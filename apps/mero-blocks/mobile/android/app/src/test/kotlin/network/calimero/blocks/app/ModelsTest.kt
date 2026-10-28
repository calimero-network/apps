package network.calimero.blocks.app

import com.calimero.mero.app.AppContextEvent
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

object Fixtures {
    val me = "ab".repeat(32)
    val device = "de".repeat(32)

    /**
     * A token minted by the web app's own `encodeInvite` (app/src/net/inviteCodec.ts:
     * `bs58(deflateSync(JSON, { level: 9 }))`) for `{invitation, groupAlias: "Lime Valley",
     * contextId: "c"×64, groupId: "b"×64}`, around the SDKs' chat vector invitation (group id =
     * bytes 1…32). Same token as the Swift tests.
     */
    const val WEB_TOKEN =
        "7AFNTiMbuC1rQX6sQZrCxrz8XFBVKtQDKdMiR8LFqwvyQgcAA4XhtpgMvEfNRGNdS7wfvMbvXHUkin1Muc2rvHvWw5doEVRkA8kqvekckd8i44TAFRo2" +
            "nqu393v5Nvqibt9sAPcedipQwZ2U8xTfFZ5R3hnbRikgPQ7edPWzNAiw3fsy7ngpq1SM4JzhEctVt25vA6JtmiA85u34vQBgJd9Dkuie2K2MwAwSQx" +
            "NgiogEagrqbWuetiedN5u8iCdUfcsicugJi1irX9ZRoD7ZnDHyCCUMPsfjV6e5HhUEMik45vMjZ2B5iCrmVj1HvNUboqgDh6UL5VNZ3cmbFkHC9bGMgi"
    val webNamespace = (1..32).joinToString("") { "%02x".format(it) }

    fun meta() =
        buildJsonObject {
            put("name", "Lime Valley")
            put("seed", 1337)
            put("createdAt", 1_730_000_000)
        }

    fun player(
        id: String,
        online: Boolean,
    ) = buildJsonObject {
        put("id", id)
        put("name", id.uppercase())
        listOf("x", "y", "z", "yaw", "pitch", "sel").forEach { put(it, 0) }
        put("online", online)
    }
}

private fun obj(text: String?): JsonObject = Json.parseToJsonElement(text!!).jsonObject

class InvitationTest {
    @Test
    fun readsTheWebAppsLink() {
        val link = InviteLink.invitation(Fixtures.WEB_TOKEN, BlocksConstants.PACKAGE_NAME)
        assertTrue(link, link.startsWith("https://links.calimero.network/com.calimero.mero-blocks/join?invitation="))
        val invitation = BlocksInvitation.parse(link)!!
        assertEquals("Lime Valley", invitation.name)
        assertEquals("c".repeat(64), invitation.contextId)
        assertEquals("b".repeat(64), invitation.groupId)
        assertEquals(Fixtures.webNamespace, invitation.namespaceId)
        assertNotNull("a bare token", BlocksInvitation.parse(Fixtures.WEB_TOKEN))
        assertNotNull(BlocksInvitation.parse("calimero://com.calimero.mero-blocks/join?invitation=${Fixtures.WEB_TOKEN}"))
    }

    @Test
    fun refusesAnotherAppsLinkAndJunk() {
        assertNull(BlocksInvitation.parse(InviteLink.invitation(Fixtures.WEB_TOKEN, "com.calimero.chat")))
        assertNull(BlocksInvitation.parse("hello"))
        assertNull(BlocksInvitation.parse(""))
    }

    /** What the phone mints, the web app reads: `invitation` with a signature, `groupAlias`, and `contextId` / `groupId` strings. */
    @Test
    fun mintsTheWebAppsPayload() {
        val original = BlocksInvitation.parse(Fixtures.WEB_TOKEN)!!
        val minted = BlocksInvitation(original.invitation, "Ana's world", "ctx-1", "grp-1")
        val payload = obj(InviteCodec.decode(minted.token()))
        assertEquals("Ana's world", payload["groupAlias"]!!.jsonPrimitive.content)
        assertEquals("ctx-1", payload["contextId"]!!.jsonPrimitive.content)
        assertEquals("grp-1", payload["groupId"]!!.jsonPrimitive.content)
        val signed = payload["invitation"]!!.jsonObject
        assertNotNull(signed["inviter_signature"] ?: signed["inviterSignature"])
        assertNotNull(signed["invitation"]!!.jsonObject)

        val back = BlocksInvitation.parse(minted.link())!!
        assertEquals("Ana's world", back.name)
        assertEquals("ctx-1", back.contextId)
        assertEquals(Fixtures.webNamespace, back.namespaceId)
    }
}

