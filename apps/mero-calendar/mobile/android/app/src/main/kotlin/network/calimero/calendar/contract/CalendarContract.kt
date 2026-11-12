package network.calimero.calendar.contract

import network.calimero.calendar.generated.CalendarClient

// The calendar contract (`logic/`, a Calimero 1.0 component), typed: the phone's copy of the web
// app's `app/src/api/calendar.ts`, against the same `logic/res/abi.json`. The iOS app's
// `CalendarContract.swift` is its twin.
//
// What the component ABI changed from v1, and how this file follows it:
// - method and argument names are camelCase (`getEvents`, `eventId`, `eventData`); event fields
//   keep v1's `event_type`;
// - v1's `timestamp` arguments are gone (the app's log is the clock);
// - accounts (`owner`, `peers`, a member's `id`) are the node's account ids, as strings;
// - 64-bit integers are decimal strings (`"1783296000000"`), [ULong] in the generated types;
// - a refusal is the node's `APP_ERROR` with the contract's `{ code, fields }` ([CalendarAppCode]).

/** The contract's methods, as `abi.json` names them. */
object CalendarMethods {
    val CALLS =
        listOf(
            "setUsername",
            "createEvent",
            "updateEvent",
            "deleteEvent",
            "createPrivateEvent",
            "updatePrivateEvent",
            "deletePrivateEvent",
            "createBookingLink",
            "deleteBookingLink",
            "bookSlot",
            "rescheduleBooking",
            "cancelBooking",
        )
    val VIEWS =
        listOf("getMembers", "getEvents", "getPrivateEvents", "listBookingLinks", "getBookingPage", "getAvailableSlots")
}

/** The contract's error codes (`#[app::error]`), as `APP_ERROR` carries them. */
enum class CalendarAppCode(
    val code: String,
) {
    NOT_FOUND("NotFound"),
    FORBIDDEN("Forbidden"),
    INVALID("Invalid"),
    LINK_EXISTS("LinkExists"),
    ALREADY_BOOKED("AlreadyBooked"),
    LINK_CANCELLED("LinkCancelled"),
    LINK_EXPIRED("LinkExpired"),
    NOT_BOOKED("NotBooked"),
    SLOT_UNAVAILABLE("SlotUnavailable"),
    ;

    companion object {
        fun of(code: String): CalendarAppCode? = entries.firstOrNull { it.code == code }
    }
}

// ---- shapes ---------------------------------------------------------------------------------

// The shapes are the generated client's ([CalendarClient], from the ABI): 64-bit integers are
// [ULong], decimal strings on the wire; event fields keep v1's `event_type`.

/** An event as the contract answers it; `private` tells the caller's private event from a shared one. */
typealias CalendarEvent = CalendarClient.CalendarEvent

/** What `createEvent` / `createPrivateEvent` send. `peers` are account ids. */
typealias CreateCalendarEvent = CalendarClient.CreateCalendarEvent

/** What `updateEvent` / `updatePrivateEvent` send: only the fields named change (null ones the contract leaves alone). */
typealias UpdateCalendarEvent = CalendarClient.UpdateCalendarEvent

/** A member who set a name. `id` is the account. */
typealias Member = CalendarClient.Member

/** One weekly window a booking link offers. `weekday` 0 is Monday. */
typealias WeeklyWindow = CalendarClient.WeeklyWindow

typealias BookingView = CalendarClient.BookingView

/** A booking link: `status` is `open`, `booked` or `cancelled`. */
typealias BookingLinkView = CalendarClient.BookingLinkView

typealias BookingPage = CalendarClient.BookingPage

typealias GuestDetails = CalendarClient.GuestDetails

typealias CreateBookingLink = CalendarClient.CreateBookingLink
