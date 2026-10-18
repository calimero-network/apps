package network.calimero.chat.live

import kotlinx.coroutines.runBlocking
import network.calimero.chat.app.ChannelModel
import network.calimero.chat.app.ChannelState
import network.calimero.chat.app.LiveMode
import network.calimero.chat.data.Channel
import network.calimero.chat.data.ChatRepository
import network.calimero.chat.data.Workspace
import network.calimero.chat.data.describeChatError
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The app's own view models and repository against a REAL relay (merod with delegated access and
 * a mock TEE, booted by `mobile/e2e/run-relay.sh`): founding, channels, messages, invitations,
 * direct admission and the live stream, end to end. Only the Calimero Cloud manager's routing
 * answers are faked ([FakeCloudRoutes]); there is no cloud or wallet in this rig, so each account is
 * minted offline ([LiveUser]).
 *
 * Skipped unless `MERO_E2E_RELAY_URL` and `MERO_E2E_APP_ID` are set (or `mobile/e2e/.relay.env`
 * exists). Each test founds its own workspace with fresh accounts, so they share nothing.
 */
class LiveChatTest {
    private lateinit var cloud: FakeCloudRoutes
    private val users = mutableListOf<LiveUser>()
    private val run = FakeCloudRoutes.randomHex(3)

    @Before
    fun setUp() {
        LiveEnv.requireRelay()
        cloud = FakeCloudRoutes(LiveEnv.relayUrl!!)
    }

    @After
    fun tearDown() {
        users.forEach { it.close() }
        if (::cloud.isInitialized) {
            // The fake answered cloud routes only: nothing the app sends a relay went anywhere but the relay.
            val strays = cloud.requests.filterNot { it.substringAfter(' ').startsWith("/api/cloud/") }
            cloud.close()
            assertTrue("non-cloud requests reached the fake cloud: $strays", strays.isEmpty())
        }
    }

    private fun user(
        name: String,
        hosted: Boolean,
    ) = LiveUser(name, cloud, hosted).also { users += it }

    // ---- 1. founder ---------------------------------------------------------------------------

    @Test
    fun `a founder creates a workspace and #general, then sends, pages, edits, reacts, deletes and names themself`() =
        runBlocking {
            val alice = user("Alice", hosted = true)
            alice.signIn()
            val auth = alice.client.state.value
            assertTrue("signed in: $auth", auth.isAuthenticated)
            assertEquals(alice.accountHex, auth.account)
            assertEquals(cloud.relayUrl, auth.relayUrl)
            assertTrue("the relay session is minted (attested mock quote + device-key login): $auth", auth.sessionReady)

            val workspace = found(alice, "Live founder $run")
            val general = openGeneral(alice, workspace)

            // A second channel, created through the channels model as the "+" button does.
            val channels = alice.channels(workspace)
            var created: Channel? = null
            channels.create("random-$run", public = true) { created = it }.join()
            assertNull("create channel: ${channels.state.value}", channels.state.value.error)
            assertNotNull(created)
            channels.refresh().join()
            assertTrue(
                "both channels listed: ${channels.state.value.channels}",
                channels.state.value.channels
                    .map { it.name }
                    .containsAll(listOf(ChatRepository.GENERAL_CHANNEL, "random-$run")),
            )

            val model = alice.channel(general)
            model.start().join()
            assertNull("open #general: ${model.state.value}", model.state.value.error)
            assertTrue(
                "a new channel is empty: ${model.state.value.messages}",
                model.state.value.messages
                    .isEmpty(),
            )

            // Send three, read back through the relay's /query.
            for (i in 1..3) {
                model.send("hello $i").join()
                assertNull("send $i: ${model.state.value}", model.state.value.error)
            }
            val mine = waitFor(model, "the three messages") { s -> s.messages.takeIf { m -> m.map { it.message.text } == listOf("hello 1", "hello 2", "hello 3") } }
            assertTrue("all are mine: $mine", mine.all { it.mine && it.message.sender == alice.userId })
            assertEquals("named by get_profiles", "Alice", mine.first().author)
            assertFalse(model.state.value.hasOlder)

            // Paging, against the contract's real answers: the newest two, then by absolute position.
            val newest = alice.repo.newestMessages(general.contextId, limit = 2)
            assertEquals(3L, newest.totalCount)
            assertEquals(listOf("hello 2", "hello 3"), newest.messages.map { it.text })
            val first = alice.repo.messagesFrom(general.contextId, start = 0, limit = 1)
            assertEquals(listOf("hello 1"), first.messages.map { it.text })

            // Edit.
            val target = mine.first()
            model.edit(target.id, "hello 1 (edited)").join()
            assertNull("edit: ${model.state.value}", model.state.value.error)
            val edited = waitFor(model, "the edit") { s -> s.messages.firstOrNull { it.id == target.id }?.takeIf { it.message.text == "hello 1 (edited)" } }
            assertNotNull("edited_on is stamped", edited.message.editedOn)

            // React, then take it back.
            model.toggleReaction(target.id, "👍").join()
            assertNull("react: ${model.state.value}", model.state.value.error)
            val reacted = waitFor(model, "the reaction") { s -> s.messages.firstOrNull { it.id == target.id }?.takeIf { it.reactions.isNotEmpty() } }
            assertEquals(listOf("👍"), reacted.reactions.map { it.emoji })
            assertEquals(1, reacted.reactions.single().count)
            assertTrue(reacted.reactions.single().mine)
            model.toggleReaction(target.id, "👍").join()
            waitFor(model, "the reaction taken back") { s -> s.messages.firstOrNull { it.id == target.id }?.takeIf { it.reactions.isEmpty() } }

            // Delete: the sender blanks it in place.
            val doomed = mine.last()
            model.delete(doomed.id).join()
            assertNull("delete: ${model.state.value}", model.state.value.error)
            val deleted = waitFor(model, "the delete") { s -> s.messages.firstOrNull { it.id == doomed.id }?.takeIf { it.message.deleted == true } }
            assertTrue("a deleted message is blank: ${deleted.message}", deleted.message.text.isEmpty())

            // The profile name (set_profile), as the name dialog sets it.
            model.setProfileName("Alice").join()
            assertNull("set_profile: ${model.state.value}", model.state.value.error)
            assertEquals("Name registered in this channel.", model.state.value.notice)
            val profiles = alice.repo.profiles(general.contextId)
            assertTrue("profiles: $profiles", profiles.any { it.identity == alice.userId && it.username == "Alice" })

            // Unread: opening the channel marked it read.
            assertEquals(0, alice.repo.unreadCount(general.contextId))
            channels.refresh().join()
            assertEquals(
                0,
                channels.state.value
                    .find(general.contextId)
                    ?.unread,
            )
            model.stop()
        }

