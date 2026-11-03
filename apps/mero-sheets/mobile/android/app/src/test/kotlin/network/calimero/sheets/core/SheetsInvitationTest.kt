package network.calimero.sheets.core

import com.calimero.mero.app.OrgInvitation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SheetsInvitationTest {
    private val org = "07".repeat(32)

    private fun invitation() = OrgInvitation(org, "inv_abcdef")

    @Test fun `link round trip`() {
        val invite = SheetsInvitation(invitation(), "Platform team")
        val back = SheetsInvitation.parse(invite.link())!!
        assertEquals("Platform team", back.workspaceName)
        assertEquals(org, back.namespaceId)
        assertEquals("inv_abcdef", back.invitation.token)
        assertNotNull(SheetsInvitation.parse("calimero://com.calimero.mero-sheets/join?invitation=${invite.token()}"))
        assertNotNull(SheetsInvitation.parse(invite.token()))
    }

    @Test fun `the SDK reads the same link`() {
        val invite = SheetsInvitation(invitation(), "Finance", "ctx-1")
        val sdk = OrgInvitation.parse(invite.link(), MeroSheets.PACKAGE_NAME)!!
        assertEquals(org, sdk.namespaceId)
        assertEquals("ctx-1", sdk.contextId)
        assertEquals("Finance", sdk.name)
    }

    @Test fun `spreadsheet hint round trips`() {
        val invite = SheetsInvitation(invitation(), "Finance", "ctx-1", "Q3 Budget")
        val link = invite.link()
        assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-sheets/join?invitation="))
        val back = SheetsInvitation.parse(link)!!
        assertEquals("ctx-1", back.contextId)
        assertEquals("Q3 Budget", back.spreadsheetName)
        val stream = SheetsInvitation.parseJson("""{"invitation":"inv_x","namespaceId":"$org","roomName":"Standup"}""")!!
        assertEquals("Standup", stream.spreadsheetName)
    }

    @Test fun `another app's link and pre-1_0 invitations are refused`() {
        val invite = SheetsInvitation(invitation(), null)
        assertNull(SheetsInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=${invite.token()}"))
        assertNull(SheetsInvitation.parse("not an invitation"))
        val pre10 = """{"invitation":{"invitation":{"group_id":[7]},"inviter_signature":"sig"},"groupAlias":"Ops"}"""
        assertNull(SheetsInvitation.parseJson(pre10))
    }

    @Test fun `envelope and name spellings are read`() {
        val named = SheetsInvitation.parseJson("""{"data":{"invitation":"inv_x","namespaceId":"$org","groupName":"Ops"}}""")!!
        assertEquals("Ops", named.workspaceName)
        assertNull(SheetsInvitation.parseJson("""{"invitation":"inv_x","namespaceId":"$org"}""")!!.workspaceName)
    }
}
