import CoreGraphics
import Foundation

@main struct CursorRouteAcceptance {
    static func main() {
        let displays = [
            CGRect(x: 0, y: 0, width: 2056, height: 1329),
            CGRect(x: -1640, y: -1440, width: 2560, height: 1440),
            CGRect(x: 920, y: -1440, width: 2560, height: 1440)
        ]
        let samples: [(CGPoint, CGPoint)] = [
            (CGPoint(x: -1100, y: -665), CGPoint(x: 440, y: 920)),
            (CGPoint(x: 2600, y: -1200), CGPoint(x: 440, y: 920)),
            (CGPoint(x: -1100, y: -665), CGPoint(x: 2600, y: -1200)),
            (CGPoint(x: 300, y: 400), CGPoint(x: 1000, y: 800))
        ]
        for (index, (start, end)) in samples.enumerated() {
            guard let route = MacCursorTrajectory.route(from: start, to: end,
                                                          displays: displays) else {
                fatalError("No route for scenario \(index)")
            }
            if index < 3 { precondition(route.count >= 4, "Missing display seam") }
            precondition(route.first == start && route.last == end)
            let total = MacCursorTrajectory.length(of: route)
            precondition(total >= hypot(end.x - start.x, end.y - start.y))
            for frame in 0...300 {
                let point = MacCursorTrajectory.position(at: Double(frame) / 300.0,
                                                           along: route, display: nil)
                precondition(displays.contains(where: { rect in
                    rect.insetBy(dx: -1.0, dy: -1.0).contains(point)
                }), "Cursor left physical displays at step \(frame) in scenario \(index): \(point)")
            }
            print("display scenario \(index): \(route.count) waypoints, \(Int(total))px, all 301 samples on-screen")
        }
        precondition(MacCursorTrajectory.route(from: CGPoint(x: -5000, y: -5000),
                                              to: CGPoint(x: 500, y: 500),
                                              displays: displays) == nil)
        print("CursorRoute acceptance PASS")
    }
}
