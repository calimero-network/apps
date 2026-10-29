package network.calimero.forum.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class SpacesModelTest {
    @Test
    fun `loads spaces by name`() =
        runTest {
            val (backend, _) = makeBackend()
            backend.namespaces = listOf(AppNamespace("2", "zeta", "app"), AppNamespace("1", "Alpha", "app"))
            val model = SpacesModel(backend)
            model.load()
            assertEquals(LoadPhase.Loaded, model.phase.value)
            assertEquals(listOf("1", "2"), model.spaces.value.map { it.id })
        }

    @Test
    fun `create founds a namespace`() =
        runTest {
            val (backend, _) = makeBackend()
            val model = SpacesModel(backend)
            val space = model.create("  Design  ")
            assertEquals("Design", space.name)
            assertTrue("foundNamespace Design" in backend.log)
            assertEquals(1, model.spaces.value.size)
        }

    @Test
    fun `create needs a name`() =
        runTest {
            val (backend, _) = makeBackend()
            try {
                SpacesModel(backend).create(" ")
                fail("expected a refusal")
            } catch (e: ForumModelException) {
                assertEquals("Give the space a name.", e.message)
            }
            assertTrue(backend.log.isEmpty())
        }

    @Test
    fun `a failed first load says why`() =
        runTest {
            val (backend, _) = makeBackend()
            backend.failure = UnknownHostException("relay")
            val model = SpacesModel(backend)
            model.load()
            assertEquals(LoadPhase.Failed("You're offline. Check your connection and try again."), model.phase.value)
        }
}

class ForumsModelTest {
    private fun model(backend: InMemoryAppBackend) = ForumsModel(backend, NS, "Design", backend.applicationId)

    @Test
    fun `lists forums with membership`() =
        runTest {
            val (backend, _) = makeBackend()
            backend.subgroups =
                mapOf(
                    NS to
                        listOf(
                            AppSubgroup("g2", "Random", listOf("c2")),
                            AppSubgroup("g1", "General", listOf("c1")),
                            AppSubgroup("g3", null, emptyList()),
                        ),
                )
            backend.members = setOf("c1")
            val forums = model(backend)
            forums.load()
            assertEquals(listOf("Forum g3", "General", "Random"), forums.forums.value.map { it.name })
            assertTrue(
                forums.forums.value
                    .first { it.id == "g1" }
                    .joined,
            )
            assertFalse(
                forums.forums.value
                    .first { it.id == "g2" }
                    .joined,
            )
            assertNull(
                forums.forums.value
                    .first { it.id == "g3" }
                    .contextId,
            )
        }

    @Test
    fun `create makes an open subgroup and a context with no init args`() =
        runTest {
            val (backend, _) = makeBackend()
            val forums = model(backend)
            val ref = forums.create("General")
            assertEquals("General", ref.forumName)
            assertTrue(ref.forumId in backend.publicSubgroups)
            assertEquals(JsonObject(emptyMap()), backend.initArgs[ref.contextId])
            assertTrue(
                forums.forums.value
                    .first()
                    .joined,
            )
        }

    @Test
    fun `enter joins an open forum first`() =
        runTest {
            val (backend, _) = makeBackend()
            val ref = model(backend).enter(ForumRow("g1", "General", "c1", joined = false))
            assertEquals("c1", ref.contextId)
            assertTrue("joinContext c1" in backend.log)
            assertTrue("c1" in backend.members)
        }

    @Test
    fun `enter refuses a forum still syncing`() =
        runTest {
            val (backend, _) = makeBackend()
            try {
                model(backend).enter(ForumRow("g1", "General", null, joined = false))
                fail("expected a refusal")
            } catch (e: ForumModelException) {
                assertEquals("This forum is still syncing. Try again in a moment.", e.message)
            }
        }

    @Test
    fun `invites parse back`() =
        runTest {
            val (backend, _) = makeBackend()
            val forums = model(backend)
            val space = ForumInvitation.parse(forums.spaceInvite())!!
            assertEquals(ForumInvitation.Kind.SPACE, space.kind)
            assertEquals("Design", space.spaceName)
            val forum = ForumInvitation.parse(forums.forumInvite(ForumRow("g1", "General", "c1", joined = true)))!!
            assertEquals(ForumInvitation.Kind.FORUM, forum.kind)
            assertEquals("c1", forum.contextId)
            assertEquals(NS, forum.namespaceId)
        }
}

class InvitationModelTest {
    @Test
    fun `rejects a link that is not an invitation`() {
        val model = InvitationModel()
        assertFalse(model.open("https://example.com"))
        assertEquals(InvitationModel.Stage.Failed("This isn't a Mero Forum invitation. Check the link and try again."), model.stage.value)
    }

    @Test
    fun `joins a space`() =
        runTest {
            val (backend, _) = makeBackend()
            backend.hasRelay = false
            val link = ForumInvitation(InMemoryAppBackend.invitation(NS), spaceName = "Design").link()
            val model = InvitationModel()
            assertTrue(model.open(link))
            assertEquals(InvitationModel.Stage.Confirm("Design", false), model.stage.value)
            var joined = false
            model.accept(backend = { backend }, didJoin = { joined = true })
            assertTrue(joined)
            assertTrue(backend.hasRelay)
            assertEquals(InvitationModel.Stage.Joined(InvitationDestination(NS, "Design", null)), model.stage.value)
        }

    @Test
    fun `a forum invite lands in the forum`() =
        runTest {
            val (backend, _) = makeBackend()
            val link =
                ForumInvitation(InMemoryAppBackend.invitation(NS), ForumInvitation.Kind.FORUM, "Design", "g1", "General", "c1").link()
            val model = InvitationModel(forumAttempts = 1, forumRetryDelayMs = 0)
            model.open(link)
            model.accept(backend = { backend }, didJoin = {})
            val stage = model.stage.value as InvitationModel.Stage.Joined
            assertEquals("c1", stage.destination.forum?.contextId)
            assertTrue("joinContext c1" in backend.log)
        }

    @Test
    fun `a failed join says why`() =
        runTest {
            val (backend, _) = makeBackend()
            backend.failure = SocketTimeoutException("slow")
            val model = InvitationModel()
            model.open(ForumInvitation(InMemoryAppBackend.invitation(NS)).token())
            model.accept(backend = { backend }, didJoin = {})
            assertEquals(InvitationModel.Stage.Failed("The relay took too long to answer. Try again."), model.stage.value)
        }
}
