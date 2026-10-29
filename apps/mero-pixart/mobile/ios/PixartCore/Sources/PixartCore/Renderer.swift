import CoreGraphics
import CoreText
import Foundation
import ImageIO

/// A decoded image that can cross tasks (CGImage is immutable).
public struct Bitmap: @unchecked Sendable {
    public let image: CGImage
    public init(_ image: CGImage) { self.image = image }
    public var width: Int { image.width }
    public var height: Int { image.height }
}

/// The composite, drawn natively with Core Graphics from the layers the
/// contract stores and their PNG blobs: the port of the web's
/// `composite()` (`utils/compositor.ts`). Each layer is prepared in its own
/// pixels (mask, adjustments, blur), then placed by its matrix or warp mesh
/// with its opacity and blend mode. (Android: `Compositor.kt`, `android.graphics`.)
public enum Renderer {
    static let space = CGColorSpace(name: CGColorSpace.sRGB)!
    static let info = CGImageAlphaInfo.premultipliedLast.rawValue

    // MARK: PNG

    public static func decode(_ data: Data) -> Bitmap? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
            let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
        else { return nil }
        return Bitmap(img)
    }

    public static func png(_ bitmap: Bitmap) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, bitmap.image, nil)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }

    // MARK: Composite

    /// The document at `scale` (1 = its own pixels). `images` holds the
    /// decoded blobs by id; a raster whose blob has not arrived is skipped.
    public static func composite(
        width: Int, height: Int, background: String, ops: [DrawOp], images: [String: Bitmap], scale: Double = 1
    ) -> Bitmap? {
        let w = max(1, Int((Double(width) * scale).rounded()))
        let h = max(1, Int((Double(height) * scale).rounded()))
        guard let ctx = context(w, h) else { return nil }
        ctx.interpolationQuality = .high
        // Top-left origin, y down, like the web's canvas.
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: CGFloat(scale), y: CGFloat(-scale))
        if let bg = RGBA.parse(background), bg.a > 0 {
            ctx.setFillColor(cgColor(bg))
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        for op in ops {
            guard let prepared = prepare(op, images: images) else { continue }
            ctx.saveGState()
            ctx.setAlpha(CGFloat(op.alpha))
            ctx.setBlendMode(cgBlend(op.blend))
            ctx.concatenate(cgAffine(op.matrix))
            if let warp = op.warp, prepared.ox == 0, prepared.oy == 0 {
                for tri in warp.mesh(width: Double(prepared.bitmap.width), height: Double(prepared.bitmap.height)) {
                    ctx.saveGState()
                    ctx.beginPath()
                    ctx.move(to: CGPoint(x: tri.clip[0].x, y: tri.clip[0].y))
                    ctx.addLine(to: CGPoint(x: tri.clip[1].x, y: tri.clip[1].y))
                    ctx.addLine(to: CGPoint(x: tri.clip[2].x, y: tri.clip[2].y))
                    ctx.closePath()
                    ctx.clip()
                    ctx.concatenate(cgAffine(tri.transform))
                    drawUpright(ctx, prepared.bitmap.image, at: 0, 0)
                    ctx.restoreGState()
                }
            } else {
                drawUpright(ctx, prepared.bitmap.image, at: Double(prepared.ox), Double(prepared.oy))
            }
            ctx.restoreGState()
        }
        return ctx.makeImage().map(Bitmap.init)
    }

    /// A layer's own pixels, ready to place: where its top-left sits in the
    /// layer's space (negative when a blur spills past the box).
    struct Prepared {
        let bitmap: Bitmap
        let ox: Int
        let oy: Int
    }

    static func prepare(_ op: DrawOp, images: [String: Bitmap]) -> Prepared? {
        let w = op.width
        let h = op.height
        var base: CGImage?
        switch op.source {
        case .raster(let id):
            guard let img = images[id] else { return nil }
            base = layerCanvas(img.image, w, h)
        case .fill(let color):
            guard let ctx = context(w, h) else { return nil }
            ctx.setFillColor(cgColor(color))
            ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
            base = ctx.makeImage()
        case .text(let props):
            base = text(props, w, h)
        }
        guard let base else { return nil }
        let mask = op.maskBlobId.flatMap { images[$0] }
        guard mask != nil || op.filter != nil else { return Prepared(bitmap: Bitmap(base), ox: 0, oy: 0) }
        var px = rgba(base, w, h)
        if let mask { PixelOps.mask(&px, with: rgba(mask.image, w, h)) }
        var pad = 0
        if let filter = op.filter {
            PixelOps.color(&px, filter)
            if filter.blur > 0 {
                px = PixelOps.blur(px, radius: filter.blur)
                pad = PixelOps.blurPad(filter.blur)
            }
        }
        guard let out = cgImage(px) else { return nil }
        return Prepared(bitmap: Bitmap(out), ox: -pad, oy: -pad)
    }

    /// The image at the top-left of a `w`×`h` box, clipped to it (the web's layer canvas).
    static func layerCanvas(_ img: CGImage, _ w: Int, _ h: Int) -> CGImage? {
        if img.width == w, img.height == h { return img }
        guard let ctx = context(w, h) else { return nil }
        ctx.draw(img, in: CGRect(x: 0, y: h - img.height, width: img.width, height: img.height))
        return ctx.makeImage()
    }

    // MARK: Text

    /// The web's `renderTextLayer`: one line per `\n`, 1.2× line height, the
    /// top of each line at its row, aligned in the box.
    static func text(_ t: TextProps, _ w: Int, _ h: Int) -> CGImage? {
        guard let ctx = context(w, h) else { return nil }
        let size = CGFloat(max(1, t.fontSize))
        let font = ctFont(t.fontFamily, size: size, bold: t.bold, italic: t.italic)
        let color = cgColor(RGBA.parse(t.color) ?? RGBA(0, 0, 0))
        let attrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
        ]
        let ascent = CTFontGetAscent(font)
        for (i, line) in t.content.components(separatedBy: "\n").enumerated() {
            let ct = CTLineCreateWithAttributedString(NSAttributedString(string: line, attributes: attrs))
            let width = CTLineGetTypographicBounds(ct, nil, nil, nil)
            let x: Double
            switch t.align {
            case "center": x = (Double(w) - width) / 2
            case "right": x = Double(w) - width
            default: x = 0
            }
            let top = Double(i) * Double(size) * 1.2
            ctx.textPosition = CGPoint(x: x, y: Double(h) - top - Double(ascent))
            CTLineDraw(ct, ctx)
        }
        return ctx.makeImage()
    }

    static func ctFont(_ family: String, size: CGFloat, bold: Bool, italic: Bool) -> CTFont {
        let f = family.lowercased()
        let name: String
        if f.contains("mono") || f.contains("courier") {
            name = "Menlo"
        } else if f.contains("serif") && !f.contains("sans") || f.contains("georgia") || f.contains("times") {
            name = "Georgia"
        } else {
            name = "Helvetica Neue"
        }
        let base = CTFontCreateWithName(name as CFString, size, nil)
        var traits: CTFontSymbolicTraits = []
        if bold { traits.insert(.traitBold) }
        if italic { traits.insert(.traitItalic) }
        guard !traits.isEmpty else { return base }
        return CTFontCreateCopyWithSymbolicTraits(base, size, nil, traits, traits) ?? base
    }

    // MARK: Pixels

    static func context(_ w: Int, _ h: Int) -> CGContext? {
        CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space, bitmapInfo: info)
    }

    /// Straight-alpha pixels of `img` drawn at the top-left of a `w`×`h` box.
    static func rgba(_ img: CGImage, _ w: Int, _ h: Int) -> RGBAImage {
        var out = RGBAImage(width: w, height: h)
        out.pixels.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(
                data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
                bitmapInfo: info)
            else { return }
            ctx.draw(img, in: CGRect(x: 0, y: h - img.height, width: img.width, height: img.height))
        }
        for i in stride(from: 0, to: out.pixels.count, by: 4) {
            let a = Int(out.pixels[i + 3])
            guard a > 0, a < 255 else { continue }
            for c in 0..<3 { out.pixels[i + c] = UInt8(min(255, (Int(out.pixels[i + c]) * 255 + a / 2) / a)) }
        }
        return out
    }

    static func cgImage(_ img: RGBAImage) -> CGImage? {
        var px = img.pixels
        for i in stride(from: 0, to: px.count, by: 4) {
            let a = Int(px[i + 3])
            guard a < 255 else { continue }
            for c in 0..<3 { px[i + c] = UInt8((Int(px[i + c]) * a + 127) / 255) }
        }
        return px.withUnsafeMutableBytes { buf -> CGImage? in
            CGContext(
                data: buf.baseAddress, width: img.width, height: img.height, bitsPerComponent: 8,
                bytesPerRow: img.width * 4, space: space, bitmapInfo: info)?.makeImage()
        }
    }

    /// Draw `img` with its top-left at (`x`, `y`) in a y-down context.
    static func drawUpright(_ ctx: CGContext, _ img: CGImage, at x: Double, _ y: Double) {
        ctx.saveGState()
        ctx.translateBy(x: CGFloat(x), y: CGFloat(y) + CGFloat(img.height))
        ctx.scaleBy(x: 1, y: -1)
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
        ctx.restoreGState()
    }

    static func cgAffine(_ m: Affine) -> CGAffineTransform {
        CGAffineTransform(a: CGFloat(m.a), b: CGFloat(m.b), c: CGFloat(m.c), d: CGFloat(m.d), tx: CGFloat(m.e), ty: CGFloat(m.f))
    }

    static func cgColor(_ c: RGBA) -> CGColor {
        CGColor(colorSpace: space, components: [CGFloat(c.r), CGFloat(c.g), CGFloat(c.b), CGFloat(c.a)])!
    }

    static func cgBlend(_ b: BlendMode) -> CGBlendMode {
        switch b {
        case .normal: return .normal
        case .multiply: return .multiply
        case .screen: return .screen
        case .overlay: return .overlay
        case .darken: return .darken
        case .lighten: return .lighten
        case .colorDodge: return .colorDodge
        case .colorBurn: return .colorBurn
        case .hardLight: return .hardLight
        case .softLight: return .softLight
        case .difference: return .difference
        case .exclusion: return .exclusion
        case .hue: return .hue
        case .saturation: return .saturation
        case .color: return .color
        case .luminosity: return .luminosity
        }
    }
}
