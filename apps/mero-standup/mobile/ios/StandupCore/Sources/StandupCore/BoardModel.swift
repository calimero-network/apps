import Foundation
import MeroKit

/// The Standup tab: one day's updates, your own, the week strip around it,
/// who has not posted, what blocks the team right now and what was decided
/// that day (the web's `StandupBoard`).
@MainActor
public final class BoardModel: ObservableObject {
    public let team: TeamModel
    private let now: () -> Date
    private let calendar: Calendar

    @Published public private(set) var day: String
    @Published public private(set) var dayView: DayView?
    @Published public private(set) var week: [DayView] = []
    @Published public private(set) var blockers: [UpdateView] = []
    @Published public private(set) var decided: [DecisionView] = []
    /// Your last update before ``day``, when you have not posted for it: the
    /// carry-forward source.
    @Published public private(set) var previous: UpdateView?
    @Published public private(set) var isLoading = false
    @Published public var error: String?

    public init(team: TeamModel, now: @escaping () -> Date = Date.init, calendar: Calendar = .current) {
        self.team = team
        self.now = now
        self.calendar = calendar
        self.day = Days.today(now(), calendar: calendar)
    }

    public var today: String { Days.today(now(), calendar: calendar) }
    public var isToday: Bool { day == today }
    public var weekStart: String { Days.weekStart(day, calendar: calendar) }
    public var weekDays: [String] { Days.weekDays(weekStart, calendar: calendar) }
    public var dayTitle: String { Days.describe(day, now: now(), calendar: calendar) }

    public var updates: [UpdateView] { dayView?.day == day ? dayView?.updates ?? [] : [] }
    public var mine: UpdateView? { updates.first { $0.author == team.me } }
    public var others: [UpdateView] { updates.filter { $0.author != team.me } }
    /// Who the contract knows and has not posted. Today only.
    public var waiting: [MemberView] {
        guard isToday, dayView != nil else { return [] }
        return People.notYetPosted(team.members, posted: updates)
    }

    /// The week strip's dot for `d`: how many posted, and whether anyone was blocked.
    public func summary(of d: String) -> (count: Int, blocked: Bool) {
        guard let view = week.first(where: { $0.day == d }) else { return (0, false) }
        return (view.updates.count, view.updates.contains { !$0.blockers.isEmpty })
    }

    public func isFuture(_ d: String) -> Bool { d > today }

    /// What the update sheet opens with: your posted update, else your last
    /// one carried forward.
    public var draft: UpdateDraft {
        if let mine { return UpdateDraft(mine) }
        return UpdateDraft.carryForward(previous)
    }

    /// The day the draft was carried from, when it was.
    public var carriedFrom: String? {
        guard mine == nil, let previous else { return nil }
        return previous.day
    }

    public func describe(_ d: String) -> String { Days.describe(d, now: now(), calendar: calendar) }

    public func select(_ d: String) async {
        guard !isFuture(d), d != day else { return }
        day = d
        dayView = nil
        previous = nil
        decided = []
        await load()
    }

    public func shift(by delta: Int) async {
        await select(Days.shift(day, by: delta, calendar: calendar))
    }

    public func load() async {
        // "Which update is mine" and the carry-forward need who you are.
        if team.me == nil { await team.load() }
        isLoading = true
        defer { isLoading = false }
        let client = team.client
        let day = day
        let start = weekStart
        do {
            async let dayView = client.getDay(day: day)
            async let week = client.getWeek(start: start)
            async let blockers = client.currentBlockers()
            async let decided = client.listDecisions(fromDay: day, standingOnly: false, limit: 10)
            let (d, w, b, dec) = try await (dayView, week, blockers, decided)
            guard day == self.day else { return }
            self.dayView = d
            self.week = w
            self.blockers = b
            self.decided = dec.items
            error = nil
        } catch {
            guard day == self.day else { return }
            self.error = ErrorText.describe(error)
            return
        }
        await loadPrevious()
    }

    /// Your last update before this day, for the carry-forward.
    private func loadPrevious() async {
        guard mine == nil, let me = team.me,
            let last = team.members.first(where: { $0.account == me })?.lastDay, !last.isEmpty, last < day
        else {
            previous = nil
            return
        }
        let view = try? await team.client.getDay(day: last)
        previous = view?.updates.first { $0.author == me }
    }

    // MARK: Writes

    public func post(_ draft: UpdateDraft) async throws {
        let day = day
        try await team.act {
            try await $0.postUpdate(day: day, done: draft.done, next: draft.next, blockers: draft.blockers)
        }
        await load()
    }

    public func withdraw() async throws {
        let day = day
        try await team.act { try await $0.clearUpdate(day: day) }
        await load()
    }

    public func offerHelp(on update: UpdateView, note: String) async throws {
        try await team.act {
            try await $0.offerHelp(
                day: update.day, author: update.author, note: note.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        await load()
    }

    public func withdrawHelp(on update: UpdateView) async throws {
        try await team.act { try await $0.withdrawHelp(day: update.day, author: update.author) }
        await load()
    }

    /// Whether you offered help on `update`.
    public func offered(_ update: UpdateView) -> Bool {
        update.helpers.contains { $0.account == team.me }
    }
}
