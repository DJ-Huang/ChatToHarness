import Foundation
import AppKit
import ScreenCaptureKit
import CoreGraphics
import ApplicationServices
import Darwin

// Independent native helper, launched via the bounded computer_use stdio MCP adapter.
// Never executes shell commands, reads clipboard content or captures the full desktop.
@available(macOS 14.0, *)
@MainActor
final class MacComputerUse: NSObject {
    private var targetID: CGWindowID = 0
    private var targetPID: pid_t = 0
    private var targetTitle = ""
    private var targetLaunchDate: Date?
    private var inputBlockedReason: String?
    private var deadline = Date.distantFuture
    private var lastImageSize = CGSize.zero
    private var lastGeometry: [Int] = []
    private var leftHeld = false
    private var heldSince: Date?
    private var lastOcclusion: [String: Any]?
    private var stopPanel: NSPanel?
    private var hudTargetFrame = CGRect.zero
    private var activityField: NSTextField?
    private var sessionField: NSTextField?
    private var previousField: NSTextField?
    private var sessionTitle: String?
    private let sessionID: String?
    private var outlinePanel: NSPanel?
    private var stopTap: CFMachPort?
    private var stopSource: CFRunLoopSource?
    private var watchdog: Timer?
    private var cursorTimer: Timer?
    private let cursorGlow = MacCursorGlow()
    private let ownerPID: pid_t

