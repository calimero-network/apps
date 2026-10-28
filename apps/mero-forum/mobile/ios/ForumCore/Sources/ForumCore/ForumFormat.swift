import Foundation

/// How posts, people and times are written. Kotlin `ForumFormat` says the same.
public enum ForumFormat {
    /// The contract stamps with `env::time_now()`, nanoseconds. Anything past
    /// 10^14 cannot be milliseconds, so it is scaled down (the web's `toMs`).
    public static func date(_ stamp: UInt64) -> Date {
        let millis = stamp > 100_000_000_000_000 ? Double(stamp / 1_000_000) : Double(stamp)
        return Date(timeIntervalSince1970: millis / 1000)
    }

    /// The timeline's age: "now", "5m", "3h", "2d", then "Mar 4" (and the year
    /// once it is not this one).
    public static func age(_ stamp: UInt64, now: Date = Date(), calendar: Calendar = .current) -> String {
        let then = date(stamp)
        let seconds = max(0, Int(now.timeIntervalSince(then)))
        if seconds < 60 { return "now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        if days < 7 { return "\(days)d" }
        let sameYear = calendar.component(.year, from: then) == calendar.component(.year, from: now)
        return formatter(sameYear ? "MMM d" : "MMM d, yyyy", calendar: calendar).string(from: then)
    }

    /// The post page's stamp: "3:04 PM · Mar 4, 2026".
    public static func fullStamp(_ stamp: UInt64, calendar: Calendar = .current) -> String {
        let then = date(stamp)
        let time = formatter("h:mm a", calendar: calendar).string(from: then)
        let day = formatter("MMM d, yyyy", calendar: calendar).string(from: then)
        return "\(time) · \(day)"
    }

    private static func formatter(_ format: String, calendar: Calendar) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = format
        return formatter
    }

    /// `3f9a1c…b2e0`: the account, short. Never instead of a name, always beside it.
    public static func shortAccount(_ account: String) -> String {
        account.count > 10 ? "\(account.prefix(6))…\(account.suffix(4))" : account
    }

    /// The handle under a name: `@3f9a1c…b2e0`.
    public static func handle(_ account: String) -> String { "@" + shortAccount(account) }

    /// The name to show for an author: their chosen name, or the short id.
    public static func displayName(_ name: String, account: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? shortAccount(account) : trimmed
    }

    /// One or two letters for an avatar.
    public static func initials(_ label: String) -> String {
        let words = label.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" })
        guard !words.isEmpty else { return "?" }
        let letters = words.prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.uppercased()
    }

    /// Which of the avatar tones a seed takes: a stable hash, so a person keeps
    /// one colour everywhere (and on Android).
    public static func tone(_ seed: String, tones: Int = 6) -> Int {
        var hash: UInt32 = 0
        for byte in seed.utf8 { hash = hash &* 31 &+ UInt32(byte) }
        return Int(hash % UInt32(tones))
    }

    /// "1 reply" / "3 replies", and the like.
    public static func count(_ value: Int, _ singular: String, _ plural: String) -> String {
        "\(value) \(value == 1 ? singular : plural)"
    }

    /// Counts the way a timeline shows them: 999, 1.2K, 12K, 1.3M.
    public static func compact(_ value: Int64) -> String {
        let magnitude = abs(value)
        let sign = value < 0 ? "-" : ""
        func scaled(_ divisor: Int64, _ suffix: String) -> String {
            let tenths = magnitude * 10 / divisor
            let text = tenths < 100 && tenths % 10 != 0 ? "\(tenths / 10).\(tenths % 10)" : "\(tenths / 10)"
            return sign + text + suffix
        }
        if magnitude >= 1_000_000 { return scaled(1_000_000, "M") }
        if magnitude >= 1_000 { return scaled(1_000, "K") }
        return "\(value)"
    }

    /// Whether `text` looks like an account id (64 hex).
    public static func isAccountId(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return trimmed.count == 64 && trimmed.allSatisfy { $0.isHexDigit }
    }
}
