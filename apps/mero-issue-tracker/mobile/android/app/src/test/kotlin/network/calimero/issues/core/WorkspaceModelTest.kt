package network.calimero.issues.core

import com.calimero.mero.app.AppNamespace
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.UnknownHostException

class WorkspaceModelTest {
    private fun model(
        fake: FakeTracker,
        store: TrackerStore = MemoryTrackerStore(),
    ) = WorkspaceModel(fake.backend, fake.backend.applicationId, store)

    @Test fun `load opens the remembered workspace and names repos from their url`() =
        runTest {
            val fake = FakeTracker()
            val a = "1".repeat(64)
            val b = "2".repeat(64)
            fake.backend.namespaces = listOf(AppNamespace(a, "Alpha", "app"), AppNamespace(b, "Beta", "app"))
            fake.backend.rootContexts = mapOf(b to listOf("ctx-1"))
            fake.backend.contract.execute("ctx-1", "set_repo_url", JsonObject(mapOf("url" to JsonPrimitive("https://github.com/acme/core"))))
            val store = MemoryTrackerStore().apply { activeWorkspace = b }
            val m = model(fake, store)
            m.load()
            val s = m.state.value
            assertEquals(LoadPhase.Loaded, s.phase)
            assertEquals(listOf("Alpha", "Beta"), s.workspaces.map { it.name })
            assertEquals(b, s.activeWorkspaceId)
            assertEquals(listOf(Repo("ctx-1", "core", "https://github.com/acme/core")), s.repos)
            assertEquals("ctx-1", s.activeRepoId)
        }

    @Test fun `create a workspace then add a repo`() =
        runTest {
            val fake = FakeTracker()
            val store = MemoryTrackerStore()
            val m = model(fake, store)
            m.load()
            assertTrue(
                m.state.value.workspaces
                    .isEmpty(),
            )
            assertNull(m.createWorkspace("  Platform team "))
            assertEquals(
                "Platform team",
                m.state.value.activeWorkspace
                    ?.name,
            )
            assertTrue("foundNamespace Platform team" in fake.backend.log)

            m.addRepo("core", "https://github.com/acme/core-repo")
            val repo = m.state.value.activeRepo!!
            assertEquals("core", repo.name)
            assertEquals("https://github.com/acme/core-repo", fake.repoUrl(repo.id))
            assertEquals("core", store.repoName(repo.id))
            assertEquals(JsonObject(emptyMap()), fake.backend.initArgs[repo.id])
        }

    @Test fun `hosting notice when the cloud will not host`() =
        runTest {
            val fake = FakeTracker()
            fake.backend.haEnabled = false
            assertNotNull(model(fake).createWorkspace("Solo"))
        }

    @Test fun `a repo needs a name`() =
        runTest {
            try {
                model(FakeTracker()).addRepo(" ", "")
                fail("expected a failure")
            } catch (e: TrackerException) {
                assertEquals("Repo name is required", e.message)
            }
        }

    @Test fun `invite link round trips and joining opens the workspace`() =
        runTest {
            val m = model(FakeTracker())
            m.createWorkspace("Core team")
            val link = m.inviteLink()
            assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation="))
            val parsed = TrackerInvitation.parse(link)!!
            assertEquals("Core team", parsed.workspaceName)

            val joiner = FakeTracker(account = "cd".repeat(32))
            val store = MemoryTrackerStore()
            val other = model(joiner, store)
            other.join(parsed)
            assertEquals(parsed.namespaceId, other.state.value.activeWorkspaceId)
            assertEquals(parsed.namespaceId, store.activeWorkspace)
            assertTrue(other.state.value.isSyncing)
        }

    @Test fun `failures are worded`() =
        runTest {
            val fake = FakeTracker()
            fake.backend.failure = UnknownHostException("relay.test")
            val m = model(fake)
            m.load()
            assertEquals(LoadPhase.Failed("You are offline. Check your connection and try again."), m.state.value.phase)
        }

    @Test fun `ensure member joins when not a member`() =
        runTest {
            val fake = FakeTracker()
            model(fake).ensureMember("ctx-9")
            assertTrue("joinContext ctx-9" in fake.backend.log)
            assertTrue("ctx-9" in fake.backend.members)
        }
}
