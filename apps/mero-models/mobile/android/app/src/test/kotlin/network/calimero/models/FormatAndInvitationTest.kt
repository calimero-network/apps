package network.calimero.models

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.WrongNode
import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.models.core.ClusterTarget
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
            assertEquals(InMemoryAppBackend.invitation(Fixtures.studio).token, parsed.invitation.token)
            // The payload is the 1.0 link shape: an org invite token, the org and the scene.
            val token = InviteLink.tokenFromPasted(link)!!
            val json = InviteCodec.decode(token)!!
            assertTrue(json.contains("\"namespaceId\""))
            assertTrue(json.contains("\"invitation\":\"inv_"))
            assertEquals(Fixtures.scene, OrgInvitation.decode(token)?.contextId)
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
    fun `raw JSON parses and a link without a scene is refused`() {
        val parsed = ModelsInvitation.parse("""{"invitation":"inv_x","namespaceId":"org1","contextId":"app1","extra":1}""")
        assertEquals("org1", parsed?.namespaceId)
        assertEquals("app1", parsed?.contextId)
        assertNull(ModelsInvitation.parse("""{"invitation":"inv_x","namespaceId":"org1"}"""))
        val old = """{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"s"},"namespaceId":"aa","contextId":"cc"}"""
        assertNull(ModelsInvitation.parse(old))
    }

    @Test
    fun `the node's errors read as words`() {
        assertEquals(
            "Your cluster takes no new work until node release 2.3.110 is approved. Review it under Needs your approval.",
            ModelsFormat.errorText(ReleaseDeadlineError("deadline", buildJsonObject { put("release", "2.3.110") })),
        )
        assertEquals("This isn't shared with you, or it was deleted.", ModelsFormat.errorText(NotFound("no such app")))
        assertEquals("Your session ended. Sign in again.", ModelsFormat.errorText(LoginRequired("expired")))
        assertEquals("You dismissed the passkey prompt, so nothing changed.", ModelsFormat.errorText(ConfirmCancelled()))
        assertEquals(
            "This node runs a release your account hasn't approved. Try another node of the cluster.",
            ModelsFormat.errorText(WrongNode("not approved")),
        )
    }

    /** `422 APP_ERROR {code, fields: {message}}`: the contract's own words, else words for its code. */
    @Test
    fun `the contract's errors read as words`() {
        val locked =
            AppError(
                "app error",
                buildJsonObject {
                    put("code", "Locked")
                    put("fields", buildJsonObject { put("message", "crate is checked out by Ana") })
                },
            )
        assertEquals("crate is checked out by Ana", ModelsFormat.errorText(locked))
        val forbidden = AppError("app error", buildJsonObject { put("code", "Forbidden") })
        assertEquals("Your role in this scene doesn't allow that.", ModelsFormat.errorText(forbidden))
    }

    @Test
    fun `the sign-in field takes a cluster name or a node`() {
        assertEquals(ClusterTarget.Name("eu-shared-1"), ClusterTarget.parse(" EU-shared-1 "))
        assertEquals(ClusterTarget.Url("https://node1.example.com"), ClusterTarget.parse("https://node1.example.com/"))
        assertEquals(ClusterTarget.Url("https://node1.example.com"), ClusterTarget.parse("node1.example.com"))
        assertEquals(ClusterTarget.Url("http://127.0.0.1:2501"), ClusterTarget.parse("http://127.0.0.1:2501"))
        assertNull(ClusterTarget.parse("ftp://x.y"))
        assertNull(ClusterTarget.parse("two words"))
        assertNull(ClusterTarget.parse(""))
        assertEquals("node1.example.com", ClusterTarget.parse("https://node1.example.com")?.label)
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
