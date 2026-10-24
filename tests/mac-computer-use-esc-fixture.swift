import AppKit
import CoreGraphics
import Foundation

@main struct EscFixtureEmitter {
    static func main() {
        guard CommandLine.arguments.count == 2,
              let expected = Int32(CommandLine.arguments[1]),
              expected > 0,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == expected else {
            fputs("Target test window is not foreground: refusing Esc emission.\n", stderr)
            exit(3)
        }
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 53, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 53, keyDown: false) else {
            exit(4)
        }
        down.post(tap: .cghidEventTap)
        usleep(60000)
        up.post(tap: .cghidEventTap)
        print("Esc delivered to foreground fixture PID \(expected)")
    }
}