class WorldsModelTest {
    private val backend = InMemoryAppBackend(account = Fixtures.me)

    private fun model() = WorldsModel(backend, backend.applicationId)

    @Test
    fun createsAWorldTheWayTheWebAppDoes() =
        runTest {
            val model = model()
            val ref = model.create("  Lime Valley  ", 4242uL)
            assertEquals("Lime Valley", ref.name)
            assertEquals("foundNamespace Lime Valley", backend.log.first())
            assertTrue(backend.log.toString(), backend.log.any { it.startsWith("createSubgroup ${ref.namespaceId} Lime Valley") })
            assertTrue(ref.groupId in backend.publicSubgroups)
            val args = backend.initArgs[ref.contextId]!!.jsonObject
            assertEquals("Lime Valley", args["name"]!!.jsonPrimitive.content)
            assertEquals(4242L, args["seed"]!!.jsonPrimitive.long)
            assertNotNull(args["now"])
            assertEquals(
                ref,
                model.state.value.worlds
                    .first()
                    .ref,
            )
        }

    @Test
    fun anEmptyNameAndSeedFallBackToTheDefaults() =
        runTest {
            val ref = model().create("   ", null)
            assertEquals("overworld", ref.name)
            val seed =
                backend.initArgs[ref.contextId]!!
                    .jsonObject["seed"]!!
                    .jsonPrimitive.long
            assertTrue(seed.toULong() in BlocksConstants.SEED_RANGE)
        }

    @Test
    fun saysWhenTheCloudWillNotHostTheWorld() =
        runTest {
            backend.haEnabled = false
            val model = model()
            model.create("Solo", 1uL)
            assertNotNull(model.state.value.notice)
        }

    @Test
    fun listsEveryWorldWithWhoIsPlaying() =
        runTest {
            backend.recording.handler = { call ->
                if (call.method == "get_players") JsonArray(listOf(Fixtures.player("a", true), Fixtures.player("b", false))) else JsonNull
            }
            val creator = model()
            val one = creator.create("One", 1uL)
            val two = creator.create("Two", 2uL)

            val model = model()
            model.load()
            val state = model.state.value
            assertNull(state.error)
            assertEquals(setOf(one, two), state.worlds.map { it.ref }.toSet())
            assertEquals(listOf(1, 1), state.worlds.map { it.online })
            assertEquals(
                RecordedContractCall.Path.QUERY,
                backend.recording
                    .calls("get_players")
                    .first()
                    .path,
            )
        }

    @Test
    fun withNoRelayThereIsNothingToList() =
        runTest {
            backend.hasRelay = false
            val model = model()
            model.load()
            assertTrue(model.state.value.loaded)
            assertTrue(
                model.state.value.worlds
                    .isEmpty(),
            )
            assertFalse(model.hasRelay)
            try {
                model.create("x", 1uL)
                fail("created with no relay")
            } catch (e: BlocksException) {
                assertEquals(BlocksException.Kind.NO_RELAY, e.kind)
            }
        }

    @Test
    fun aFailedReadIsShown() =
        runTest {
            backend.failure = IOException("offline")
            val model = model()
            model.load()
            assertNotNull(model.state.value.error)
            model.dismissError()
            assertNull(model.state.value.error)
        }

    @Test
    fun joinsFromTheWebAppsInvitation() =
        runTest {
            backend.hasRelay = false
            val invitation = BlocksInvitation.parse(Fixtures.WEB_TOKEN)!!
            var didJoin = false
            val ref = model().join(invitation) { didJoin = true }
            assertTrue(didJoin)
            assertEquals("c".repeat(64), ref.contextId)
            assertEquals(Fixtures.webNamespace, ref.namespaceId)
            assertEquals("Lime Valley", ref.name)
            assertEquals(listOf("joinNamespace ${Fixtures.webNamespace}"), backend.log)
            assertTrue("the admitting relay is the account's now", backend.hasRelay)
        }

