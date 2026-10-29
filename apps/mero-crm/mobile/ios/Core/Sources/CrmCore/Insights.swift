import Foundation

public struct StageStat: Identifiable, Equatable, Sendable {
    public let stage: StageView
    public let count: Int
    public let value: UInt64
    public let weighted: UInt64
    public var id: String { stage.id }
}

public struct ForecastMonth: Identifiable, Equatable, Sendable {
    public let label: String
    public let value: UInt64
    public let weighted: UInt64
    public var id: String { label }

    public init(label: String, value: UInt64, weighted: UInt64) {
        self.label = label
        self.value = value
        self.weighted = weighted
    }
}

public struct OwnerStat: Identifiable, Equatable, Sendable {
    public let owner: String
    public let wonValue: UInt64
    public let openValue: UInt64
    public let wonCount: Int
    public var id: String { owner }
}

public struct ReasonCount: Identifiable, Equatable, Sendable {
    public let reason: String
    public let count: Int
    public var id: String { reason }
}

/// The Insights page's numbers (the web's `computeStats`).
public struct PipelineStats: Equatable, Sendable {
    public let openCount: Int
    public let openValue: UInt64
    public let weightedValue: UInt64
    public let wonCount: Int
    public let wonValue: UInt64
    public let lostCount: Int
    public let lostValue: UInt64
    /// 0...100, or nil before anything has closed.
    public let winRate: Int?
    public let avgWonValue: UInt64?
    public let avgCycleDays: Int?
    public let wonThisMonth: UInt64
    public let perStage: [StageStat]
    public let lostReasons: [ReasonCount]
    /// Keyed by owner as stored; label with the model's `ownerLabel`.
    public let byOwner: [OwnerStat]
    /// Open value by expected-close month, this month and the next five, plus undated.
    public let forecast: [ForecastMonth]
}

public enum ActivityBucket: String, CaseIterable, Sendable {
    case overdue, today, upcoming, done

    public var title: String {
        switch self {
        case .overdue: return "Overdue"
        case .today: return "Today"
        case .upcoming: return "Upcoming"
        case .done: return "Recently done"
        }
    }

    /// Shown under an empty section; nil hides the section when empty.
    public var emptyText: String? {
        switch self {
        case .today: return "Nothing due today."
        case .upcoming: return "Nothing scheduled ahead."
        case .overdue, .done: return nil
        }
    }
}

/// A company: the organization named on people and deals, gathered.
public struct Company: Identifiable, Equatable, Sendable {
    public let name: String
    public let people: [ContactView]
    public let deals: [DealView]
    public var id: String { Insights.companyKey(name) }
    public var openDeals: [DealView] { deals.filter { $0.status == "open" } }
    public var openValue: UInt64 { openDeals.reduce(0) { $0 + $1.value } }
    public var wonValue: UInt64 { deals.filter { $0.status == "won" }.reduce(0) { $0 + $1.value } }
}

public enum Insights {
    public static func weighted(_ deal: DealView) -> UInt64 {
        UInt64((Double(deal.value) * Double(deal.probability) / 100).rounded())
    }

