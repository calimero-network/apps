package network.calimero.chat.app

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import network.calimero.chat.data.ChatInvites
import network.calimero.chat.data.ChatRepository
import network.calimero.chat.data.MeroChatBackend
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The workspaces list over kotlin-sdk's in-memory app backend. (Swift `WorkspaceModelsTests`.) */
class WorkspacesModelTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val profile = ProfileStore(MemoryKeyValueStore())
    private val app = InMemoryAppBackend()
    private val model = WorkspacesModel(ChatRepository(MeroChatBackend(app)), scope, profile)

    @After
    fun tearDown() = scope.cancel()

    @Test
    fun `nothing is created or joined until the person has a name`() =
        runBlocking {
            model.create("Team").join()
            assertNotNull(model.state.value.error)
            assertTrue(app.log.none { it.startsWith("foundNamespace") })
        }

    @Test
    fun `creating a workspace founds it and opens general in the org`() =
        runBlocking {
            profile.setDisplayName("droid")
            model.create("Team").join()
            val s = model.state.value
            assertNull(s.error)
            assertTrue(s.workspaces.any { it.name == "Team" })
            val org = s.workspaces.first { it.name == "Team" }.id
            // An open channel is an app instance in the org itself, as the web makes them.
            assertTrue(app.log.any { it == "createContext $org ${ChatInvites.APP_SLUG} general" })
            assertTrue(app.log.none { it.startsWith("createSubgroup") })
            val init =
                app.initArgs.values
                    .single()
                    .toString()
            assertTrue(init.contains("\"contextType\":\"Channel\""))
            // The creator's name in the new channel, in the component ABI's names.
            assertEquals(1, app.recording.calls("setProfile").size)
        }

    @Test
    fun `an opened invitation is held for confirmation, then redeemed`() =
        runBlocking {
            profile.setDisplayName("droid")
            val org = "ee".repeat(32)
            val link = ChatInvites.link(OrgInvitation(org, "inv_x"), "Their team")
            assertTrue(model.offerInvite(link))
            assertEquals(
                "Their team",
                model.state.value.pendingInvite!!
                    .workspaceName,
            )
            assertTrue("nothing joined before the person says so", app.log.none { it.startsWith("joinNamespace") })

            model.acceptPendingInvite().join()
            assertNull(model.state.value.pendingInvite)
            assertNull(model.state.value.error)
            assertTrue(app.log.contains("joinNamespace $org"))
            assertTrue(
                model.state.value.workspaces
                    .any { it.id == org },
            )
        }

    @Test
    fun `a link that is not an invitation says so`() {
        assertTrue(!model.offerInvite("https://example.com/nothing"))
        assertNotNull(model.state.value.error)
    }
}
