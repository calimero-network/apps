package network.calimero.calendar.contract

import com.calimero.mero.app.ContextContractCalling
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

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

// ---- the client -----------------------------------------------------------------------------

/**
 * Typed calls to the calendar contract in one app instance ([ContextContractCalling]:
 * `backend.contract.bound(appId)`). Views go through `query`, calls through `execute`.
 *
 * Booking links (`createBookingLink`, `bookSlot`, …) are part of the contract but not of the
 * phone app; they are left to the web app.
 */
class CalendarClient(
    private val transport: ContextContractCalling,
) {
    suspend fun setUsername(username: String) {
        transport.execute("setUsername", args { put("username", username) })
    }

    suspend fun getMembers(): List<Member> = list("getMembers", Member.serializer())

    /** The shared events the caller owns or is invited to. */
    suspend fun getEvents(): List<CalendarEvent> = list("getEvents", CalendarEvent.serializer())

    /** The caller's own private events. */
    suspend fun getPrivateEvents(): List<CalendarEvent> = list("getPrivateEvents", CalendarEvent.serializer())

    /** Routed by the contract: no peers keeps it private. Answers the id. */
    suspend fun createEvent(eventData: CreateCalendarEvent): String = string("createEvent", eventArgs(eventData))

    /** A private event; `peers` is ignored. Answers the id. */
    suspend fun createPrivateEvent(eventData: CreateCalendarEvent): String = string("createPrivateEvent", eventArgs(eventData))

    /** Owner only (`Forbidden` otherwise). */
    suspend fun updateEvent(
        eventId: String,
        eventData: UpdateCalendarEvent,
    ): String = string("updateEvent", updateArgs(eventId, eventData))

    /** Naming peers promotes it to a shared event with the same id. */
    suspend fun updatePrivateEvent(
        eventId: String,
        eventData: UpdateCalendarEvent,
    ): String = string("updatePrivateEvent", updateArgs(eventId, eventData))

    suspend fun deleteEvent(eventId: String): String = string("deleteEvent", args { put("eventId", eventId) })

    suspend fun deletePrivateEvent(eventId: String): String = string("deletePrivateEvent", args { put("eventId", eventId) })

    private suspend fun <T> list(
        method: String,
        item: KSerializer<T>,
    ): List<T> {
        val answer = transport.query(method, "{}")
        if (answer.isBlank() || answer.trim() == "null") return emptyList()
        return json.decodeFromString(ListSerializer(item), answer)
    }

    private suspend fun string(
        method: String,
        args: String,
    ): String {
        val answer = json.parseToJsonElement(transport.execute(method, args).ifBlank { "null" })
        return (answer as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content.orEmpty()
    }

    private fun eventArgs(event: CreateCalendarEvent): String =
        JsonObject(mapOf("eventData" to json.encodeToJsonElement(CreateCalendarEvent.serializer(), event))).toString()

    private fun updateArgs(
        eventId: String,
        event: UpdateCalendarEvent,
    ): String =
        JsonObject(
            mapOf(
                "eventId" to JsonPrimitive(eventId),
                "eventData" to json.encodeToJsonElement(UpdateCalendarEvent.serializer(), event),
            ),
        ).toString()

    private fun args(build: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): String = buildJsonObject(build).toString()

    companion object {
        /** Unknown answer fields are tolerated; nulls are not written (the contract refuses unknown or null keys it does not expect). */
        val json =
            Json {
                ignoreUnknownKeys = true
                explicitNulls = false
                encodeDefaults = true
            }

        /** A decoded JSON value, for tests. */
        fun parse(text: String): JsonElement = json.parseToJsonElement(text)
    }
}
