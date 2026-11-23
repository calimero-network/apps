import Foundation

/// One row of a call's roster (`app/src/lib/people.ts`).
public struct Person: Identifiable, Equatable, Sendable {
    public let memberId: String
    public let name: String
    /// Sending video right now.
    public let live: Bool
    public let isSelf: Bool
    public var id: String { memberId }

    public init(memberId: String, name: String, live: Bool, isSelf: Bool) {
        self.memberId = memberId
        self.name = name
        self.live = live
        self.isSelf = isSelf
    }
}

public enum People {
    /// Up to two initials: first and last word, or the first two letters of one word.
    public static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace })
        guard let first = words.first else { return "??" }
        if words.count == 1 { return String(first.prefix(2)).uppercased() }
        return (String(first.prefix(1)) + String(words[words.count - 1].prefix(1))).uppercased()
    }

    /// `abcdef12…`
    public static func shortId(_ id: String) -> String { "\(id.prefix(8))…" }

    /// The roster: the contract's members, plus anyone sending who has not
    /// joined yet. You first, then whoever is live, then by name.
    public static func roster(
        members: [(id: String, name: String)], liveIds: Set<String>, me: String, selfName: String, selfLive: Bool
    ) -> [Person] {
        var rows = members.map { member in
            Person(
                memberId: member.id,
                name: member.id == me
                    ? selfName
                    : (member.name.trimmingCharacters(in: .whitespaces).isEmpty ? shortId(member.id) : member.name),
                live: member.id == me ? selfLive : liveIds.contains(member.id),
                isSelf: member.id == me)
        }
        let known = Set(rows.map(\.memberId))
        for id in liveIds.sorted() where !known.contains(id) {
            rows.append(Person(memberId: id, name: shortId(id), live: true, isSelf: false))
        }
        if !rows.contains(where: \.isSelf) {
            rows.append(Person(memberId: me, name: selfName, live: selfLive, isSelf: true))
        }
        return rows.sorted { a, b in
            if a.isSelf != b.isSelf { return a.isSelf }
            if a.live != b.live { return a.live }
            if a.name != b.name { return a.name.localizedCompare(b.name) == .orderedAscending }
            return a.memberId < b.memberId
        }
    }
}
