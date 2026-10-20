import AppKit
import CoreGraphics
import Foundation

// Mouse-transparent silhouette halo. Renders *only* outside the current
// system cursor's visible pixels; never substitutes a fake pointer or circle.
// NSCursor.currentSystem is deprecated but remains available on macOS 14.
// If the system cursor cannot be recovered, fail closed visually (no halo).
@available(macOS 14.0, *)
@MainActor
final class MacCursorGlow {
    private var panel: NSPanel?
    private var imageView: NSImageView?
    private var cachedKey: Int?
    private var cursorSize = NSSize.zero
    private var hotspot = NSPoint.zero
    private let padding: CGFloat = 12

    func update(target: CGRect, frontmost: Bool) {
        guard frontmost, !target.isEmpty,
              let point = CGEvent(source: nil)?.location,
              target.contains(point),
              let cursor = NSCursor.currentSystem,
              let pixels = cursor.image.tiffRepresentation else {
            panel?.orderOut(nil)
            return
        }
        let key = pixels.hashValue ^ Int(cursor.hotSpot.x * 997) ^ Int(cursor.hotSpot.y * 547)
        if key != cachedKey {
            guard let sprite = buildHalo(from: cursor.image) else {
                cachedKey = nil
                panel?.orderOut(nil)
                return
            }
            cachedKey = key
            cursorSize = cursor.image.size
            hotspot = cursor.hotSpot
            showSprite(sprite)
        }
        guard let panel else { return }
        // CG coordinates are top-left based, AppKit screen coordinates bottom-left.
        // Cursor hotspot is measured from the image's top-left (Apple API).
        let main = CGDisplayBounds(CGMainDisplayID())
        let x = point.x - hotspot.x - padding
        let y = main.maxY - (point.y - hotspot.y + cursorSize.height + padding)
        let frame = NSRect(x: x, y: y,
                           width: cursorSize.width + padding * 2,
                           height: cursorSize.height + padding * 2)
        if panel.frame != frame { panel.setFrame(frame, display: true) }
        if !panel.isVisible { panel.orderFrontRegardless() }
    }

    func stop() {
        panel?.orderOut(nil)
        panel?.close()
        panel = nil
        imageView = nil
        cachedKey = nil
    }

    private func showSprite(_ sprite: NSImage) {
        if panel == nil {
            let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: sprite.size.width,
                                                     height: sprite.size.height),
                                 styleMask: [.borderless, .nonactivatingPanel],
                                 backing: .buffered, defer: false)
            window.level = .statusBar
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            window.ignoresMouseEvents = true
            window.hasShadow = false
            window.backgroundColor = .clear
            window.isOpaque = false
            let imageView = NSImageView(frame: NSRect(origin: .zero, size: sprite.size))
            imageView.imageScaling = .scaleAxesIndependently
            window.contentView = imageView
            self.panel = window
            self.imageView = imageView
        }
        imageView?.image = sprite
        imageView?.frame = NSRect(origin: .zero, size: sprite.size)
    }

    private func buildHalo(from image: NSImage) -> NSImage? {
        let width = Int(ceil(image.size.width))
        let height = Int(ceil(image.size.height))
        guard width >= 1, height >= 1, width <= 256, height <= 256 else { return nil }
        guard let source = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width,
                                            pixelsHigh: height, bitsPerSample: 8,
                                            samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                            colorSpaceName: .deviceRGB, bytesPerRow: 0,
                                            bitsPerPixel: 0),
              let target = NSBitmapImageRep(bitmapDataPlanes: nil,
                                            pixelsWide: width + Int(padding) * 2,
                                            pixelsHigh: height + Int(padding) * 2,
                                            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                            isPlanar: false, colorSpaceName: .deviceRGB,
                                            bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: source) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSColor.clear.setFill()
        NSRect(x: 0, y: 0, width: width, height: height).fill()
        image.draw(in: NSRect(x: 0, y: 0, width: width, height: height))
        context.flushGraphics()
        NSGraphicsContext.restoreGraphicsState()

        // Cache opacity and scan only a bounded 12pt neighborhood.
        var mask = [Bool](repeating: false, count: width * height)
        var anyOpaque = false
        for y in 0..<height {
            for x in 0..<width {
                let opaque = (source.colorAt(x: x, y: y)?.alphaComponent ?? 0) >= 0.20
                mask[y * width + x] = opaque
                if opaque { anyOpaque = true }
            }
        }
        guard anyOpaque else { return nil }
        let totalW = width + Int(padding) * 2
        let totalH = height + Int(padding) * 2
        for y in 0..<totalH {
            for x in 0..<totalW {
                let localX = x - Int(padding)
                let localY = y - Int(padding)
                if localX >= 0 && localX < width && localY >= 0 && localY < height,
                   (source.colorAt(x: localX, y: localY)?.alphaComponent ?? 0) >= 0.10 {
                    continue  // Never cover pixels occupied by the actual cursor.
                }
                var distanceSq = 169
                for yy in max(0, localY - 12)..<min(height, localY + 13) {
                    for xx in max(0, localX - 12)..<min(width, localX + 13) {
                        if !mask[yy * width + xx] { continue }
                        let dx = localX - xx, dy = localY - yy
                        let d2 = dx * dx + dy * dy
                        if d2 < distanceSq { distanceSq = d2 }
                    }
                }
                if distanceSq >= 144 { continue }
                let distance = sqrt(Double(distanceSq))
                let alpha = min(0.75, 0.68 * exp(-0.060 * distance * distance))
                target.setColor(NSColor(calibratedRed: 0.38, green: 0.76,
                                        blue: 1.00, alpha: alpha), atX: x, y: y)
            }
        }
        let result = NSImage(size: NSSize(width: totalW, height: totalH))
        result.addRepresentation(target)
        return result
    }
}
