import CalendarGenerated
import Foundation
import MeroKit

/// One calendar's data: the contract through the generated client, and the
/// device-local private events beside it. The phone's copy of the web app's
/// `api/dataSource/ClientApiDataSource.ts` on an account session.
public struct CalendarRepository: Sendable {
    public let client: CalendarClient
    public let contextId: String
    public let account: String
    public let privateStore: PrivateEventStore
    /// `PrivateEventStore.key(account:namespaceId:)` for the calendar's team.
    public let storeKey: String

    public init(
        contract: any MeroKit.ContextContractCalling, contextId: String, account: String, namespaceId: String,
        privateStore: PrivateEventStore
    ) {
        self.client = CalendarClient(transport: HexIdTransport(contract))
        self.contextId = contextId
        self.account = account.lowercased()
        self.privateStore = privateStore
        self.storeKey = PrivateEventStore.key(account: account.lowercased(), namespaceId: namespaceId)
    }

    /// Shared events (`get_events`) and this device's private ones, sorted by start.
    public func events() async throws -> [CalendarItem] {
        let shared = try await client.getEvents().compactMap { CalendarItem($0, isPrivate: false) }
        let local = privateStore.list(key: storeKey, contextId: contextId)
        return (shared + local).sorted { ($0.start, $0.title) < ($1.start, $1.title) }
    }

    /// `get_members`, as people.
    public func members() async throws -> [CalendarPerson] {
        try await client.getMembers().map {
            CalendarPerson(id: $0.id.lowercased(), name: $0.username.trimmingCharacters(in: .whitespaces))
        }
    }

    /// Create an event. A private one, and a peerless one (which the contract
    /// would route to its node-local private storage, which a replicated 1.0 app instance can't offer), stays
    /// on this device; anything shared goes to `create_event`. Returns its id.
    @discardableResult
    public func create(_ event: CalendarItem, at now: Date = Date()) async throws -> String {
        if event.isPrivate || event.peers.isEmpty {
            return privateStore.add(key: storeKey, contextId: contextId, event: event)
        }
        return try await client.createEvent(eventData: createArgs(event), timestamp: nowMillis(now))
    }

    /// Save an edited event.
    ///
    /// A device-local event stays local, unless the edit made it shared (not
    /// private, with someone invited): then it is promoted, as the contract's
    /// `update_private_event` promotes, with `create_event` and the local copy
    /// dropped. A shared event goes to `update_event`; sharing is one way, so it
    /// never moves back to the device.
    public func update(_ event: CalendarItem, at now: Date = Date()) async throws {
        if event.isLocal {
            if !event.isPrivate && !event.peers.isEmpty {
                _ = try await client.createEvent(eventData: createArgs(event), timestamp: nowMillis(now))
                privateStore.remove(key: storeKey, id: event.id)
                return
            }
            guard privateStore.update(key: storeKey, event: event) else { throw CalendarError.notOnDevice }
            return
        }
        let patch = UpdateCalendarEvent(
            title: event.title, description: event.description, start: EventTime.format(event.start),
            end: EventTime.format(event.end), eventType: type(event), color: event.color,
            peers: event.peers.map(\.hexBytes))
        _ = try await client.updateEvent(eventId: event.id, eventData: patch, timestamp: nowMillis(now))
    }

    /// Delete an event: from this device, or `delete_event` for a shared one.
    public func delete(_ event: CalendarItem) async throws {
        if event.isLocal {
            guard privateStore.remove(key: storeKey, id: event.id) else { throw CalendarError.notOnDevice }
            return
        }
        _ = try await client.deleteEvent(eventId: event.id)
    }

    /// `set_username`.
    public func setUsername(_ name: String, at now: Date = Date()) async throws {
        try await client.setUsername(username: name, timestamp: nowMillis(now))
    }

    private func createArgs(_ event: CalendarItem) -> CreateCalendarEvent {
        CreateCalendarEvent(
            title: event.title, description: event.description, start: EventTime.format(event.start),
            end: EventTime.format(event.end), eventType: type(event), color: event.color,
            peers: event.peers.map(\.hexBytes))
    }

    private func type(_ event: CalendarItem) -> String {
        event.isAllDay ? CalendarConstants.allDayType : CalendarConstants.timedType
    }
}

/// Errors the calendar layer raises itself.
public enum CalendarError: LocalizedError, Equatable {
    case notOnDevice
    case invalidInvitation
    case noApplication
    case calendarUnavailable

    public var errorDescription: String? {
        switch self {
        case .notOnDevice: return "This private event isn't on this device."
        case .invalidInvitation: return "That isn't a Mero Calendar invitation link."
        case .noApplication: return "Still connecting. Try again in a moment."
        case .calendarUnavailable: return "This calendar isn't available to you yet. Try again in a moment."
        }
    }
}
