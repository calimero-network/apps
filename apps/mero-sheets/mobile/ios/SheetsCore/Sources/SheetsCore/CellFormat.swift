import Foundation

/// A cell's computed value as shown, by its format keyword. The twin of
/// `app/src/spreadsheet/format.ts`: `number[:dp]`, `currency[:CODE[:dp]]`,
/// `percent[:dp]`, `date[:us|eu|long]`, `text`. Anything that is not a number
/// (or a date, for `date`) is shown unchanged, so `#REF!` passes through.
public enum CellFormat {
    public struct Parts: Equatable {
        public let kind: String
        public let code: String
        public let decimals: Int
        public let style: String
    }

    public static func parse(_ format: String) -> Parts {
        let bits = format.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        let kind = bits.first ?? ""
        let a = bits.count > 1 ? bits[1] : ""
        let b = bits.count > 2 ? bits[2] : ""
        func digits(_ s: String, _ fallback: Int) -> Int {
            guard let n = Int(s), n >= 0, n <= 10 else { return fallback }
            return n
        }
        switch kind {
        case "number": return Parts(kind: kind, code: "", decimals: digits(a, 2), style: "")
        case "currency": return Parts(kind: kind, code: (a.isEmpty ? "USD" : a).uppercased(), decimals: digits(b, 2), style: "")
        case "percent": return Parts(kind: kind, code: "", decimals: digits(a, 0), style: "")
        case "date": return Parts(kind: kind, code: "", decimals: 0, style: a)
        default: return Parts(kind: kind, code: "", decimals: 0, style: "")
        }
    }

    public static func display(_ computed: String, format: String) -> String {
        let p = parse(format)
        switch p.kind {
        case "", "general", "text":
            return computed
        case "date":
            guard let d = parseDate(computed) else { return computed }
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = TimeZone(identifier: "UTC")!
            let c = cal.dateComponents([.year, .month, .day], from: d)
            let y = c.year ?? 0
            let m = String(format: "%02d", c.month ?? 0)
            let day = String(format: "%02d", c.day ?? 0)
            switch p.style {
            case "us": return "\(m)/\(day)/\(y)"
            case "eu": return "\(day)/\(m)/\(y)"
            case "long":
                let f = DateFormatter()
                f.locale = Locale(identifier: "en_GB")
                f.timeZone = TimeZone(identifier: "UTC")
                f.dateFormat = "d MMMM yyyy"
                return f.string(from: d)
            default: return "\(y)-\(m)-\(day)"
            }
        default:
            break
        }
        let trimmed = computed.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let n = Double(trimmed), n.isFinite else { return computed }
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US")
        f.roundingMode = .halfUp
        f.minimumFractionDigits = p.decimals
        f.maximumFractionDigits = p.decimals
        switch p.kind {
        case "number":
            f.numberStyle = .decimal
        case "currency":
            guard p.code.count == 3, p.code.allSatisfy({ $0.isLetter }) else {
                f.numberStyle = .decimal
                return "\(f.string(from: NSNumber(value: n)) ?? computed) \(p.code)"
            }
            f.numberStyle = .currency
            f.currencyCode = p.code
        case "percent":
            f.numberStyle = .percent
        default:
            return computed
        }
        return f.string(from: NSNumber(value: n)) ?? computed
    }

    /// The format in words, for the cell sheet ("Currency (EUR, 2 decimals)").
    public static func describe(_ format: String) -> String {
        let p = parse(format)
        let places = { (n: Int) in n == 1 ? "1 decimal" : "\(n) decimals" }
        switch p.kind {
        case "", "general": return "Automatic"
        case "text": return "Plain text"
        case "number": return "Number (\(places(p.decimals)))"
        case "currency": return "Currency (\(p.code), \(places(p.decimals)))"
        case "percent": return "Percent (\(places(p.decimals)))"
        case "date":
            switch p.style {
            case "us": return "Date (MM/DD/YYYY)"
            case "eu": return "Date (DD/MM/YYYY)"
            case "long": return "Date (long)"
            default: return "Date (YYYY-MM-DD)"
            }
        default: return format
        }
    }

    /// ISO dates and date-times (`2024-03-05`, `2024-03-05T10:00:00Z`), as `Date.parse` reads them.
    static func parseDate(_ text: String) -> Date? {
        let s = text.trimmingCharacters(in: .whitespaces)
        guard s.count >= 10 else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: s) { return d }
        iso.formatOptions = [.withInternetDateTime]
        if let d = iso.date(from: s) { return d }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return s.count == 10 ? f.date(from: s) : nil
    }

    /// Whether a value reads as a number (for alignment and charts).
    public static func number(_ text: String) -> Double? {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, let n = Double(t), n.isFinite else { return nil }
        return n
    }
}

/// A cell's own style, as the contract stores it (one value per field) and the
/// web grid draws it (`app/src/spreadsheet/styling.ts`).
public struct CellLook: Equatable, Sendable {
    public var bold = false
    public var italic = false
    public var underline = false
    public var strike = false
    /// `#rrggbb` text colour.
    public var color: UInt32?
    /// `#rrggbb` fill.
    public var fill: UInt32?
    /// `left`, `center` or `right`; nil is the default (left).
    public var align: String?
    public var wrap = false

    public init() {}

    public init(style: [String: String]) {
        bold = !(style["bold"] ?? "").isEmpty
        italic = !(style["italic"] ?? "").isEmpty
        underline = !(style["underline"] ?? "").isEmpty
        strike = !(style["strike"] ?? "").isEmpty
        wrap = !(style["wrap"] ?? "").isEmpty
        color = style["color"].flatMap(Self.hex)
        fill = style["fill"].flatMap(Self.hex)
        if let a = style["align"], ["left", "center", "right"].contains(a) { align = a }
    }

    public var isPlain: Bool { self == CellLook() }

    /// `#rgb` or `#rrggbb` → 0xRRGGBB.
    public static func hex(_ text: String) -> UInt32? {
        var s = text.trimmingCharacters(in: .whitespaces)
        guard s.hasPrefix("#") else { return nil }
        s.removeFirst()
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return v
    }
}
