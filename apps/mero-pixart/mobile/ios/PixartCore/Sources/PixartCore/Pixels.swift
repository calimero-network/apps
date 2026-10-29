import Foundation

/// A colour with components in 0…1.
public struct RGBA: Equatable, Sendable {
    public var r, g, b, a: Double
    public init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
        self.r = r
        self.g = g
        self.b = b
        self.a = a
    }

    /// `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`, `transparent`,
    /// `white`, `black`; `nil` otherwise. (Kotlin `Rgba.parse`.)
    public static func parse(_ raw: String) -> RGBA? {
        let s = raw.trimmingCharacters(in: .whitespaces).lowercased()
        switch s {
        case "transparent": return RGBA(0, 0, 0, 0)
        case "white": return RGBA(1, 1, 1)
        case "black": return RGBA(0, 0, 0)
        default: break
        }
        if s.hasPrefix("#") {
            var hex = String(s.dropFirst())
            if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
            guard hex.count == 6 || hex.count == 8, let v = UInt64(hex, radix: 16) else { return nil }
            if hex.count == 6 {
                return RGBA(Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
            }
            return RGBA(
                Double((v >> 24) & 0xFF) / 255, Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255,
                Double(v & 0xFF) / 255)
        }
        if s.hasPrefix("rgb"), let open = s.firstIndex(of: "("), let close = s.lastIndex(of: ")") {
            let parts = s[s.index(after: open)..<close]
                .split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" })
                .compactMap { Double($0.replacingOccurrences(of: "%", with: "")) }
            guard parts.count >= 3 else { return nil }
            return RGBA(parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.count > 3 ? min(1, max(0, parts[3])) : 1)
        }
        return nil
    }
}

/// The 16 blend modes the editor offers (`BlendMode` in the web's types).
public enum BlendMode: String, CaseIterable, Sendable {
    case normal, multiply, screen, overlay, darken, lighten
    case colorDodge = "color-dodge", colorBurn = "color-burn", hardLight = "hard-light", softLight = "soft-light"
    case difference, exclusion, hue, saturation, color, luminosity

    /// An unknown mode draws as normal, like the web's `blendOp`.
    public init(wire: String) { self = BlendMode(rawValue: wire) ?? .normal }

