package network.calimero.chess.app

import com.calimero.mero.app.AppContextEvent
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.chess.generated.MoveView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TableModelTest {
    private val contextId = "cc".repeat(32)
    private val namespaceId = "aa".repeat(32)
    private val backend = InMemoryAppBackend(account = Fixtures.me)
    private val script = TableScript(Fixtures.table()).also { it.install(backend.recording) }

    private fun TestScope.model(name: String = "Ana") = TableModel(backend, contextId, namespaceId, MemoryNameStore(name), backgroundScope)

    private fun args(method: String): JsonObject? =
        backend.recording
            .calls(method)
            .lastOrNull()
            ?.args as? JsonObject

    @Test
    fun `refresh reads the whole table in one call`() =
        runTest {
            val model = model()
            model.refresh()
            assertEquals(
                "Friday game",
                model.state.value.view
                    ?.title,
            )
            val reads = backend.recording.calls("table")
            assertEquals(1, reads.size)
            assertEquals(contextId, reads.first().contextId)
            assertEquals(RecordedContractCall.Path.QUERY, reads.first().path)
            assertTrue(model.state.value.interactive)
            assertFalse(model.state.value.flipped)
            assertEquals("the record is read once per game state", 1, backend.recording.calls("history").size)
            model.refresh()
            assertEquals(1, backend.recording.calls("history").size)
        }

    @Test
    fun `tap picks up then moves through the contract`() =
        runTest {
            val model = model()
            model.refresh()
            model.tap("e2")
            assertEquals("e2", model.state.value.selected)
            assertEquals(setOf("e3", "e4"), model.state.value.targets)
            assertEquals("e2e4", model.tap("e4"))
            val plays = backend.recording.calls("play")
            assertEquals(1, plays.size)
            assertEquals(RecordedContractCall.Path.EXECUTE, plays.first().path)
            assertEquals(JsonPrimitive("e2e4"), args("play")?.get("uci"))
            assertNull(model.state.value.selected)
            assertEquals(1, model.state.value.movesPlayed)
        }

    @Test
    fun `tapping an empty or foreign square selects nothing`() =
        runTest {
            val model = model()
            model.refresh()
            model.tap("e4")
            assertNull(model.state.value.selected)
            model.tap("e7")
            assertNull(model.state.value.selected)
            model.tap("g1")
            model.tap("g1")
            assertNull("tapping the selected piece puts it down", model.state.value.selected)
            model.tap("g1")
            model.tap("b1")
            assertEquals("another of your pieces is picked up instead", "b1", model.state.value.selected)
        }

    @Test
    fun `the board ignores taps when it is not your move`() =
        runTest {
            script.view = Fixtures.table(legal = emptyList(), myTurn = false, sideToMove = "black")
            val model = model()
            model.refresh()
            assertFalse(model.state.value.interactive)
            model.tap("e2")
            assertNull(model.state.value.selected)
            assertTrue(backend.recording.calls("play").isEmpty())
        }

    @Test
    fun `promotion asks for the piece`() =
        runTest {
            script.view = Fixtures.table(fen = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1", legal = listOf("e7e8q", "e7e8r", "e7e8b", "e7e8n", "e1d1"))
            val model = model()
            model.refresh()
            model.tap("e7")
            assertNull(model.tap("e8"))
            assertEquals(
                listOf('q', 'r', 'b', 'n'),
                model.state.value.promotion
                    ?.kinds,
            )
            assertEquals(
                PieceColor.WHITE,
                model.state.value.promotion
                    ?.color,
            )
            assertTrue(backend.recording.calls("play").isEmpty())
            model.promote('n')
            assertEquals(JsonPrimitive("e7e8n"), args("play")?.get("uci"))
            assertNull(model.state.value.promotion)
        }

    @Test
    fun `a refusal is shown as the contract wrote it`() =
        runTest {
            script.refuse("play", "it is not your move")
            val model = model()
            model.refresh()
            model.tap("e2")
            model.tap("e4")
            assertEquals("it is not your move", model.state.value.error)
            assertEquals(0, model.state.value.movesPlayed)
            assertFalse(model.state.value.busy)
            model.dismissError()
            assertNull(model.state.value.error)
        }

    @Test
    fun `sitting uses the stored name`() =
        runTest {
            script.view =
                Fixtures.table(
                    legal = emptyList(),
                    myColor = "",
                    myTurn = false,
                    status = "awaitingPlayers",
                    white = Fixtures.seat("white", "", ""),
                    black = Fixtures.seat("black", Fixtures.them, "Ben"),
                )
            val model = model(name = "  Ana  ")
            model.refresh()
            assertFalse(model.state.value.isSeated)
            model.sit(PieceColor.WHITE)
            assertEquals(JsonPrimitive("white"), args("sit")?.get("seat"))
            assertEquals(JsonPrimitive("Ana"), args("sit")?.get("name"))
            model.setName("")
            model.sit(PieceColor.WHITE)
            assertEquals(JsonPrimitive("Guest"), args("sit")?.get("name"))
        }

    @Test
    fun `draw offer states and actions`() =
        runTest {
            script.view = Fixtures.table(drawOfferFrom = Fixtures.them)
            val model = model()
            model.refresh()
            assertTrue(model.state.value.offerFromOpponent)
            assertFalse(model.state.value.myOfferStands)
            model.acceptDraw()
            model.declineDraw()
            model.offerDraw()
            model.claimDraw()
            model.resign()
            model.rematch()
            val methods =
                backend.recording.calls
                    .filter { it.path == RecordedContractCall.Path.EXECUTE }
                    .map { it.method }
            assertEquals(listOf("accept_draw", "decline_draw", "offer_draw", "claim_draw", "resign", "rematch"), methods)
        }

    @Test
    fun `black sees the board from blacks side but both chairs do not flip`() =
        runTest {
            script.view = Fixtures.table(myColor = "black", white = Fixtures.seat("white", Fixtures.them, "Ben"), black = Fixtures.seat("black", Fixtures.me, "Ana"))
            val black = model()
            black.refresh()
            assertTrue(black.state.value.flipped)

            script.view = Fixtures.table(myColor = "black", white = Fixtures.seat("white", Fixtures.me, "Ana"), black = Fixtures.seat("black", Fixtures.me, "Ana"))
            val both = model()
            both.refresh()
            assertFalse(both.state.value.flipped)
        }

    @Test
    fun `stand is offered only before the first move`() =
        runTest {
            val model = model()
            model.refresh()
            assertTrue(model.state.value.canStand(PieceColor.WHITE))
            assertFalse(model.state.value.canStand(PieceColor.BLACK))
            script.view = Fixtures.table(moves = listOf(MoveView(0u, "e2e4", "e4", Fixtures.me, 1u)))
            model.refresh()
            assertFalse(model.state.value.canStand(PieceColor.WHITE))
            assertEquals("e2" to "e4", model.state.value.lastMove)
        }

    @Test
    fun `an event triggers a read`() =
        runTest {
            val model = model()
            model.start()
            runCurrent()
            assertEquals("presence is announced on open", 1, backend.recording.calls("join").size)
            assertEquals(1, backend.subscriberCount)
            val before = backend.recording.calls("table").size
            backend.emit(AppContextEvent(contextId, "StateMutation"))
            runCurrent()
            assertTrue(backend.recording.calls("table").size > before)
        }

    @Test
    fun `invite link carries the table and its namespace`() =
        runTest {
            val link = model().inviteLink()
            assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-chess/join?invitation="))
            val parsed = ChessInvitation.parse(link)!!
            assertEquals(contextId, parsed.contextId)
            assertEquals(namespaceId, parsed.namespaceId)
            assertEquals("createInvitation $namespaceId", backend.log.last())
        }
}

class LobbyModelTest {
    private val club = "aa".repeat(32)

    @Test
    fun `load lists every table with its summary`() =
        runTest {
            val backend = InMemoryAppBackend(account = Fixtures.me)
            TableScript(Fixtures.table()).install(backend.recording)
            backend.namespaces = listOf(AppNamespace(club, "Friday club", backend.applicationId))
            backend.rootContexts = mapOf(club to listOf("c1", "c2"))
            val lobby = LobbyModel(backend, backend.applicationId)
            lobby.load()
            val state = lobby.state.value
            assertEquals(listOf("c1", "c2"), state.tables.map { it.id })
            assertEquals("Friday club", state.tables.first().clubName)
            assertEquals(
                "Friday game",
                state.tables
                    .first()
                    .summary
                    ?.title,
            )
            assertEquals(
                "Your move",
                state.tables
                    .first()
                    .summary
                    ?.state,
            )
            assertEquals(
                "Ana vs Ben",
                state.tables
                    .first()
                    .summary
                    ?.players,
            )
            assertTrue(state.loaded)
        }

    @Test
    fun `create founds a club and initialises the table`() =
        runTest {
            val backend = InMemoryAppBackend(account = Fixtures.me)
            val ref = LobbyModel(backend, backend.applicationId).create(" Sunday ", null)
            assertEquals("foundNamespace Sunday", backend.log.first())
            assertNotNull(ref.namespaceId)
            assertEquals("directly in the namespace", listOf(ref.contextId), backend.rootContexts[ref.namespaceId])
            val init = backend.initArgs[ref.contextId] as JsonObject
            assertEquals(JsonPrimitive("Sunday"), init["title"])
            assertNotNull(init["now"])
        }

    @Test
    fun `create in an existing club`() =
        runTest {
            val backend = InMemoryAppBackend(account = Fixtures.me)
            val ref = LobbyModel(backend, backend.applicationId).create("", club)
            assertFalse(backend.log.any { it.startsWith("foundNamespace") })
            assertEquals(club, ref.namespaceId)
            assertEquals(JsonPrimitive("Chess table"), (backend.initArgs[ref.contextId] as JsonObject)["title"])
        }

    @Test
    fun `create needs a relay`() =
        runTest {
            val backend = InMemoryAppBackend(account = Fixtures.me)
            backend.hasRelay = false
            try {
                LobbyModel(backend, backend.applicationId).create("x", null)
                fail("created without a relay")
            } catch (e: ChessException) {
                assertEquals(ChessException.Kind.NO_RELAY, e.kind)
            }
        }

    @Test
    fun `join redeems the invitation and opens its table`() =
        runTest {
            val backend = InMemoryAppBackend(account = Fixtures.me)
            backend.hasRelay = false
            val invitation = ChessInvitation(InMemoryAppBackend.invitation(club), club, "c9")
            val parsed = ChessInvitation.parse(invitation.link())!!
            var joined = false
            val ref = LobbyModel(backend, backend.applicationId).join(parsed) { joined = true }
            assertTrue(joined)
            assertEquals(TableRef("c9", club), ref)
            assertEquals(listOf("joinNamespace $club"), backend.log)
            assertTrue(backend.hasRelay)
        }

    @Test
    fun `another apps link is not a chess invitation`() {
        val link = ChessInvitation(InMemoryAppBackend.invitation(club), club, "c9").link()
        assertNull(ChessInvitation.parse(link.replace("com.calimero.mero-chess", "com.calimero.chat")))
        assertNull(ChessInvitation.parse("hello"))
        assertNotNull(ChessInvitation.parse(link))
    }
}
