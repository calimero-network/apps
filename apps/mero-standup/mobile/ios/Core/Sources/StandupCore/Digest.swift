import Foundation

/// One person's week: their updates in day order, only days they posted.
public struct PersonWeek: Identifiable, Equatable, Sendable {
    public var account: String
    public var name: String
    public var updates: [UpdateView]
    public var id: String { account }
}

/// The week digest (the web's `lib/digest.ts`).
public enum Digest {
    /// A week regrouped by person, people in name order. The latest name wins.
    public static func byPerson(_ week: [DayView]) -> [PersonWeek] {
        var order: [String] = []
        var people: [String: PersonWeek] = [:]
        for day in week {
            for u in day.updates {
                var p = people[u.author] ?? PersonWeek(account: u.author, name: u.authorName, updates: [])
                if people[u.author] == nil { order.append(u.author) }
                if !u.authorName.isEmpty { p.name = u.authorName }
                p.updates.append(u)
                people[u.author] = p
            }
        }
        return order.compactMap { people[$0] }.sorted {
            People.displayName($0.account, $0.name).localizedCompare(People.displayName($1.account, $1.name))
                == .orderedAscending
        }
    }

    /// The week as Markdown, for a weekly report. Leaves the app only when the
    /// person shares or copies it.
    public static func markdown(teamName: String, start: String, week: [DayView], calendar: Calendar = .current) -> String {
        var lines = ["# \(teamName.isEmpty ? "Team" : teamName) — week of \(Days.describeWeek(start, calendar: calendar))", ""]
        let people = byPerson(week)
        if people.isEmpty { lines.append("_No updates this week._") }
        for p in people {
            lines.append(contentsOf: ["## \(People.displayName(p.account, p.name))", ""])
            for u in p.updates {
                lines.append("**\(Days.weekdayShort(u.day, calendar: calendar))**")
                if !u.done.isEmpty { lines.append("- Done: \(oneLine(u.done))") }
                if !u.next.isEmpty { lines.append("- Next: \(oneLine(u.next))") }
                if !u.blockers.isEmpty { lines.append("- Blocked: \(oneLine(u.blockers))") }
                lines.append("")
            }
        }
        var text = lines.joined(separator: "\n")
        while text.last?.isWhitespace == true { text.removeLast() }
        return text + "\n"
    }

    static func oneLine(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: true).joined(separator: "; ")
    }
}