    /// "Color dodge", for the layer list.
    public var label: String {
        let words = rawValue.split(separator: "-").joined(separator: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}

/// The non-destructive adjustments, as the web turns them into a canvas
/// `filter` (`adjustmentsToFilter`): brightness and exposure multiply,
/// contrast, saturate, hue-rotate, blur, invert, in that order. Curves are
/// baked into the pixels by the editor, never applied at composite time.
public struct ColorFilter: Equatable, Sendable {
    public var brightness: Double?
    public var contrast: Double?
    public var saturate: Double?
    public var hue: Double?
    public var blur: Double
    public var invert: Bool

    /// `nil` when the adjustments change nothing.
    public static func from(_ adj: Adjustments) -> ColorFilter? {
        let clamp = { (v: Double) in min(4, max(0, v)) }
        let b = 1 + Double(adj.brightness) / 100 + Double(adj.exposure) / 100
        let c = 1 + Double(adj.contrast) / 100
        let s = 1 + Double(adj.saturation) / 100
        let f = ColorFilter(
            brightness: abs(b - 1) > 0.001 ? clamp(b) : nil,
            contrast: abs(c - 1) > 0.001 ? clamp(c) : nil,
            saturate: abs(s - 1) > 0.001 ? clamp(s) : nil,
            hue: adj.hue != 0 ? Double(adj.hue) : nil,
            blur: Double(adj.blur),
            invert: adj.invert)
        return f.isNeutral ? nil : f
    }

    public var isNeutral: Bool {
        brightness == nil && contrast == nil && saturate == nil && hue == nil && blur <= 0 && !invert
    }

    /// Whether anything but the blur is set.
    public var changesColor: Bool { brightness != nil || contrast != nil || saturate != nil || hue != nil || invert }

    /// One straight-alpha colour through the colour steps (each clamped, as the
    /// CSS filter functions are).
    public func apply(_ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
        let cl = { (v: Double) in min(1, max(0, v)) }
        var (r, g, b) = (r, g, b)
        if let k = brightness { (r, g, b) = (cl(r * k), cl(g * k), cl(b * k)) }
        if let k = contrast {
            let o = 0.5 - 0.5 * k
            (r, g, b) = (cl(r * k + o), cl(g * k + o), cl(b * k + o))
        }
        if let s = saturate {
            let m = [
                0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
                0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
                0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
            ]
            (r, g, b) = Self.mul(m, r, g, b)
        }
        if let deg = hue {
            let cs = cos(deg * .pi / 180)
            let sn = sin(deg * .pi / 180)
            let m = [
                0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
                0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283,
                0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072,
            ]
            (r, g, b) = Self.mul(m, r, g, b)
        }
        if invert { (r, g, b) = (1 - r, 1 - g, 1 - b) }
        return (r, g, b)
    }

    private static func mul(_ m: [Double], _ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
        let cl = { (v: Double) in min(1, max(0, v)) }
        return (
            cl(m[0] * r + m[1] * g + m[2] * b), cl(m[3] * r + m[4] * g + m[5] * b), cl(m[6] * r + m[7] * g + m[8] * b)
        )
    }
}

/// Straight-alpha RGBA pixels, row by row. (Kotlin keeps ARGB ints.)
public struct RGBAImage: Equatable, Sendable {
    public let width: Int
    public let height: Int
    public var pixels: [UInt8]

    public init(width: Int, height: Int, pixels: [UInt8]? = nil) {
        self.width = width
        self.height = height
        self.pixels = pixels ?? [UInt8](repeating: 0, count: width * height * 4)
    }

    public subscript(x: Int, y: Int) -> (UInt8, UInt8, UInt8, UInt8) {
        let i = (y * width + x) * 4
        return (pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3])
    }
}

/// The per-pixel steps of preparing a layer: mask, colour, blur. (Kotlin `PixelOps`.)
public enum PixelOps {
    /// Alpha times the mask's luminance (`maskToAlpha` + `destination-in`).
    /// The mask is read at the same size; outside it, the layer is hidden.
    public static func mask(_ img: inout RGBAImage, with mask: RGBAImage) {
        for y in 0..<img.height {
            for x in 0..<img.width {
                let i = (y * img.width + x) * 4
                var lum = 0.0
                if x < mask.width, y < mask.height {
                    let j = (y * mask.width + x) * 4
                    lum = 0.299 * Double(mask.pixels[j]) + 0.587 * Double(mask.pixels[j + 1]) + 0.114 * Double(mask.pixels[j + 2])
                }
                img.pixels[i + 3] = UInt8(min(255, max(0, (Double(img.pixels[i + 3]) * lum / 255).rounded())))
            }
        }
    }

    /// The filter's colour steps on every visible pixel.
    public static func color(_ img: inout RGBAImage, _ f: ColorFilter) {
        guard f.changesColor else { return }
        var cache: [UInt32: (UInt8, UInt8, UInt8)] = [:]
        for i in stride(from: 0, to: img.pixels.count, by: 4) where img.pixels[i + 3] > 0 {
            let key = UInt32(img.pixels[i]) << 16 | UInt32(img.pixels[i + 1]) << 8 | UInt32(img.pixels[i + 2])
            let out: (UInt8, UInt8, UInt8)
            if let hit = cache[key] {
                out = hit
            } else {
                let (r, g, b) = f.apply(Double(img.pixels[i]) / 255, Double(img.pixels[i + 1]) / 255, Double(img.pixels[i + 2]) / 255)
                out = (UInt8((r * 255).rounded()), UInt8((g * 255).rounded()), UInt8((b * 255).rounded()))
                if cache.count < 65_536 { cache[key] = out }
            }
            img.pixels[i] = out.0
            img.pixels[i + 1] = out.1
            img.pixels[i + 2] = out.2
        }
    }

