import Foundation
import CoreGraphics

// Physical mouse travel is constrained to real display rectangles. This avoids
// sending CGEvent mouse positions through gaps between non-rectangular displays.
enum MacCursorTrajectory {
    static func activeDisplays() -> [CGRect] {
        var ids = [CGDirectDisplayID](repeating: 0, count: 32)
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(32, &ids, &count) == .success else { return [] }
        return ids.prefix(Int(count)).map { CGDisplayBounds($0) }
    }

    private static func contains(_ point: CGPoint, in rect: CGRect) -> Bool {
        point.x >= rect.minX - 1 && point.x <= rect.maxX + 1 &&
        point.y >= rect.minY - 1 && point.y <= rect.maxY + 1
    }

    // Two points, one firmly within each neighbor, for a shared seam.
    private static func crossing(_ a: CGRect, _ b: CGRect, toward destination: CGPoint)
        -> (CGPoint, CGPoint)? {
        let epsilon: CGFloat = 0.5
        let x0 = max(a.minX, b.minX), x1 = min(a.maxX, b.maxX)
        let y0 = max(a.minY, b.minY), y1 = min(a.maxY, b.maxY)
        if x1 - x0 >= 6 {
            let x = max(x0 + 3, min(x1 - 3, destination.x))
            if abs(a.maxY - b.minY) <= epsilon {
                return (CGPoint(x: x, y: a.maxY - 2), CGPoint(x: x, y: b.minY + 2))
            }
            if abs(a.minY - b.maxY) <= epsilon {
                return (CGPoint(x: x, y: a.minY + 2), CGPoint(x: x, y: b.maxY - 2))
            }
        }
        if y1 - y0 >= 6 {
            let y = max(y0 + 3, min(y1 - 3, destination.y))
            if abs(a.maxX - b.minX) <= epsilon {
                return (CGPoint(x: a.maxX - 2, y: y), CGPoint(x: b.minX + 2, y: y))
            }
            if abs(a.minX - b.maxX) <= epsilon {
                return (CGPoint(x: a.minX + 2, y: y), CGPoint(x: b.maxX - 2, y: y))
            }
        }
        // Mirror/overlapping display rectangles. Choose a point inside both.
        if x1 - x0 >= 6 && y1 - y0 >= 6 {
            let x = max(x0 + 3, min(x1 - 3, destination.x))
            let y = max(y0 + 3, min(y1 - 3, destination.y))
            let common = CGPoint(x: x, y: y)
            return (common, common)
        }
        return nil
    }

    static func route(from start: CGPoint, to end: CGPoint, displays: [CGRect]) -> [CGPoint]? {
        guard let origin = displays.firstIndex(where: { contains(start, in: $0) }),
              let destination = displays.firstIndex(where: { contains(end, in: $0) })
        else { return nil }
        if origin == destination { return [start, end] }
        var previous = [Int](repeating: -1, count: displays.count)
        var queue = [origin]
        previous[origin] = origin
        var cursor = 0
        while cursor < queue.count && previous[destination] < 0 {
            let current = queue[cursor]
            cursor += 1
            for next in displays.indices where previous[next] < 0 {
                if crossing(displays[current], displays[next], toward: end) != nil {
                    previous[next] = current
                    queue.append(next)
                }
            }
        }
        guard previous[destination] >= 0 else { return nil }
        var order = [destination]
        while order.last != origin {
            let preceding = previous[order.last!]
            guard preceding >= 0 else { return nil }
            order.append(preceding)
        }
        order.reverse()
        var points = [start]
        for pair in zip(order, order.dropFirst()) {
            guard let (a, b) = crossing(displays[pair.0], displays[pair.1], toward: end)
            else { return nil }
            points.append(a)
            points.append(b)
        }
        points.append(end)
        return points
    }

    static func length(of points: [CGPoint]) -> CGFloat {
        zip(points, points.dropFirst()).reduce(0) { total, pair in
            total + hypot(pair.1.x - pair.0.x, pair.1.y - pair.0.y)
        }
    }

    static func position(at fraction: Double, along points: [CGPoint],
                         display: CGRect?) -> CGPoint {
        guard let origin = points.first, let destination = points.last else { return .zero }
        let u = CGFloat(max(0, min(1, fraction)))
        if u <= 0 { return origin }
        if u >= 1 { return destination }
        let total = length(of: points)
        guard total > 0 else { return destination }
        var remaining = total * u
        for pair in zip(points, points.dropFirst()) {
            let start = pair.0, end = pair.1
            let dx = end.x - start.x, dy = end.y - start.y
            let segment = hypot(dx, dy)
            if remaining <= segment && segment > 0 {
                let t = remaining / segment
                var x = start.x + dx * t
                var y = start.y + dy * t
                // Small hand-like lateral arc is used ONLY within one screen,
                // sufficiently far from edges to stay inside that screen.
                if points.count == 2, let bounds = display,
                   bounds.insetBy(dx: 25, dy: 25).contains(start),
                   bounds.insetBy(dx: 25, dy: 25).contains(end) {
                    let bend = min(18, Double(total) * 0.035)
                    let offset = CGFloat(4 * t * (1 - t) * bend * (dx >= 0 ? 1 : -1))
                    x += -dy / segment * offset
                    y += dx / segment * offset
                }
                return CGPoint(x: x, y: y)
            }
            remaining -= segment
        }
        return destination
    }
}
