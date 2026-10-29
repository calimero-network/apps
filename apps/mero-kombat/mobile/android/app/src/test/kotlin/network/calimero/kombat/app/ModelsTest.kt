package network.calimero.kombat.app

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import network.calimero.kombat.generated.MatchSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ArenaModelTest {
    private val ref = ArenaRef("cc".repeat(32), "aa".repeat(32))
    private val backend = InMemoryAppBackend(account = Fixtures.me)
    private val script = ArenaScript(Fixtures.arena()).also { it.install(backend.recording) }
    private val presence = FakePresence()

    private fun model(store: PlayerStore = MemoryPlayerStore(name = "Ana", fighter = "cryo")) = ArenaModel(backend, ref, store, presence)

    private fun args(method: String): JsonObject? =
        backend.recording
            .calls(method)
            .lastOrNull()
            ?.args as? JsonObject

    @Test
    fun `a read boots the page in my seat and feeds it the arena`() =
        runTest {
            val model = model()
            val page = PageSpy().also { it.attach(model) }
            model.refresh()
            assertEquals(GameMode.NET, model.state.value.mode)
            assertEquals(0, model.state.value.local)
            assertEquals(listOf(BridgeOutbound.Boot(GameMode.NET, 0, listOf("cryo", "jinzo"), false)), page.boots)
            val wire = Json.parseToJsonElement(page.states.first()).jsonObject
            assertEquals("the page reads the ABI's field names", "p1", wire["my_seat"]?.jsonPrimitive?.content)
            assertEquals("0", wire["match_index"]?.jsonPrimitive?.content)
            assertEquals(
                RecordedContractCall.Path.QUERY,
                backend.recording
                    .calls("arena")
                    .first()
                    .path,
            )

            model.refresh()
            assertEquals("the same seat does not restart the fight", 1, page.boots.size)
            assertEquals(2, page.states.size)
        }

    @Test
    fun `a spectator watches`() =
        runTest {
            script.view = Fixtures.arena(mySeat = "")
            val model = model()
            val page = PageSpy().also { it.attach(model) }
            model.refresh()
            assertEquals(listOf(BridgeOutbound.Boot(GameMode.SPECTATE, null, listOf("cryo", "jinzo"), false)), page.boots)
        }

    @Test
    fun `ready reboots with the latest arena`() =
        runTest {
            val model = model()
            model.refresh()
            val page = PageSpy().also { it.attach(model) }
            model.receive(BridgeInbound.Ready)
            assertEquals(1, page.boots.size)
            assertEquals(1, page.states.size)
        }

    @Test
    fun `an act from the page is one transaction through the generated client`() =
        runTest {
            val model = model()
            val page = PageSpy().also { it.attach(model) }
            model.receive(
                BridgeInbound.Call(
                    9,
                    BridgeInbound.CallKind.EXECUTE,
                    "act",
                    """{"match_index":0,"round":1,"id":42,"kind":"uppercut","hit":true,"blocked":false,"now":1700000000000}""",
                ),
            )
            val call = backend.recording.calls("act").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            assertEquals(ref.contextId, call.contextId)
            assertEquals(JsonPrimitive("uppercut"), args("act")?.get("kind"))
            assertEquals("42", args("act")?.get("id")?.jsonPrimitive?.content)
            assertEquals("0", args("act")?.get("match_index")?.jsonPrimitive?.content)
            assertTrue(BridgeOutbound.Result(9, "null") in page.messages)
            assertEquals(1, model.state.value.meter.sent)
            assertEquals(1, model.state.value.meter.ok)
        }

    @Test
    fun `a refused act is answered as a failure`() =
        runTest {
            script.refuse("act", "round 1 is already decided")
            val model = model()
            val page = PageSpy().also { it.attach(model) }
            model.receive(
                BridgeInbound.Call(3, BridgeInbound.CallKind.EXECUTE, "act", """{"match_index":0,"round":1,"id":1,"kind":"kick","hit":false,"blocked":false}"""),
            )
            assertTrue(page.messages.any { it is BridgeOutbound.Failure && it.id == 3 && it.message.contains("round 1 is already decided") })
            assertEquals(1, model.state.value.meter.failed)
        }

    @Test
    fun `the page cannot call anything but the fight`() =
        runTest {
            val model = model()
            val page = PageSpy().also { it.attach(model) }
            model.receive(BridgeInbound.Call(1, BridgeInbound.CallKind.EXECUTE, "rematch", """{"now":1}"""))
            model.receive(BridgeInbound.Call(2, BridgeInbound.CallKind.QUERY, "act", "{}"))
            assertTrue(backend.recording.calls("rematch").isEmpty())
            assertTrue(backend.recording.calls("act").isEmpty())
            assertEquals(2, page.messages.filterIsInstance<BridgeOutbound.Failure>().size)
        }

    @Test
    fun `queries from the page go through the client`() =
        runTest {
            val model = model()
            val page = PageSpy().also { it.attach(model) }
            model.receive(BridgeInbound.Call(5, BridgeInbound.CallKind.QUERY, "history", "{}"))
            assertTrue(BridgeOutbound.Result(5, "[]") in page.messages)
        }

    @Test
    fun `slices go out through presence and come in to the page`() =
        runTest {
            val model = model()
            val page = PageSpy().also { it.attach(model) }
            model.receive(BridgeInbound.Presence("""{"seat":"p1","n":1}"""))
            assertEquals(listOf("""{"seat":"p1","n":1}"""), presence.published)

            model.onSlice("""{"seat":"p2","n":4}""")
            assertEquals(BridgeOutbound.Slice("""{"seat":"p2","n":4}"""), page.messages.last())
            assertEquals(setOf("p2"), model.state.value.live)
        }

    @Test
    fun `sitting sends the name and fighter`() =
        runTest {
            script.view = Fixtures.arena(status = "waiting", mySeat = "", p2 = Fixtures.corner("p2", "", "", ""))
            val model = model()
            model.refresh()
            model.sit("p2")
            assertEquals(JsonPrimitive("p2"), args("sit")?.get("seat"))
            assertEquals(JsonPrimitive("Ana"), args("sit")?.get("name"))
            assertEquals(JsonPrimitive("cryo"), args("sit")?.get("fighter"))
        }

    @Test
    fun `choosing a fighter picks only when seated`() =
        runTest {
            val store = MemoryPlayerStore(name = "Ana", fighter = "cryo")
            script.view = Fixtures.arena(mySeat = "")
            val model = model(store)
            model.refresh()
            model.choose("inferno")
            assertTrue(backend.recording.calls("pick").isEmpty())
            assertEquals("inferno", store.fighter)

            script.view = Fixtures.arena()
            model.refresh()
            model.choose("jinzo")
            assertEquals(JsonPrimitive("jinzo"), args("pick")?.get("fighter"))
        }

    @Test
    fun `leaving is offered only before the first blow`() =
        runTest {
            script.view = Fixtures.arena(status = "waiting", matchActions = 0u)
            val model = model()
            model.refresh()
            val view = model.state.value.view!!
            assertTrue(model.state.value.canLeave(view.p1))
            assertFalse("not my corner", model.state.value.canLeave(view.p2))
            script.view = Fixtures.arena(matchActions = 1u)
            model.refresh()
            assertFalse(
                model.state.value.canLeave(
                    model.state.value.view!!
                        .p1,
                ),
            )
        }

    @Test
    fun `the record is finished matches newest first`() =
        runTest {
            script.past =
                listOf(
                    MatchSummary(0u, 1u, "p1", true, listOf("p1", "p1"), 40u),
                    MatchSummary(1u, 2u, "p2", false, listOf("p2", "p1", "p2"), 61u),
                    MatchSummary(2u, 3u, "", false, emptyList(), 3u),
                )
            val model = model()
            model.refresh()
            assertEquals(
                listOf(1u, 0u),
                model.state.value.record
                    .map { it.index },
            )
        }

    @Test
    fun `announce joins once`() =
        runTest {
            val model = model()
            model.announce()
            model.announce()
            assertEquals(1, backend.recording.calls("join").size)
            assertEquals(JsonPrimitive("cryo"), args("join")?.get("fighter"))
        }

    @Test
    fun `invite link round trips`() =
        runTest {
            val link = model().inviteLink()
            assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-kombat/join?invitation="))
            val parsed = KombatInvitation.parse(link)
            assertNotNull(parsed)
            assertEquals(ref.contextId, parsed!!.contextId)
            assertEquals(ref.namespaceId, parsed.namespaceId)
        }
}

