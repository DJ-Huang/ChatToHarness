import AppKit
import QuartzCore

// High-contrast contents of the non-activating Computer Use STOP HUD.
// A fixed dark backplate isolates text from the desktop wallpaper, tint and
// vibrancy; the independently animated cyan dash circles the rounded perimeter.
// This view does not intercept the local STOP button or activate another app.
@available(macOS 14.0, *)
@MainActor
final class MacHUDSurface: NSView {
    static let cornerRadius: CGFloat = 14
    static let backplateColor = NSColor(calibratedRed: 0.035, green: 0.065,
                                        blue: 0.12, alpha: 0.97)
    static let titleColor = NSColor(calibratedRed: 0.48, green: 0.94,
                                    blue: 1, alpha: 1)
    static let primaryTextColor = NSColor(calibratedRed: 0.97, green: 0.98,
                                          blue: 1, alpha: 1)
    static let secondaryTextColor = NSColor(calibratedRed: 0.85, green: 0.91,
                                            blue: 0.97, alpha: 1)
    static let orbitDuration: CFTimeInterval = 3.5

    private let steadyBorder = CAShapeLayer()
    private let movingTrail = CAShapeLayer()
    private let movingHighlight = CAShapeLayer()
    private var previousSize = CGSize.zero

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setup()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }

    private func setup() {
        wantsLayer = true
        guard let layer else { return }
        layer.backgroundColor = Self.backplateColor.cgColor
        layer.cornerRadius = Self.cornerRadius
        layer.masksToBounds = true
        for shape in [steadyBorder, movingTrail, movingHighlight] {
            shape.fillColor = NSColor.clear.cgColor
            shape.lineJoin = .round
            shape.lineCap = .round
            layer.addSublayer(shape)
        }
        steadyBorder.strokeColor = NSColor(calibratedRed: 0.17, green: 0.77,
                                           blue: 0.95, alpha: 0.75).cgColor
        steadyBorder.lineWidth = 2.5

        movingTrail.strokeColor = NSColor(calibratedRed: 0.12, green: 0.79,
                                          blue: 1, alpha: 0.54).cgColor
        movingTrail.lineWidth = 5.5

        movingHighlight.strokeColor = NSColor(calibratedRed: 0.65, green: 1,
                                              blue: 1, alpha: 1).cgColor
        movingHighlight.lineWidth = 3.8
        movingHighlight.shadowColor = NSColor.cyan.cgColor
        movingHighlight.shadowOpacity = 0.85
        movingHighlight.shadowRadius = 5
        movingHighlight.shadowOffset = .zero

        updateBorderGeometry()
    }

    override func layout() {
        super.layout()
        updateBorderGeometry()
    }

    private func updateBorderGeometry() {
        guard bounds.size != previousSize else { return }
        previousSize = bounds.size
        let inset: CGFloat = 3.5
        let rect = bounds.insetBy(dx: inset, dy: inset)
        guard rect.width > 28, rect.height > 28 else { return }
        let radius = min(Self.cornerRadius - inset, rect.height / 2)
        let path = CGPath(roundedRect: rect, cornerWidth: radius,
                          cornerHeight: radius, transform: nil)
        let perimeter = 2 * (rect.width + rect.height - 4 * radius)
                        + 2 * .pi * radius
        steadyBorder.frame = bounds
        movingTrail.frame = bounds
        movingHighlight.frame = bounds
        for shape in [steadyBorder, movingTrail, movingHighlight] {
            shape.path = path
        }
        // A bright head with a longer, lower-opacity tail stays on the actual
        // rounded path, even when the HUD is resized on a narrow monitor.
        let trailLength = min(155, perimeter * 0.19)
        let highlightLength = min(64, perimeter * 0.08)
        movingTrail.lineDashPattern = [NSNumber(value: Double(trailLength)),
                                        NSNumber(value: Double(perimeter - trailLength))]
        movingHighlight.lineDashPattern = [NSNumber(value: Double(highlightLength)),
                                            NSNumber(value: Double(perimeter - highlightLength))]
        for shape in [movingTrail, movingHighlight] {
            shape.removeAnimation(forKey: "cyanPerimeterOrbit")
            let travel = CABasicAnimation(keyPath: "lineDashPhase")
            travel.fromValue = 0
            travel.toValue = -perimeter
            travel.duration = Self.orbitDuration
            travel.repeatCount = .infinity
            travel.timingFunction = CAMediaTimingFunction(name: .linear)
            shape.add(travel, forKey: "cyanPerimeterOrbit")
        }
    }
}
