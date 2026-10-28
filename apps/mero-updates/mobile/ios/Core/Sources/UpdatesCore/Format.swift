import Foundation

/// The web app's display helpers (`app/src/lib/updates.ts`), so both sides say
/// the same thing about the same data. Timestamps are the contract's
/// milliseconds.
public enum Format {
    public static func date(ms: UInt64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }

    public static func ms(_ date: Date) -> UInt64 { UInt64(max(0, date.timeIntervalSince1970 * 1000)) }

    /// "just now", "5m ago", "3h ago", "12d ago", then the date.
    public static func timeAgo(_ ms: UInt64, now: Date = Date(), calendar: Calendar = .current) -> String {
        guard ms > 0 else { return "never" }
        let seconds = max(0, Int((now.timeIntervalSince1970 * 1000 - Double(ms)) / 1000))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 30 { return "\(days)d ago" }
        return formatDate(ms, calendar: calendar)
    }

    /// "Oct 28, 2026".
    public static func formatDate(_ ms: UInt64, calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US")
        formatter.setLocalizedDateFormatFromTemplate("yMMMd")
        return formatter.string(from: date(ms: ms))
    }

    /// "Due today", "Due in 3 days", "2 days overdue".
    public static func dueLabel(_ dueMs: UInt64, now: Date = Date()) -> String {
        let day = 86_400_000.0
        let days = Int(((Double(dueMs) - now.timeIntervalSince1970 * 1000) / day).rounded())
        if days == 0 { return "Due today" }
        if days > 0 { return "Due in \(days) day\(days == 1 ? "" : "s")" }
        return "\(-days) day\(days == -1 ? "" : "s") overdue"
    }

    public static func isOverdue(_ dueMs: UInt64, now: Date = Date()) -> Bool {
        Double(dueMs) < now.timeIntervalSince1970 * 1000
    }

    /// The month's update title: "October 2026 update".
    public static func monthTitle(now: Date = Date(), calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "LLLL yyyy"
        return "\(formatter.string(from: now)) update"
    }

    public static func plural(_ n: UInt64, _ one: String, _ many: String? = nil) -> String {
        "\(n) \(n == 1 ? one : (many ?? one + "s"))"
    }

    /// "Read 3/4 (75%)": the share of updates a person opened, rounded.
    public static func percent(_ part: UInt64, of total: UInt64) -> Int {
        guard total > 0 else { return 0 }
        return Int((Double(part) / Double(total) * 100).rounded())
    }
}

/// Names for accounts, the web's `personLabel` / `shortAccount` / `initials`.
public enum People {
    /// `abcdef…7890`.
    public static func shortAccount(_ account: String) -> String {
        account.count > 12 ? "\(account.prefix(6))…\(account.suffix(4))" : account
    }

    /// Their profile name, else a short account id.
    public static func label(_ name: String, _ account: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? shortAccount(account) : trimmed
    }

    /// Up to two initials from a label.
    public static func initials(_ name: String, _ account: String) -> String {
        let label = label(name, account)
        let words = label.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "_" }).filter { !$0.isEmpty }
        let letters = words.prefix(2).compactMap { $0.first.map(String.init) }.joined()
        return (letters.isEmpty ? String(label.prefix(2)) : letters).uppercased()
    }

    /// A stable hue (0..<360) for an account's avatar.
    public static func avatarHue(_ account: String) -> Int {
        var hash: UInt32 = 2_166_136_261
        for byte in account.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        return Int(hash % 360)
    }
}

/// KPI values are stored as typed ("$1.2M", "38%"); these read the number out
/// for deltas and sparklines, exactly as the web's `parseMetric` / `deltaLabel`.
public enum Metrics {
    public enum Direction: String, Sendable { case up, down, flat }

