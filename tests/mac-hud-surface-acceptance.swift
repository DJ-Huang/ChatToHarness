import AppKit
import QuartzCore
import Foundation

// Runs without controlling any real desktop window. Checks the actual AppKit
// surface and Core Animation layers rather than guessing from source strings.
@main struct HUDSurfaceAcceptance {
    @MainActor static func main() {
        _ = NSApplication.shared
        let hud = MacHUDSurface(frame: NSRect(x: 0, y: 0, width: 530, height: 108))
        hud.layoutSubtreeIfNeeded()
        guard let root = hud.layer else { fatalError("HUD layer unavailable") }
        let shapes = (root.sublayers ?? []).compactMap { $0 as? CAShapeLayer }
        guard shapes.count == 3 else { fatalError("Expected base cyan border + trail + orbiting head") }
        guard root.cornerRadius == MacHUDSurface.cornerRadius, root.masksToBounds,
              let overlay = root.backgroundColor,
              let orbit = shapes[2].animation(forKey: "cyanPerimeterOrbit") as? CABasicAnimation,
              orbit.keyPath == "lineDashPhase", orbit.repeatCount.isInfinite,
              orbit.duration == MacHUDSurface.orbitDuration,
              orbit.timingFunction != nil,
              shapes[2].lineDashPattern?.count == 2 else {
            fatalError("HUD orbit/backplate not configured")
        }
        let fullPath = shapes[2].path?.boundingBoxOfPath ?? .zero
        guard fullPath.width >= 510 else { fatalError("Bright segment does not follow full HUD perimeter") }
        guard shapes[2].shadowOpacity > 0.8 else { fatalError("Cyan orbit glow missing") }

        // Worst-case legibility over the brightest possible light desktop,
        // after compositing the dark, almost-opaque HUD backplate.
        func rgb(_ color: NSColor) -> (Double, Double, Double, Double) {
            guard let c = color.usingColorSpace(.deviceRGB) else { fatalError("Cannot convert HUD color") }
            return (Double(c.redComponent), Double(c.greenComponent),
                    Double(c.blueComponent), Double(c.alphaComponent))
        }
        func channel(_ value: Double) -> Double {
            value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        func luminosity(_ red: Double, _ green: Double, _ blue: Double) -> Double {
            0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
        }
        let backdrop = NSColor(cgColor: overlay) ?? MacHUDSurface.backplateColor
        let (r,g,b,a) = rgb(backdrop)
        let backgroundLuminance = luminosity(r*a+1-a, g*a+1-a, b*a+1-a)
        var contrasts: [String: Double] = [:]
        for (name, color) in [
            ("title", MacHUDSurface.titleColor),
            ("session", MacHUDSurface.secondaryTextColor),
            ("activity", MacHUDSurface.primaryTextColor)
        ] {
            let (fr,fg,fb,_) = rgb(color)
            let foreground = luminosity(fr,fg,fb)
            let ratio = (max(backgroundLuminance,foreground)+0.05)
                       / (min(backgroundLuminance,foreground)+0.05)
            guard ratio >= 7 else { fatalError("\(name) contrast ratio \(ratio) below AAA 7:1") }
            contrasts[name] = ratio
        }

        hud.setFrameSize(NSSize(width: 280, height: 108))
        hud.layoutSubtreeIfNeeded()
        let narrowPath = shapes[2].path?.boundingBoxOfPath ?? .zero
        guard narrowPath.width < fullPath.width - 200, narrowPath.width >= 260,
              shapes[2].animation(forKey: "cyanPerimeterOrbit") != nil else {
            fatalError("Orbit did not reflow and resume on narrow displays")
        }
        let payload: [String: Any] = [
            "pass": true,
            "contrast_worst_case_light_desktop": contrasts,
            "border_animation": orbit.keyPath ?? "",
            "orbit_seconds_per_lap": orbit.duration,
            "resizes_with_hud": true
        ]
        let bytes = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        print(String(data: bytes, encoding: .utf8)!)
    }
}