    // ---- 2. invite + join -----------------------------------------------------------------------

    @Test
    fun `an invitee joins from the founder's link by direct admission, reads, replies, and cannot edit the founder's message`() =
        runBlocking {
            val (alice, bob, workspace) = foundAndJoin("Live invite $run")
            val general = openGeneral(alice, workspace)
            val aliceModel = alice.channel(general)
            aliceModel.start().join()
            aliceModel.send("hi from Alice").join()
            assertNull(aliceModel.state.value.error)

            // Bob lists the workspace's channels. #general is open, so as a namespace member he can
            // already read and write it (listed as joined), with Alice's message unread.
            val bobChannels = bob.channels(workspace)
            val listed =
                eventually("#general in Bob's channel list with Alice's message unread", state = { bobChannels.state.value }) {
                    bobChannels.refresh().join()
                    bobChannels.state.value.channels
                        .firstOrNull { it.contextId == general.contextId && it.unread > 0 }
                }
            assertEquals(1, listed.unread)
            // Opening it registers his name there (ChannelsModel.open → ensureProfile).
            var opened: Channel? = null
            bobChannels.open(listed) { opened = it }.join()
            assertNull("join #general: ${bobChannels.state.value}", bobChannels.state.value.error)
            val bobGeneral = checkNotNull(opened)
            assertTrue(bobGeneral.joined)

            val bobModel = bob.channel(bobGeneral)
            bobModel.start().join()
            val seen =
                eventually("Alice's message on Bob's side", state = { bobModel.state.value }) {
                    bobModel.refresh().join()
                    bobModel.state.value.messages
                        .firstOrNull { it.message.text == "hi from Alice" }
                }
            assertFalse(seen.mine)
            assertEquals("Alice", seen.author)
            assertEquals(alice.userId, seen.message.sender)
            assertEquals("opening the channel marked it read", 0, bob.repo.unreadCount(bobGeneral.contextId))

            bobModel.send("hi from Bob").join()
            assertNull("Bob's send: ${bobModel.state.value}", bobModel.state.value.error)

            val reply =
                eventually("Bob's reply on Alice's side", state = { aliceModel.state.value }) {
                    aliceModel.refresh().join()
                    aliceModel.state.value.messages
                        .firstOrNull { it.message.text == "hi from Bob" }
                }
            assertFalse(reply.mine)
            assertEquals(bob.userId, reply.message.sender)
            assertEquals("Bob registered his name on opening #general", "Bob", reply.author)

            // Negative: Bob cannot edit Alice's message. The model refuses before signing anything…
            bobModel.edit(seen.id, "rewritten by Bob").join()
            assertEquals("Couldn't edit: You can only change your own messages.", bobModel.state.value.error)
            // …and the contract refuses the warrant even if one is sent; the relay's reason reaches the person.
            val refusal =
                try {
                    bob.repo.edit(bobGeneral.contextId, seen.id, "rewritten by Bob")
                    null
                } catch (e: Exception) {
                    e
                }
            assertNotNull("the contract accepted an edit of someone else's message", refusal)
            val text = describeChatError(refusal!!)
            assertTrue("the app's error text names the contract's reason: $text", text.contains("You can only edit your own messages"))
            aliceModel.refresh().join()
            assertEquals(
                "Alice's message is untouched",
                "hi from Alice",
                aliceModel.state.value.messages
                    .first { it.id == seen.id }
                    .message.text,
            )
            aliceModel.stop()
            bobModel.stop()
        }

