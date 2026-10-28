package network.calimero.sheets.core

import com.calimero.mero.admin.SignedGroupOpenInvitation
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class SheetsInvitationTest {
    private val envelope =
        """
        {"invitation":{"inviter_identity":[${List(32) { 1 }.joinToString(",")}],"group_id":[${List(32) { 7 }.joinToString(",")}],
        "expiration_timestamp":9999999999,"secret_salt":[${List(32) { 2 }.joinToString(",")}]},"inviter_signature":"sig"}
        """.trimIndent()

    private fun signed() = SignedGroupOpenInvitation(Json.parseToJsonElement(envelope).jsonObject)

    @Test fun `link round trip`() {
        val invite = SheetsInvitation(signed(), "Platform team")
        val back = SheetsInvitation.parse(invite.link())!!
        assertEquals("Platform team", back.workspaceName)
        assertEquals("07".repeat(32), back.namespaceId)
        assertNotNull(SheetsInvitation.parse("calimero://com.calimero.mero-sheets/join?invitation=${invite.token()}"))
        assertNotNull(SheetsInvitation.parse(invite.token()))
    }

    @Test fun `spreadsheet hint round trips`() {
        val invite = SheetsInvitation(signed(), "Finance", "ctx-1", "Q3 Budget")
        val link = invite.link()
        assertEquals(true, link.startsWith("https://links.calimero.network/com.calimero.mero-sheets/join?invitation="))
        val back = SheetsInvitation.parse(link)!!
        assertEquals("ctx-1", back.contextId)
        assertEquals("Q3 Budget", back.spreadsheetName)
        val stream = SheetsInvitation.parseJson("""{"invitation":$envelope,"roomName":"Standup"}""")!!
        assertEquals("Standup", stream.spreadsheetName)
    }

    @Test fun `another app's link is refused`() {
        val invite = SheetsInvitation(signed(), null)
        assertNull(SheetsInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=${invite.token()}"))
        assertNull(SheetsInvitation.parse("not an invitation"))
    }

    @Test fun `web shapes are read`() {
        val named = SheetsInvitation.parseJson("""{"data":{"invitation":$envelope,"groupName":"Ops"}}""")!!
        assertEquals("Ops", named.workspaceName)
        assertNull(SheetsInvitation.parseJson(envelope)!!.workspaceName)
    }
}
