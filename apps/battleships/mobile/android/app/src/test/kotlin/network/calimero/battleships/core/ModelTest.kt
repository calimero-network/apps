package network.calimero.battleships.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** [BattleshipsBackend] over the SDK's [InMemoryAppBackend], remembering the service each context runs. */
class FakeBattleshipsBackend(
    val memory: InMemoryAppBackend = InMemoryAppBackend(),
) : BattleshipsBackend {
    private val services = mutableMapOf<String, String>()
    val created = mutableListOf<Triple<String, String, JsonElement>>()

    override val app: MeroAppBackend get() = memory

    override suspend fun createServiceContext(
        groupId: String,
        applicationId: String,
        service: String,
        name: String,
        initArgs: JsonElement,
    ): String {
        val id = memory.createContext(groupId, applicationId, name, initArgs)
        services[id] = service
        created += Triple(service, groupId, initArgs)
        return id
    }

    override suspend fun serviceName(contextId: String): String? = services[contextId]

    fun setService(
        service: String,
        contextId: String,
    ) {
        services[contextId] = service
    }
}

val ME = "ab".repeat(32)
val RIVAL = "cd".repeat(32)
val RIVAL_ACCOUNT = "ce".repeat(32)

fun str(value: String) = JsonPrimitive(value)

fun obj(vararg pairs: Pair<String, JsonElement>) = JsonObject(mapOf(*pairs))

fun summary(
    id: String,
    contextId: String? = null,
) = obj(
    "match_id" to str(id),
    "player1" to str(ME),
    "player2" to str(RIVAL),
    "player2_account" to str(RIVAL_ACCOUNT),
    "status" to str("Active"),
    "context_id" to (contextId?.let { str(it) } ?: JsonNull),
    "winner" to JsonNull,
    "created_ms" to JsonPrimitive(1),
)

val RecordedContractCall.obj: JsonObject get() = args.jsonObject

class LobbyModelTest {
    @Test
    fun `creating a lobby founds it and starts the lobby service`() =
        runTest {
            val backend = FakeBattleshipsBackend()
            val model = LobbiesModel(backend, null)
            val lobby = model.create("  Harbour  ")
            assertEquals("Harbour", lobby.name)
            assertTrue("foundNamespace Harbour" in backend.memory.log)
            assertEquals(listOf("lobby"), backend.created.map { it.first })
            assertEquals(lobby.id, backend.created.first().second)
            assertEquals(listOf(lobby.id), model.lobbies.value.map { it.id })
        }

    @Test
    fun `a lobby needs a name`() =
        runTest {
            val backend = FakeBattleshipsBackend()
            try {
                LobbiesModel(backend, null).create(" ")
            } catch (e: BattleshipsException) {
                assertEquals("Give the lobby a name.", ErrorText.describe(e))
            }
            assertTrue(backend.memory.log.isEmpty())
        }

    @Test
    fun `the lobby context is found by its service not by being first`() =
        runTest {
            val backend = FakeBattleshipsBackend()
            val ns = AppNamespace("aa01", "Harbour", "app")
            backend.memory.namespaces = listOf(ns)
            backend.memory.rootContexts = mapOf("aa01" to listOf("game-ctx", "lobby-ctx"))
            backend.setService("game", "game-ctx")
            backend.setService("lobby", "lobby-ctx")
            backend.memory.recording.handler = { call ->
                when (call.method) {
                    "register_player" -> str(ME)
                    "get_matches" -> JsonArray(listOf(summary("m1", "game-ctx")))
                    "get_players" ->
                        JsonArray(
                            listOf(
                                obj("account" to str(ME), "player" to str(ME)),
                                obj("account" to str(RIVAL_ACCOUNT), "player" to str(RIVAL)),
                            ),
                        )
                    "get_player_stats" -> obj("wins" to JsonPrimitive(2), "losses" to JsonPrimitive(1), "games_played" to JsonPrimitive(3))
                    "get_history" -> JsonArray(emptyList())
                    else -> JsonNull
                }
            }
            val model = LobbyModel(backend, ns, syncAttempts = 1, syncDelayMs = 0)
            model.load()
            assertEquals(LoadPhase.Loaded, model.phase.value)
            assertEquals("lobby-ctx", model.lobbyContextId.value)
            assertTrue("joins the lobby when not a member", "joinContext lobby-ctx" in backend.memory.log)
            assertEquals(
                "lobby-ctx",
                backend.memory.recording
                    .calls("register_player")
                    .first()
                    .contextId,
            )
            assertEquals(listOf(RIVAL), model.opponents().map { it.player })
            assertEquals(listOf("m1"), model.myMatches().map { it.matchId })
            assertEquals(2uL, model.stats.value?.wins)
            assertEquals("game-ctx", model.ref(model.myMatches().first())?.contextId)
        }