    // ---- 3. live update -------------------------------------------------------------------------

    @Test
    fun `a message the invitee sends reaches the founder's open channel over the relay's event stream`() =
        runBlocking {
            val (alice, bob, workspace) = foundAndJoin("Live stream $run")
            val general = openGeneral(alice, workspace)

            // Polling an hour apart: within the timeout, only the stream can deliver.
            val aliceModel = alice.channel(general, pollIntervalMs = 3_600_000)
            aliceModel.start().join()
            waitFor(aliceModel, "the stream to be followed", timeoutMs = 10_000) { s -> s.live.takeIf { it != LiveMode.OFF } }
            assertEquals("the session has the relay's event stream", LiveMode.STREAM, aliceModel.state.value.live)

            val bobChannels = bob.channels(workspace)
            val listed =
                eventually("#general in Bob's channel list", state = { bobChannels.state.value }) {
                    bobChannels.refresh().join()
                    bobChannels.state.value.channels
                        .firstOrNull { it.contextId == general.contextId }
                }
            var opened: Channel? = null
            bobChannels.open(listed) { opened = it }.join()
            val bobModel = bob.channel(checkNotNull(opened) { "Bob could not join #general: ${bobChannels.state.value}" })
            bobModel.start().join()
            bobModel.send("live from Bob").join()
            assertNull("Bob's send: ${bobModel.state.value}", bobModel.state.value.error)

            val arrived = waitFor(aliceModel, "Bob's message pushed to Alice", timeoutMs = 30_000) { s -> s.messages.firstOrNull { it.message.text == "live from Bob" } }
            assertEquals(bob.userId, arrived.message.sender)
            assertEquals("still on the stream, not the polling fallback", LiveMode.STREAM, aliceModel.state.value.live)
            aliceModel.stop()
            bobModel.stop()
        }

    // ---- helpers --------------------------------------------------------------------------------

    /** Alice founds [name] through the workspaces model, as the "Create" button does. */
    private suspend fun found(
        alice: LiveUser,
        name: String,
    ): Workspace {
        alice.workspaces.create(name).join()
        val s = alice.workspaces.state.value
        assertNull("create workspace: $s", s.error)
        val workspace = s.workspaces.firstOrNull { it.name == name }
        assertNotNull("the new workspace is listed: $s", workspace)
        return workspace!!
    }

    /** The workspace's #general, as the founder's channel list shows it. */
    private suspend fun openGeneral(
        user: LiveUser,
        workspace: Workspace,
    ): Channel {
        val channels = user.channels(workspace)
        val general =
            eventually("#general listed", state = { channels.state.value }) {
                channels.refresh().join()
                channels.state.value.channels
                    .firstOrNull { it.name == ChatRepository.GENERAL_CHANNEL }
            }
        assertTrue("the founder is a member of #general: $general", general.joined)
        return general
    }

    private data class Pair3(
        val alice: LiveUser,
        val bob: LiveUser,
        val workspace: Workspace,
    )

    /**
     * Alice founds a workspace and mints an invitation link; Bob, a brand-new account no relay
     * serves yet, opens the link and accepts it — direct admission at the relay's `/admit`.
     */
    private suspend fun foundAndJoin(name: String): Pair3 {
        val alice = user("Alice", hosted = true)
        alice.signIn()
        val workspace = found(alice, name)

        alice.workspaces.invite(workspace).join()
        val link =
            alice.workspaces.state.value.invite
                ?.link
        assertNotNull("invitation: ${alice.workspaces.state.value}", link)

        val bob = user("Bob", hosted = false)
        bob.signIn()
        val before = bob.client.state.value
        assertTrue(before.isAuthenticated)
        assertNull("a new account has no relay until it joins: $before", before.relayUrl)

        assertTrue(bob.workspaces.offerInvite(link!!))
        assertEquals(
            workspace.id,
            bob.workspaces.state.value.pendingInvite
                ?.namespaceId,
        )
        bob.workspaces.acceptPendingInvite().join()
        val joined = bob.workspaces.state.value
        assertNull("join: $joined", joined.error)
        val after = bob.client.state.value
        assertEquals("the admitting relay became Bob's: $after", cloud.relayUrl, after.relayUrl)
        assertTrue("Bob's relay session is minted: $after", after.sessionReady)

        val listed =
            eventually("the workspace in Bob's list", state = { bob.workspaces.state.value }) {
                bob.workspaces.refresh().join()
                bob.workspaces.state.value.workspaces
                    .firstOrNull { it.id == workspace.id }
            }
        return Pair3(alice, bob, listed)
    }

    private suspend fun <T : Any> waitFor(
        model: ChannelModel,
        what: String,
        timeoutMs: Long = 30_000,
        probe: (ChannelState) -> T?,
    ): T = eventually(what, timeoutMs, state = { model.state.value }) { probe(model.state.value) }
}
