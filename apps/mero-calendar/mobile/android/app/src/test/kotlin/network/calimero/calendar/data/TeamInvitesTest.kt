package network.calimero.calendar.data

import com.calimero.mero.app.OrgInvitation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class TeamInvitesTest {
    private val org = "org_1"

    @Test
    fun `a link carries the SDK payload with the team's name`() {
        val link = TeamInvites.link(OrgInvitation(org, "inv_abc"), "Design")
        assertEquals(true, link.startsWith("https://links.calimero.network/com.calimero.mero-calendar/join?invitation="))
        val parsed = TeamInvites.parse(link)!!
        assertEquals(org, parsed.namespaceId)
        assertEquals("inv_abc", parsed.invitation.token)
        assertEquals("Design", parsed.teamName)
        // The SDK (and the iOS app) read the same link.
        assertEquals("Design", OrgInvitation.parse(link, "com.calimero.mero-calendar")?.name)
    }

    @Test
    fun `the web app's name keys and a data envelope are read`() {
        val parsed = TeamInvites.parseJson("""{"data":{"invitation":"inv_x","namespaceId":"$org","__teamName":"Ops"}}""")!!
        assertEquals("Ops", parsed.teamName)
        assertEquals("inv_x", parsed.invitation.token)
    }

    @Test
    fun `a pre-1_0 signed invitation and another app's link are refused`() {
        assertNull(TeamInvites.parseJson("""{"invitation":{"invitation":{"group_id":[1,2]},"inviter_signature":"5a"},"__teamName":"Old"}"""))
        val code = OrgInvitation(org, "inv_abc").encoded()
        assertNull(TeamInvites.parse("https://links.calimero.network/com.calimero.chat/join?invitation=$code"))
        assertNotNull(TeamInvites.parse("calimero://com.calimero.mero-calendar/join?invitation=$code"))
        assertNotNull(TeamInvites.parse(code))
        assertNull(TeamInvites.parse("hello"))
    }
}
