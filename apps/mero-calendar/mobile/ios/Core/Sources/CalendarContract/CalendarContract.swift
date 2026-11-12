import Foundation
import MeroKit

// The calendar contract (`logic/`, a Calimero 1.0 component), typed: the
// phone's copy of the web app's `app/src/api/calendar.ts`, against the same
// committed `logic/res/abi.json`.
//
// What the component ABI changed from v1, and how this file follows it:
//
// - method and argument names are camelCase (`getEvents`, `eventId`,
//   `eventData`); event fields keep v1's `event_type`;
// - v1's `timestamp` arguments are gone (the app's log is the clock);
// - accounts (`owner`, `peers`, a member's `id`) are the node's account ids,
//   as strings;
// - 64-bit integers are decimal strings (`"1783296000000"`), read by ``U64``;
// - a refusal is the node's `APP_ERROR` with the contract's `{ code, fields }`
//   (``CalendarAppCode`` lists the codes).
//
// `CalendarContractTests` checks the method list against the ABI.

/// The contract's calls, as `abi.json` names them.
public enum CalendarMethods {
    public static let calls: [String] = [
        "setUsername", "createEvent", "updateEvent", "deleteEvent", "createPrivateEvent", "updatePrivateEvent",
        "deletePrivateEvent", "createBookingLink", "deleteBookingLink", "bookSlot", "rescheduleBooking",
        "cancelBooking",
    ]
    public static let views: [String] = [
        "getMembers", "getEvents", "getPrivateEvents", "listBookingLinks", "getBookingPage", "getAvailableSlots",
    ]
}

/// The contract's error codes (`#[app::error]`), as `APP_ERROR` carries them.
public enum CalendarAppCode: String, Sendable, CaseIterable {
    case notFound = "NotFound"
    case forbidden = "Forbidden"
    case invalid = "Invalid"
    case linkExists = "LinkExists"
    case alreadyBooked = "AlreadyBooked"
    case linkCancelled = "LinkCancelled"
    case linkExpired = "LinkExpired"
    case notBooked = "NotBooked"
    case slotUnavailable = "SlotUnavailable"
}

/// A `u64` the contract writes as a decimal string (an older answer may hold
/// a number). Encodes as the decimal string a `u64` argument must be.
public struct U64: Codable, Sendable, Hashable, ExpressibleByIntegerLiteral {
    public var value: UInt64

    public init(_ value: UInt64) { self.value = value }
    public init(integerLiteral value: UInt64) { self.value = value }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self), let parsed = UInt64(text.trimmingCharacters(in: .whitespaces)) {
            value = parsed
        } else if let number = try? container.decode(UInt64.self) {
            value = number
        } else if let number = try? container.decode(Double.self), number >= 0 {
            value = UInt64(number)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "not a u64")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(String(value))
    }
}

// MARK: Shapes

/// An event as the contract answers it. `private` tells the caller's private
/// event from a shared one.
public struct CalendarEvent: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var description: String
    public var owner: String
    public var start: String
    public var end: String
    public var eventType: String
    public var color: String
    public var peers: [String]
    public var `private`: Bool

    public init(
        id: String, title: String, description: String, owner: String, start: String, end: String, eventType: String,
        color: String, peers: [String], private isPrivate: Bool
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.owner = owner
        self.start = start
        self.end = end
        self.eventType = eventType
        self.color = color
        self.peers = peers
        self.private = isPrivate
    }

    enum CodingKeys: String, CodingKey {
        case id, title, description, owner, start, end, color, peers, `private`
        case eventType = "event_type"
    }
}

/// What `createEvent` / `createPrivateEvent` send. `peers` are account ids.
public struct CreateCalendarEvent: Codable, Sendable, Equatable {
    public var title: String
    public var description: String
    public var start: String
    public var end: String
    public var eventType: String
    public var color: String
    public var peers: [String]

    public init(
        title: String, description: String, start: String, end: String, eventType: String, color: String,
        peers: [String]
    ) {
        self.title = title
        self.description = description
        self.start = start
        self.end = end
        self.eventType = eventType
        self.color = color
        self.peers = peers
    }

    enum CodingKeys: String, CodingKey {
        case title, description, start, end, color, peers
        case eventType = "event_type"
    }
}

/// What `updateEvent` / `updatePrivateEvent` send: only the fields named are
/// changed (the contract refuses unknown keys, so `nil` ones are left out).
public struct UpdateCalendarEvent: Codable, Sendable, Equatable {
    public var title: String?
    public var description: String?
    public var start: String?
    public var end: String?
    public var eventType: String?
    public var color: String?
    public var peers: [String]?

