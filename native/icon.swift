// Renders the thesis app icon at a given size/variant using CoreGraphics + CoreText.
// usage: swift icon.swift <variant> <size> <out.png> [--opaque] [--margin <fraction>]
import Foundation
import CoreGraphics
import CoreText
import ImageIO

func srgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: r/255, green: g/255, blue: b/255, alpha: a)
}

struct Variant {
    var fontName: String
    var glyphColor: CGColor
    var bgTop: CGColor
    var bgBottom: CGColor
    var cursorColor: CGColor?   // nil = no cursor bar
    var glyphHeight: CGFloat    // ink height as fraction of tile
}

let ink = srgb(242, 242, 242)
let paper = srgb(26, 26, 26)          // #1a1a1a
let paperTop = srgb(34, 34, 34)       // subtle vertical gradient
let variants: [String: Variant] = [
    "solo":         Variant(fontName: "HelveticaNeue-Bold", glyphColor: ink, bgTop: paperTop, bgBottom: paper, cursorColor: nil, glyphHeight: 0.58),
    "cursor-gray":  Variant(fontName: "HelveticaNeue-Bold", glyphColor: ink, bgTop: paperTop, bgBottom: paper, cursorColor: srgb(110, 110, 110), glyphHeight: 0.54),
    "cursor-amber": Variant(fontName: "HelveticaNeue-Bold", glyphColor: ink, bgTop: paperTop, bgBottom: paper, cursorColor: srgb(217, 142, 63), glyphHeight: 0.54),
    "serif":        Variant(fontName: "Georgia-Bold", glyphColor: ink, bgTop: paperTop, bgBottom: paper, cursorColor: nil, glyphHeight: 0.58),
    "solo-light":   Variant(fontName: "HelveticaNeue-Bold", glyphColor: srgb(26, 26, 26), bgTop: srgb(250, 250, 248), bgBottom: srgb(240, 240, 237), cursorColor: nil, glyphHeight: 0.58),
]

let args = CommandLine.arguments
guard args.count >= 4, let variant = variants[args[1]], let size = Int(args[2]) else {
    FileHandle.standardError.write("usage: swift icon.swift <\(variants.keys.joined(separator: "|"))> <size> <out.png> [--opaque] [--margin <f>]\n".data(using: .utf8)!)
    exit(1)
}
let outPath = args[3]
let opaque = args.contains("--opaque")
var margin: CGFloat = 0
if let i = args.firstIndex(of: "--margin"), i + 1 < args.count, let m = Double(args[i + 1]) { margin = CGFloat(m) }

let S = CGFloat(size)
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setAllowsAntialiasing(true)
ctx.setShouldSmoothFonts(true)

// tile rect (inset when a margin is requested, e.g. macOS dock icons)
let inset = S * margin
let tile = CGRect(x: inset, y: inset, width: S - 2 * inset, height: S - 2 * inset)
let radius = tile.width * 0.225

ctx.saveGState()
if margin > 0 {
    // soft shadow behind the tile so it sits like a native macOS icon
    ctx.setShadow(offset: CGSize(width: 0, height: -tile.width * 0.012),
                  blur: tile.width * 0.05, color: srgb(0, 0, 0, 0.35))
    ctx.addPath(CGPath(roundedRect: tile, cornerWidth: radius, cornerHeight: radius, transform: nil))
    ctx.setFillColor(variant.bgBottom)
    ctx.fillPath()
    ctx.setShadow(offset: .zero, blur: 0, color: nil)
}
if opaque {
    ctx.setFillColor(variant.bgBottom)
    ctx.fill(CGRect(x: 0, y: 0, width: S, height: S))
    ctx.clip(to: CGRect(x: 0, y: 0, width: S, height: S))
} else {
    ctx.addPath(CGPath(roundedRect: tile, cornerWidth: radius, cornerHeight: radius, transform: nil))
    ctx.clip()
}
// subtle top-to-bottom gradient for a hint of depth
let grad = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                      colors: [variant.bgTop, variant.bgBottom] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: tile.maxY), end: CGPoint(x: 0, y: tile.minY), options: [])

// glyph, scaled so its ink height is a fixed fraction of the tile
let refSize: CGFloat = 100
let refFont = CTFontCreateWithName(variant.fontName as CFString, refSize, nil)
let refLine = CTLineCreateWithAttributedString(NSAttributedString(string: "t", attributes: [
    kCTFontAttributeName as NSAttributedString.Key: refFont,
]))
let refBounds = CTLineGetBoundsWithOptions(refLine, .useGlyphPathBounds)
let fontSize = variant.glyphHeight * tile.height / refBounds.height * refSize

let font = CTFontCreateWithName(variant.fontName as CFString, fontSize, nil)
let line = CTLineCreateWithAttributedString(NSAttributedString(string: "t", attributes: [
    kCTFontAttributeName as NSAttributedString.Key: font,
    kCTForegroundColorAttributeName as NSAttributedString.Key: variant.glyphColor,
]))
let b = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)

var compWidth = b.width
let cursorWidth = tile.width * 0.055
let cursorGap = tile.width * 0.065
let drawCursor = variant.cursorColor != nil && size >= 48   // bar turns to mush below 48px
if drawCursor { compWidth += cursorGap + cursorWidth }

let x0 = tile.minX + (tile.width - compWidth) / 2
let y0 = tile.minY + (tile.height - b.height) / 2
ctx.textPosition = CGPoint(x: x0 - b.minX, y: y0 - b.minY)
CTLineDraw(line, ctx)

if drawCursor, let c = variant.cursorColor {
    let barHeight = b.height * 1.04
    let bar = CGRect(x: x0 + b.width + cursorGap,
                     y: tile.minY + (tile.height - barHeight) / 2,
                     width: cursorWidth, height: barHeight)
    ctx.addPath(CGPath(roundedRect: bar, cornerWidth: cursorWidth / 2, cornerHeight: cursorWidth / 2, transform: nil))
    ctx.setFillColor(c)
    ctx.fillPath()
}
ctx.restoreGState()

let image = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL, "public.png" as CFString, 1, nil)!
CGImageDestinationAddImage(dest, image, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("failed to write \(outPath)") }
