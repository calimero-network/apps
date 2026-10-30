import CalendarGenerated
import Foundation

/// One event as the screens draw it: a shared event from the contract, or a
/// private one kept on this device.
public struct CalendarItem: Identifiable, Hashable, Sendable, Codable {
    public var id: String
    public var title: String
    public var description: String
    /// The owner's account, 64 hex (lowercase).
    public var owner: String
    public var start: Date
    public var end: Date
    public var isAllDay: Bool
    public var color: String
    /// Invited accounts, 64 hex each.
    public var peers: [String]
    /// Private: lives on this device only (never sent to the cluster).
    public var isPrivate: Bool

    public init(
        id: String, title: String, description: String = "", owner: String, start: Date, end: Date,
        isAllDay: Bool = false, color: String = CalendarConstants.defaultColor, peers: [String] = [],
        isPrivate: Bool = false
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.owner = owner
        self.start = start
        self.end = end
        self.isAllDay = isAllDay
        self.color = color
        self.peers = peers
        self.isPrivate = isPrivate
    }

    /// From the contract's answer. `nil` when its times cannot be read.
    public init?(_ event: CalendarEvent, isPrivate: Bool) {
        guard let start = EventTime.parse(event.start) else { return nil }
        let end = EventTime.parse(event.end) ?? start
        self.init(
            id: event.id, title: event.title, description: event.description, owner: event.owner.hexString,
            start: start, end: max(end, start), isAllDay: event.eventType == CalendarConstants.allDayType,
            color: event.color.isEmpty ? CalendarConstants.defaultColor : event.color,
            peers: event.peers.map(\.hexString), isPrivate: isPrivate)
    }

    /// Whether this item was minted by the device-local store.
    public var isLocal: Bool { PrivateEventStore.isLocalId(id) }

    /// Whether the event touches the day starting at `dayStart` (local calendar).
    public func occurs(on dayStart: Date, calendar: Calendar = .current) -> Bool {
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart
        if start >= dayEnd { return false }
        if end > dayStart { return true }
        return calendar.isDate(start, inSameDayAs: dayStart)
    }
}

/// A member of the calendar, from `get_members`.
public struct CalendarPerson: Identifiable, Hashable, Sendable {
    /// The account, 64 hex.
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// A team: a Calimero org running Mero Calendar.
public struct Team: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let applicationId: String

    public init(id: String, name: String, applicationId: String) {
        self.id = id
        self.name = name
        self.applicationId = applicationId
    }
}

/// A calendar in a team: one context, in its own subgroup or straight in the team.
public struct TeamCalendar: Identifiable, Hashable, Sendable {
    /// The context id.
    public let id: String
    public let name: String
    /// The group the context hangs off (its subgroup, or the team itself).
    public let groupId: String

    public init(id: String, name: String, groupId: String) {
        self.id = id
        self.name = name
        self.groupId = groupId
    }
}
