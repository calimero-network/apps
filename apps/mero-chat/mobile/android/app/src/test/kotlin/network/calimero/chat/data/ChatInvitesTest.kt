package network.calimero.chat.data

import com.calimero.mero.admin.SignedGroupOpenInvitation
import com.calimero.mero.invite.InviteCodec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URLEncoder

/** Invitation links in the web app's format (app/src/utils/invitation.ts), both ways. */
class ChatInvitesTest {
    private val namespaceHex = (0 until 32).joinToString("") { "%02x".format(it) }

    /** A signed envelope as core writes it: the group id as a byte array, keys snake_case. */
    private val envelopeJson =
        """{"invitation":{"inviter_identity":[1,2],"group_id":[${(0 until 32).joinToString(",")}],"expiration_timestamp":1999999999,""" +
            """"secret_salt":[9],"invited_role":1,"admitters":["${"cd".repeat(32)}"]},"inviter_signature":"abcd","inviter_account":"${"ab".repeat(32)}"}"""
    private val envelope = SignedGroupOpenInvitation(Json.parseToJsonElement(envelopeJson).jsonObject)

    @Test
    fun `the link is the web app's shape and reads back to the same envelope`() {
        val link = ChatInvites.link(envelope, "Team")
        assertTrue(link, link.startsWith("https://links.calimero.network/com.calimero.chat/join?invitation="))

        val read = ChatInvites.parse(link)!!
        assertEquals(namespaceHex, read.namespaceId)
        assertEquals("Team", read.workspaceName)
        // Verbatim: re-encoding an invitation any other way breaks its signature.
        assertEquals(envelope.raw, read.invitation.raw)
    }

    @Test
    fun `the payload is the web's serializeGroupInvitationPayload`() {
        assertEquals(
            Json.parseToJsonElement("""{"invitation":$envelopeJson,"groupAlias":"Team"}"""),
            Json.parseToJsonElement(ChatInvites.payload(envelope, "Team")),
        )
        assertEquals(Json.parseToJsonElement("""{"invitation":$envelopeJson}"""), Json.parseToJsonElement(ChatInvites.payload(envelope, null)))
    }

    @Test
    fun `a link the web app minted opens here`() {
        // The web's generateInvitationUrl: base58(deflate(JSON)) in the invitation parameter, groupName from mero-js.
        val token = InviteCodec.encode("""{"invitation":$envelopeJson,"groupName":"Web team"}""")
        val read = ChatInvites.parse("https://links.calimero.network/com.calimero.chat/join?invitation=$token")!!
        assertEquals(namespaceHex, read.namespaceId)
        assertEquals("Web team", read.workspaceName)
    }

    @Test
    fun `calimero links, bare tokens, data wrappers and bare envelopes are accepted`() {
        val token = InviteCodec.encode("""{"data":$envelopeJson}""")
        assertEquals(namespaceHex, ChatInvites.parse("calimero://com.calimero.chat/join?invitation=$token")!!.namespaceId)
        assertEquals(namespaceHex, ChatInvites.parse(token)!!.namespaceId)
        assertNull(ChatInvites.parse(token)!!.workspaceName)
        assertEquals(namespaceHex, ChatInvites.parse(envelopeJson)!!.namespaceId)
        val encoded = URLEncoder.encode(InviteCodec.encode("""{"invitation":$envelopeJson}"""), "UTF-8")
        assertNotNull(ChatInvites.parse("https://links.calimero.network/com.calimero.chat/join?invitation=$encoded"))
    }

    @Test
    fun `the SDK sample's invite form names its namespace itself`() {
        val ns = "ee".repeat(32)
        val token = InviteCodec.encode("""{"namespaceId":"$ns","spaceName":"Sample","invitation":$envelopeJson}""")
        val read = ChatInvites.parse(token)!!
        assertEquals(ns, read.namespaceId)
        assertEquals("Sample", read.workspaceName)
    }

    @Test
    fun `anything else is not an invitation`() {
        assertNull(ChatInvites.parse(""))
        assertNull(ChatInvites.parse("hello"))
        assertNull(ChatInvites.parse("https://links.calimero.network/com.calimero.chat/join?invitation=zzz"))
        assertNull(ChatInvites.parse("""{"invitation":{"group_id":[1]}}"""))
    }

    @Test
    fun `an account's hex id is the contract's base58 UserId`() {
        // Vectors from an independent bs58 implementation; a leading zero byte is a leading '1'.
        assertEquals("1thX6LZfHDZZKUs92febYZhYRcXddmzfzF2NvTkPNE", ChatIdentity.userIdOf("00" + (1..31).joinToString("") { "%02x".format(it) }))
        assertEquals("CZ8YUVdk7znjrUmnb5n7kgySk9yRAsQDYmyCxzfSky9t", ChatIdentity.userIdOf("AB".repeat(32)))
        assertNull(ChatIdentity.userIdOf("abc"))
        assertNull(ChatIdentity.userIdOf(null))
    }
}