    public static func stats(
        deals: [DealView], stages: [StageView], now: Date, _ calendar: Calendar
    ) -> PipelineStats {
        let open = deals.filter { $0.status == "open" }
        let won = deals.filter { $0.status == "won" }
        let lost = deals.filter { $0.status == "lost" }
        func sum(_ xs: [DealView]) -> UInt64 { xs.reduce(0) { $0 + $1.value } }
        func wsum(_ xs: [DealView]) -> UInt64 { xs.reduce(0) { $0 + weighted($1) } }

        let monthStart = calendar.date(from: calendar.dateComponents([.year, .month], from: now)) ?? now
        let cycles = won.compactMap { d in
            d.closedAt.map { max(0, Days.between(Days.date(d.createdAt), Days.date($0), calendar)) }
        }

        var reasonOrder: [String] = []
        var reasons: [String: Int] = [:]
        for d in lost {
            let r = d.lostReason.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = r.isEmpty ? "No reason given" : r
            if reasons[key] == nil { reasonOrder.append(key) }
            reasons[key, default: 0] += 1
        }

        var ownerOrder: [String] = []
        var owners: [String: (won: UInt64, open: UInt64, count: Int)] = [:]
        for d in deals where d.status != "lost" {
            let key = (d.owner ?? "").isEmpty ? "" : d.owner!
            if owners[key] == nil { ownerOrder.append(key) }
            var o = owners[key] ?? (0, 0, 0)
            if d.status == "won" {
                o.won += d.value
                o.count += 1
            } else {
                o.open += d.value
            }
            owners[key] = o
        }

        let monthFormatter = DateFormatter()
        monthFormatter.calendar = calendar
        monthFormatter.timeZone = calendar.timeZone
        monthFormatter.locale = calendar.locale ?? .current
        var forecast: [ForecastMonth] = []
        for i in 0..<6 {
            let start = calendar.date(byAdding: .month, value: i, to: monthStart) ?? monthStart
            let end = calendar.date(byAdding: .month, value: 1, to: start) ?? start
            let inMonth = open.filter { d in
                guard let c = d.expectedClose.map(Days.date) else { return false }
                // Slipped dates count in the current month: they are due now, not never.
                return i == 0 ? c < end : (c >= start && c < end)
            }
            let withYear = i == 0 || calendar.component(.month, from: start) == 1
            monthFormatter.setLocalizedDateFormatFromTemplate(withYear ? "MMMyy" : "MMM")
            forecast.append(ForecastMonth(label: monthFormatter.string(from: start), value: sum(inMonth), weighted: wsum(inMonth)))
        }
        let undated = open.filter { $0.expectedClose == nil }
        if !undated.isEmpty {
            forecast.append(ForecastMonth(label: "No date", value: sum(undated), weighted: wsum(undated)))
        }

        let closed = won.count + lost.count
        return PipelineStats(
            openCount: open.count,
            openValue: sum(open),
            weightedValue: wsum(open),
            wonCount: won.count,
            wonValue: sum(won),
            lostCount: lost.count,
            lostValue: sum(lost),
            winRate: closed > 0 ? Int((Double(won.count) / Double(closed) * 100).rounded()) : nil,
            avgWonValue: won.isEmpty ? nil : UInt64((Double(sum(won)) / Double(won.count)).rounded()),
            avgCycleDays: cycles.isEmpty ? nil : Int((Double(cycles.reduce(0, +)) / Double(cycles.count)).rounded()),
            wonThisMonth: sum(won.filter { Days.date($0.closedAt ?? 0) >= monthStart }),
            perStage: stages.map { stage in
                let inStage = open.filter { $0.stageId == stage.id }
                return StageStat(stage: stage, count: inStage.count, value: sum(inStage), weighted: wsum(inStage))
            },
            lostReasons: reasonOrder.map { ReasonCount(reason: $0, count: reasons[$0] ?? 0) }
                .enumerated().sorted { $0.element.count != $1.element.count ? $0.element.count > $1.element.count : $0.offset < $1.offset }
                .map(\.element),
            byOwner: ownerOrder.map { key in
                let o = owners[key]!
                return OwnerStat(owner: key, wonValue: o.won, openValue: o.open, wonCount: o.count)
            }
            .enumerated().sorted { a, b in
                if a.element.wonValue != b.element.wonValue { return a.element.wonValue > b.element.wonValue }
                if a.element.openValue != b.element.openValue { return a.element.openValue > b.element.openValue }
                return a.offset < b.offset
            }
            .map(\.element),
            forecast: forecast)
    }

    /// The to-do list, grouped by when each is due. Done newest first.
    public static func buckets(_ list: [ActivityView], now: Date, _ calendar: Calendar) -> [ActivityBucket: [ActivityView]] {
        let today = calendar.startOfDay(for: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: today) ?? today
        var out: [ActivityBucket: [ActivityView]] = [.overdue: [], .today: [], .upcoming: [], .done: []]
        for a in list {
            let due = Days.date(a.dueAt)
            if a.done {
                out[.done]!.append(a)
            } else if due < today {
                out[.overdue]!.append(a)
            } else if due < tomorrow {
                out[.today]!.append(a)
            } else {
                out[.upcoming]!.append(a)
            }
        }
        out[.done]!.sort { ($0.doneAt ?? 0) > ($1.doneAt ?? 0) }
        for key in [ActivityBucket.overdue, .today, .upcoming] { out[key]!.sort { $0.dueAt < $1.dueAt } }
        return out
    }

    public static func dealMatches(_ deal: DealView, _ query: String, ownerLabel: (String?) -> String = { $0 ?? "" }) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return true }
        return [deal.title, deal.organization, deal.contactName ?? "", ownerLabel(deal.owner), deal.source]
            .contains { $0.lowercased().contains(q) }
    }

    public static func contactMatches(_ c: ContactView, _ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return true }
        return [c.name, c.email, c.phone, c.organization, c.jobTitle].contains { $0.lowercased().contains(q) }
    }

    public static func activityMatches(_ a: ActivityView, _ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return true }
        return a.subject.lowercased().contains(q) || (a.dealTitle ?? "").lowercased().contains(q)
    }

    public static func companyKey(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Every organization named on a person or a deal, with its people and deals, by name.
    public static func companies(contacts: [ContactView], deals: [DealView]) -> [Company] {
        var names: [String: String] = [:]
        var people: [String: [ContactView]] = [:]
        var dealsBy: [String: [DealView]] = [:]
        for c in contacts {
            let key = companyKey(c.organization)
            guard !key.isEmpty else { continue }
            names[key] = names[key] ?? c.organization.trimmingCharacters(in: .whitespacesAndNewlines)
            people[key, default: []].append(c)
        }
        for d in deals {
            let key = companyKey(d.organization)
            guard !key.isEmpty else { continue }
            names[key] = names[key] ?? d.organization.trimmingCharacters(in: .whitespacesAndNewlines)
            dealsBy[key, default: []].append(d)
        }
        return names.map { key, name in
            Company(
                name: name,
                people: (people[key] ?? []).sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending },
                deals: (dealsBy[key] ?? []).sorted { $0.createdAt > $1.createdAt })
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    public static func companyMatches(_ c: Company, _ query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return q.isEmpty || c.name.lowercased().contains(q)
    }
}
