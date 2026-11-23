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
// - 64-bit integers are decimal strings (`"1783296000000"`), `UInt64` in the
//   generated types;
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

// MARK: Shapes

// The shapes are the generated client's (`Generated/CalendarClient.swift`, from the ABI): 64-bit
// integers are `UInt64`, decimal strings on the wire; event fields keep v1's `event_type`.

/// An event as the contract answers it. `private` tells the caller's private
/// event from a shared one.
public typealias CalendarEvent = CalendarClient.CalendarEvent
/// What `createEvent` / `createPrivateEvent` send. `peers` are account ids.
public typealias CreateCalendarEvent = CalendarClient.CreateCalendarEvent
/// What `updateEvent` / `updatePrivateEvent` send: only the fields named are
/// changed (`nil` ones are sent as `null`, which the contract leaves alone).
public typealias UpdateCalendarEvent = CalendarClient.UpdateCalendarEvent
/// A member who set a name. `id` is the account.
public typealias Member = CalendarClient.Member
/// One weekly window a booking link offers. `weekday` 0 is Monday.
public typealias WeeklyWindow = CalendarClient.WeeklyWindow
public typealias BookingView = CalendarClient.BookingView
/// A booking link: `status` is `open`, `booked` or `cancelled`.
public typealias BookingLinkView = CalendarClient.BookingLinkView
public typealias BookingPage = CalendarClient.BookingPage
public typealias GuestDetails = CalendarClient.GuestDetails
public typealias CreateBookingLink = CalendarClient.CreateBookingLink
