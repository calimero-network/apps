package network.calimero.calendar.contract

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.serializer

// The calendar contract (`logic/`, a Calimero 1.0 component), typed: the phone's copy of the web
// app's `app/src/api/calendar.ts`, against the same `logic/res/abi.json`. The iOS app's
// `CalendarContract.swift` is its twin.
//
// What the component ABI changed from v1, and how this file follows it:
// - method and argument names are camelCase (`getEvents`, `eventId`, `eventData`); event fields
//   keep v1's `event_type`;
// - v1's `timestamp` arguments are gone (the app's log is the clock);
// - accounts (`owner`, `peers`, a member's `id`) are the node's account ids, as strings;
// - 64-bit integers are decimal strings (`"1783296000000"`), read by [U64Serializer];
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

/** A `u64` the contract writes as a decimal string (an older answer may hold a number); written as the string. */
object U64Serializer : KSerializer<Long> {
    override val descriptor = PrimitiveSerialDescriptor("U64", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: Long,
    ) = encoder.encodeString(value.toULong().toString())

    override fun deserialize(decoder: Decoder): Long {
        val element = (decoder as? JsonDecoder)?.decodeJsonElement() ?: return decoder.decodeString().toULong().toLong()
        val text = (element as? JsonPrimitive)?.content ?: error("not a u64")
        return text.trim().toULongOrNull()?.toLong() ?: text.toDouble().toLong()
    }
}

// ---- shapes ---------------------------------------------------------------------------------

/** An event as the contract answers it; `private` tells the caller's private event from a shared one. */
@Serializable
data class CalendarEvent(
    val id: String,
    val title: String,
    val description: String = "",
    val owner: String,
    val start: String,
    val end: String,
    @SerialName("event_type") val eventType: String,
    val color: String = "",
    val peers: List<String> = emptyList(),
    val private: Boolean = false,
)

/** What `createEvent` / `createPrivateEvent` send. `peers` are account ids. */
@Serializable
data class CreateCalendarEvent(
    val title: String,
    val description: String,
    val start: String,
    val end: String,
    @SerialName("event_type") val eventType: String,
    val color: String,
    val peers: List<String>,
)

/** What `updateEvent` / `updatePrivateEvent` send: only the fields named change (nulls are left out). */
@Serializable
data class UpdateCalendarEvent(
    val title: String? = null,
    val description: String? = null,
    val start: String? = null,
    val end: String? = null,
    @SerialName("event_type") val eventType: String? = null,
    val color: String? = null,
    val peers: List<String>? = null,
)

/** A member who set a name. `id` is the account. */
@Serializable
data class Member(
    val id: String,
    val username: String,
    @Serializable(with = U64Serializer::class) val joinedAt: Long = 0,
    @Serializable(with = U64Serializer::class) val usernameUpdatedAt: Long = 0,
)

// ---- reading the generated client's answers -------------------------------------------------

/**
 * The JSON of the shapes above, beside the generated
 * [network.calimero.calendar.generated.CalendarClient]. The ABI names them without their shape until
 * the logic derives `AbiType`, so the client takes and answers their JSON.
 */
object CalendarContract {
    /** Unknown answer fields are tolerated; nulls are not written (the contract refuses unknown or null keys it does not expect). */
    val json =
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = true
        }

    /** A decoded JSON value, for tests. */
    fun parse(text: String): JsonElement = json.parseToJsonElement(text)

    /** An answer of the generated client as the shape [T]. */
    inline fun <reified T> read(answer: JsonElement): T = json.decodeFromJsonElement(serializer<T>(), answer)

    /** [value] (one of the shapes above) as the JSON the generated client takes. */
    inline fun <reified T> write(value: T): JsonElement = json.encodeToJsonElement(serializer<T>(), value)
}