    init(ownerPID: pid_t, sessionID: String? = nil) {
        self.ownerPID = ownerPID
        self.sessionID = sessionID
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(willTerminate),
                                               name: NSApplication.willTerminateNotification, object: nil)
    }

    @objc private func willTerminate() { releaseHeldMouse() }

    private func fail(_ code: String) -> [String: Any] { ["error": code] }
    private func emit(_ result: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let line = String(data: data, encoding: .utf8) else { return }
        print(line)
        fflush(stdout)
    }

    private func shareable() async throws -> [SCWindow] {
        guard CGPreflightScreenCaptureAccess() else { throw CUError.screen }
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        return content.windows.filter { window in
            window.owningApplication?.processID != getpid() &&
            !(window.title ?? "").isEmpty &&
            window.frame.width > 0 && window.frame.height > 0
        }
    }

    func begin(mode: String, windowID: String) async {
        do {
            let windows = try await shareable()
            if mode == "list_windows" {
                emit(["windows": Array(windows.prefix(256)).map {
                    ["window_id": String($0.windowID), "title": $0.title ?? "",
                     "pid": Int($0.owningApplication?.processID ?? 0)] as [String: Any]
                }])
                exit(0)
            }
            if mode == "probe_window" {
                // A read-only, explicitly targeted, no-disk screenshot check.
                // Does not require Accessibility or install any input event tap.
                guard let id = UInt32(windowID), let window = windows.first(where: { $0.windowID == id })
                else { throw CUError.unavailable }
                let snapshot = try await screenshot(window)
                guard let width = snapshot["width"] as? Int,
                      let height = snapshot["height"] as? Int,
                      let encoded = snapshot["png"] as? String,
                      let decoded = Data(base64Encoded: encoded) else { throw CUError.capture }
                emit(["ok": true, "window_id": String(id), "width": width, "height": height,
                      "png_bytes": decoded.count, "geometry": geometry(window)])
                exit(0)
            }
            guard mode == "all_windows" || mode == "per_window" else { throw CUError.invalid }
            let selected: SCWindow?
            if mode == "per_window" {
                selected = consent(windows: windows, suggestedID: windowID)
            } else if let number = UInt32(windowID), number != 0 {
                selected = windows.first { $0.windowID == number }
            } else {
                let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
                selected = windows.first { $0.owningApplication?.processID == front }
            }
            guard let window = selected else { throw CUError.denied }
            targetID = window.windowID
            targetPID = window.owningApplication?.processID ?? 0
            targetTitle = window.title ?? ""
            targetLaunchDate = NSRunningApplication(processIdentifier: targetPID)?.launchDate
            guard targetPID > 0 else { throw CUError.unavailable }
            // Observation requires only Screen Recording permission.
            // Control requires Accessibility *and* a working local Esc stop.
            // Missing input permissions never block read-only screenshots.
            if !AXIsProcessTrusted() {
                inputBlockedReason = CUError.accessibility.rawValue
            } else if !installLocalEsc() {
                inputBlockedReason = CUError.stopUnavailable.rawValue
            } else {
                inputBlockedReason = nil
            }
            showStop(for: window)
            if inputBlockedReason == nil { showOutline(for: window) }
            deadline = Date().addingTimeInterval(600)
            if inputBlockedReason == nil {
                cursorTimer = Timer.scheduledTimer(withTimeInterval: 0.033, repeats: true) { [weak self] _ in
                    self?.updateCursorGlow()
                }
            }
            watchdog = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    if Date() > self.deadline || kill(self.ownerPID, 0) != 0 { self.stopNow(); return }
                    if let since = self.heldSince, Date().timeIntervalSince(since) > 30 {
                        self.releaseHeldMouse()
                    }
                    self.refreshOutline()
                    self.refreshStopPosition()
                }
            }
            emit(["ready": true, "window_id": String(targetID),
                  "input_enabled": inputBlockedReason == nil,
                  "input_blocked_reason": inputBlockedReason ?? NSNull()])
            Task.detached { [weak self] in
                while let line = readLine() {
                    guard let self else { break }
                    if line.utf8.count > 20_000 {
                        await self.emit(["error": "CU_INVALID_ARGUMENT"])
                        continue
                    }
                    let json = line.data(using: .utf8).flatMap {
                        try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
                    }
                    guard let args = json else {
                        await self.emit(["error": "CU_INVALID_ARGUMENT"])
                        continue
                    }
                    let result = await self.command(args)
                    await self.emit(result)
                }
                if let self { await self.stopNow() }
            }
        } catch let error as CUError {
            emit(fail(error.rawValue))
            exit(0)
        } catch {
            emit(fail("CU_NATIVE_ERROR"))
            exit(0)
        }
    }

    private func consent(windows: [SCWindow], suggestedID: String) -> SCWindow? {
        guard !windows.isEmpty else { return nil }
        let alert = NSAlert()
        alert.messageText = "ChatToHarness — Allow window control"
        alert.informativeText = "Select one window. Control ends after 10 minutes, on Esc, or with STOP."
        alert.addButton(withTitle: "Allow selected window")
        alert.addButton(withTitle: "Cancel")
        let picker = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 460, height: 30))
        for window in windows.prefix(256) {
            picker.addItem(withTitle: "\(window.title ?? "Window") [PID \(window.owningApplication?.processID ?? 0)]")
        }
        if let i = windows.prefix(256).firstIndex(where: { String($0.windowID) == suggestedID }) {
            picker.selectItem(at: i)
        }
        alert.accessoryView = picker
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal() == .alertFirstButtonReturn ? windows[picker.indexOfSelectedItem] : nil
    }

    private func installLocalEsc() -> Bool {
        // A passive session event tap sees Esc even when another app is foreground.
        // Failure is fatal: input must never start without a local emergency stop.
        let callback: CGEventTapCallBack = { _, type, event, _ in
            if type == .keyDown && event.getIntegerValueField(.keyboardEventKeycode) == 53 {
                DispatchQueue.main.async { NSApp.terminate(nil) }
            }
            return Unmanaged.passUnretained(event)
        }
        let mask = CGEventMask(1) << CGEventType.keyDown.rawValue
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                          options: .listenOnly, eventsOfInterest: mask,
                                          callback: callback, userInfo: nil) else { return false }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        stopTap = tap
        stopSource = source
        return CGEvent.tapIsEnabled(tap: tap)
    }

    // A high-contrast but translucent HUD stays on the top-center edge of the
    // monitor containing the controlled window. It never becomes the target
    // of automation; only a human can press its STOP control.
    private func hudText(_ key: String) -> String {
        let isChinese = Locale.preferredLanguages.first?.hasPrefix("zh") == true
        let names: [String: (String, String)] = [
            "idle": ("等待下一步操作", "Waiting for next action"),
            "observe": ("正在截取窗口截图", "Capturing window"),
            "activate": ("正在激活目标窗口", "Activating target window"),
            "moving": ("正在移动鼠标", "Moving mouse pointer"),
            "mouse_move": ("正在移动鼠标", "Moving mouse"),
            "mouse_down": ("正在按住鼠标", "Holding mouse button"),
            "mouse_drag": ("正在拖动窗口", "Dragging mouse"),
            "drag_window": ("正在拖动窗口", "Dragging window"),
            "mouse_up": ("正在松开鼠标", "Releasing mouse"),
            "click": ("正在点击鼠标", "Clicking mouse"),
            "scroll": ("正在滚动", "Scrolling"),
            "type_text": ("正在输入文字", "Typing text"),
            "key_press": ("正在发送按键", "Sending keystroke")
        ]
        let value = names[key] ?? names["idle"]!
        return isChinese ? value.0 : value.1
    }

    private func updateHUD(_ key: String) {
        let prefix = Locale.preferredLanguages.first?.hasPrefix("zh") == true ? "当前：" : "Now: "
        activityField?.stringValue = prefix + hudText(key)
    }

    private func completeHUD(_ key: String, error: String?) {
        // Only bounded action names and status codes; never typed text,
        // screenshots, keystrokes, or window contents.
        let chinese = Locale.preferredLanguages.first?.hasPrefix("zh") == true
        let outcome = error == nil ? (chinese ? "完成" : "Done") : (chinese ? "失败" : "Failed")
        let time = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .short)
        let title = hudText(key)
        let normalized = chinese ? title.replacingOccurrences(of: "正在", with: "") : title
        previousField?.stringValue = (chinese ? "上一步：" : "Previous: ") +
            normalized + " · " + outcome + " · " + time
        previousField?.toolTip = error
        updateHUD("idle")
    }

    private func updateSessionTitle(_ title: String) {
        sessionTitle = title
        let chinese = Locale.preferredLanguages.first?.hasPrefix("zh") == true
        sessionField?.stringValue = (chinese ? "会话：" : "Conversation: ") + title
        sessionField?.toolTip = title
    }

    private func hudFrame() -> NSRect {
        let width: CGFloat = 530
        let height: CGFloat = 140
        let targetFrame = cgToAppKit(hudTargetFrame)
        let screens = NSScreen.screens
        let screen = screens.max(by: { a, b in
            (a.frame.intersection(targetFrame).width * a.frame.intersection(targetFrame).height)
                < (b.frame.intersection(targetFrame).width * b.frame.intersection(targetFrame).height)
        }) ?? NSScreen.main
        let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let panelWidth = min(width, max(280, visible.width - 20))
        return NSRect(x: visible.midX - panelWidth / 2,
                      y: max(visible.minY, visible.maxY - height - 10),
                      width: panelWidth, height: height)
    }

    private func refreshStopPosition() {
        guard let stopPanel else { return }
        let rect = hudFrame()
        if stopPanel.frame != rect { stopPanel.setFrame(rect, display: true) }
        if !stopPanel.isVisible { stopPanel.orderFrontRegardless() }
    }

    private func showStop(for window: SCWindow) {
        // Store the target's original screen geometry, so a HUD can select
        // the correct display even before the first screenshot.
        hudTargetFrame = window.frame
        let panel = NSPanel(contentRect: hudFrame(),
                            styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered, defer: false)
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        // A rectangular window shadow or a square visual-effect backdrop
        // produces visible spikes at the four rounded corners. The dark HUD
        // surface itself provides the only fill and clips to its rounded path.
        panel.hasShadow = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        let surface = MacHUDSurface(frame: NSRect(origin: .zero, size: panel.frame.size))
        surface.autoresizingMask = [.width, .height]

        let title = NSTextField(labelWithString: "● ChatToHarness · Computer Use")
        title.font = NSFont.boldSystemFont(ofSize: 14)
        title.textColor = MacHUDSurface.titleColor
        title.frame = NSRect(x: 18, y: 103, width: max(110, panel.frame.width - 164), height: 21)
        title.autoresizingMask = [.width]
        title.lineBreakMode = .byTruncatingTail
        surface.addSubview(title)

        // No reliable conversation title in standalone MCP metadata by default.
        // Preserve the native UUID as a diagnostic tooltip, not display text.
        let chinese = Locale.preferredLanguages.first?.hasPrefix("zh") == true
        let session = NSTextField(labelWithString: chinese ? "会话：名称未提供" : "Conversation: title unavailable")
        session.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        session.textColor = MacHUDSurface.secondaryTextColor
        session.lineBreakMode = .byTruncatingTail
        session.frame = NSRect(x: 18, y: 81, width: max(110, panel.frame.width - 164), height: 18)
        session.autoresizingMask = [.width]
        session.toolTip = sessionID.map { "Computer Use session \($0)" } ?? "External native helper session"
        surface.addSubview(session)
        sessionField = session

        let activity = NSTextField(labelWithString: "")
        activity.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        activity.textColor = MacHUDSurface.primaryTextColor
        activity.frame = NSRect(x: 18, y: 51, width: max(110, panel.frame.width - 164), height: 23)
        activity.autoresizingMask = [.width]
        activity.lineBreakMode = .byTruncatingTail
        surface.addSubview(activity)
        activityField = activity
        updateHUD("idle")

        let previous = NSTextField(labelWithString: chinese ? "上一步：暂无" : "Previous: none")
        previous.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        previous.textColor = MacHUDSurface.secondaryTextColor
        previous.frame = NSRect(x: 18, y: 23, width: max(110, panel.frame.width - 164), height: 21)
        previous.autoresizingMask = [.width]
        previous.lineBreakMode = .byTruncatingTail
        surface.addSubview(previous)
        previousField = previous

        let button = NSButton(title: "STOP  ·  Esc", target: self,
                              action: #selector(stopPressed))
        button.frame = NSRect(x: panel.frame.width - 133, y: 45, width: 116, height: 43)
        button.autoresizingMask = [.minXMargin]
        button.isBordered = false
        button.wantsLayer = true
        button.layer?.cornerRadius = 9
        button.layer?.backgroundColor = NSColor(calibratedRed: 0.91, green: 0.19,
                                                 blue: 0.25, alpha: 0.97).cgColor
        button.contentTintColor = .white
        button.font = NSFont.boldSystemFont(ofSize: 13)
        surface.addSubview(button)
        panel.contentView = surface
        panel.orderFrontRegardless()
        stopPanel = panel
    }

    // Mouse-transparent native highlight follows only the authorized window.
    // No fake pointer or click-position ring is drawn.
    private func cgToAppKit(_ bounds: CGRect) -> NSRect {
        let main = CGDisplayBounds(CGMainDisplayID())
        return NSRect(x: bounds.minX, y: main.maxY - bounds.maxY,
                      width: bounds.width, height: bounds.height)
    }

    private func showOutline(for window: SCWindow) {
        let panel = NSPanel(contentRect: cgToAppKit(window.frame),
                            styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered, defer: false)
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.ignoresMouseEvents = true
        panel.hasShadow = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.contentView?.wantsLayer = true
        panel.contentView?.layer?.borderWidth = 7
        panel.contentView?.layer?.borderColor = NSColor(calibratedRed: 0.47, green: 0.76,
                                                        blue: 1, alpha: 0.70).cgColor
        panel.contentView?.layer?.cornerRadius = 9
        panel.orderFrontRegardless()
        outlinePanel = panel
    }

    private func refreshOutline() {
        guard let panel = outlinePanel else { return }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID,
              let data = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                                    kCGNullWindowID) as? [[String: Any]],
              let info = data.first(where: {
                  ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == targetID
              }),
              let bounds = info[kCGWindowBounds as String] as? [String: Any],
              let x = bounds["X"] as? NSNumber, let y = bounds["Y"] as? NSNumber,
              let width = bounds["Width"] as? NSNumber, let height = bounds["Height"] as? NSNumber
        else { panel.orderOut(nil); return }
        hudTargetFrame = CGRect(x: x.doubleValue, y: y.doubleValue,
                                 width: width.doubleValue, height: height.doubleValue)
        let rect = cgToAppKit(hudTargetFrame)
        if panel.frame != rect { panel.setFrame(rect, display: true) }
        if !panel.isVisible { panel.orderFrontRegardless() }
    }

    private func updateCursorGlow() {
        guard targetID != 0, CGPreflightScreenCaptureAccess(),
              NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                                       kCGNullWindowID) as? [[String: Any]],
              let record = windows.first(where: {
                  ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == targetID
              }),
              let bounds = record[kCGWindowBounds as String] as? [String: Any],
              let x = bounds["X"] as? NSNumber, let y = bounds["Y"] as? NSNumber,
              let w = bounds["Width"] as? NSNumber, let h = bounds["Height"] as? NSNumber else {
            cursorGlow.update(target: .zero, frontmost: false)
            return
        }
        cursorGlow.update(target: CGRect(x: x.doubleValue, y: y.doubleValue,
                                        width: w.doubleValue, height: h.doubleValue),
                          frontmost: true)
    }

    @objc private func stopPressed() { stopNow() }
    private func stopNow() {
        releaseHeldMouse()
        watchdog?.invalidate()
        cursorTimer?.invalidate()
        cursorGlow.stop()
        stopPanel?.close()
        activityField = nil
        sessionField = nil
        previousField = nil
        outlinePanel?.close()
        if let source = stopSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        stopSource = nil
        stopTap = nil
        exit(0)
    }

    private func currentWindow(requireForeground: Bool) async throws -> SCWindow {
        guard Date() <= deadline else { throw CUError.expired }
        guard CGPreflightScreenCaptureAccess() else { throw CUError.screen }
        if requireForeground {
            guard inputBlockedReason == nil else { throw CUError.accessibility }
            guard AXIsProcessTrusted() else { throw CUError.accessibility }
            guard stopTap.map({ CGEvent.tapIsEnabled(tap: $0) }) == true else { throw CUError.stopUnavailable }
        }
        guard let window = try await shareable().first(where: { $0.windowID == targetID }) else { throw CUError.unavailable }
        guard window.owningApplication?.processID == targetPID &&
              NSRunningApplication(processIdentifier: targetPID)?.launchDate == targetLaunchDate else { throw CUError.changed }
        if requireForeground && NSWorkspace.shared.frontmostApplication?.processIdentifier != targetPID {
            throw CUError.foreground
        }
        return window
    }

    private func geometry(_ window: SCWindow) -> [Int] {
        [Int(window.frame.minX), Int(window.frame.minY), Int(window.frame.maxX), Int(window.frame.maxY)]
    }

    private func screenshot(_ window: SCWindow) async throws -> [String: Any] {
        let configuration = SCStreamConfiguration()
        // The native window rect is in desktop points; image dimensions are pixels.
        // Use the display's backing scale, never a universal Retina=2 assumption.
        var displayIDs = [CGDirectDisplayID](repeating: 0, count: 32)
        var displayCount: UInt32 = 0
        var scale: CGFloat = 1
        if CGGetActiveDisplayList(32, &displayIDs, &displayCount) == .success {
            var intersectionArea: CGFloat = 0
            for id in displayIDs.prefix(Int(displayCount)) {
                let bounds = CGDisplayBounds(id)
                let overlap = bounds.intersection(window.frame)
                let area = overlap.isNull ? 0 : overlap.width * overlap.height
                if area > intersectionArea && bounds.width > 0 {
                    intersectionArea = area
                    scale = CGFloat(CGDisplayPixelsWide(id)) / bounds.width
                }
            }
        }
        configuration.width = max(1, Int((window.frame.width * scale).rounded()))
        configuration.height = max(1, Int((window.frame.height * scale).rounded()))
        configuration.showsCursor = true
        guard configuration.width <= 4096, configuration.height <= 4096,
              configuration.width * configuration.height <= 8_388_608 else { throw CUError.capture }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]),
              png.count <= 40 * 1024 * 1024 else { throw CUError.capture }
        lastImageSize = CGSize(width: image.width, height: image.height)
        lastGeometry = geometry(window)
        return ["width": image.width, "height": image.height,
                "geometry": lastGeometry, "displays": desktopDisplays(), "png": png.base64EncodedString()]
    }

    private func checkUserIdle(allowHeld: Bool = false) throws {
        let flags = CGEventSource.flagsState(.combinedSessionState)
        if !flags.intersection([.maskCommand, .maskControl, .maskShift, .maskAlternate]).isEmpty ||
           (!allowHeld && CGEventSource.buttonState(.combinedSessionState, button: .left)) ||
           CGEventSource.buttonState(.combinedSessionState, button: .right) {
            throw CUError.userActive
        }
    }

    private func point(_ args: [String: Any], window: SCWindow) throws -> CGPoint {
        guard let x = args["x"] as? Int, let y = args["y"] as? Int,
              x >= 0, y >= 0, x < Int(lastImageSize.width), y < Int(lastImageSize.height),
              lastImageSize.width > 0, lastImageSize.height > 0 else { throw CUError.invalid }
        return CGPoint(x: window.frame.minX + CGFloat(x) * window.frame.width / lastImageSize.width,
                       y: window.frame.minY + CGFloat(y) * window.frame.height / lastImageSize.height)
    }


    private func checkLivePointerTarget() throws { try checkLivePointerTargetDuringDrag(allowMovingWindow: false) }
    private func checkLivePointerTargetDuringDrag(allowMovingWindow: Bool) throws {
        guard Date() <= deadline else { throw CUError.expired }
        guard CGPreflightScreenCaptureAccess() else { throw CUError.screen }
        guard AXIsProcessTrusted() else { throw CUError.accessibility }
        guard stopTap.map({ CGEvent.tapIsEnabled(tap: $0) }) == true else { throw CUError.stopUnavailable }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID,
              NSRunningApplication(processIdentifier: targetPID)?.launchDate == targetLaunchDate
        else { throw CUError.foreground }
        guard let data = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                                   kCGNullWindowID) as? [[String: Any]],
              let info = data.first(where: {
                  ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == targetID
              }),
              (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == targetPID,
              let bounds = info[kCGWindowBounds as String] as? [String: Any],
              let x = bounds["X"] as? NSNumber, let y = bounds["Y"] as? NSNumber,
              let width = bounds["Width"] as? NSNumber, let height = bounds["Height"] as? NSNumber
        else { throw CUError.unavailable }
        let rect = [Int(x.doubleValue), Int(y.doubleValue),
                    Int(x.doubleValue + width.doubleValue), Int(y.doubleValue + height.doubleValue)]
        guard allowMovingWindow || rect == lastGeometry else { throw CUError.moved }
    }

    // Move the physical macOS cursor at a visibly human-paced speed.
    // A monotonic clock prevents frame rates or window checks from shortening
    // long moves; the 60 Hz target leaves enough time for the native glow.
    // Typical moves: 100pt ≈ 0.29s, 500pt ≈ 0.76s, 1000pt ≈ 1.35s.
    private func movePointer(to destination: CGPoint, dragging: Bool = false) async throws {
        let source = CGEventSource(stateID: .combinedSessionState)
        guard let start = CGEvent(source: nil)?.location else { throw CUError.input }
        let displays = MacCursorTrajectory.activeDisplays()
        guard let waypoints = MacCursorTrajectory.route(from: start, to: destination,
                                                        displays: displays) else { throw CUError.input }
        let distance = MacCursorTrajectory.length(of: waypoints)
        // Scale travel time to actual on-screen route length. Cross-monitor
        // paths can take several seconds instead of "teleporting" through gaps.
        let duration = min(3.6, max(0.24, 0.17 + Double(distance) / 850.0))
        let sameDisplay = waypoints.count == 2 ? displays.first(where: {
            $0.contains(start) && $0.contains(destination)
        }) : nil
        let startedAt = ProcessInfo.processInfo.systemUptime
        // Quartz may deliver a posted cursor event a few frames later.
        // Keep a short history of our OWN emitted positions, rather than
        // mistaking OS event delivery latency for human mouse intervention.
        var recentExpected = [start]

        while true {
            try Task.checkCancellation()
            if dragging { try checkLivePointerTargetDuringDrag(allowMovingWindow: true) }
            else { try checkLivePointerTarget() }
            try checkUserIdle(allowHeld: dragging)
            if let physical = CGEvent(source: nil)?.location,
               !recentExpected.contains(where: {
                   hypot(physical.x - $0.x, physical.y - $0.y) <= 18
               }) {
                throw CUError.pointerOffPath
            }

            let elapsed = ProcessInfo.processInfo.systemUptime - startedAt
            let t = min(1.0, max(0.0, elapsed / duration))
            // Quintic ease-in/out: the cursor accelerates, travels, then slows.
            let eased = t * t * t * (t * (t * 6 - 15) + 10)
            let next = MacCursorTrajectory.position(at: eased, along: waypoints,
                                                    display: sameDisplay)
            let event: CGEvent?
            if dragging {
                event = CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged,
                                mouseCursorPosition: next, mouseButton: .left)
            } else {
                event = CGEvent(mouseEventSource: source, mouseType: .mouseMoved,
                                mouseCursorPosition: next, mouseButton: .left)
            }
            guard let event else { throw CUError.input }
            event.post(tap: .cghidEventTap)
            recentExpected.append(next)
            if recentExpected.count > 12 { recentExpected.removeFirst() }
            if t >= 1 { break }
            try await Task.sleep(nanoseconds: 16_000_000)
        }
    }

    // CGWindow bounds alone over-report occlusion for click-through overlays and
    // window shadows. Require a foreground rectangle AND corroborate actual AX
    // hit testing when possible. Unknown AX results remain fail-closed.
    // Only IDs/owner metadata are returned; never leak another window's title.
    private func occluder(at point: CGPoint) -> [String: Any]? {
        guard let data = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                                  kCGNullWindowID) as? [[String: Any]] else {
            return ["reason": "window_list_unavailable"]
        }
        for window in data {
            guard let number = window[kCGWindowNumber as String] as? NSNumber,
                  let owner = window[kCGWindowOwnerPID as String] as? NSNumber else { continue }
            if number.uint32Value == targetID { return nil }
            if owner.int32Value == getpid() { continue } // Own click-through HUD/glow.
            guard let rect = window[kCGWindowBounds as String] as? [String: Any],
                  let x = rect["X"] as? NSNumber, let y = rect["Y"] as? NSNumber,
                  let width = rect["Width"] as? NSNumber, let height = rect["Height"] as? NSNumber else { continue }
            let frame = CGRect(x: x.doubleValue, y: y.doubleValue,
                               width: width.doubleValue, height: height.doubleValue)
            if !frame.contains(point) { continue }

            // An on-screen rectangle may be transparent to pointer events.
            // AX hit testing identifies the real receiver; never trust alpha
            // alone, since a transparent window can still intercept clicks.
            var element: AXUIElement?
            let hit = AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(),
                                                       Float(point.x), Float(point.y), &element)
            if hit == .success, let element {
                var hitPID: pid_t = 0
                // A *different window of the same target app* must not be
                // confused with the scoped target window.
                if owner.int32Value != targetPID,
                   AXUIElementGetPid(element, &hitPID) == .success, hitPID == targetPID {
                    return nil
                }
            }
            return ["reason": "window_above_target", "window_id": String(number.uint32Value),
                    "owner_pid": Int(owner.int32Value),
                    "owner": window[kCGWindowOwnerName as String] as? String ?? "",
                    "layer": (window[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0,
                    "alpha": (window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? -1,
                    "bounds": [Int(frame.minX), Int(frame.minY),
                               Int(frame.width), Int(frame.height)],
                    "ax_hit_test": hit == .success ? "checked" : "unavailable"]
        }
        return ["reason": "target_not_in_window_list"]
    }

    private func requireUnoccluded(_ point: CGPoint) throws {
        lastOcclusion = occluder(at: point)
        if lastOcclusion != nil { throw CUError.occluded }
    }

    private func mouse(_ type: CGEventType, at position: CGPoint, button: CGMouseButton) throws {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type,
                                  mouseCursorPosition: position, mouseButton: button) else { throw CUError.input }
        event.post(tap: .cghidEventTap)
    }

    private func releaseHeldMouse() {
        guard leftHeld else { return }
        // Always attempt release, including STOP, timeout and failed drag.
        let here = CGEvent(source: nil)?.location ?? CGPoint.zero
        try? mouse(.leftMouseUp, at: here, button: .left)
        leftHeld = false
        heldSince = nil
    }

    private func desktopDisplays() -> [[String: Int]] {
        MacCursorTrajectory.activeDisplays().map { rect in
            ["x": Int(rect.minX), "y": Int(rect.minY),
             "width": Int(rect.width), "height": Int(rect.height)]
        }
    }

    private func key(_ code: CGKeyCode, flags: CGEventFlags = []) throws {
        // Post shortcut's keyDown and keyUp carrying the modifier flags.
        // Always send a final modifier keyUp with no flags to avoid leaving
        // macOS in a synthetic Command/Shift-held state.
        let modifier: CGKeyCode? = flags.contains(.maskCommand) ? 55 :
                                   flags.contains(.maskShift) ? 56 : nil
        defer {
            if let modifier,
               let release = CGEvent(keyboardEventSource: nil, virtualKey: modifier, keyDown: false) {
                release.flags = []
                release.post(tap: .cghidEventTap)
            }
        }
        for down in [true, false] {
            guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
            else { throw CUError.input }
            event.flags = flags
            event.post(tap: .cghidEventTap)
        }
    }

    private func typeText(_ value: String) throws {
        guard !value.isEmpty && value.utf16.count <= 1000 &&
              !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            throw CUError.invalid
        }
        for scalar in value.unicodeScalars {
            let utf16 = Array(String(scalar).utf16)
            try utf16.withUnsafeBufferPointer { buffer in
                for down in [true, false] {
                    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else { throw CUError.input }
                    event.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
                    event.post(tap: .cghidEventTap)
                }
            }
        }
    }

    private func press(_ value: String) throws {
        let codes: [String: CGKeyCode] = [
            "ENTER": 36, "TAB": 48, "BACKSPACE": 51, "DELETE": 117,
            "LEFT": 123, "RIGHT": 124, "UP": 126, "DOWN": 125,
            "HOME": 115, "END": 119, "PAGEUP": 116, "PAGEDOWN": 121
        ]
        if value == "SHIFT+TAB" { try key(48, flags: .maskShift); return }
        if value.hasPrefix("CTRL+"), value.count == 6 {
            let letters: [String: CGKeyCode] = ["A":0, "C":8, "V":9, "Z":6, "Y":16]
            guard let code = letters[String(value.suffix(1))] else { throw CUError.invalid }
            // The cross-platform CTRL+ aliases map to macOS Command shortcuts.
            try key(code, flags: .maskCommand)
            return
        }
        guard let code = codes[value] else { throw CUError.invalid }
        try key(code)
    }

    private func command(_ args: [String: Any]) async -> [String: Any] {
        guard let action = args["action"] as? String else { return fail(CUError.invalid.rawValue) }
        // This command can be sent only through the native helper's private stdio.
        // It carries an optional supplied title and does not generate GUI input.
        if action == "set_session_title" {
            guard let title = args["title"] as? String,
                  !title.trimmingCharacters(in: .whitespaces).isEmpty,
                  title.utf16.count <= 80,
                  !title.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
            else { return fail(CUError.invalid.rawValue) }
            updateSessionTitle(title)
            return ["ok": true]
        }
        updateHUD(action)
        let result = await executeAction(args)
        completeHUD(action, error: result["error"] as? String)
        return result
    }

    private func executeAction(_ args: [String: Any]) async -> [String: Any] {
        do {
            guard let action = args["action"] as? String else { throw CUError.invalid }
            // Release must work even if dragging changed the target geometry or focus.
            if action == "mouse_up" {
                guard leftHeld else { throw CUError.notHeld }
                releaseHeldMouse()
                lastImageSize = .zero
                lastGeometry = []
                return ["ok": true]
            }
            if leftHeld && action != "observe" && action != "mouse_drag" { throw CUError.buttonHeld }
            if action == "mouse_drag" && !leftHeld { throw CUError.notHeld }
            let window = try await currentWindow(requireForeground: action != "observe" && action != "activate")
            if action == "observe" { return try await screenshot(window) }
            if let reason = inputBlockedReason { return fail(reason) }
            if action == "activate" {
                guard let app = NSRunningApplication(processIdentifier: targetPID),
                      app.activate(options: []) else { throw CUError.activation }
                return ["foreground": true]
            }
            guard let expected = args["geometry"] as? [Int], expected.count == 4,
                  expected == geometry(window), expected == lastGeometry,
                  lastImageSize.width > 0 else { throw CUError.moved }
            try checkUserIdle(allowHeld: action == "mouse_drag")
            switch action {
            case "click", "scroll", "mouse_move", "mouse_down", "drag_window":
                let position = try point(args, window: window)
                // A single native drag avoids losing a held mouse between MCP
                // calls, screenshots and the 30-second safety watchdog.
                if action == "drag_window" {
                    guard let y = args["y"] as? Int, let x = args["x"] as? Int,
                          y >= 8, y <= min(48, Int(lastImageSize.height) - 1),
                          x >= 72, x < Int(lastImageSize.width) - 16,
                          let sx = args["screen_x"] as? Int,
                          let sy = args["screen_y"] as? Int else { throw CUError.invalid }
                    let destination = CGPoint(x: sx, y: sy)
                    guard MacCursorTrajectory.activeDisplays().contains(where: { $0.contains(destination) })
                    else { throw CUError.outsideDisplay }
                    // Retry ONLY read-only hit tests of at most three title-bar
                    // points before pressing. No uncertain mouse action is replayed.
                    // Shift the destination by the chosen origin delta so the
                    // requested final window position remains unchanged.
                    let imageWidth = Int(lastImageSize.width)
                    let maxX = imageWidth - 17
                    let leftX = min(maxX, 85)
                    let middleX = max(72, min(maxX, imageWidth / 2))
                    let candidates = [x, leftX, middleX]
                    var tried = Set<Int>()
                    var selected: CGPoint?
                    var blocked = [[String: Any]]()
                    for candidateX in candidates {
                        if !tried.insert(candidateX).inserted { continue }
                        let candidate = CGPoint(x: window.frame.minX +
                            CGFloat(candidateX) * window.frame.width / lastImageSize.width,
                            y: position.y)
                        if let reason = occluder(at: candidate) {
                            blocked.append(["candidate_x": candidateX, "blocker": reason])
                        } else {
                            selected = candidate
                            break
                        }
                    }
                    guard let start = selected else {
                        lastOcclusion = ["reason": "all_titlebar_candidates_blocked",
                                         "candidates": blocked]
                        throw CUError.occluded
                    }
                    let shiftedDestination = CGPoint(x: destination.x + start.x - position.x,
                                                     y: destination.y)
                    guard MacCursorTrajectory.activeDisplays().contains(where: {
                        $0.contains(shiftedDestination)
                    }) else { throw CUError.outsideDisplay }
                    updateHUD("moving")
                    try await movePointer(to: start)
                    let latest = try await currentWindow(requireForeground: true)
                    guard geometry(latest) == expected else { throw CUError.moved }
                    try requireUnoccluded(start)
                    updateHUD("mouse_down")
                    try mouse(.leftMouseDown, at: start, button: .left)
                    leftHeld = true
                    heldSince = Date()
                    updateHUD("mouse_drag")
                    try await movePointer(to: shiftedDestination, dragging: true)
                    releaseHeldMouse()
                    break
                }
                updateHUD("moving")
                try await movePointer(to: position)
                updateHUD(action)
                let latest = try await currentWindow(requireForeground: true)
                guard geometry(latest) == expected else { throw CUError.moved }
                try requireUnoccluded(position)
                if action == "mouse_down" {
                    try mouse(.leftMouseDown, at: position, button: .left)
                    leftHeld = true
                    heldSince = Date()
                } else if action == "click" {
                    let right = (args["button"] as? String) == "right"
                    try mouse(right ? .rightMouseDown : .leftMouseDown, at: position, button: right ? .right : .left)
                    try mouse(right ? .rightMouseUp : .leftMouseUp, at: position, button: right ? .right : .left)
                } else if action == "scroll" {
                    guard let delta = args["delta"] as? Int, delta != 0, abs(delta) <= 10,
                          let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1,
                                              wheel1: Int32(delta), wheel2: 0, wheel3: 0) else { throw CUError.invalid }
                    event.post(tap: .cghidEventTap)
                }
            case "mouse_drag":
                guard let sx = args["screen_x"] as? Int, let sy = args["screen_y"] as? Int else { throw CUError.invalid }
                let destination = CGPoint(x: sx, y: sy)
                guard MacCursorTrajectory.activeDisplays().contains(where: { $0.contains(destination) }) else { throw CUError.outsideDisplay }
                try await movePointer(to: destination, dragging: true)
                heldSince = Date()
            case "type_text":
                guard let text = args["text"] as? String else { throw CUError.invalid }
                try typeText(text)
            case "key_press":
                guard let keyName = args["key"] as? String else { throw CUError.invalid }
                try press(keyName)
            default: throw CUError.invalid
            }
            lastImageSize = .zero
            lastGeometry = []
            return ["ok": true]
        } catch let error as CUError {
            releaseHeldMouse()
            if error == .occluded {
                return ["error": error.rawValue,
                        "occlusion": lastOcclusion ?? ["reason": "unknown"]]
            }
            return fail(error.rawValue)
        } catch {
            releaseHeldMouse()
            return fail("CU_NATIVE_ERROR")
        }
    }

    enum CUError: String, Error {
        case invalid = "CU_INVALID_ARGUMENT"
        case screen = "CU_SCREEN_RECORDING_REQUIRED"
        case denied = "CU_CONSENT_DENIED"
        case accessibility = "CU_ACCESSIBILITY_REQUIRED"
        case stopUnavailable = "CU_STOP_HOTKEY_UNAVAILABLE"
        case unavailable = "CU_WINDOW_UNAVAILABLE"
        case changed = "CU_WINDOW_CHANGED"
        case foreground = "CU_WINDOW_NOT_FOREGROUND"
        case moved = "CU_WINDOW_MOVED"
        case expired = "CU_SESSION_EXPIRED"
        case capture = "CU_CAPTURE_UNSUPPORTED"
        case userActive = "CU_USER_INPUT_ACTIVE"
        case pointerOffPath = "CU_POINTER_OFF_PATH"
        case input = "CU_INPUT_FAILED"
        case occluded = "CU_TARGET_OCCLUDED"
        case activation = "CU_ACTIVATION_FAILED"
        case notHeld = "CU_MOUSE_NOT_HELD"
        case buttonHeld = "CU_MOUSE_BUTTON_HELD"
        case outsideDisplay = "CU_COORDINATE_OUTSIDE_DISPLAY"
    }
}

