import Foundation

/// Names, initials and avatar colours (the web app's `lib/people.ts`).
public enum People {
    /// A long account id shortened for a byline: `a1b2c3…7890`.
    public static func shortAccount(_ account: String) -> String {
        account.count > 12 ? "\(account.prefix(6))…\(account.suffix(4))" : account
    }

    /// The name someone chose on this team, else a short id. Never blank.
    public static func displayName(_ account: String, _ name: String?) -> String {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? shortAccount(account) : trimmed
    }

    /// Up to two letters: "Ana Lee" -> "AL", unnamed -> from the id.
    public static func initials(_ account: String, _ name: String?) -> String {
        let words = (name ?? "").split(whereSeparator: { $0.isWhitespace })
        if words.count >= 2, let a = words[0].first, let b = words[1].first {
            return "\(a)\(b)".uppercased()
        }
        if let one = words.first { return String(one.prefix(2)).uppercased() }
        return String(account.prefix(2)).uppercased()
    }

    /// A hue (0–359) from the ACCOUNT, so renaming yourself keeps your colour.
    public static func avatarHue(_ account: String) -> Int {
        var h: UInt32 = 0
        for unit in account.utf16 { h = h &* 31 &+ UInt32(unit) }
        return Int(h % 360)
    }

    /// Who has taken part but has not posted among `posted`, by name. Shown for
    /// today only: for a past day the contract cannot tell "skipped" from "had
    /// not joined yet".
    public static func notYetPosted(_ members: [MemberView], posted: [UpdateView]) -> [MemberView] {
        let done = Set(posted.map(\.author))
        return members.filter { !done.contains($0.account) }
            .sorted { displayName($0.account, $0.name).localizedCompare(displayName($1.account, $1.name)) == .orderedAscending }
    }
}