    /// How far a blur of `radius` spills past the layer box (three sigma, as the web pads).
    public static func blurPad(_ radius: Double) -> Int { radius > 0 ? Int((radius * 3).rounded(.up)) : 0 }

    /// A gaussian blur (sigma = `radius`, the CSS `blur()`), approximated by
    /// three box passes over premultiplied pixels. The result is padded by
    /// ``blurPad(_:)`` on every side.
    public static func blur(_ img: RGBAImage, radius: Double) -> RGBAImage {
        let pad = blurPad(radius)
        guard pad > 0 else { return img }
        let w = img.width + pad * 2
        let h = img.height + pad * 2
        var ch = [[Double]](repeating: [Double](repeating: 0, count: w * h), count: 4)
        for y in 0..<img.height {
            for x in 0..<img.width {
                let i = (y * img.width + x) * 4
                let a = Double(img.pixels[i + 3]) / 255
                let o = (y + pad) * w + x + pad
                ch[0][o] = Double(img.pixels[i]) * a
                ch[1][o] = Double(img.pixels[i + 1]) * a
                ch[2][o] = Double(img.pixels[i + 2]) * a
                ch[3][o] = a * 255
            }
        }
        for size in boxSizes(sigma: radius) {
            let r = (size - 1) / 2
            for c in 0..<4 {
                ch[c] = boxPass(ch[c], w: w, h: h, r: r, horizontal: true)
                ch[c] = boxPass(ch[c], w: w, h: h, r: r, horizontal: false)
            }
        }
        var out = RGBAImage(width: w, height: h)
        for o in 0..<(w * h) {
            let a = ch[3][o]
            guard a > 0.5 else { continue }
            let k = 255 / a
            out.pixels[o * 4] = UInt8(min(255, max(0, (ch[0][o] * k).rounded())))
            out.pixels[o * 4 + 1] = UInt8(min(255, max(0, (ch[1][o] * k).rounded())))
            out.pixels[o * 4 + 2] = UInt8(min(255, max(0, (ch[2][o] * k).rounded())))
            out.pixels[o * 4 + 3] = UInt8(min(255, max(0, a.rounded())))
        }
        return out
    }

    /// Box widths whose three passes approximate a gaussian of `sigma`.
    static func boxSizes(sigma: Double) -> [Int] {
        let ideal = (12 * sigma * sigma / 3 + 1).squareRoot()
        var wl = Int(ideal.rounded(.down))
        if wl % 2 == 0 { wl -= 1 }
        let wu = wl + 2
        let mIdeal = (12 * sigma * sigma - 3 * Double(wl * wl) - 12 * Double(wl) - 9) / (-4 * Double(wl) - 4)
        let m = Int(mIdeal.rounded())
        return (0..<3).map { $0 < m ? max(1, wl) : max(1, wu) }
    }

    private static func boxPass(_ src: [Double], w: Int, h: Int, r: Int, horizontal: Bool) -> [Double] {
        guard r > 0 else { return src }
        var dst = [Double](repeating: 0, count: src.count)
        let lines = horizontal ? h : w
        let len = horizontal ? w : h
        let norm = 1 / Double(2 * r + 1)
        for line in 0..<lines {
            let at = { (k: Int) -> Int in horizontal ? line * w + k : k * w + line }
            var acc = 0.0
            for k in -r...r where k >= 0 && k < len { acc += src[at(k)] }
            for k in 0..<len {
                dst[at(k)] = acc * norm
                let add = k + r + 1
                let drop = k - r
                if add < len { acc += src[at(add)] }
                if drop >= 0 { acc -= src[at(drop)] }
            }
        }
        return dst
    }
}
