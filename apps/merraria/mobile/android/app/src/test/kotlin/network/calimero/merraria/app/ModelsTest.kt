package network.calimero.merraria.app

import com.calimero.mero.app.AppContextEvent
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

class WorldsModelTest {
    @Test
    fun `create founds an organization the instance and creates the world`() =
        runTest {
            val backend = InMemoryAppBackend()
            val model = WorldsModel(backend, backend.applicationId)
            val ref = model.create("  Caves  ", 4242u)
            assertEquals("Caves", ref.name)
            assertNull(ref.groupId)
            assertEquals(
                listOf("foundNamespace Caves", "createContext ${ref.namespaceId} ${backend.applicationId} Caves"),
                backend.log,
            )
            // The component `init()` takes nothing; the creator founds the world with `createWorld`.
            assertEquals(JsonObject(emptyMap()), backend.initArgs[ref.contextId])
            val create = backend.recording.calls("createWorld").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, create.path)
            assertEquals(ref.contextId, create.contextId)
            val args = create.args as JsonObject
            assertEquals(JsonPrimitive("Caves"), args["name"])
            assertEquals("4242", (args["seed"] as JsonPrimitive).content)
            assertNotNull(args["now"])

            model.load()
            assertEquals(
                listOf(ref),
                model.state.value.worlds
                    .map { it.ref },
            )
        }

    @Test
    fun `an empty name is the web default`() =
        runTest {
            val backend = InMemoryAppBackend()
            assertEquals(MerrariaConstants.DEFAULT_WORLD_NAME, WorldsModel(backend, backend.applicationId).create("   ", 1u).name)
        }

    @Test
    fun `signed out lists nothing and refuses to create`() =
        runTest {
            val backend = InMemoryAppBackend().apply { hasRelay = false }
            val model = WorldsModel(backend, backend.applicationId)
            model.load()
            assertTrue(model.state.value.loaded)
            assertTrue(
                model.state.value.worlds
                    .isEmpty(),
            )
            try {
                model.create("x", 1u)
                fail("created while signed out")
            } catch (e: MerrariaException) {
                assertEquals(MerrariaException.Kind.SIGNED_OUT, e.kind)
            }
        }

    @Test
    fun `a load error is shown`() =
        runTest {
            val backend = InMemoryAppBackend().apply { failure = IOException("offline") }
            val model = WorldsModel(backend, backend.applicationId)
            model.load()
            assertEquals("Can't reach your cluster. Check your connection and try again.", model.state.value.error)
            model.dismissError()
            assertNull(model.state.value.error)
        }

    @Test
    fun `an invite link round-trips and join opens that world`() =
        runTest {
            val host = InMemoryAppBackend()
            val hostModel = WorldsModel(host, host.applicationId)
            val ref = hostModel.create("Caves", 1u)
            val link = hostModel.inviteLink(ref)
            assertTrue(link, link.startsWith("https://links.calimero.network/com.calimero.merraria/join?invitation="))

            val invitation = WorldInvitation.parse(link)!!
            assertEquals(ref.namespaceId, invitation.namespaceId)
            assertEquals(ref.contextId, invitation.contextId)
            assertEquals(ref.groupId, invitation.groupId)
            assertEquals("Caves", invitation.worldName)

            val guest = InMemoryAppBackend(account = "cd".repeat(32)).apply { hasRelay = false }
            var didJoin = false
            val joined = WorldsModel(guest, guest.applicationId).join(invitation) { didJoin = true }
            assertTrue(didJoin)
            assertEquals(ref, joined)
            assertEquals(listOf("joinNamespace ${ref.namespaceId}", "isMember ${ref.contextId}", "joinContext ${ref.contextId}"), guest.log)
        }

    @Test
    fun `an invitation without a world opens the organization's first`() =
        runTest {
            val backend = InMemoryAppBackend()
            val model = WorldsModel(backend, backend.applicationId)
            val ref = model.create("Caves", 1u)
            val bare = WorldInvitation(InMemoryAppBackend.invitation(ref.namespaceId), null)
            val joined = model.join(bare) {}
            assertEquals(ref.contextId, joined.contextId)
            assertNull(joined.groupId)
        }
}

class WorldInvitationTest {
    /** The 1.0 link payload: an `OrgInvitation` plus `groupId`; a pre-1.0 signed invitation is refused. */
    @Test
    fun `reads the org invitation payload`() {
        val namespaceId = "ab".repeat(32)
        val payload =
            JsonObject(
                mapOf(
                    "invitation" to JsonPrimitive("inv_abc"),
                    "namespaceId" to JsonPrimitive(namespaceId),
                    "name" to JsonPrimitive("surface"),
                    "contextId" to JsonPrimitive("ctx9"),
                    "groupId" to JsonPrimitive("grp9"),
                ),
            )
        val token = InviteCodec.encode(payload.toString())
        val parsed = WorldInvitation.parse("https://links.calimero.network/com.calimero.merraria/join?invitation=$token")!!
        assertEquals(namespaceId, parsed.namespaceId)
        assertEquals("inv_abc", parsed.invitation.token)
        assertEquals("surface", parsed.worldName)
        assertEquals("ctx9", parsed.contextId)
        assertEquals("grp9", parsed.groupId)
        assertNotNull(WorldInvitation.parse(token))
        val old = """{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"s"},"namespaceId":"aa","contextId":"cc"}"""
        assertNull(WorldInvitation.parseJson(old))
    }

