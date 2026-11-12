package network.calimero.chess.app

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.WrongNode
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import network.calimero.chess.contract.ChessContract
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The typed client against the component contract's wire: camelCase methods and fields, `u64`s as decimal strings. (iOS `ContractTests`.) */
class ContractTest {
    private val abiCalls =
        setOf("acceptDraw", "claimDraw", "declineDraw", "heartbeat", "join", "offerDraw", "play", "rematch", "resign", "sit", "stand")
    private val abiViews = setOf("history", "table")

    /** The committed `logic/res/abi.json` when this checkout has the component port, else the lists above (calimero-network/apps#716). */
    private fun abi(): Pair<Set<String>, Set<String>> {
        val file = File("../../../logic/res/abi.json")
        val methods =
            runCatching { Json.parseToJsonElement(file.readText()).jsonObject["methods"]?.jsonObject }.getOrNull()
                ?: return abiCalls to abiViews
        if (methods.values.none { (it as? JsonObject)?.get("kind") != null }) return abiCalls to abiViews

        fun kind(k: String) = methods.filter { (it.value as JsonObject)["kind"]?.jsonPrimitive?.content == k }.keys
        return kind("call") to kind("view")
    }

    @Test
    fun `method lists match the abi`() {
        val (calls, views) = abi()
        assertEquals(calls, ChessContract.CALLS.toSet())
        assertEquals(views, ChessContract.VIEWS.toSet())
    }

    @Test
    fun `every error code has words`() {
        listOf(
            "AlreadyPlayed", "BadMove", "GameLimit", "GameNotFinished", "GameOver", "IllegalMove", "MoveLimit",
            "NoDrawOffer", "NoDrawToClaim", "NotSeated", "NotYourMove", "SeatTaken", "UnknownSeat", "WaitingForOpponent",
        ).forEach { assertNotNull(it, ChessContract.message(it)) }
    }

    @Test
    fun `calls send now as a decimal string under camel case names`() =
        runTest {
            val backend = InMemoryAppBackend(account = Fixtures.me)
            backend.recording.handler = { call ->
                when (call.method) {
                    "play" -> JsonPrimitive("e4")
                    "rematch" -> JsonPrimitive(2)
                    else -> JsonNull as JsonElement
                }
            }
            val client = chessClient(backend, "app1")
            assertEquals("e4", client.play("e2e4", 1_700_000_000_123uL))
            client.offerDraw(5uL)
            client.sit("white", "Ana", 6uL)
            assertEquals(2u, client.rematch(7uL))
            val play = backend.recording.calls("play").first()
            assertEquals(RecordedContractCall.Path.EXECUTE, play.path)
            assertEquals("app1", play.contextId)
            assertEquals(
                buildJsonObject {
                    put("uci", "e2e4")
                    put("now", "1700000000123")
                },
                play.args,
            )
            assertEquals(
                buildJsonObject { put("now", "5") },
                backend.recording
                    .calls("offerDraw")
                    .first()
                    .args,
            )
            assertEquals(
                buildJsonObject {
                    put("seat", "white")
                    put("name", "Ana")
                    put("now", "6")
                },
                backend.recording
                    .calls("sit")
                    .first()
                    .args,
            )
        }

    @Test
    fun `table decodes the component answer`() =
        runTest {
            val wire =
                """
                {"title":"Friday","createdAt":"1700000000000","game":0,"fen":"8/8/8/8/8/8/8/8 w - - 0 1",
                 "sideToMove":"white","moves":[{"ply":1,"uci":"e2e4","san":"e4","by":"acc1","at":"1700000000500"}],
                 "legalMoves":["e7e5"],"status":"inProgress","result":"*","reason":"","check":false,"claimableDraw":"",
                 "white":{"seat":"white","member":"acc1","name":"Ana","online":true},
                 "black":{"seat":"black","member":"acc2","name":"Ben","online":false},
                 "me":"acc2","myColor":"black","myTurn":true,"drawOfferFrom":"",
                 "players":[{"id":"acc1","name":"Ana","online":true,"color":"white"}],"gamesPlayed":1}
                """.trimIndent()
            val history =
                """[{"index":0,"startedAt":"1700000000000","result":"1-0","reason":"resignation","plies":12,"white":"acc1","black":"acc2"}]"""
            val backend = InMemoryAppBackend(account = Fixtures.me)
            backend.recording.handler = { call ->
                when (call.method) {
                    "table" -> Json.parseToJsonElement(wire)
                    "history" -> Json.parseToJsonElement(history) as JsonArray
                    else -> JsonNull as JsonElement
                }
            }
            val client = chessClient(backend, "app1")
            val view = client.table(9uL)
            assertEquals(
                RecordedContractCall.Path.QUERY,
                backend.recording
                    .calls("table")
                    .first()
                    .path,
            )
            assertEquals(
                buildJsonObject { put("now", "9") },
                backend.recording
                    .calls("table")
                    .first()
                    .args,
            )
            assertEquals(1_700_000_000_000uL, view.createdAt)
            assertEquals(1_700_000_000_500uL, view.moves.first().at)
            assertEquals(listOf("e7e5"), view.legalMoves)
            assertTrue(view.myTurn)
            assertEquals("black", view.myColor)
            val past = client.history()
            assertEquals(1_700_000_000_000uL, past.first().startedAt)
            assertEquals(12u, past.first().plies)
        }

    @Test
    fun `cluster errors and contract refusals in words`() {
        assertEquals("The passkey prompt was cancelled.", ChessText.error(ConfirmCancelled()))
        assertEquals("Your session ended. Sign in again.", ChessText.error(LoginRequired("expired")))
        assertTrue(ChessText.error(WrongNode("wrong")).contains("doesn't serve your account"))
        assertTrue(ChessText.error(ConsentStale("stale")).contains("out of date"))
        val refusal =
            AppError(
                "app refused",
                buildJsonObject {
                    put("code", "NotYourMove")
                    put("fields", JsonObject(emptyMap()))
                },
            )
        assertEquals("it is not your move", ChessText.error(refusal))
    }
}
