import Foundation

/// The web app's display rules, ported so both clients show a channel the same way.
enum ChatFormat {
    // MARK: Time (`virtualized-chat/utils.ts`)

    /// `formatTimeAgo`: `HH:mm` today, `yesterday`, else `DD/MM/YYYY`.
    static func messageTime(_ seconds: UInt64, now: Date = Date(), calendar: Calendar = .current) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(seconds))
        let parts = calendar.dateComponents([.day, .month, .year, .hour, .minute], from: date)
        if calendar.isDate(date, inSameDayAs: now) {
            return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
        }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return "yesterday"
        }
        return day(date, calendar: calendar)
    }

    /// `DD/MM/YYYY`, as the channel details and join screens show dates.
    static func day(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.day, .month, .year], from: date)
        return String(format: "%02d/%02d/%04d", parts.day ?? 0, parts.month ?? 0, parts.year ?? 0)
    }

    /// `elapsedTime`: "now", "37 minutes ago", "yesterday", "3 days ago", …
    static func elapsed(_ seconds: UInt64, now: Date = Date()) -> String {
        let diff = Int(now.timeIntervalSince1970) - Int(clamping: seconds)
        func unit(_ n: Int, _ name: String) -> String { "\(n) \(name)\(n == 1 ? "" : "s") ago" }
        switch diff {
        case ..<60: return "now"
        case ..<3600: return unit(diff / 60, "minute")
        case ..<86400: return unit(diff / 3600, "hour")
        case ..<172_800: return "yesterday"
        case ..<604_800: return unit(diff / 86400, "day")
        case ..<2_419_200: return unit(diff / 604_800, "week")
        case ..<29_030_400: return unit(diff / 2_592_000, "month")
        default: return unit(diff / 31_556_952, "year")
        }
    }

    // MARK: Message grouping (`Message/index.tsx`)

    /// Whether a message starts a new group (avatar, name, time): the first
    /// message, another sender, after a deleted message, or a minute or more
    /// after the previous one.
    static func startsGroup(_ message: ChatMessage, after previous: ChatMessage?) -> Bool {
        guard let previous else { return true }
        return previous.sender != message.sender || previous.deleted
            || (previous.text.isEmpty && previous.editedOn != nil)
            || message.timestamp >= previous.timestamp + 60
    }

    // MARK: Avatars (`Message/Avatar.tsx`)

    /// The avatar palette, as hex.
    static let avatarPalette = [
        "#e0637a", "#3e63f5", "#8b5cf6", "#0f9b8e", "#d97706", "#db2777", "#2563eb", "#16a34a",
    ]

    /// `initialsColor`: a JS string hash (`h = h * 31 + charCode`, int32) into the palette.
    static func avatarColor(for name: String) -> String {
        var hash: Int32 = 0
        for unit in name.utf16 { hash = hash &* 31 &+ Int32(unit) }
        let magnitude = hash == Int32.min ? Int(Int32.max) + 1 : Int(abs(hash))
        return avatarPalette[magnitude % avatarPalette.count]
    }

    /// The first letter of each word, the first two of them, upper-cased.
    static func initials(_ name: String) -> String {
        String(name.split(separator: " ").compactMap(\.first).prefix(2)).uppercased()
    }

    /// `placeholderName.ts`: a name that is really an id, so the avatar shows a person glyph instead of letters.
    static func isPlaceholderName(_ name: String) -> Bool {
        let t = name.trimmingCharacters(in: .whitespaces)
        if t.isEmpty || ["unknown", "unnamed member"].contains(t.lowercased()) { return true }
        if t.contains("…") || t.contains("...") { return true }
        let hex = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
        if t.count == 64, t.unicodeScalars.allSatisfy(hex.contains) { return true }
        let base58 = CharacterSet(charactersIn: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
        return (32...44).contains(t.count) && t.unicodeScalars.allSatisfy(base58.contains)
    }

    // MARK: Composer

    /// The composer's placeholder: "Message #channel", "Message {name}", or "Reply in thread".
    static func composerPlaceholder(channel: ChannelEntry, inThread: Bool) -> String {
        if inThread { return "Reply in thread" }
        if channel.kind == .dm {
            let name = channel.name.count >= 44 ? "\(channel.name.prefix(6))...\(channel.name.suffix(4))" : channel.name
            return "Message \(name)"
        }
        return "Message #\(channel.name)"
    }

    /// "1 reply" / "N replies".
    static func replies(_ count: UInt32) -> String {
        count == 1 ? "1 reply" : "\(count) replies"
    }

    // MARK: Channel names (`utils/validation.ts`)

    /// Why a channel name is refused, or `nil`: 3–19 characters, no `#`, `!` or spaces.
    static func channelNameProblem(_ name: String, existing: [String] = []) -> String? {
        if name.contains(where: { $0 == "#" || $0 == "!" || $0.isWhitespace }) || name.contains("://") {
            return "Channel name must not contain special charters or links."
        }
        if name.count < 3 { return "Channel name is too short. It should be at least 3 characters." }
        if name.count > 19 { return "Channel name is too long. It should be at most 19 characters." }
        if existing.contains(where: { $0.caseInsensitiveCompare(name) == .orderedSame }) {
            return "A group with this name already exists"
        }
        return nil
    }
}
