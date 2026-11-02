package network.calimero.chat.data

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Org invite links (the SDKs' [OrgInvitation]) and the web app's `?invite=` links. (Swift `ChatInvitationTests`.) */
class ChatInvitesTest {
    private val org = "aa".repeat(32)
    private val invitation = OrgInvitation(org, "inv_abc123", name = "Old name")

    @Test
    fun `the link carries the org invite token and reads back`() {
        val link = ChatInvites.link(invitation, "Team")
        assertTrue(link.startsWith("https://links.calimero.network/com.calimero.chat/join?invitation="))
        val parsed = ChatInvites.parse(link)!!
        assertEquals(org, parsed.namespaceId)
        assertEquals("inv_abc123", parsed.invitation.token)
        assertEquals("Team", parsed.workspaceName)
        val json = InviteCodec.decode(InviteLink.tokenFromPasted(link)!!)!!
        assertTrue(json.contains("\"invitation\":\"inv_abc123\""))
    }

    @Test
    fun `calimero links, bare codes and data wrappers are accepted`() {
        val code = invitation.encoded()
        assertEquals(org, ChatInvites.parse("calimero://com.calimero.chat/join?invitation=$code")?.namespaceId)
        assertEquals(org, ChatInvites.parse(code)?.namespaceId)
        val wrapped = InviteCodec.encode("""{"data":{"invitation":"inv_x","namespaceId":"$org","groupName":"Web team"}}""")
        assertEquals("Web team", ChatInvites.parse(wrapped)?.workspaceName)
    }

    /** The web app (#730) shares `https://<its origin>/?invite=inv_…`: the token alone. */
    @Test
    fun `the web app's invite link and a bare token parse, with no org`() {
        val web = ChatInvites.parse("https://chat.example.com/?invite=inv_abc123")!!
        assertEquals("inv_abc123", web.invitation.token)
        assertEquals("", web.namespaceId)
        assertEquals("inv_abc123", ChatInvites.parse("inv_abc123")?.invitation?.token)
    }

    @Test
    fun `anything else is not an invitation`() {
        assertNull(ChatInvites.parse("https://example.com/nothing"))
        assertNull(ChatInvites.parse("https://chat.example.com/?invite=nope"))
        assertNull(ChatInvites.parse(ChatInvites.link(invitation, null).replace("com.calimero.chat", "com.calimero.mero-docs")))
        // A 0.x signed group invitation: a 1.0 cluster cannot redeem it.
        val old = InviteCodec.encode("""{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"s"},"groupAlias":"x"}""")
        assertNull(ChatInvites.parse(old))
    }

    @Test
    fun `an account is its own user id on the component runtime`() {
        assertEquals("ab".repeat(32), ChatIdentity.userIdOf("ab".repeat(32)))
        assertNull(ChatIdentity.userIdOf(" "))
    }
}
