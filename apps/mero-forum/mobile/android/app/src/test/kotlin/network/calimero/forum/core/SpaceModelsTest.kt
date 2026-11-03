package network.calimero.forum.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun `lists the app instances in the space`() =
        runTest {
            val (backend, _) = makeBackend()
            backend.rootContexts = mapOf(NS to listOf("c2", "c1", "c3"))
            backend.contextNames = mapOf("c1" to "General", "c2" to "Random")
            val forums = model(backend)
            forums.load()
            assertEquals(listOf("Forum c3", "General", "Random"), forums.forums.value.map { it.name })
            assertEquals(
                "c1",
                forums.forums.value
                    .first { it.name == "General" }
                    .contextId,
            )
            assertTrue("every member of the org reaches its instances", forums.forums.value.all { it.joined })
        }

    @Test
    fun `create makes an app instance in the org with no init args`() =
        runTest {
            val (backend, _) = makeBackend()
            val forums = model(backend)
            val ref = forums.create("General")
            assertEquals("General", ref.forumName)
            assertEquals("a forum is its app instance", ref.contextId, ref.forumId)
            assertEquals("directly in the org", listOf(ref.contextId), backend.rootContexts[NS])
            assertTrue(backend.publicSubgroups.isEmpty())
            assertEquals(JsonObject(emptyMap()), backend.initArgs[ref.contextId])
        }

    @Test
    fun `enter opens without joining`() {
        val (backend, _) = makeBackend()
        val ref = model(backend).enter(ForumRow("c1", "General", "c1", joined = true))
        assertEquals("c1", ref.contextId)
        assertFalse(backend.log.any { it.startsWith("joinContext") })
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
            assertEquals(InvitationModel.Stage.Failed("Your cluster took too long to answer. Try again."), model.stage.value)
        }
}