    /// The number in a KPI value, with a k/m/b suffix applied. Nil when there is none.
    public static func parse(_ value: String) -> Double? {
        let cleaned = value.replacingOccurrences(of: ",", with: "")
        guard let regex = try? NSRegularExpression(pattern: #"(-?\d+(?:\.\d+)?)\s*(?:([kKmMbB])(?![a-zA-Z]))?"#),
            let match = regex.firstMatch(in: cleaned, range: NSRange(cleaned.startIndex..., in: cleaned)),
            let numberRange = Range(match.range(at: 1), in: cleaned),
            let number = Double(cleaned[numberRange]), number.isFinite
        else { return nil }
        var multiplier = 1.0
        if let suffixRange = Range(match.range(at: 2), in: cleaned) {
            switch cleaned[suffixRange].lowercased() {
            case "k": multiplier = 1e3
            case "m": multiplier = 1e6
            case "b": multiplier = 1e9
            default: break
            }
        }
        return number * multiplier
    }

    /// "+12%", "−4%" (a real minus sign), "±0%", or nil when either side has no number.
    public static func delta(_ previous: String, _ next: String) -> String? {
        guard let a = parse(previous), let b = parse(next), a != 0 else { return nil }
        let pct = (b - a) / abs(a) * 100
        guard pct.isFinite else { return nil }
        let rounded = abs(pct) >= 10 ? pct.rounded() : (pct * 10).rounded() / 10
        if rounded == 0 { return "±0%" }
        return "\(rounded > 0 ? "+" : "−")\(trim(abs(rounded)))%"
    }

    public static func direction(_ delta: String?) -> Direction {
        guard let delta else { return .flat }
        if delta.hasPrefix("+") { return .up }
        if delta.hasPrefix("−") { return .down }
        return .flat
    }

    /// The numbers of a series, for a sparkline; values with no number are skipped.
    public static func points(_ values: [String]) -> [Double] { values.compactMap(parse) }

    /// The change between a post's KPI and the previous report of the same metric.
    public static func previous(of name: String, before postId: String, in series: [MetricSeries]) -> MetricPoint? {
        guard let line = series.first(where: { $0.name.lowercased() == name.lowercased() }),
            let index = line.points.firstIndex(where: { $0.postId == postId }), index > 0
        else { return nil }
        return line.points[index - 1]
    }

    /// The latest reported value of a metric, for "last: $42k" in the composer.
    public static func last(of name: String, in series: [MetricSeries]) -> String? {
        let key = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !key.isEmpty else { return nil }
        return series.first(where: { $0.name.lowercased() == key })?.points.last?.value
    }

    private static func trim(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }
}

/// The kinds of help an ask can request.
public struct AskKind: Hashable, Sendable {
    public let id: String
    public let label: String
    public let hint: String

    public static let all: [AskKind] = [
        AskKind(id: "intro", label: "Intro", hint: "An introduction to a person or company"),
        AskKind(id: "hire", label: "Hiring", hint: "A candidate referral"),
        AskKind(id: "customer", label: "Customer", hint: "A lead or a design partner"),
        AskKind(id: "advice", label: "Advice", hint: "Expertise or a second opinion"),
        AskKind(id: "fundraising", label: "Fundraising", hint: "An investor intro or a term-sheet read"),
        AskKind(id: "other", label: "Other", hint: "Anything else"),
    ]

    public static func of(_ id: String) -> AskKind { all.first { $0.id == id } ?? all[all.count - 1] }
}

/// What the app offers to react with, and the rest of the web's fixed lists.
public enum Catalog {
    public static let reactions = ["👍", "🎉", "❤️", "🚀", "👀", "🙏"]

    public static let categoryColors = [
        "#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#525252",
    ]

    public struct Cadence: Hashable, Sendable {
        public let days: UInt32
        public let label: String
    }

    public static let cadences = [
        Cadence(days: 0, label: "No reminder"),
        Cadence(days: 7, label: "Weekly"),
        Cadence(days: 14, label: "Every two weeks"),
        Cadence(days: 30, label: "Monthly"),
        Cadence(days: 91, label: "Quarterly"),
    ]

    public struct StarterCategory: Hashable, Sendable {
        public let name: String
        public let emoji: String
        public let color: String
    }

    public static let starterCategories = [
        StarterCategory(name: "Monthly update", emoji: "📅", color: "#2563eb"),
        StarterCategory(name: "Fundraising", emoji: "💰", color: "#16a34a"),
        StarterCategory(name: "Product", emoji: "🚀", color: "#7c3aed"),
        StarterCategory(name: "Hiring", emoji: "🧑‍💻", color: "#d97706"),
        StarterCategory(name: "Board", emoji: "🏛️", color: "#525252"),
    ]

    /// `#rrggbb` to 0xRRGGBB, nil when it is not one.
    public static func rgb(_ hex: String) -> UInt32? {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let value = UInt32(s, radix: 16) else { return nil }
        return value
    }
}