    @Test
    fun invitesWithALinkForThatWorld() =
        runTest {
            val model = model()
            val ref = model.create("Lime Valley", 1uL)
            val back = BlocksInvitation.parse(model.inviteLink(ref))!!
            assertEquals(ref.contextId, back.contextId)
            assertEquals(ref.groupId, back.groupId)
            assertEquals("Lime Valley", back.name)
            assertEquals(ref.namespaceId, back.namespaceId)
        }

    @Test
    fun leavingAWorldLeavesItsNamespace() =
        runTest {
            val model = model()
            val ref = model.create("Gone", 1uL)
            model.leave(ref)
            assertTrue(
                model.state.value.worlds
                    .isEmpty(),
            )
            assertEquals("leaveNamespace ${ref.namespaceId}", backend.log.last())
        }
}

@OptIn(ExperimentalCoroutinesApi::class)
class GameModelTest {
    private val backend = InMemoryAppBackend(account = Fixtures.me)
    private val sent = mutableListOf<String>()
    private val world = WorldRef("cc".repeat(32), "aa".repeat(32), "bb".repeat(32), "Lime Valley")

    init {
        backend.recording.handler = { call -> if (call.method == "world_meta") Fixtures.meta() else JsonNull }
    }

    private fun kotlinx.coroutines.test.TestScope.model(
        name: String = "Ana",
        sensitivity: Double = 1.0,
    ): GameModel =
        GameModel(backend, world, Fixtures.device, name, sensitivity, backgroundScope).also { model ->
            model.outbox = { sent.add(it) }
        }

    @Test
    fun joinsAWorldItWasInvitedTo() =
        runTest {
            val model = model()
            model.prepare()
            assertEquals(GameModel.Phase.Loading, model.phase.value)
            assertEquals(listOf("isMember ${world.contextId}", "joinContext ${world.contextId}"), backend.log)
            model.prepare()
            assertEquals("a member does not join again", "isMember ${world.contextId}", backend.log.last())
        }

    @Test
    fun aFailedJoinIsShown() =
        runTest {
            backend.failure = IOException("timed out")
            val model = model()
            model.prepare()
            assertTrue(model.phase.value is GameModel.Phase.Failed)
        }

    @Test
    fun startsThePageWhenItIsReady() =
        runTest {
            val model = model(name = "   ", sensitivity = 9.0)
            model.setInsets(GameInsets(0.0, 47.0, 21.0, 47.0))
            assertTrue("nothing goes to a page that is not listening", sent.isEmpty())
            model.receive("""{"op":"ready"}""")
            val start = obj(sent.last())
            assertEquals("start", start["type"]!!.jsonPrimitive.content)
            assertEquals(world.contextId, start["contextId"]!!.jsonPrimitive.content)
            assertEquals(Fixtures.device, start["myId"]!!.jsonPrimitive.content)
            assertEquals("a blank name is the web app's default", "Player", start["name"]!!.jsonPrimitive.content)
            assertEquals("Lime Valley", start["worldName"]!!.jsonPrimitive.content)
            assertEquals("clamped", 3.0, start["sensitivity"]!!.jsonPrimitive.double, 0.0)
            assertEquals(47.0, start["insets"]!!.jsonObject["left"]!!.jsonPrimitive.double, 0.0)
            model.receive("""{"op":"loaded"}""")
            assertEquals(GameModel.Phase.Playing, model.phase.value)
            model.stop()
        }

    @Test
    fun answersTheGamesCallsThroughTheSession() =
        runTest {
            val model = model()
            model.receive("""{"id":1,"op":"query","method":"world_meta","args":{}}""")
            val answer = obj(sent.last())
            assertEquals(1, answer["id"]!!.jsonPrimitive.int)
            assertTrue(answer["ok"]!!.jsonPrimitive.boolean)
            assertEquals(1337, answer["result"]!!.jsonObject["seed"]!!.jsonPrimitive.int)
            val call = backend.recording.calls("world_meta").first()
            assertEquals(world.contextId, call.contextId)
            assertEquals(RecordedContractCall.Path.QUERY, call.path)

            model.receive("""{"id":2,"op":"execute","method":"init","args":{"name":"x","seed":1,"now":1}}""")
            val refused = obj(sent.last())
            assertEquals(2, refused["id"]!!.jsonPrimitive.int)
            assertFalse(refused["ok"]!!.jsonPrimitive.boolean)
            assertEquals("The game may not call init.", refused["error"]!!.jsonPrimitive.content)
            assertTrue(backend.recording.calls("init").isEmpty())
        }

