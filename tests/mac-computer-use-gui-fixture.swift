import AppKit
import CoreGraphics
import Foundation

// Disposable, local-only GUI fixture used to verify real CGEvent delivery.
// It never reads user files, clipboard, network, or other applications.
@MainActor final class AcceptanceFixture: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var button: NSButton!
    private var field: NSTextField!
    private var scrollArea: ScrollTarget!
    private var ticks: Timer?
    private var motionSampler: Timer?
    private var cursorTrace = [[String: Double]]()
    private var clicks = 0
    private var scrollEvents = 0
    private var scrollDelta = 0.0
    private var pointerNudges = 0
    private var pendingNudgeAt: TimeInterval?
    private let stateURL = URL(fileURLWithPath: CommandLine.arguments[1])

    func applicationDidFinishLaunching(_ notification: Notification) {
        let rect = NSRect(x: 200, y: 170, width: 480, height: 340)
        window = NSWindow(contentRect: rect,
                          styleMask: [.titled, .closable, .miniaturizable],
                          backing: .buffered, defer: false)
        window.title = "CTH Computer Use Acceptance Fixture"
        window.isReleasedWhenClosed = false
        window.backgroundColor = .white
        button = NSButton(title: "CLICK TEST", target: self, action: #selector(clicked))
        button.frame = NSRect(x: 150, y: 225, width: 180, height: 65)
        field = NSTextField(frame: NSRect(x: 100, y: 135, width: 280, height: 45))
        field.placeholderString = "TYPE TEST TEXT HERE"
        field.font = NSFont.systemFont(ofSize: 18)
        scrollArea = ScrollTarget(frame: NSRect(x: 140, y: 22, width: 200, height: 85))
        scrollArea.wantsLayer = true
        scrollArea.layer?.backgroundColor = NSColor.systemTeal.withAlphaComponent(0.30).cgColor
        scrollArea.onScroll = { [weak self] dy in
            guard let self else { return }
            self.scrollEvents += 1
            self.scrollDelta += dy
            self.save()
        }
        let scrollLabel = NSTextField(labelWithString: "SCROLL OVER THIS BOX")
        scrollLabel.frame = NSRect(x: 12, y: 32, width: 185, height: 22)
        scrollArea.addSubview(scrollLabel)
        window.contentView?.addSubview(button)
        window.contentView?.addSubview(field)
        window.contentView?.addSubview(scrollArea)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        motionSampler = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.captureCursor() }
        }
        ticks = Timer.scheduledTimer(withTimeInterval: 0.10, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.save() }
        }
        save()
    }
    private func captureCursor() {
        // Explicit disposable-fixture-only pointer perturbation for trajectory
        // recovery tests. Never touch unrelated applications or user windows.
        let marker = stateURL.deletingLastPathComponent().appendingPathComponent("pointer-nudge-request")
        if window.isKeyWindow && FileManager.default.fileExists(atPath: marker.path),
           pendingNudgeAt == nil {
            pendingNudgeAt = ProcessInfo.processInfo.systemUptime + 0.23
        }
        if let when = pendingNudgeAt, ProcessInfo.processInfo.systemUptime >= when,
           window.isKeyWindow, let current = CGEvent(source: nil)?.location {
            try? FileManager.default.removeItem(at: marker)
            pendingNudgeAt = nil
            _ = CGWarpMouseCursorPosition(CGPoint(x: current.x + 34, y: current.y + 19))
            pointerNudges += 1
        }
        guard let point = CGEvent(source: nil)?.location else { return }
        if let last = cursorTrace.last,
           abs(last["x", default: 0] - Double(point.x)) < 0.6,
           abs(last["y", default: 0] - Double(point.y)) < 0.6 { return }
        cursorTrace.append(["x": Double(point.x), "y": Double(point.y),
                            "time": ProcessInfo.processInfo.systemUptime])
        if cursorTrace.count > 500 { cursorTrace.removeFirst(cursorTrace.count - 500) }
    }
    @objc private func clicked() { clicks += 1; save() }
    private func center(_ view: NSView) -> [String: Double] {
        let position = view.convert(NSPoint(x: view.bounds.midX, y: view.bounds.midY), to: nil)
        let global = window.convertPoint(toScreen: position)
        let mainBounds = CGDisplayBounds(CGMainDisplayID())
        return ["x": Double(global.x), "y": Double(mainBounds.maxY - global.y)]
    }
    private func save() {
        guard let data = try? JSONSerialization.data(withJSONObject: [
            "pid": Int(getpid()), "clicks": clicks, "text": field.stringValue,
            "scroll_events": scrollEvents, "scroll_delta": scrollDelta,
            "pointer_nudges": pointerNudges,
            "button": center(button), "field": center(field), "scroll": center(scrollArea),
            "cursor_trace": cursorTrace,
            "frontmost_pid": Int(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0),
            "window_is_key": window.isKeyWindow,
            "modifier_flags": CGEventSource.flagsState(.combinedSessionState).rawValue,
            "left_button": CGEventSource.buttonState(.combinedSessionState, button: .left),
            "right_button": CGEventSource.buttonState(.combinedSessionState, button: .right)
        ] as [String: Any]) else { return }
        try? data.write(to: stateURL, options: .atomic)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { ticks?.invalidate(); motionSampler?.invalidate() }
}

@MainActor final class ScrollTarget: NSView {
    var onScroll: ((Double) -> Void)?
    override func scrollWheel(with event: NSEvent) {
        onScroll?(Double(event.scrollingDeltaY))
    }
}

@main struct App {
    @MainActor static func main() {
        guard CommandLine.arguments.count == 2 else { return }
        let app = NSApplication.shared
        let delegate = AcceptanceFixture()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        app.run()
    }
}
