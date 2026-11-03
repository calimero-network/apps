package network.calimero.battleships.core

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.LoginRequired
import com.calimero.mero.app.AppMember
import com.calimero.mero.app.AppNamespace
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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

val ME = "ab".repeat(32)
val RIVAL = "cd".repeat(32)
val RIVAL_ACCOUNT = "ce".repeat(32)

fun str(value: String) = JsonPrimitive(value)

fun obj(vararg pairs: Pair<String, JsonElement>) = JsonObject(mapOf(*pairs))

/** A `MatchSummary` as the contract answers it: u64s as decimal strings. */
fun summary(
    id: String,
    status: String = "Active",
) = obj(
    "match_id" to str(id),
    "player1" to str(ME),
    "player2" to str(RIVAL),
    "player2_account" to str(RIVAL),
    "status" to str(status),
    "winner" to JsonNull,
    "created_ms" to str("1700000000000"),
)

val RecordedContractCall.obj: JsonObject get() = args.jsonObject

class LobbyModelTest {
    @Test
    fun `creating a lobby founds an org and one instance of the package`() =
        runTest {
            val backend = InMemoryAppBackend()
            val model = LobbiesModel(backend, Battleships.PACKAGE_NAME)
            val lobby = model.create("  Harbour  ")
            assertEquals("Harbour", lobby.name)
            assertTrue("foundNamespace Harbour" in backend.log)
            assertTrue("createContext ${lobby.id} ${Battleships.PACKAGE_NAME} Harbour" in backend.log)
            assertEquals(1, backend.rootContexts[lobby.id]?.size)
            assertEquals(listOf(lobby.id), model.lobbies.value.map { it.id })
        }

    @Test
    fun `a lobby needs a name`() =
        runTest {
            val backend = InMemoryAppBackend()
            try {
                LobbiesModel(backend, null).create(" ")
            } catch (e: BattleshipsException) {
                assertEquals("Give the lobby a name.", ErrorText.describe(e))
            }
            assertTrue(backend.log.isEmpty())
        }

    @Test
    fun `loading reads the lobby instance with camelCase views`() =
        runTest {
            val backend = InMemoryAppBackend()
            val ns = AppNamespace("aa01", "Harbour", "app")
            backend.namespaces = listOf(ns)
            backend.rootContexts = mapOf("aa01" to listOf("lobby-app"))
            backend.groupMembers = mapOf("aa01" to listOf(AppMember(RIVAL, "Member", "Rafael")))
            backend.recording.handler = { call ->
                when (call.method) {
                    "registerPlayer" -> str(ME)
                    "getMatches" -> JsonArray(listOf(summary("m1")))
                    "getPlayers" ->
                        JsonArray(
                            listOf(
                                obj("account" to str(ME), "player" to str(ME)),
                                obj("account" to str(RIVAL), "player" to str(RIVAL)),
                            ),
                        )
                    "getPlayerStats" -> {
                        assertEquals(ME, call.obj["player"]?.jsonPrimitive?.content)
                        obj("wins" to str("2"), "losses" to str("1"), "games_played" to str("3"))
                    }
                    "getHistory" ->
                        JsonArray(
                            listOf(obj("match_id" to str("m0"), "winner" to str(ME), "loser" to str(RIVAL), "finished_ms" to str("1700000000001"))),
                        )
                    else -> JsonNull
                }
            }
            val model = LobbyModel(backend, ns, syncAttempts = 1, syncDelayMs = 0)
            model.load()
            assertEquals(LoadPhase.Loaded, model.phase.value)
            assertEquals("lobby-app", model.appId.value)
            val register = backend.recording.calls("registerPlayer").first()
            assertEquals("lobby-app", register.contextId)
            assertEquals(RecordedContractCall.Path.EXECUTE, register.path)
            assertEquals(
                RecordedContractCall.Path.QUERY,
                backend.recording
                    .calls("getMatches")
                    .first()
                    .path,
            )
            assertEquals(listOf(RIVAL), model.opponents().map { it.player })
            assertEquals(listOf("m1"), model.myMatches().map { it.matchId })
            assertEquals(1_700_000_000_000uL, model.myMatches().first().createdMs)
            assertEquals(PlayerStatsView(2uL, 1uL, 3uL), model.stats.value)
            assertEquals(
                1_700_000_000_001uL,
                model.history.value
                    .first()
                    .finishedMs,
            )
            assertEquals("names come from the org's member metadata", "Rafael", model.displayName(RIVAL))
            assertEquals(MatchRef("aa01", "lobby-app", "m1", RIVAL), model.ref(model.myMatches().first()))
        }