    public init(
        title: String? = nil, description: String? = nil, start: String? = nil, end: String? = nil,
        eventType: String? = nil, color: String? = nil, peers: [String]? = nil
    ) {
        self.title = title
        self.description = description
        self.start = start
        self.end = end
        self.eventType = eventType
        self.color = color
        self.peers = peers
    }

    enum CodingKeys: String, CodingKey {
        case title, description, start, end, color, peers
        case eventType = "event_type"
    }
}

/// A member who set a name. `id` is the account.
public struct Member: Codable, Sendable, Equatable {
    public var id: String
    public var username: String
    public var joinedAt: U64
    public var usernameUpdatedAt: U64

    public init(id: String, username: String, joinedAt: UInt64, usernameUpdatedAt: UInt64) {
        self.id = id
        self.username = username
        self.joinedAt = U64(joinedAt)
        self.usernameUpdatedAt = U64(usernameUpdatedAt)
    }
}

/// One weekly window a booking link offers. `weekday` 0 is Monday.
public struct WeeklyWindow: Codable, Sendable, Equatable {
    public var weekday: Int
    public var startMinute: Int
    public var endMinute: Int

    public init(weekday: Int, startMinute: Int, endMinute: Int) {
        self.weekday = weekday
        self.startMinute = startMinute
        self.endMinute = endMinute
    }
}

public struct BookingView: Codable, Sendable, Equatable {
    public var startMs: U64
    public var endMs: U64
    public var guestName: String
    public var guestEmail: String
    public var guestNote: String
    public var bookedAtMs: U64
    public var rescheduledCount: Int
}

public struct BookingLinkView: Codable, Sendable, Equatable {
    public var linkId: String
    public var grantId: String
    public var title: String
    public var description: String
    public var durationMinutes: Int
    public var weeklyHours: [WeeklyWindow]
    public var utcOffsetMinutes: Int
    public var horizonDays: Int
    public var minNoticeMinutes: Int
    public var createdAtMs: U64
    public var expiresAtMs: U64?
    /// `open`, `booked` or `cancelled`.
    public var status: String
    public var booking: BookingView?
}

public struct BookingPage: Codable, Sendable, Equatable {
    public var title: String
    public var description: String
    public var ownerName: String?
    public var durationMinutes: Int
    public var status: String
    public var expiresAtMs: U64?
    public var booking: BookingView?
}

public struct GuestDetails: Codable, Sendable, Equatable {
    public var name: String
    public var email: String
    public var note: String

    public init(name: String, email: String, note: String) {
        self.name = name
        self.email = email
        self.note = note
    }
}

public struct CreateBookingLink: Codable, Sendable, Equatable {
    public var tokenHash: String
    public var grantId: String
    public var title: String
    public var description: String
    public var durationMinutes: Int
    public var weeklyHours: [WeeklyWindow]
    public var utcOffsetMinutes: Int
    public var horizonDays: Int
    public var minNoticeMinutes: Int
    public var expiresAtMs: U64?

    public init(
        tokenHash: String, grantId: String, title: String, description: String, durationMinutes: Int,
        weeklyHours: [WeeklyWindow], utcOffsetMinutes: Int, horizonDays: Int, minNoticeMinutes: Int,
        expiresAtMs: UInt64?
    ) {
        self.tokenHash = tokenHash
        self.grantId = grantId
        self.title = title
        self.description = description
        self.durationMinutes = durationMinutes
        self.weeklyHours = weeklyHours
        self.utcOffsetMinutes = utcOffsetMinutes
        self.horizonDays = horizonDays
        self.minNoticeMinutes = minNoticeMinutes
        self.expiresAtMs = expiresAtMs.map { U64($0) }
    }

    /// `expiresAtMs` is written as `null` when there is none, as the web app sends it.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(tokenHash, forKey: .tokenHash)
        try c.encode(grantId, forKey: .grantId)
        try c.encode(title, forKey: .title)
        try c.encode(description, forKey: .description)
        try c.encode(durationMinutes, forKey: .durationMinutes)
        try c.encode(weeklyHours, forKey: .weeklyHours)
        try c.encode(utcOffsetMinutes, forKey: .utcOffsetMinutes)
        try c.encode(horizonDays, forKey: .horizonDays)
        try c.encode(minNoticeMinutes, forKey: .minNoticeMinutes)
        try c.encode(expiresAtMs, forKey: .expiresAtMs)
    }
}

// MARK: Reading the generated client's answers

extension Encodable {
    /// This answer as the app type `T` (one of the shapes above). The ABI names them without their
    /// shape until the logic derives `AbiType`, so the generated `CalendarClient` (`Generated/`)
    /// takes and answers their JSON.
    public func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
    }

    /// This value as the generated client's type `T` (an argument), through its JSON.
    public func converted<T: Decodable>() throws -> T {
        try MeroJSON.decode(T.self, from: MeroJSON.encode(self))
    }
}