class PracticeModelTest {
    @Test
    fun `ready boots against the CPU and rematch restarts`() =
        runTest {
            val model = PracticeModel(MemoryPlayerStore(fighter = "kinetic"))
            val page = PageSpy().also { it.attach(model) }
            model.receive(BridgeInbound.Ready)
            assertEquals(listOf<BridgeOutbound>(BridgeOutbound.Boot(GameMode.CPU, 0, listOf("kinetic", "cryo"), false)), page.messages)
            model.receive(BridgeInbound.Over(true))
            assertTrue(model.state.value.over)
            model.rematch()
            assertFalse(model.state.value.over)
            assertEquals(BridgeOutbound.Restart, page.messages.last())
            model.choose("cryo")
            assertEquals(BridgeOutbound.Boot(GameMode.CPU, 0, listOf("cryo", "kinetic"), false), page.messages.last())
        }
}

class LobbyModelTest {
    @Test
    fun `creating an arena founds a namespace and initialises the contract`() =
        runTest {
            val backend = InMemoryAppBackend(account = Fixtures.me)
            ArenaScript(Fixtures.arena(status = "waiting", mySeat = "")).install(backend.recording)
            val lobby = LobbyModel(backend, backend.applicationId)
            lobby.load()
            assertTrue(lobby.state.value.loaded)
            val ref = lobby.create("  Friday night ", null)
            assertNotNull(ref.namespaceId)
            val init = backend.initArgs[ref.contextId] as JsonObject
            assertEquals(JsonPrimitive("Friday night"), init["title"])
            assertNotNull(init["now"])
            lobby.load()
            assertEquals(
                listOf(ref.contextId),
                lobby.state.value.arenas
                    .map { it.id },
            )
            assertEquals(
                "Waiting for fighters",
                lobby.state.value.arenas
                    .first()
                    .summary
                    ?.state,
            )
            assertEquals(
                "Ana vs Ben",
                lobby.state.value.arenas
                    .first()
                    .summary
                    ?.players,
            )
        }