    @Test
    fun `challenging creates the game context beside the lobby`() =
        runTest {
            val backend = FakeBattleshipsBackend()
            val ns = AppNamespace("aa01", "Harbour", "app-id")
            backend.memory.rootContexts = mapOf("aa01" to listOf("lobby-ctx"))
            backend.setService("lobby", "lobby-ctx")
            backend.memory.recording.handler = { call ->
                when (call.method) {
                    "register_player" -> str(ME)
                    "create_match" -> str("m9")
                    "get_matches" -> JsonArray(listOf(summary("m9")))
                    else -> JsonNull
                }
            }
            val model = LobbyModel(backend, ns, syncAttempts = 1, syncDelayMs = 0)
            model.load()
            val ref = model.challenge(RIVAL)!!
            assertEquals("m9", ref.matchId)
            assertEquals(listOf("game"), backend.created.map { it.first })
            assertEquals("the game sits in the lobby's group, for the xcall", "aa01", backend.created.first().second)
            assertEquals(
                obj(
                    "player1" to str(ME),
                    "player2" to str(RIVAL),
                    "player2_account" to str(RIVAL_ACCOUNT),
                    "lobby_context_id" to str("lobby-ctx"),
                    "match_id" to str("m9"),
                ),
                backend.created.first().third,
            )
            val recorded =
                backend.memory.recording
                    .calls("set_match_context_id")
                    .first()
            assertEquals(ref.contextId, recorded.obj["context_id"]?.jsonPrimitive?.content)
            assertEquals(
                RIVAL,
                backend.memory.recording
                    .calls("create_match")
                    .first()
                    .obj["player2"]
                    ?.jsonPrimitive
                    ?.content,
            )
        }

    @Test
    fun `a challenge to something that is not a key is refused locally`() =
        runTest {
            val backend = FakeBattleshipsBackend()
            backend.memory.rootContexts = mapOf("aa01" to listOf("lobby-ctx"))
            val model = LobbyModel(backend, AppNamespace("aa01", null, "a"), syncAttempts = 1, syncDelayMs = 0)
            model.load()
            assertNull(model.challenge("nope"))
            assertEquals("That is not a valid player key.", model.notice.value)
            assertTrue(
                backend.memory.recording
                    .calls("create_match")
                    .isEmpty(),
            )
        }
}

/** The game contract, played in memory: commitments, one pending shot, answers. */
class FakeGame {
    var committed = mutableListOf<String>()
    var pending: List<Any>? = null // id, x, y, target
    var standing = "playing"
    var revealed = mutableListOf<String>()
    var winner: String? = null
    val shots = MutableList(100) { 0 }
    val incoming = MutableList(100) { 0 }
    var turn: String? = ME

    private fun grid(values: List<Int>) = obj("size" to JsonPrimitive(10), "shots" to JsonArray(values.map { JsonPrimitive(it) }))

    @Synchronized
    fun handle(call: RecordedContractCall): JsonElement? =
        when (call.method) {
            "get_match_state" ->
                obj(
                    "standing" to str(standing),
                    "committed" to JsonArray(committed.map { str(it) }),
                    "pending_shot" to (
                        pending?.let {
                            obj(
                                "shot_id" to JsonPrimitive(it[0] as Int),
                                "x" to JsonPrimitive(it[1] as Int),
                                "y" to JsonPrimitive(it[2] as Int),
                                "target" to str(it[3] as String),
                            )
                        } ?: JsonNull
                    ),
                    "ended_by" to if (standing == "playing") JsonNull else str("sunk"),
                    "loser" to JsonNull,
                    "revealed" to JsonArray(revealed.map { str(it) }),
                    "audit_failed" to JsonArray(emptyList()),
                    "winner" to (winner?.let { str(it) } ?: JsonNull),
                )
            "get_shots" -> grid(shots)
            "get_incoming_shots" -> grid(incoming)
            "get_current_turn" -> turn?.let { str(it) } ?: JsonNull
            "commit_board" -> {
                committed += ME
                JsonNull
            }
            "acknowledge_shot" -> {
                pending?.let { incoming[(it[2] as Int) * 10 + (it[1] as Int)] = if (call.obj["hit"]!!.jsonPrimitive.boolean) 2 else 3 }
                pending = null
                turn = ME
                str("ok")
            }
            "propose_shot" -> {
                val x = call.obj["x"]!!.jsonPrimitive.int
                val y = call.obj["y"]!!.jsonPrimitive.int
                shots[y * 10 + x] = 4
                pending = listOf(1, x, y, RIVAL)
                turn = RIVAL
                JsonNull
            }
            "reveal_board" -> {
                revealed += ME
                JsonNull
            }
            else -> JsonNull
        }
}

