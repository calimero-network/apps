import Foundation

/// A colour as the canvas stores it, resolved to sRGB components 0...1.
public struct RGBA: Equatable, Hashable, Sendable {
    public var r: Double
    public var g: Double
    public var b: Double
    public var a: Double

    public init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
        self.r = r
        self.g = g
        self.b = b
        self.a = a
    }

    public init(hex: UInt32) {
        self.init(
            Double((hex >> 16) & 0xFF) / 255, Double((hex >> 8) & 0xFF) / 255, Double(hex & 0xFF) / 255)
    }

    public static let black = RGBA(0, 0, 0)
    public static let white = RGBA(1, 1, 1)
    /// What a line, arrow or freehand stroke falls back to with no stroke colour.
    public static let defaultInk = RGBA(hex: 0x111111)
    /// `inkFor` on a light fill.
    public static let darkInk = RGBA(hex: 0x1E1E1E)
    /// An image whose bytes have not arrived (the web export's placeholder).
    public static let placeholderFill = RGBA(hex: 0xE8E8E8)
    public static let placeholderStroke = RGBA(hex: 0xCCCCCC)
}

/// CSS colour strings the web canvas writes: `#rgb`, `#rgba`, `#rrggbb`,
/// `#rrggbbaa`, `rgb()`/`rgba()`, `transparent`/`none`, and the basic names.
public enum CSSColor {
    /// Whether the web would paint this colour at all (`isPainted`).
    public static func isPainted(_ value: String?) -> Bool {
        guard let v = value?.trimmingCharacters(in: .whitespaces), !v.isEmpty else { return false }
        return v != "transparent" && v != "none"
    }

    /// The colour, or `nil` for `transparent`, `none` or anything unreadable.
    public static func parse(_ value: String?) -> RGBA? {
        guard let raw = value?.trimmingCharacters(in: .whitespaces).lowercased(), isPainted(raw) else { return nil }
        if raw.hasPrefix("#") { return hex(String(raw.dropFirst())) }
        if raw.hasPrefix("rgb") { return functional(raw) }
        return named[raw]
    }

    private static func hex(_ s: String) -> RGBA? {
        guard s.allSatisfy(\.isHexDigit) else { return nil }
        let digits: [Character]
        switch s.count {
        case 3, 4: digits = s.flatMap { [$0, $0] }
        case 6, 8: digits = Array(s)
        default: return nil
        }
        func byte(_ i: Int) -> Double { Double(Int(String(digits[i...i + 1]), radix: 16) ?? 0) / 255 }
        return RGBA(byte(0), byte(2), byte(4), digits.count == 8 ? byte(6) : 1)
    }

    private static func functional(_ s: String) -> RGBA? {
        guard let open = s.firstIndex(of: "("), let close = s.lastIndex(of: ")"), open < close else { return nil }
        let parts = s[s.index(after: open)..<close]
            .split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" })
            .map { String($0) }
        guard parts.count >= 3 else { return nil }
        func channel(_ p: String) -> Double? {
            if p.hasSuffix("%") { return Double(p.dropLast()).map { $0 / 100 } }
            return Double(p).map { $0 / 255 }
        }
        guard let r = channel(parts[0]), let g = channel(parts[1]), let b = channel(parts[2]) else { return nil }
        var a = 1.0
        if parts.count >= 4 {
            let p = parts[3]
            a = p.hasSuffix("%") ? (Double(p.dropLast()) ?? 100) / 100 : (Double(p) ?? 1)
        }
        return RGBA(clamp(r), clamp(g), clamp(b), clamp(a))
    }

    private static func clamp(_ v: Double) -> Double { min(1, max(0, v)) }

    /// WCAG relative luminance of a `#rgb` / `#rrggbb` colour (`luminance` in shapes.ts).
    public static func luminance(_ value: String) -> Double? {
        let v = value.trimmingCharacters(in: .whitespaces)
        guard v.hasPrefix("#"), v.count == 4 || v.count == 7, let c = parse(v) else { return nil }
        func lin(_ x: Double) -> Double { x <= 0.03928 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    }

    /// Text colour for words on `fill` when none was chosen (`inkFor`):
    /// white on dark fills, near-black otherwise.
    public static func ink(on fill: String?) -> RGBA {
        guard let fill, isPainted(fill), let l = luminance(fill) else { return .darkInk }
        return l < 0.35 ? .white : .darkInk
    }

    private static let named: [String: RGBA] = [
        "black": RGBA(hex: 0x000000), "white": RGBA(hex: 0xFFFFFF), "red": RGBA(hex: 0xFF0000),
        "green": RGBA(hex: 0x008000), "blue": RGBA(hex: 0x0000FF), "yellow": RGBA(hex: 0xFFFF00),
        "orange": RGBA(hex: 0xFFA500), "purple": RGBA(hex: 0x800080), "gray": RGBA(hex: 0x808080),
        "grey": RGBA(hex: 0x808080), "pink": RGBA(hex: 0xFFC0CB), "brown": RGBA(hex: 0xA52A2A),
        "cyan": RGBA(hex: 0x00FFFF), "magenta": RGBA(hex: 0xFF00FF), "lime": RGBA(hex: 0x00FF00),
        "navy": RGBA(hex: 0x000080), "teal": RGBA(hex: 0x008080), "silver": RGBA(hex: 0xC0C0C0),
    ]
}