@available(macOS 14.0, *)
@main
struct MacComputerUseMain {
    static func main() {
        // Permission diagnostics are explicitly opt-in and cannot activate input.
        if CommandLine.arguments.count == 2,
           ["permission_status", "request_permissions"].contains(CommandLine.arguments[1]) {
            let request = CommandLine.arguments[1] == "request_permissions"
            let screen = request ? CGRequestScreenCaptureAccess() : CGPreflightScreenCaptureAccess()
            let options: CFDictionary = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: request] as CFDictionary
            let accessibility = request ? AXIsProcessTrustedWithOptions(options) : AXIsProcessTrusted()
            // Accessibility authorizes both CGEvent posting and the listen-only Esc tap.
            // Do not separately request Input Monitoring: it is redundant for this helper.
            let data: [String: Any] = [
                "screen_recording": screen,
                "accessibility": accessibility,
                "request_attempted": request,
                "identity_hint": "TCC grants belong to the actual process/app identity; restart the helper after changing macOS Privacy & Security."
            ]
            if let encoded = try? JSONSerialization.data(withJSONObject: data),
               let json = String(data: encoded, encoding: .utf8) { print(json) }
            return
        }
        guard (CommandLine.arguments.count == 4 || CommandLine.arguments.count == 5),
              let parent = Int32(CommandLine.arguments[1]),
              parent > 0 else {
            print("{\"error\":\"CU_OWNER_REQUIRED\"}")
            return
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let sessionID = CommandLine.arguments.count == 5 ? CommandLine.arguments[4] : nil
        if let id = sessionID, UUID(uuidString: id) == nil { exit(2) }
        let helper = MacComputerUse(ownerPID: parent, sessionID: sessionID)
        Task { await helper.begin(mode: CommandLine.arguments[2], windowID: CommandLine.arguments[3]) }
        app.run()
    }
}
