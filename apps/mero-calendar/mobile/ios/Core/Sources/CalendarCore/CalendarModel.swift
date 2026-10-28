import Foundation
import MeroKit

#if canImport(Combine)
import Combine
#endif

/// One open calendar: its events and members, the view's mode and date, live
/// updates, and saving / deleting events. (`app/src/pages/calendar/index.tsx`.)
@MainActor
public final class CalendarModel: ObservableObject {
    @Published public private(set) var events: [CalendarItem] = []
    @Published public private(set) var members: [CalendarPerson] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var hasLoaded = false
    @Published public var error: String?
    @Published public var mode: CalendarMode = .month
    /// The day the views center on (and the month view's selected day).
    @Published public var focus: Date
    /// No name chosen for this calendar yet: ask for one.
    @Published public private(set) var needsName = false

    public let backend: any MeroAppBackend
    public let team: Team
    public let calendar: TeamCalendar
    public let names: NameBook
    public let repository: CalendarRepository
    public let math: CalendarMath
    public var pollInterval: Duration = .seconds(10)

    public init(
        backend: any MeroAppBackend, team: Team, calendar: TeamCalendar, names: NameBook,
        privateStore: PrivateEventStore, math: CalendarMath = CalendarMath(), today: Date = Date()
    ) {
        self.backend = backend
        self.team = team
        self.calendar = calendar
        self.names = names
        self.math = math
        self.focus = math.startOfDay(today)
        self.repository = CalendarRepository(
            contract: backend.contract.bound(to: calendar.id), contextId: calendar.id, account: backend.account,
            namespaceId: team.id, privateStore: privateStore)
    }

    /// The signed-in account, 64 hex.
    public var me: String { backend.account.lowercased() }

    /// First open: register the stored name (or ask for one), then load.
    public func start() async {
        if let name = names.username(context: calendar.id) {
            try? await repository.setUsername(name)
        } else {
            needsName = true
        }
        await reload()
    }

    /// Events and members, again.
    public func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let events = repository.events()
            async let members = repository.members()
            self.events = try await events
            self.members = (try? await members) ?? self.members
            error = nil
        } catch {
            self.error = ErrorText.describe(error, doing: "load this calendar")
        }
        hasLoaded = true
    }

    /// Follow the context: the relay's event stream when it is up, polling
    /// every `pollInterval` otherwise. Runs until cancelled.
    public func runLive() async {
        if backend.canSubscribe {
            do {
                for try await _ in backend.events(contextId: calendar.id) {
                    await reload()
                }
            } catch {}
        }
        while !Task.isCancelled {
            do { try await Task.sleep(for: pollInterval) } catch { return }
            await reload()
        }
    }

    // MARK: Names

    /// Save the person's name for this calendar (`set_username`).
    public func setName(_ raw: String) async {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        needsName = false
        guard !name.isEmpty else { return }
        names.setUsername(name, context: calendar.id)
        do {
            try await repository.setUsername(name)
            members = (try? await repository.members()) ?? members
        } catch {
            self.error = ErrorText.describe(error, doing: "save your name")
        }
    }

    public func skipName() { needsName = false }

    /// The name the prompt starts with.
    public var suggestedName: String { names.username(context: calendar.id) ?? names.lastUsername ?? "" }

    /// The display name of an account: its `get_members` name, else a short id.
    public func displayName(_ account: String) -> String {
        let id = account.lowercased()
        if let person = members.first(where: { $0.id == id }), !person.name.isEmpty { return person.name }
        if id == me, let mine = names.username(context: calendar.id) { return mine }
        return CalendarConstants.short(id)
    }

    /// Teammates the event can be shared with (not the person themselves).
    public var invitees: [CalendarPerson] {
        members.filter { $0.id != me }
            .sorted { displayName($0.id).localizedCaseInsensitiveCompare(displayName($1.id)) == .orderedAscending }
    }

    /// Only the owner edits an event; everyone else sees it read-only.
    public func canEdit(_ event: CalendarItem) -> Bool { event.isLocal || event.owner.lowercased() == me }

    // MARK: Events

    /// Save the form: create a new event or update the one it edits.
    public func save(_ draft: EventDraft) async throws {
        if let problem = draft.problem(math: math) { throw DraftError(message: problem) }
        let item = draft.item(owner: me, math: math)
        if draft.isNew {
            try await repository.create(item)
        } else {
            try await repository.update(item)
        }
        await reload()
    }

    public func delete(_ event: CalendarItem) async throws {
        try await repository.delete(event)
        events.removeAll { $0.id == event.id }
        await reload()
    }

    // MARK: Navigation

    public func step(_ direction: Int) {
        focus = math.startOfDay(math.step(focus, mode: mode, by: direction))
    }

    public func goToToday(_ now: Date = Date()) { focus = math.startOfDay(now) }

    public var title: String { math.title(focus, mode: mode) }

    public func events(on day: Date) -> [CalendarItem] { math.events(events, on: day) }
}

/// A form problem, said as the form says it.
public struct DraftError: LocalizedError, Equatable {
    public let message: String
    public var errorDescription: String? { message }
}
