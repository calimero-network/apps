package network.calimero.models

import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.coroutines.test.runTest
import network.calimero.models.core.InvitationModel
import network.calimero.models.core.ModelsFormat
import network.calimero.models.core.ModelsInvitation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

/** The same cases as the iOS `FormatAndInvitationTests`. */
class FormatAndInvitationTest {
    @Test
    fun formatting() {
        assertEquals("ababab…abab", ModelsFormat.shortId("ab".repeat(32)))
        assertEquals("AL", ModelsFormat.initials("Ana Lopez"))
        assertEquals("Sun", ModelsFormat.kindLabel("directional_light"))
        assertEquals("1.2k", ModelsFormat.compact(1234))
        assertEquals("2M", ModelsFormat.compact(2_000_000))
        val now = 1_800_000_000_000L
        assertEquals("2h ago", ModelsFormat.relativeTime(now - 7_200_000, now))
        val utc = TimeZone.getTimeZone("UTC")
        assertEquals("09:00", ModelsFormat.until(now + 3_600_000, now, utc))
        assertEquals("16 Jan, 08:00", ModelsFormat.until(now + 86_400_000, now, utc))
    }

    @Test
    fun `a link round-trips in the web format`() =
        runTest {
            val link = ModelsInvitation.mint(Fixtures.backend(), Fixtures.studio, Fixtures.scene)
            assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-models/join?invitation="))
            val parsed = ModelsInvitation.parse(link)
            assertNotNull(parsed)
            assertEquals(Fixtures.studio, parsed!!.namespaceId)
            assertEquals(Fixtures.scene, parsed.contextId)
            val json = InviteCodec.decode(InviteLink.tokenFromPasted(link)!!)!!
            assertTrue(json.contains("\"namespaceId\""))
            assertTrue(json.contains("\"inviter_signature\""))
        }

    @Test
    fun `another app's link is refused`() =
        runTest {
            val link = ModelsInvitation.mint(Fixtures.backend(), Fixtures.studio, Fixtures.scene)
            assertNull(ModelsInvitation.parse(link.replace("com.calimero.mero-models", "com.calimero.mero-chat")))
            assertNull(ModelsInvitation.parse("not an invitation"))
        }

    @Test
    fun `accepting joins the studio then the scene`() =
        runTest {
            val backend = Fixtures.backend(memberOfScene = false)
            backend.namespaces = emptyList()
            val link = ModelsInvitation.mint(backend, Fixtures.studio, Fixtures.scene)
            val model = InvitationModel(attempts = 2, retryDelayMs = 1)
            assertTrue(model.open(link))
            assertEquals(InvitationModel.Stage.Confirm, model.stage.value)
            var joined = false
            model.accept(backend = { backend }, didJoin = { joined = true })
            assertTrue(joined)
            assertEquals(InvitationModel.Stage.Joined(Fixtures.studio, Fixtures.scene), model.stage.value)
            assertTrue("joinNamespace ${Fixtures.studio}" in backend.log)
            assertTrue("joinContext ${Fixtures.scene}" in backend.log)
        }

    @Test
    fun `a bad link fails`() {
        val model = InvitationModel()
        assertFalse(model.open("https://example.com"))
        assertEquals(
            InvitationModel.Stage.Failed("This isn't a Mero Models invitation. Check the link and try again."),
            model.stage.value,
        )
    }
}
