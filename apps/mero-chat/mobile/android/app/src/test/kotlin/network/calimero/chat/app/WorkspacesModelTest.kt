package network.calimero.chat.app

import com.calimero.mero.compose.MemoryKeyValueStore
import com.calimero.mero.compose.MeroAuthState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import network.calimero.chat.ChatRig
import network.calimero.chat.data.Workspace
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The workspaces list over the real delegated stack (FakeNode), and the session stages. */
class WorkspacesModelTest {
    private lateinit var rig: ChatRig
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val profile = ProfileStore(MemoryKeyValueStore())
    private lateinit var model: WorkspacesModel

    @Before
    fun setUp() =
        runBlocking {
            rig = ChatRig()
            rig.signIn()
            model = WorkspacesModel(rig.repo, scope, profile)
        }

    @After
    fun tearDown() {
        scope.cancel()
        rig.close()
    }

    @Test
    fun `nothing is created or joined until the person has a name`() =
        runBlocking {
            model.create("Team").join()
            assertNotNull(model.state.value.error)
            assertTrue(rig.cloud.recorded("/governance-intents").none { it.method == "POST" })
        }

    @Test
    fun `creating a workspace founds it and lists it`() =
        runBlocking {
            profile.setDisplayName("droid")
            model.create("Team").join()
            val s = model.state.value
            assertNull(s.error)
            assertNull(s.busy)
            assertTrue(s.workspaces.any { it.name == "Team" })
            assertTrue(s.notice!!.contains("Team"))
        }

    @Test
    fun `an opened invitation is held for confirmation, then redeemed by direct admission`() =
        runBlocking {
            profile.setDisplayName("droid")
            // A real invitation, minted by the SDK for a namespace this account is in.
            val ns = "ab".repeat(32)
            val link = rig.repo.invitationLink(Workspace(ns, "Their team"))
            assertTrue(model.offerInvite(link))
            assertEquals(
                "Their team",
                model.state.value.pendingInvite!!
                    .workspaceName,
            )
            assertTrue("nothing joined before the person says so", rig.cloud.recorded("/admit").isEmpty())

            model.acceptPendingInvite().join()
            assertNull(model.state.value.pendingInvite)
            assertNull(model.state.value.error)
            assertEquals(
                "/admin-api/namespaces/${"ab".repeat(32)}/admit",
                rig.cloud
                    .recorded("/admit")
                    .single()
                    .path,
            )
        }

    @Test
    fun `a link that is not an invitation says so`() {
        assertTrue(!model.offerInvite("https://example.com/nothing"))
        assertNotNull(model.state.value.error)
    }

    @Test
    fun `session stages follow the SDK's auth state, staying signed in while reconnecting`() {
        assertEquals(SessionStage.SignedOut(), sessionStage(MeroAuthState()))
        assertEquals(SessionStage.SignedOut(cancelled = true), sessionStage(MeroAuthState(cancelled = true)))
        assertEquals(SessionStage.Connecting, sessionStage(MeroAuthState(isLoading = true)))
        val reconnecting = sessionStage(MeroAuthState(isAuthenticated = true, isLoading = true, account = "ab", relayUrl = "https://r"))
        assertEquals(SessionStage.SignedIn("ab", "https://r", live = false, note = null, connecting = true), reconnecting)
        val newAccount = sessionStage(MeroAuthState(isAuthenticated = true, account = "ab", relayNote = "no relay yet")) as SessionStage.SignedIn
        assertTrue(!newAccount.hasRelay)
        assertEquals("no relay yet", newAccount.note)
        val live = sessionStage(rig.client.state.value) as SessionStage.SignedIn
        assertTrue(live.live)
        assertEquals(rig.accountHex, live.account)
    }
}
