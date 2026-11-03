package network.calimero.kombat.app

import com.calimero.mero.AppError
import com.calimero.mero.CloudEvent
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.app.OrgInvitation
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What changed for Calimero 1.0: the invitation link, presence events, errors. (Swift `Calimero10Tests`.) */
class Calimero10Test {
    @Test
    fun `the link is an org invitation naming the arena`() {
        val link = KombatInvitation.of(OrgInvitation("org1", "inv_abc"), "app1").link()
        assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-kombat/join?invitation="))
        val parsed = KombatInvitation.parse(link)
        assertNotNull(parsed)
        assertEquals("org1", parsed!!.namespaceId)
        assertEquals("app1", parsed.contextId)
        assertEquals("inv_abc", parsed.invitation.token)
        // Without an arena it is not a Mero Kombat link; neither is a pre-1.0 signed invitation.
        assertNull(KombatInvitation.parseJson("""{"invitation":"inv_abc","namespaceId":"org1"}"""))
        val old = """{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"s"},"namespaceId":"aa","contextId":"cc"}"""
        assertNull(KombatInvitation.parseJson(old))
    }

    @Test
    fun `presence events become slices`() {
        val slice = """{"x":1}""".encodeToByteArray().joinToString("") { "%02x".format(it) }

        fun entry(state: String?) =
            JsonObject(mapOf("account" to JsonPrimitive("a"), "device" to JsonPrimitive("d"), "state" to (state?.let(::JsonPrimitive) ?: JsonNull)))
        val snapshot = CloudEvent("1", "snapshot", JsonArray(listOf(entry(slice), entry(null))))
        assertEquals(listOf("""{"x":1}"""), CalimeroPresenceChannel.slices(snapshot))
        val diff = CloudEvent("2", "presence", entry(slice))
        assertEquals(listOf("""{"x":1}"""), CalimeroPresenceChannel.slices(diff))
    }

    @Test
    fun `the node's errors read as words`() {
        assertEquals(
            "Your cluster takes no new work until node release 2.3.110 is approved. Review it under Needs your approval.",
            KombatText.error(ReleaseDeadlineError("deadline", JsonObject(mapOf("release" to JsonPrimitive("2.3.110"))))),
        )
        assertEquals("This isn't shared with you, or it was deleted.", KombatText.error(NotFound("no such app")))
        assertEquals("Your session ended. Sign in again.", KombatText.error(LoginRequired("expired")))
        assertEquals("Cancelled. Nothing was sent.", KombatText.error(ConfirmCancelled()))
        assertEquals(
            "That corner is taken.",
            KombatText.error(AppError("refused", JsonObject(mapOf("code" to JsonPrimitive("CornerTaken"), "fields" to JsonObject(emptyMap()))))),
        )
        assertEquals(
            "That round is over.",
            KombatText.error(
                AppError("refused", JsonObject(mapOf("code" to JsonPrimitive("RoundOver"), "fields" to JsonObject(mapOf("current" to JsonPrimitive(2)))))),
            ),
        )
    }
}
