package network.calimero.chess.app

import com.calimero.mero.testkit.RecordingContextContract
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.chess.generated.MoveView
import network.calimero.chess.generated.SeatView
import network.calimero.chess.generated.TableView

object Fixtures {
    val me = "ab".repeat(32)
    val them = "cd".repeat(32)
    const val START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    val openingMoves =
        listOf(
            "a2a3", "a2a4", "b1a3", "b1c3", "b2b3", "b2b4", "c2c3", "c2c4", "d2d3", "d2d4", "e2e3", "e2e4",
            "f2f3", "f2f4", "g1f3", "g1h3", "g2g3", "g2g4", "h2h3", "h2h4",
        )

    fun seat(
        color: String,
        member: String,
        name: String,
    ) = SeatView(seat = color, member = member, name = name, online = true)

    /** A table where I hold White and it is my move at the start. */
    @Suppress("LongParameterList")
    fun table(
        fen: String = START,
        legal: List<String> = openingMoves,
        myColor: String = "white",
        myTurn: Boolean = true,
        status: String = "inProgress",
        result: String = "*",
        reason: String = "",
        moves: List<MoveView> = emptyList(),
        white: SeatView = seat("white", me, "Ana"),
        black: SeatView = seat("black", them, "Ben"),
        drawOfferFrom: String = "",
        check: Boolean = false,
        sideToMove: String = "white",
    ) = TableView(
        title = "Friday game",
        createdAt = 1u,
        game = 0u,
        fen = fen,
        sideToMove = sideToMove,
        moves = moves,
        legalMoves = legal,
        status = status,
        result = result,
        reason = reason,
        check = check,
        claimableDraw = "",
        white = white,
        black = black,
        me = me,
        myColor = myColor,
        myTurn = myTurn,
        drawOfferFrom = drawOfferFrom,
        players = emptyList(),
        gamesPlayed = 1u,
    )
}

/** A scriptable contract: answers `table` with [view], `history` with `[]`, and refuses what it is told to. */
class TableScript(
    @Volatile var view: TableView,
) {
    private val refusals = mutableMapOf<String, String>()

    fun refuse(
        method: String,
        message: String,
    ) {
        synchronized(refusals) { refusals[method] = message }
    }

    fun install(recording: RecordingContextContract) {
        recording.handler = { call ->
            synchronized(refusals) { refusals[call.method] }?.let { throw IllegalStateException(it) }
            when (call.method) {
                "table" -> Json.encodeToJsonElement(TableView.serializer(), view)
                "history" -> JsonArray(emptyList())
                "play" -> JsonPrimitive("e4")
                "rematch" -> JsonPrimitive(1)
                else -> JsonNull as JsonElement
            }
        }
    }
}
