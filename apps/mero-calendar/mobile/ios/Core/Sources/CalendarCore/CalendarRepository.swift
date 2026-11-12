import CalendarContract
import Foundation
import MeroKit

/// One calendar's data: the contract through its typed client. The phone's
/// copy of the web app's `api/calendar.ts` adapter.
///
/// Private events live in the contract too now: per-owner rows that only the
/// owner's own calls read (`getPrivateEvents`), on the cluster's attested
/// nodes, so they follow the account to every device.
public struct CalendarRepository: Sendable {
    public let client: CalendarClient
    /// The app instance (the calendar).
    public let contextId: String
    public let account: String

    public init(contract: any MeroKit.ContextContractCalling, contextId: String, account: String) {
        self.client = CalendarClient(contract: contract)
        self.contextId = contextId
        self.account = account
    }

    /// Shared events (`getEvents`) and the caller's private ones
    /// (`getPrivateEvents`), sorted by start.
    public func events() async throws -> [CalendarItem] {
        async let shared = client.getEvents()
        async let mine = client.getPrivateEvents()
        var seen = Set<String>()
        let all = (try await shared).compactMap { CalendarItem($0, isPrivate: $0.private) }
            + (try await mine).compactMap { CalendarItem($0, isPrivate: true) }
        return all.filter { seen.insert($0.id).inserted }
            .sorted { ($0.start, $0.title) < ($1.start, $1.title) }
    }

    /// `getMembers`, as people.
    public func members() async throws -> [CalendarPerson] {
        try await client.getMembers().map {
            CalendarPerson(id: $0.id, name: $0.username.trimmingCharacters(in: .whitespaces))
        }
    }

    /// Create an event: `createPrivateEvent` for a private one, else
    /// `createEvent` (which the contract keeps private when no one is
    /// invited). Returns its id.
    @discardableResult
    public func create(_ event: CalendarItem) async throws -> String {
        if event.isPrivate {
            return try await client.createPrivateEvent(eventData: createArgs(event))
        }
        return try await client.createEvent(eventData: createArgs(event))
    }

    /// Save an edited event. `wasPrivate`: where the event lives now. A
    /// private event goes to `updatePrivateEvent`, which promotes it to a
    /// shared one when the edit invites someone; a shared one goes to
    /// `updateEvent` (sharing is one way, so it never becomes private again).
    public func update(_ event: CalendarItem, wasPrivate: Bool) async throws {
        let patch = UpdateCalendarEvent(
            title: event.title, description: event.description, start: EventTime.format(event.start),
            end: EventTime.format(event.end), event_type: type(event), color: event.color,
            peers: event.isPrivate ? [] : event.peers)
        if wasPrivate {
            _ = try await client.updatePrivateEvent(eventId: event.id, eventData: patch)
        } else {
            _ = try await client.updateEvent(eventId: event.id, eventData: patch)
        }
    }

    /// Delete an event: `deletePrivateEvent` or `deleteEvent`.
    public func delete(_ event: CalendarItem) async throws {
        if event.isPrivate {
            _ = try await client.deletePrivateEvent(eventId: event.id)
        } else {
            _ = try await client.deleteEvent(eventId: event.id)
        }
    }

    /// `setUsername`.
    public func setUsername(_ name: String) async throws {
        try await client.setUsername(username: name)
    }

    private func createArgs(_ event: CalendarItem) -> CreateCalendarEvent {
        CreateCalendarEvent(
            title: event.title, description: event.description, start: EventTime.format(event.start),
            end: EventTime.format(event.end), event_type: type(event), color: event.color,
            peers: event.isPrivate ? [] : event.peers)
    }

    private func type(_ event: CalendarItem) -> String {
        event.isAllDay ? CalendarConstants.allDayType : CalendarConstants.timedType
    }
}

/// Errors the calendar layer raises itself.
public enum CalendarError: LocalizedError, Equatable {
    case invalidInvitation
    case noApplication
    case calendarUnavailable

    public var errorDescription: String? {
        switch self {
        case .invalidInvitation: return "That isn't a Mero Calendar invitation link."
        case .noApplication: return "Still connecting. Try again in a moment."
        case .calendarUnavailable: return "This calendar isn't available to you yet. Try again in a moment."
        }
    }
}