class MatchModelTest {
    private fun model(
        game: FakeGame,
        store: InMemoryBoardStore = InMemoryBoardStore(),
    ): Pair<MatchModel, FakeBattleshipsBackend> {
        val backend = FakeBattleshipsBackend()
        backend.memory.members = setOf("game-ctx")
        backend.memory.recording.handler = { game.handle(it) }
        val ref = MatchRef("aa01", "lobby-ctx", "m1", "game-ctx", RIVAL)
        return MatchModel(ref, ME, backend, store) to backend
    }

    @Test
    fun `a new match starts with placement`() =
        runTest {
            val (model, _) = model(FakeGame())
            model.refresh()
            assertEquals(MatchModel.Stage.Placing, model.stage.value)
        }

    @Test
    fun `tap to place then tap to rotate`() {
        val (model, _) = model(FakeGame())
        assertEquals(0, model.selectedShip.value)
        assertTrue(model.tapPlacement(Coordinate(0, 0)))
        assertEquals(PlacedShip(5, Coordinate(0, 0), true), model.layout.value.ships[0])
        assertEquals("the next ship is up", 1, model.selectedShip.value)
        assertTrue(model.tapPlacement(Coordinate(2, 0)))
        assertFalse(
            model.layout.value.ships[0]!!
                .horizontal,
        )
        assertFalse("touching the carrier", model.tapPlacement(Coordinate(1, 1)))
        assertNotNull(model.notice.value)
    }

    @Test
    fun `deploy keeps the board first and sends only the commitment`() =
        runTest {
            val game = FakeGame()
            val store = InMemoryBoardStore()
            val (model, backend) = model(game, store)
            model.shuffle()
            assertTrue(model.deploy())
            val stored = store.load(ME, "m1")!!
            assertEquals(model.layout.value.cells, stored.cells)
            val commit =
                backend.memory.recording
                    .calls("commit_board")
                    .first()
            assertEquals(stored.commitment, commit.obj["commitment"]?.jsonPrimitive?.content)
            assertEquals(stored.commitment, Commitment.compute(stored.cells, stored.saltBytes))
            // Nothing but the commitment left the device: no call carries the salt or the cells.
            backend.memory.recording.calls.forEach { call ->
                val text = call.args.toString()
                assertFalse(stored.salt in text)
                assertFalse("board_bytes" in text)
            }
            assertEquals(MatchModel.Stage.Waiting, model.stage.value)
        }

    @Test
    fun `a board the store refuses is never committed`() =
        runTest {
            val store = InMemoryBoardStore().apply { refuses = true }
            val (model, backend) = model(FakeGame(), store)
            model.shuffle()
            assertFalse(model.deploy())
            assertTrue(
                backend.memory.recording
                    .calls("commit_board")
                    .isEmpty(),
            )
        }

    @Test
    fun `a shot at you is answered from your board`() =
        runTest {
            val game = FakeGame()
            val store = InMemoryBoardStore()
            store.save(StoredBoard.sealing(Vectors.alice, Vectors.aliceSalt), ME, "m1")
            game.committed = mutableListOf(ME, RIVAL)
            game.pending = listOf(3, 1, 0, ME) // B1: Alice's destroyer
            game.turn = RIVAL
            val (model, backend) = model(game, store)
            model.refresh()
            val answer =
                backend.memory.recording
                    .calls("acknowledge_shot")
                    .first()
            assertTrue(answer.obj["hit"]!!.jsonPrimitive.boolean)
            assertEquals(3, answer.obj["shot_id"]!!.jsonPrimitive.int)
            assertEquals(MatchModel.Stage.Battle, model.stage.value)
            assertEquals(Cell.HIT, model.ownBoard.value[1])
            assertTrue(model.isMyTurn)
        }

    @Test
    fun `aim then fire`() =
        runTest {
            val game = FakeGame()
            val store = InMemoryBoardStore()
            store.save(StoredBoard.sealing(Vectors.alice), ME, "m1")
            game.committed = mutableListOf(ME, RIVAL)
            val (model, backend) = model(game, store)
            model.refresh()
            model.tapTarget(Coordinate(4, 6))
            assertEquals(Coordinate(4, 6), model.aim.value)
            assertTrue(
                backend.memory.recording
                    .calls("propose_shot")
                    .isEmpty(),
            )
            model.tapTarget(Coordinate(4, 6))
            val shot =
                backend.memory.recording
                    .calls("propose_shot")
                    .first()
            assertEquals(4, shot.obj["x"]!!.jsonPrimitive.int)
            assertEquals(6, shot.obj["y"]!!.jsonPrimitive.int)
            assertNull(model.aim.value)
            assertFalse(model.isMyTurn)
        }

