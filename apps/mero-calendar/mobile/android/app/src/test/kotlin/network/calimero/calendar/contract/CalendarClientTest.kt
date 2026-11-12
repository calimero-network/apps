package network.calimero.calendar.contract

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.LoginRequired
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.calendar.data.ErrorText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CalendarClientTest {
    /** The component ABI's methods (`logic/res/abi.json` on the port, web PR #720). */
    @Test
    fun `the method list is the component ABI's`() {
        assertEquals(
            setOf(
                "bookSlot", "cancelBooking", "createBookingLink", "createEvent", "createPrivateEvent", "deleteBookingLink",
                "deleteEvent", "deletePrivateEvent", "getAvailableSlots", "getBookingPage", "getEvents", "getMembers",
                "getPrivateEvents", "listBookingLinks", "rescheduleBooking", "setUsername", "updateEvent", "updatePrivateEvent",
            ),
            (CalendarMethods.CALLS + CalendarMethods.VIEWS).toSet(),
        )
        assertEquals(9, CalendarAppCode.entries.size)
    }

    @Test
    fun `u64s are decimal strings both ways`() {
        val members =
            CalendarContract.json.decodeFromString(
                kotlinx.serialization.builtins.ListSerializer(Member.serializer()),
                """[{"id":"x","username":"a","joinedAt":"1761650000000000001","usernameUpdatedAt":2}]""",
            )
        assertEquals(1_761_650_000_000_000_001L, members.single().joinedAt)
        assertEquals(2L, members.single().usernameUpdatedAt)
        assertEquals(
            """{"id":"x","username":"a","joinedAt":"5","usernameUpdatedAt":"6"}""",
            CalendarContract.json.encodeToString(Member.serializer(), Member("x", "a", 5, 6)),
        )
    }

    @Test
    fun `an update sends only the fields it names`() {
        assertEquals("""{"title":"New"}""", CalendarContract.json.encodeToString(UpdateCalendarEvent.serializer(), UpdateCalendarEvent(title = "New")))
    }

    @Test
    fun `contract and cluster errors in words`() {
        fun refusal(
            code: String,
            fields: JsonObject = JsonObject(emptyMap()),
        ) = AppError(
            "refused",
            buildJsonObject {
                put("code", code)
                put("fields", fields)
            },
        )
        assertEquals("Only the event's owner can change it.", ErrorText.of(refusal("Forbidden"), "save"))
        assertEquals(
            "That isn't valid: title cannot be empty.",
            ErrorText.of(refusal("Invalid", JsonObject(mapOf("message" to JsonPrimitive("title cannot be empty")))), "save"),
        )
        assertTrue(ErrorText.of(refusal("NotFound"), "save").contains("no longer exists"))
        assertEquals("The passkey prompt was cancelled.", ErrorText.of(ConfirmCancelled(), "save"))
        assertEquals("Your session ended. Sign in again.", ErrorText.of(LoginRequired("expired"), "save"))
    }
}
