package network.calimero.issues.core

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class TrackerInvitationTest {
    private val org = "07".repeat(32)
    private val invitation = OrgInvitation(org, "inv_abc123")

    @Test fun `link round trip`() {
        val invite = TrackerInvitation(invitation, "Platform team")
        val back = TrackerInvitation.parse(invite.link())!!
        assertEquals("Platform team", back.workspaceName)
        assertEquals(org, back.namespaceId)
        assertEquals("inv_abc123", back.invitation.token)
        assertNotNull(TrackerInvitation.parse("calimero://com.calimero.mero-issue-tracker/join?invitation=${invite.token()}"))
        assertNotNull(TrackerInvitation.parse(invite.token()))
    }

    @Test fun `link carries the SDK payload`() {
        val token = TrackerInvitation(invitation, "Ops").token()
        val root = Json.parseToJsonElement(InviteCodec.decode(token)!!).jsonObject
        assertEquals("inv_abc123", root["invitation"]!!.jsonPrimitive.content)
        assertEquals(org, root["namespaceId"]!!.jsonPrimitive.content)
        assertEquals("Ops", root["name"]!!.jsonPrimitive.content)
        assertEquals("Ops", root["groupAlias"]!!.jsonPrimitive.content)
        // The SDK reads the same link, ignoring the tracker's extra fields.
        assertEquals(OrgInvitation(org, "inv_abc123", name = "Ops"), OrgInvitation.decode(token))
    }

    @Test fun `an SDK link is read`() {
        val link = OrgInvitation(org, "inv_z", contextId = "app1", name = "Core").link(Tracker.PACKAGE_NAME)
        val back = TrackerInvitation.parse(link)!!
        assertEquals("Core", back.workspaceName)
        assertEquals("app1", back.invitation.contextId)
    }

    @Test fun `another app's link is refused`() {
        val invite = TrackerInvitation(invitation, null)
        assertNull(TrackerInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=${invite.token()}"))
        assertNull(TrackerInvitation.parse("not an invitation"))
    }

    @Test fun `envelope and legacy names are read`() {
        val named = TrackerInvitation.parseJson("""{"data":{"invitation":"inv_x","namespaceId":"$org","groupName":"Ops","groupAlias":"x"}}""")!!
        assertEquals("Ops", named.workspaceName)
        assertEquals("inv_x", named.invitation.token)
        val preferred = TrackerInvitation.parseJson("""{"invitation":"inv_y","namespaceId":"$org","name":"New","groupAlias":"Old"}""")!!
        assertEquals("New", preferred.workspaceName)
        assertNull(TrackerInvitation.parseJson("""{"invitation":"inv_y","namespaceId":"$org"}""")!!.workspaceName)
    }

    @Test fun `a pre-1_0 signed invitation is refused`() {
        assertNull(TrackerInvitation.parseJson("""{"invitation":{"invitation":{"group_id":[1,2]},"inviter_signature":"sig"},"groupAlias":"Old"}"""))
    }
}