    @Test
    fun `the board is revealed when the match ends`() =
        runTest {
            val game = FakeGame()
            val store = InMemoryBoardStore()
            store.save(StoredBoard.sealing(Vectors.alice, Vectors.aliceSalt), ME, "m1")
            game.committed = mutableListOf(ME, RIVAL)
            game.standing = "awaiting_reveal"
            val (model, backend) = model(game, store)
            model.refresh()
            val reveal =
                backend.memory.recording
                    .calls("reveal_board")
                    .first()
            assertEquals(
                "the salt goes as 16 numbers, as the contract's [u8; 16] reads it",
                Vectors.aliceSalt,
                reveal.obj["salt"]!!.jsonArray.map { it.jsonPrimitive.int },
            )
            assertEquals(Commitment.boardBytes(Vectors.alice.cells), reveal.obj["board_bytes"]!!.jsonArray.map { it.jsonPrimitive.int })
            assertEquals(MatchModel.Stage.Finished, model.stage.value)
            assertEquals(MatchModel.Outcome.AUDITING, model.outcome)
            game.standing = "won"
            game.winner = ME
            model.refresh()
            assertEquals(MatchModel.Outcome.WON, model.outcome)
            assertEquals(
                "revealed once", 1,
                backend.memory.recording
                    .calls("reveal_board")
                    .size,
            )
        }

    @Test
    fun `a match deployed elsewhere says so`() =
        runTest {
            val game = FakeGame()
            game.committed = mutableListOf(ME)
            val (model, _) = model(game)
            model.refresh()
            assertEquals(MatchModel.Stage.BoardMissing, model.stage.value)
        }
}

class InvitationTest {
    private val ns = "1f".repeat(32)

    @Test
    fun `round trips through a link`() {
        val link = LobbyInvitation(InMemoryAppBackend.invitation(ns), "Harbour", ME).link()
        assertTrue(link.startsWith("https://links.calimero.network/com.calimero.battleships/join?invitation="))
        val parsed = LobbyInvitation.parse(link)!!
        assertEquals(ns, parsed.namespaceId)
        assertEquals("Harbour", parsed.lobbyName)
        assertEquals(ME, parsed.inviterKey)
    }

    @Test
    fun `the token is the shape the web reader takes`() {
        val token = LobbyInvitation(InMemoryAppBackend.invitation(ns), "Harbour").token()
        val value = Json.parseToJsonElement(InviteCodec.decode(token)!!).jsonObject
        val first = value["invitations"]!!.jsonArray.first().jsonObject
        assertEquals("readLobbyInvitation reads the namespace from here", ns, first["groupId"]!!.jsonPrimitive.content)
        assertNotNull(first["invitation"]!!.jsonObject["inviter_signature"])
        assertEquals("Harbour", value["__lobbyName"]!!.jsonPrimitive.content)
    }

    @Test
    fun `reads the single shape and refuses other apps`() {
        val json = InMemoryAppBackend.invitation(ns).raw.toString()
        assertEquals(ns, LobbyInvitation.parse(json)?.namespaceId)
        val token = InviteCodec.encode(json)
        assertNull(LobbyInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=$token"))
        assertNotNull(LobbyInvitation.parse("calimero://com.calimero.battleships/join?invitation=$token"))
        assertNull(LobbyInvitation.parse("hello"))
    }

    @Test
    fun `joining redeems the namespace`() =
        runTest {
            val backend = InMemoryAppBackend().apply { hasRelay = false }
            val model = InvitationModel()
            assertTrue(model.open(LobbyInvitation(InMemoryAppBackend.invitation(ns), "Harbour").link()))
            assertEquals(InvitationModel.Stage.Confirm("Harbour"), model.stage.value)
            var joined = false
            model.accept({ backend }, { joined = true })
            assertTrue(joined)
            assertEquals(InvitationModel.Stage.Joined(ns, "Harbour"), model.stage.value)
            assertTrue(backend.hasRelay)
        }
}

class ErrorTextTest {
    @Test
    fun `reads the contract error out of its bytes`() {
        val body = """{"kind":"Invalid","data":"not your turn"}""".toByteArray().joinToString(", ") { it.toString() }
        assertEquals("It is not your turn yet.", ErrorText.describe(IllegalStateException("rpc failed: [$body]")))
        assertTrue(ErrorText.isFinished(IllegalStateException("""{"kind":"Finished","data":""}""")))
    }

    @Test
    fun `offline is said plainly`() {
        assertEquals("You're offline. Check your connection and try again.", ErrorText.describe(java.net.UnknownHostException("relay")))
    }
}