    @Test
    fun aContractRefusalGoesBackToTheCall() =
        runTest {
            backend.recording.handler = { throw IOException("cannot connect") }
            val model = model()
            model.receive("""{"id":5,"op":"execute","method":"set_blocks","args":{"edits":[],"now":1}}""")
            val answer = obj(sent.last())
            assertEquals(5, answer["id"]!!.jsonPrimitive.int)
            assertFalse(answer["ok"]!!.jsonPrimitive.boolean)
            assertEquals("cannot connect", answer["error"]!!.jsonPrimitive.content)
        }

    @Test
    fun forwardsTheWorldsEventsUntilPausedOrStopped() =
        runTest(UnconfinedTestDispatcher()) {
            backend.canSubscribe = true
            val model = model()
            model.receive("""{"op":"ready"}""")
            sent.clear()
            backend.emit(AppContextEvent(world.contextId, "StateMutation"))
            assertEquals(1, sent.size)
            assertEquals("event", obj(sent.last())["type"]!!.jsonPrimitive.content)

            model.pause()
            assertEquals(BridgeCodec.PAUSE, sent.last())
            model.pause()
            assertEquals("paused once", 1, sent.count { it == BridgeCodec.PAUSE })
            backend.emit(AppContextEvent(world.contextId, "StateMutation"))
            assertEquals("no events while paused", BridgeCodec.PAUSE, sent.last())
            model.resume()
            assertEquals(BridgeCodec.RESUME, sent.last())
            model.stop()
        }

    @Test
    fun menuHapticsAndFatal() =
        runTest {
            val model = model()
            var menus = 0
            val haptics = mutableListOf<String>()
            model.onMenu = { menus += 1 }
            model.onHaptic = { haptics.add(it) }
            model.receive("""{"op":"menu"}""")
            model.receive("""{"op":"haptic","style":"light"}""")
            model.receive("garbage")
            assertEquals(1, menus)
            assertEquals(listOf("light"), haptics)
            model.receive("""{"op":"fatal","message":"Could not open this world (gone)."}""")
            assertEquals(GameModel.Phase.Failed("Could not open this world (gone)."), model.phase.value)
        }

    @Test
    fun invitesToThisWorld() =
        runTest {
            val back = BlocksInvitation.parse(model().inviteLink())!!
            assertEquals(world.contextId, back.contextId)
            assertEquals(world.groupId, back.groupId)
            assertEquals("Lime Valley", back.name)
            assertEquals(listOf("createInvitation ${world.namespaceId}"), backend.log)
        }

    @Test
    fun leavingTellsTheContract() =
        runTest {
            model().leave()
            assertEquals(
                RecordedContractCall.Path.EXECUTE,
                backend.recording
                    .calls("leave")
                    .first()
                    .path,
            )
        }
}

class SettingsTest {
    private class MapStore : SettingsStore {
        val values = mutableMapOf<String, Any>()

        override fun string(key: String) = values[key] as? String

        override fun double(key: String) = values[key] as? Double

        override fun put(
            key: String,
            value: String,
        ) {
            values[key] = value
        }

        override fun put(
            key: String,
            value: Double,
        ) {
            values[key] = value
        }
    }

    @Test
    fun keepsTheNameAndSensitivity() {
        val store = MapStore()
        val settings = PlayerSettings(store)
        assertEquals("Player", settings.name.value)
        assertEquals(1.0, settings.sensitivity.value, 0.0)
        settings.setName("  A name far longer than sixteen  ")
        settings.setSensitivity(2.5)
        val again = PlayerSettings(store)
        assertEquals(2.5, again.sensitivity.value, 0.0)
        assertEquals("A name far longe", again.playerName)
    }

    @Test
    fun textHelpers() {
        assertEquals(42uL, BlocksText.seed(" 42 "))
        assertNull(BlocksText.seed(""))
        assertNull(BlocksText.seed("0"))
        assertNull(BlocksText.seed("4294967296"))
        assertEquals("Nobody playing", BlocksText.online(0))
        assertEquals("3 playing", BlocksText.online(3))
        assertNull(BlocksText.online(null))
        assertEquals(24, BlocksText.worldName("x".repeat(40)).length)
    }
}
