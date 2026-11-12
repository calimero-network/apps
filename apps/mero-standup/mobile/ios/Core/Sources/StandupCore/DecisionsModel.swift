import Foundation
import MeroKit

/// The Decisions tab: the log, searched and filtered, its tags, logging a
/// decision and superseding one (the web's `DecisionLog`). Decisions are never
/// edited, only superseded.
@MainActor
public final class DecisionsModel: ObservableObject {
    public static let page: UInt32 = 25

    public let team: TeamModel
    private let calendar: Calendar

    @Published public var search = ""
    @Published public var tag: String?
    @Published public var standingOnly = false
    @Published public private(set) var pages: UInt32 = 1
    @Published public private(set) var items: [DecisionView] = []
    @Published public private(set) var hasMore = false
    @Published public private(set) var tags: [TagCount] = []
    @Published public private(set) var hasLoaded = false
    @Published public private(set) var isLoading = false
    @Published public var error: String?

    public init(team: TeamModel, calendar: Calendar = .current) {
        self.team = team
        self.calendar = calendar
    }

    public var isFiltered: Bool {
        !search.trimmingCharacters(in: .whitespaces).isEmpty || tag != nil || standingOnly
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        let query = search.trimmingCharacters(in: .whitespaces)
        let tag = tag
        let standingOnly = standingOnly
        let limit = Self.page * pages
        do {
            async let page = team.client.listDecisions(
                search: query.isEmpty ? nil : query, tag: tag, standingOnly: standingOnly, limit: limit)
            async let tags = team.client.tags()
            let (p, t) = try await (page, tags)
            guard query == search.trimmingCharacters(in: .whitespaces), tag == self.tag,
                standingOnly == self.standingOnly
            else { return }
            items = p.items
            hasMore = p.nextCursor != nil
            self.tags = t
            error = nil
            hasLoaded = true
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// A filter changed: start again from the first page.
    public func refilter() async {
        pages = 1
        await load()
    }

    public func toggle(tag t: String) async {
        tag = tag == t ? nil : t
        await refilter()
    }

    public func showOlder() async {
        pages += 1
        await load()
    }

    /// Clear every filter, so a linked decision is in the list.
    public func clearFilters() async {
        search = ""
        tag = nil
        standingOnly = false
        await refilter()
    }

    /// Log `draft`. Returns the new decision's id.
    @discardableResult
    public func log(_ draft: DecisionDraft) async throws -> String {
        let id = try await team.act {
            try await $0.logDecision(
                title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
                decision: draft.decision.trimmingCharacters(in: .whitespacesAndNewlines),
                rationale: draft.rationale.trimmingCharacters(in: .whitespacesAndNewlines),
                supersedes: draft.supersedes?.id, tags: draft.tags, with: draft.with.sorted(),
                fromDay: draft.fromDay)
        }
        await load()
        return id
    }

    /// A decision in the list, or read on its own (a link to one filtered out).
    public func decision(_ id: String) async -> DecisionView? {
        if let found = items.first(where: { $0.id == id }) { return found }
        return try? await team.client.getDecision(id: id)
    }

    public func title(of id: String) -> String? { items.first { $0.id == id }?.title }

    /// The log grouped by month, newest first, for the timeline.
    public var months: [(title: String, items: [DecisionView])] {
        var out: [(title: String, items: [DecisionView])] = []
        for d in items {
            let title = Days.monthTitle(nanos: d.createdAt, calendar: calendar)
            if out.last?.title == title {
                out[out.count - 1].items.append(d)
            } else {
                out.append((title, [d]))
            }
        }
        return out
    }
}