    @Test
    fun `refuses another app's link and junk`() {
        val token = WorldInvitation(InMemoryAppBackend.invitation("ab".repeat(32)), null).token()
        assertNull(WorldInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=$token"))
        assertNull(WorldInvitation.parse("hello"))
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class GameModelTest {
    private val ref = WorldRef("ctx1", "ns1", "g1", "Caves")
    private val hud =
        """{"type":"hud","sel":0,"slots":[{"id":1,"name":"dirt","color":"#8a5a33","count":2},{"id":3,"name":"stone","color":"#7e8288","count":0}]}"""

    private fun TestScope.model(
        backend: InMemoryAppBackend = InMemoryAppBackend(),
        settings: PlayerSettings = MemoryPlayerSettings("Ada", 1.2),
    ): Pair<GameModel, MutableList<AppMessage>> {
        val sent = mutableListOf<AppMessage>()
        val game = GameModel(backend, ref, settings, backgroundScope)
        game.send = { sent += it }
        return game to sent
    }

    @Test
    fun `answers the config request`() =
        runTest {
            val (game, sent) = model()
            game.receive("""{"type":"request","id":1,"op":"config"}""")
            assertEquals(listOf(AppMessage.success(1, """{"contextId":"ctx1","name":"Ada","zoom":1.2}""")), sent)
        }

    @Test
    fun `runs contract requests and answers failures`() =
        runTest {
            val backend = InMemoryAppBackend()
            backend.recording.handler = { call ->
                if (call.method == "worldMeta") throw IOException("offline")
                kotlinx.serialization.json.Json
                    .parseToJsonElement("""{"items":[],"next":null}""")
            }
            val (game, sent) = model(backend)
            game.receive("""{"type":"request","id":2,"op":"query","method":"get_overrides","args":{}}""")
            game.receive("""{"type":"request","id":3,"op":"query","method":"world_meta","args":{}}""")
            runCurrent()
            assertTrue(sent.toString(), AppMessage.success(2, "[]") in sent)
            assertTrue(sent.toString(), AppMessage.failure(3, "Can't reach your cluster. Check your connection and try again.") in sent)
        }

    @Test
    fun `hud and status drive the screen`() =
        runTest {
            val (game, _) = model()
            assertEquals(GamePhase.Loading, game.state.value.phase)
            game.receive(hud.replace("\"sel\":0", "\"sel\":1"))
            assertEquals(GamePhase.Playing, game.state.value.phase)
            assertEquals(1, game.state.value.selected)
            assertEquals(2, game.state.value.slots.size)
            assertFalse(game.state.value.connected)
            game.receive("""{"type":"status","state":"connected"}""")
            assertTrue(game.state.value.connected)
            game.receive("""{"type":"fatal","message":"Could not reach the shared world"}""")
            assertEquals(GamePhase.Failed("Could not reach the shared world"), game.state.value.phase)
        }

    @Test
    fun `controls send input and pause lifts them`() =
        runTest {
            val (game, sent) = model()
            game.receive(hud)
            game.press(GameButton.RIGHT)
            game.press(GameButton.JUMP)
            game.release(GameButton.JUMP)
            game.tap(90.0, 30.0)
            game.select(1)
            game.pause()
            game.press(GameButton.LEFT) // ignored while paused
            assertEquals(
                listOf(
                    AppMessage.Input(GameInput(move = 1)),
                    AppMessage.Input(GameInput(move = 1, jump = true, jumpPressed = true)),
                    AppMessage.Input(GameInput(move = 1)),
                    AppMessage.Target(90.0, 30.0),
                    AppMessage.Select(1),
                    AppMessage.Input(GameInput.IDLE),
                    AppMessage.Pause,
                ),
                sent,
            )
            assertEquals(1, game.state.value.selected)
            assertTrue(game.state.value.paused)
            game.resume()
            assertFalse(game.state.value.paused)
        }

    @Test
    fun `zoom is clamped saved and sent`() =
        runTest {
            val settings = MemoryPlayerSettings()
            val (game, sent) = model(settings = settings)
            game.setZoom(3.0)
            assertEquals(1.6, settings.zoom, 0.0)
            assertEquals(listOf(AppMessage.Zoom(1.6)), sent)
        }

    @Test
    fun `leave waits for the page to save`() =
        runTest {
            val (game, sent) = model()
            val leaving = async { game.leave() }
            runCurrent()
            assertTrue(AppMessage.Leave in sent)
            game.receive("""{"type":"left"}""")
            leaving.await()
            assertEquals(GamePhase.Left, game.state.value.phase)
        }

    @Test
    fun `leave gives up on a silent page`() =
        runTest {
            val (game, _) = model()
            val leaving = async { game.leave(timeoutMs = 50) }
            advanceTimeBy(100)
            leaving.await()
            assertEquals(GamePhase.Left, game.state.value.phase)
        }

    @Test
    fun `start joins the world and forwards relay events`() =
        runTest {
            val backend = InMemoryAppBackend()
            val (game, sent) = model(backend)
            game.start()
            assertEquals(listOf("isMember ctx1", "joinContext ctx1"), backend.log)
            runCurrent()
            backend.emit(AppContextEvent("ctx1", "StateMutation"))
            runCurrent()
            assertEquals(listOf(AppMessage.Event("StateMutation")), sent)
            game.stop()
        }
}
