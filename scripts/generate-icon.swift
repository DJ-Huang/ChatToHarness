import AppKit

// Native, code-drawn assets: no external renderer or downloaded artwork.
let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
let assets = root.appendingPathComponent("assets")
let iconset = assets.appendingPathComponent("ChatToHarness.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
}

func bitmap(_ size: Int, draw: () -> Void) throws -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let context = NSGraphicsContext.current!.cgContext
    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)
    context.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    draw()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

func monogram(_ strokeColor: NSColor, lineWidth: CGFloat = 68.4) {
    let path = NSBezierPath()
    // Joined tool-path geometry, in a bottom-left canvas.
    path.move(to: NSPoint(x: 260, y: 800))
    path.line(to: NSPoint(x: 260, y: 368))
    path.curve(to: NSPoint(x: 404, y: 224), controlPoint1: NSPoint(x: 260, y: 288.5), controlPoint2: NSPoint(x: 324.5, y: 224))
    path.line(to: NSPoint(x: 764, y: 224))
    path.move(to: NSPoint(x: 260, y: 512))
    path.line(to: NSPoint(x: 584, y: 512))
    path.curve(to: NSPoint(x: 764, y: 692), controlPoint1: NSPoint(x: 683.4, y: 512), controlPoint2: NSPoint(x: 764, y: 592.6))
    path.line(to: NSPoint(x: 764, y: 800))
    path.move(to: NSPoint(x: 584, y: 512))
    path.line(to: NSPoint(x: 584, y: 224))
    path.lineWidth = lineWidth
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    strokeColor.setStroke()
    path.stroke()
}

func appIcon() {
    let rounded = NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 210, yRadius: 210)
    let gradient = NSGradient(starting: color(71, 105, 87), ending: color(124, 154, 137))!
    gradient.draw(in: rounded, angle: 90)
    let inset = NSBezierPath(roundedRect: NSRect(x: 77, y: 77, width: 870, height: 870), xRadius: 199, yRadius: 199)
    color(255, 255, 255, 0.16).setStroke()
    inset.lineWidth = 2
    inset.stroke()
    monogram(color(255, 253, 248))
}

for size in [16, 32, 128, 256, 512] {
    try bitmap(size, draw: appIcon).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try bitmap(size * 2, draw: appIcon).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
try bitmap(1024, draw: appIcon).write(to: assets.appendingPathComponent("icon.png"))
for (filename, size) in [("tray.png", 22), ("tray@2x.png", 44)] {
    try bitmap(size) { monogram(NSColor.black, lineWidth: 80) }.write(to: assets.appendingPathComponent(filename))
}
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", iconset.path, "-o", assets.appendingPathComponent("ChatToHarness.icns").path]
try process.run()
process.waitUntilExit()
if process.terminationStatus != 0 { exit(process.terminationStatus) }
// A 256px PNG entry is supported by Windows 11 ICO resources.
let windowsPNG = try bitmap(256, draw: appIcon)
var windowsICO = Data([0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 32, 0])
for value in [UInt32(windowsPNG.count), UInt32(22)] {
    var little = value.littleEndian
    withUnsafeBytes(of: &little) { windowsICO.append(contentsOf: $0) }
}
windowsICO.append(windowsPNG)
try windowsICO.write(to: assets.appendingPathComponent("ChatToHarness.ico"))
try FileManager.default.removeItem(at: iconset)
print("Created ChatToHarness.icns, ChatToHarness.ico, icon.png, tray.png and tray@2x.png")