    @Test
    fun `challenging creates the match in the lobby instance`() =
        runTest {
            val backend = InMemoryAppBackend()
            val ns = AppNamespace("aa01", "Harbour", "app-id")
            backend.rootContexts = mapOf("aa01" to listOf("lobby-app"))
            backend.recording.handler = { call ->
                when (call.method) {
                    "registerPlayer" -> str(ME)
                    "createMatch" -> str("m9")
                    "getMatches" -> JsonArray(listOf(summary("m9", "Pending")))
                    else -> JsonNull
                }
            }
            val model = LobbyModel(backend, ns, syncAttempts = 1, syncDelayMs = 0)
            model.load()
            val ref = model.challenge(RIVAL)!!
            assertEquals(MatchRef("aa01", "lobby-app", "m9", RIVAL), ref)
            val created = backend.recording.calls("createMatch").first()
            assertEquals(obj("player2" to str(RIVAL)), created.args)
            assertEquals("lobby-app", created.contextId)
            assertTrue("no instance per match on 1.0", backend.log.none { it.startsWith("createContext") })
        }

    @Test
    fun `a challenge to no one is refused locally`() =
        runTest {
            val backend = InMemoryAppBackend()
            backend.rootContexts = mapOf("aa01" to listOf("lobby-app"))
            val model = LobbyModel(backend, AppNamespace("aa01", null, "a"), syncAttempts = 1, syncDelayMs = 0)
            model.load()
            assertNull(model.challenge("  "))
            assertEquals("That is not a valid player.", model.notice.value)
            assertTrue(backend.recording.calls("createMatch").isEmpty())
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
            "getMatchState" ->
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
            "getShots" -> grid(shots)
            "getIncomingShots" -> grid(incoming)
            "getCurrentTurn" -> turn?.let { str(it) } ?: JsonNull
            "commitBoard" -> {
                committed += ME
                JsonNull
            }
            "acknowledgeShot" -> {
                pending?.let { incoming[(it[2] as Int) * 10 + (it[1] as Int)] = if (call.obj["hit"]!!.jsonPrimitive.boolean) 2 else 3 }
                pending = null
                turn = ME
                str("ok")
            }
            "proposeShot" -> {
                val x = call.obj["x"]!!.jsonPrimitive.int
                val y = call.obj["y"]!!.jsonPrimitive.int
                shots[y * 10 + x] = 4
                pending = listOf(1, x, y, RIVAL)
                turn = RIVAL
                JsonNull
            }
            "revealBoard" -> {
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
    ): Pair<MatchModel, InMemoryAppBackend> {
        val backend = InMemoryAppBackend()
        backend.recording.handler = { game.handle(it) }
        val ref = MatchRef("aa01", "lobby-app", "m1", RIVAL)
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
                backend.recording
                    .calls("commitBoard")
                    .first()
            assertEquals(stored.commitment, commit.obj["commitment"]?.jsonPrimitive?.content)
            assertEquals(stored.commitment, Commitment.compute(stored.cells, stored.saltBytes))
            // Nothing but the commitment left the device: no call carries the salt or the cells.
            backend.recording.calls.forEach { call ->
                val text = call.args.toString()
                assertFalse(stored.salt in text)
                assertFalse("boardBytes" in text)
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
                backend.recording
                    .calls("commitBoard")
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
                backend.recording
                    .calls("acknowledgeShot")
                    .first()
            assertTrue(answer.obj["hit"]!!.jsonPrimitive.boolean)
            assertEquals(3, answer.obj["shotId"]!!.jsonPrimitive.int)
            assertEquals("m1", answer.obj["matchId"]!!.jsonPrimitive.content)
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
                backend.recording
                    .calls("proposeShot")
                    .isEmpty(),
            )
            model.tapTarget(Coordinate(4, 6))
            val shot =
                backend.recording
                    .calls("proposeShot")
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
                backend.recording
                    .calls("revealBoard")
                    .first()
            assertEquals("lobby-app", reveal.contextId)
            val salt = reveal.obj["salt"]!!.jsonPrimitive.content
            assertEquals("the salt goes as base64url", Vectors.aliceSalt, Base64Url.decode(salt))
            assertFalse("unpadded", "=" in salt)
            assertEquals(Commitment.boardBytes(Vectors.alice.cells), Base64Url.decode(reveal.obj["boardBytes"]!!.jsonPrimitive.content))
            assertEquals(MatchModel.Stage.Finished, model.stage.value)
            assertEquals(MatchModel.Outcome.AUDITING, model.outcome)
            game.standing = "won"
            game.winner = ME
            model.refresh()
            assertEquals(MatchModel.Outcome.WON, model.outcome)
            assertEquals(
                "revealed once", 1,
                backend.recording
                    .calls("revealBoard")
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
    fun `the token is the SDK's link shape`() {
        val invite = InMemoryAppBackend.invitation(ns)
        val token = LobbyInvitation(invite, "Harbour").token()
        val value = Json.parseToJsonElement(InviteCodec.decode(token)!!).jsonObject
        assertEquals(invite.token, value["invitation"]!!.jsonPrimitive.content)
        assertEquals("OrgInvitation reads the org here", ns, value["namespaceId"]!!.jsonPrimitive.content)
        assertEquals("Harbour", value["name"]!!.jsonPrimitive.content)
        assertEquals(
            ns,
            com.calimero.mero.app.OrgInvitation
                .decode(token)
                ?.namespaceId,
        )
        assertEquals("Harbour", value["__lobbyName"]!!.jsonPrimitive.content)
    }

    @Test
    fun `reads raw json and refuses other apps and pre-1_0 invitations`() {
        val json = """{"invitation":"inv_abc","namespaceId":"$ns"}"""
        assertEquals(ns, LobbyInvitation.parse(json)?.namespaceId)
        assertEquals("inv_abc", LobbyInvitation.parse(json)?.invitation?.token)
        val token = InviteCodec.encode(json)
        assertNull(LobbyInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=$token"))
        assertNotNull(LobbyInvitation.parse("calimero://com.calimero.battleships/join?invitation=$token"))
        assertNull(LobbyInvitation.parse("hello"))
        assertNull(
            "a 1.0 cluster cannot redeem a signed group invitation",
            LobbyInvitation.parse("""{"invitation":{"group_id":[1,2]},"inviter_signature":"ff"}"""),
        )
    }

    @Test
    fun `joining redeems the namespace`() =
        runTest {
            val backend = InMemoryAppBackend()
            val model = InvitationModel()
            assertTrue(model.open(LobbyInvitation(InMemoryAppBackend.invitation(ns), "Harbour").link()))
            assertEquals(InvitationModel.Stage.Confirm("Harbour"), model.stage.value)
            var joined = false
            model.accept({ backend }, { joined = true })
            assertTrue(joined)
            assertEquals(InvitationModel.Stage.Joined(ns, "Harbour"), model.stage.value)
            assertTrue(backend.log.any { it.startsWith("joinNamespace $ns") })
        }
}

class ErrorTextTest {
    private fun appError(
        code: String,
        message: String? = null,
    ) = AppError(
        "refused",
        obj("code" to str(code), "fields" to (message?.let { obj("message" to str(it)) } ?: obj())),
    )

    @Test
    fun `app errors in words`() {
        assertEquals("This match is already finished.", ErrorText.describe(appError("Finished")))
        assertTrue(ErrorText.isFinished(appError("Finished")))
        assertEquals("Not your turn.", ErrorText.describe(appError("Invalid", "not your turn")))
        assertTrue(ErrorText.isOpponentNotReady(appError("Invalid", "opponent must place ships first")))
        assertEquals("That board does not match the fleet you deployed.", ErrorText.describe(appError("CommitmentMismatch")))
    }

    @Test
    fun `every contract error has words`() {
        listOf("AlreadyCommitted", "CommitmentMismatch", "Finished", "Forbidden", "Invalid", "MatchIdCollision", "NotFound").forEach {
            assertNotNull(it, ErrorText.appErrors[it])
        }
    }

    @Test
    fun `transport errors are said plainly`() {
        assertEquals("You're offline. Check your connection and try again.", ErrorText.describe(java.net.UnknownHostException("node")))
        assertEquals("Your session ended. Sign in again.", ErrorText.describe(LoginRequired("expired")))
        assertEquals("You dismissed the passkey sheet, so nothing changed.", ErrorText.describe(ConfirmCancelled()))
    }
}
