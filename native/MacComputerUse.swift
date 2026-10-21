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
    private var stopPanel: NSPanel?
    private var outlinePanel: NSPanel?
    private var stopTap: CFMachPort?
    private var stopSource: CFRunLoopSource?
    private var watchdog: Timer?
    private var cursorTimer: Timer?
    private let cursorGlow = MacCursorGlow()
    private let ownerPID: pid_t

    init(ownerPID: pid_t) {
        self.ownerPID = ownerPID
        super.init()
    }

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
            showStop()
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
                    self.refreshOutline()
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
                exit(0)
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

    private func showStop() {
        let panel = NSPanel(contentRect: NSRect(x: 24, y: 24, width: 320, height: 52),
                            styleMask: [.titled, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "ChatToHarness — Computer Use"
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        let button = NSButton(title: "Controlling one window · Esc / STOP",
                              target: self, action: #selector(stopPressed))
        button.frame = NSRect(x: 10, y: 8, width: 300, height: 34)
        panel.contentView?.addSubview(button)
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
        let rect = cgToAppKit(CGRect(x: x.doubleValue, y: y.doubleValue,
                                     width: width.doubleValue, height: height.doubleValue))
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
        watchdog?.invalidate()
        cursorTimer?.invalidate()
        cursorGlow.stop()
        stopPanel?.close()
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
                "geometry": lastGeometry, "png": png.base64EncodedString()]
    }

    private func checkUserIdle() throws {
        let flags = CGEventSource.flagsState(.combinedSessionState)
        if !flags.intersection([.maskCommand, .maskControl, .maskShift, .maskAlternate]).isEmpty ||
           CGEventSource.buttonState(.combinedSessionState, button: .left) ||
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


    private func checkLivePointerTarget() throws {
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
        guard rect == lastGeometry else { throw CUError.moved }
    }

    // Move the physical macOS cursor at a visibly human-paced speed.
    // A monotonic clock prevents frame rates or window checks from shortening
    // long moves; the 60 Hz target leaves enough time for the native glow.
    // Typical moves: 100pt ≈ 0.29s, 500pt ≈ 0.76s, 1000pt ≈ 1.35s.
    private func movePointer(to destination: CGPoint) async throws {
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
            try checkLivePointerTarget()
            try checkUserIdle()
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
            guard let event = CGEvent(mouseEventSource: source, mouseType: .mouseMoved,
                                      mouseCursorPosition: next, mouseButton: .left)
            else { throw CUError.input }
            event.post(tap: .cghidEventTap)
            recentExpected.append(next)
            if recentExpected.count > 12 { recentExpected.removeFirst() }
            if t >= 1 { break }
            try await Task.sleep(nanoseconds: 16_000_000)
        }
    }

    // Ensure that an unrelated app or modal above the target cannot receive a
    // click. Own STOP/overlay windows are ignored, as they belong to our PID.
    private func isOccluded(at point: CGPoint) -> Bool {
        guard let data = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                    as? [[String: Any]] else { return true }
        for window in data {
            guard let number = window[kCGWindowNumber as String] as? NSNumber,
                  let owner = window[kCGWindowOwnerPID as String] as? NSNumber else { continue }
            if number.uint32Value == targetID { return false }
            if owner.int32Value == getpid() { continue }
            guard let rect = window[kCGWindowBounds as String] as? [String: Any],
                  let x = rect["X"] as? NSNumber, let y = rect["Y"] as? NSNumber,
                  let width = rect["Width"] as? NSNumber, let height = rect["Height"] as? NSNumber else { continue }
            let frame = CGRect(x: x.doubleValue, y: y.doubleValue,
                               width: width.doubleValue, height: height.doubleValue)
            if frame.contains(point) { return true }
        }
        return true
    }

    private func mouse(_ type: CGEventType, at position: CGPoint, button: CGMouseButton) throws {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type,
                                  mouseCursorPosition: position, mouseButton: button) else { throw CUError.input }
        event.post(tap: .cghidEventTap)
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
        do {
            guard let action = args["action"] as? String else { throw CUError.invalid }
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
            try checkUserIdle()
            switch action {
            case "click", "scroll":
                let position = try point(args, window: window)
                try await movePointer(to: position)
                let latest = try await currentWindow(requireForeground: true)
                guard geometry(latest) == expected else { throw CUError.moved }
                guard !isOccluded(at: position) else { throw CUError.occluded }
                if action == "click" {
                    let right = (args["button"] as? String) == "right"
                    try mouse(right ? .rightMouseDown : .leftMouseDown, at: position, button: right ? .right : .left)
                    try mouse(right ? .rightMouseUp : .leftMouseUp, at: position, button: right ? .right : .left)
                } else {
                    guard let delta = args["delta"] as? Int, delta != 0, abs(delta) <= 10,
                          let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1,
                                              wheel1: Int32(delta), wheel2: 0, wheel3: 0) else { throw CUError.invalid }
                    event.post(tap: .cghidEventTap)
                }
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
        } catch let error as CUError { return fail(error.rawValue) }
        catch { return fail("CU_NATIVE_ERROR") }
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
        guard CommandLine.arguments.count == 4, let parent = Int32(CommandLine.arguments[1]),
              parent > 0 else {
            print("{\"error\":\"CU_OWNER_REQUIRED\"}")
            return
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let helper = MacComputerUse(ownerPID: parent)
        Task { await helper.begin(mode: CommandLine.arguments[2], windowID: CommandLine.arguments[3]) }
        app.run()
    }
}
