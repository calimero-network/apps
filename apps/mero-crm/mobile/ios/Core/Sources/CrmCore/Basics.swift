import Foundation

/// The kinds of activity the contract knows, in the web app's order.
public enum ActivityKind: String, CaseIterable, Sendable, Identifiable {
    case call, meeting, task, email, deadline

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .call: return "Call"
        case .meeting: return "Meeting"
        case .task: return "Task"
        case .email: return "Email"
        case .deadline: return "Deadline"
        }
    }

    /// The label for a stored kind, or the kind itself for one this app does not know.
    public static func label(_ raw: String) -> String { ActivityKind(rawValue: raw)?.label ?? raw }
}

/// Money is whole units of the pipeline's currency (`u64`), never a float.
public enum Money {
    private static let symbols: [String: String] = [
        "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥", "CNY": "CN¥", "INR": "₹", "CAD": "CA$",
        "AUD": "A$", "NZD": "NZ$", "BRL": "R$", "CHF": "CHF ", "KRW": "₩", "MXN": "MX$",
    ]

    /// `$12,400` or, compact, `$12.4K`. A code with no known symbol reads `12,400 XYZ`.
    public static func format(_ value: UInt64, currency: String, compact: Bool = false) -> String {
        let code = currency.trimmingCharacters(in: .whitespaces).uppercased()
        let number = compact ? compactNumber(value) : grouped(value)
        if let symbol = symbols[code] { return symbol + number }
        return code.isEmpty ? number : "\(number) \(code)"
    }

    /// `12,400`.
    public static func grouped(_ value: UInt64) -> String {
        let digits = Array(String(value))
        var out = ""
        for (i, d) in digits.enumerated() {
            if i > 0, (digits.count - i) % 3 == 0 { out.append(",") }
            out.append(d)
        }
        return out
    }

    /// `950`, `12.4K`, `1.5M`, `2B`.
    public static func compactNumber(_ value: UInt64) -> String {
        let steps: [(UInt64, String)] = [(1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")]
        for (size, suffix) in steps where value >= size {
            let tenths = (value * 10 + size / 2) / size
            let whole = tenths / 10
            let frac = tenths % 10
            return frac == 0 || whole >= 100 ? "\(whole)\(suffix)" : "\(whole).\(frac)\(suffix)"
        }
        return String(value)
    }

    /// What a person types into a value field: `12k`, `1.5m`, `$12,400`. Empty is 0;
    /// nil when it is not a number.
    public static func parse(_ input: String) -> UInt64? {
        var s = input.lowercased().filter { !$0.isWhitespace && !",$€£¥".contains($0) }
        if s.isEmpty { return 0 }
        var mult = 1.0
        if s.hasSuffix("k") {
            mult = 1_000
            s.removeLast()
        } else if s.hasSuffix("m") {
            mult = 1_000_000
            s.removeLast()
        }
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        guard !s.isEmpty, parts.count <= 2, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }),
            let number = Double(s)
        else { return nil }
        let value = (number * mult).rounded()
        guard value < 1.8e19 else { return nil }
        return UInt64(value)
    }

    /// Whether a currency code is three letters.
    public static func isValidCode(_ code: String) -> Bool {
        let c = code.trimmingCharacters(in: .whitespaces)
        return c.count == 3 && c.allSatisfy { $0.isASCII && $0.isLetter }
    }
}

/// How urgent a due date reads.
public enum DueTone: String, Sendable {
    case overdue, today, soon, later
}

public struct DueLabel: Equatable, Sendable {
    public init(text: String, tone: DueTone) {
        self.text = text
        self.tone = tone
    }

    public let text: String
    public let tone: DueTone
}

/// Dates as the contract keeps them (milliseconds since the epoch) and as people read them.
public enum Days {
    public static let dayMs: UInt64 = 86_400_000

    public static func date(_ ms: UInt64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }
    public static func ms(_ date: Date) -> UInt64 { UInt64(max(0, (date.timeIntervalSince1970 * 1000).rounded())) }

    public static func startOfDay(_ date: Date, _ calendar: Calendar) -> Date { calendar.startOfDay(for: date) }

    /// Whole calendar days from `from` to `to` (negative when `to` is earlier).
    public static func between(_ from: Date, _ to: Date, _ calendar: Calendar) -> Int {
        calendar.dateComponents([.day], from: calendar.startOfDay(for: from), to: calendar.startOfDay(for: to)).day ?? 0
    }

    /// A due time `days` from now, at 10:00 local: when people actually call.
    public static func dueIn(_ days: Int, now: Date, _ calendar: Calendar) -> Date {
        let day = calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: now)) ?? now
        return calendar.date(bySettingHour: 10, minute: 0, second: 0, of: day) ?? day
    }

    /// A picked calendar day at local noon, so a timezone shift never moves the day.
    public static func noon(_ date: Date, _ calendar: Calendar) -> Date {
        calendar.date(bySettingHour: 12, minute: 0, second: 0, of: date) ?? date
    }

    /// A picked day at 10:00 local, for a due date.
    public static func atTen(_ date: Date, _ calendar: Calendar) -> Date {
        calendar.date(bySettingHour: 10, minute: 0, second: 0, of: date) ?? date
    }

    /// "Overdue 3d" / "Today" / "Tomorrow" / "In 4 days" / "Mar 3".
    public static func dueLabel(_ due: Date, now: Date, _ calendar: Calendar) -> DueLabel {
        let d = between(now, due, calendar)
        if d < 0 { return DueLabel(text: "Overdue \(-d)d", tone: .overdue) }
        if d == 0 { return DueLabel(text: "Today", tone: .today) }
        if d == 1 { return DueLabel(text: "Tomorrow", tone: .soon) }
        if d < 7 { return DueLabel(text: "In \(d) days", tone: .soon) }
        return DueLabel(text: short(due, calendar), tone: .later)
    }

    /// "Mar 3", or "Mar 3, 2025" outside the current year.
    public static func short(_ date: Date, _ calendar: Calendar, now: Date = Date()) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = calendar.locale ?? .current
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        f.setLocalizedDateFormatFromTemplate(sameYear ? "MMMd" : "MMMdyyyy")
        return f.string(from: date)
    }

    /// "just now", "5m ago", "3h ago", "2d ago", then the date.
    public static func ago(_ date: Date, now: Date, _ calendar: Calendar) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h ago" }
        if seconds < 86_400 * 30 { return "\(Int(seconds / 86_400))d ago" }
        return short(date, calendar, now: now)
    }
}
