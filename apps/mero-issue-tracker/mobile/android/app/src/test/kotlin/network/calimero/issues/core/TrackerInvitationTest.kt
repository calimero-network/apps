package network.calimero.issues.core

import com.calimero.mero.admin.SignedGroupOpenInvitation
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class TrackerInvitationTest {
    private val envelope =
        """
        {"invitation":{"inviter_identity":[${List(32) { 1 }.joinToString(",")}],"group_id":[${List(32) { 7 }.joinToString(",")}],
        "expiration_timestamp":9999999999,"secret_salt":[${List(32) { 2 }.joinToString(",")}]},"inviter_signature":"sig"}
        """.trimIndent()

    private fun signed() = SignedGroupOpenInvitation(Json.parseToJsonElement(envelope).jsonObject)

    @Test fun `link round trip`() {
        val invite = TrackerInvitation(signed(), "Platform team")
        val back = TrackerInvitation.parse(invite.link())!!
        assertEquals("Platform team", back.workspaceName)
        assertEquals("07".repeat(32), back.namespaceId)
        assertNotNull(TrackerInvitation.parse("calimero://com.calimero.mero-issue-tracker/join?invitation=${invite.token()}"))
        assertNotNull(TrackerInvitation.parse(invite.token()))
    }

    @Test fun `another app's link is refused`() {
        val invite = TrackerInvitation(signed(), null)
        assertNull(TrackerInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=${invite.token()}"))
        assertNull(TrackerInvitation.parse("not an invitation"))
    }

    @Test fun `web shapes are read`() {
        val named = TrackerInvitation.parseJson("""{"data":{"invitation":$envelope,"groupName":"Ops"}}""")!!
        assertEquals("Ops", named.workspaceName)
        assertNull(TrackerInvitation.parseJson(envelope)!!.workspaceName)
    }
}
