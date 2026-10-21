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
    private var clicks = 0
    private var scrollEvents = 0
    private var scrollDelta = 0.0
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
        ticks = Timer.scheduledTimer(withTimeInterval: 0.10, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.save() }
        }
        save()
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
            "button": center(button), "field": center(field), "scroll": center(scrollArea)
        ] as [String: Any]) else { return }
        try? data.write(to: stateURL, options: .atomic)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { ticks?.invalidate() }
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