    @Test
    fun `another app's link is not an invitation`() {
        assertNull(KombatInvitation.parse("https://links.calimero.network/com.calimero.mero-chess/join?invitation=abc"))
        assertNull(KombatInvitation.parse(""))
    }
}

class SlicePublisherTest {
    @Test
    fun `only the newest slice waits behind the one in flight`() =
        runTest {
            val channel = FakePresence(delayMillis = 50)
            val publisher = SlicePublisher(channel)
            val first = async { publisher.offer("1") }
            delay(10)
            publisher.offer("2")
            publisher.offer("3")
            publisher.offer("4")
            first.await()
            assertEquals(listOf("1", "4"), channel.published)
            assertEquals(2, publisher.dropped)
        }
}

/** The game page ships inside the APK: the asset the WebView loads exists, and needs nothing online. */
class GameAssetsTest {
    @Test
    fun `the bundled game page is complete and offline`() {
        val dir = File("src/main/assets/game")
        val page = File(dir, "index.html").readText()
        val script = File(dir, "game.js").readText()
        assertTrue("index.html loads the bundled script", page.contains("""<script src="game.js">"""))
        assertTrue("the engine is in the bundle", script.length > 10_000 && script.contains("meroBridge"))
        assertFalse("nothing from a CDN", Regex("https?://").containsMatchIn(page + script))
        assertEquals(GAME_PAGE_ASSET, "file:///android_asset/game/index.html")
    }

    private companion object {
        const val GAME_PAGE_ASSET = network.calimero.kombat.ui.GAME_PAGE
    }
}
