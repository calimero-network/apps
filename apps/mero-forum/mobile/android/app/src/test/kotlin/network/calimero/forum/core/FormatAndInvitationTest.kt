package network.calimero.forum.core

import com.calimero.mero.testkit.InMemoryAppBackend
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

class ForumFormatTest {
    private val utc = ZoneId.of("UTC")

    @Test
    fun `nanosecond stamps are scaled`() {
        assertEquals(1_761_000_000_000L, ForumFormat.epochMillis(1_761_000_000_000_000_000uL))
        assertEquals(1_761_000_000_000L, ForumFormat.epochMillis(1_761_000_000_000uL))
    }

    @Test
    fun `age reads like a timeline`() {
        val now = 1_761_000_000_000L

        fun stamp(secondsAgo: Long) = ((now - secondsAgo * 1000) * 1_000_000).toULong()
        assertEquals("now", ForumFormat.age(stamp(5), now, utc))
        assertEquals("5m", ForumFormat.age(stamp(5 * 60), now, utc))
        assertEquals("3h", ForumFormat.age(stamp(3 * 3600), now, utc))
        assertEquals("2d", ForumFormat.age(stamp(2 * 86400), now, utc))
        assertEquals("Sep 30", ForumFormat.age(stamp(20 * 86400), now, utc))
        assertEquals("Sep 15, 2024", ForumFormat.age(stamp(400 * 86400), now, utc))
        assertEquals("10:40 PM · Oct 20, 2025", ForumFormat.fullStamp(stamp(0), utc))
    }

    @Test
    fun people() {
        assertEquals("ababab…abab", ForumFormat.shortAccount(ME))
        assertEquals("@ababab…abab", ForumFormat.handle(ME))
        assertEquals("ababab…abab", ForumFormat.displayName("  ", ME))
        assertEquals("Ana", ForumFormat.displayName(" Ana ", ME))
        assertEquals("AM", ForumFormat.initials("ana maria lopez"))
        assertEquals("?", ForumFormat.initials(""))
        // Same numbers as the Swift ForumFormatTests: one colour per person on both.
        assertEquals(2, ForumFormat.tone("Ana"))
        assertEquals(4, ForumFormat.tone(ME))
        assertTrue(ForumFormat.isAccountId(ME.uppercase()))
        assertFalse(ForumFormat.isAccountId("abc"))
    }

    @Test
    fun `compact counts`() {
        assertEquals("999", ForumFormat.compact(999))
        assertEquals("1K", ForumFormat.compact(1_000))
        assertEquals("1.2K", ForumFormat.compact(1_250))
        assertEquals("12K", ForumFormat.compact(12_900))
        assertEquals("1.3M", ForumFormat.compact(1_300_000))
        assertEquals("-3", ForumFormat.compact(-3))
    }
}

class ForumInvitationTest {
    private val signed = InMemoryAppBackend.invitation(NS)

    @Test
    fun `space invite round trips`() {
        val link = ForumInvitation(signed, ForumInvitation.Kind.SPACE, "Design").link()
        assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-forum/join?invitation="))
        val parsed = ForumInvitation.parse(link)!!
        assertEquals(NS, parsed.namespaceId)
        assertEquals(ForumInvitation.Kind.SPACE, parsed.kind)
        assertEquals("Design", parsed.title)
        assertNull(parsed.contextId)
    }

    @Test
    fun `forum invite carries where to land`() {
        val invite = ForumInvitation(signed, ForumInvitation.Kind.FORUM, "Design", "f1", "General", CTX)
        val parsed = ForumInvitation.parse(invite.token())!!
        assertEquals(ForumInvitation.Kind.FORUM, parsed.kind)
        assertEquals("f1", parsed.forumId)
        assertEquals(CTX, parsed.contextId)
        assertEquals("General", parsed.title)
    }

    @Test
    fun `deep link and legacy links`() {
        val token = ForumInvitation(signed, spaceName = "Design").token()
        assertNotNull(ForumInvitation.parse("calimero://com.calimero.mero-forum/join?invitation=$token"))
        assertNotNull(ForumInvitation.parse("https://forum.example/spaces?invite=$token"))
        assertNotNull(ForumInvitation.parse("  $token\n"))
    }

    @Test
    fun `web payload shapes`() {
        val envelope = signed.raw.toString()
        val camel = envelope.replace("inviter_signature", "inviterSignature")
        val parsed = ForumInvitation.parseJson("""{"data":{"invitation":$camel,"groupName":"Ops"}}""")!!
        assertEquals("Ops", parsed.spaceName)
        assertEquals(NS, parsed.namespaceId)
        assertNotNull(ForumInvitation.parseJson(envelope))
    }

    @Test
    fun `refuses other apps and garbage`() {
        val token = ForumInvitation(signed).token()
        assertNull(ForumInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=$token"))
        assertNull(ForumInvitation.parse("hello there"))
        assertNull(ForumInvitation.parse(""))
    }
}
