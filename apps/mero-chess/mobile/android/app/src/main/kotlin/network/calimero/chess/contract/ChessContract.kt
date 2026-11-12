package network.calimero.chess.contract

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.chess.generated.MeroChessClient

/**
 * The table's contract on Calimero 1.0, as `logic/res/abi.json` declares it. The calls are the
 * generated [MeroChessClient] (`scripts/mobile-codegen.sh`), and so are the answer types; this file
 * keeps the method lists and the refusal sentences of the web app's `src/chess.ts` (Swift
 * `ChessContract`):
 *
 * - method names are the ABI's camelCase ones (`offerDraw`, not v1's `offer_draw`);
 * - every `now` argument and every `u64` in an answer is a decimal string on the wire
 *   (`createdAt`, `moves[].at`, `startedAt`); the generated types read either a string or a number;
 * - answer fields are camelCase (`sideToMove`, `legalMoves`, `myTurn`, …);
 * - a refusal is `APP_ERROR {code, fields}` ([com.calimero.mero.AppError]), worded by [message].
 */
object ChessContract {
    /** The ABI's calls (writes, through the app's log). `ContractTest` checks them against the ABI. */
    val CALLS =
        listOf(
            "join",
            "heartbeat",
            "sit",
            "stand",
            "play",
            "resign",
            "offerDraw",
            "acceptDraw",
            "declineDraw",
            "claimDraw",
            "rematch",
        )

    /** The ABI's views (answered without writing). */
    val VIEWS = listOf("table", "history")

    /** v1's refusal sentences, by the error code that replaced each (the web app's `MESSAGES`). */
    val MESSAGES =
        mapOf(
            "UnknownSeat" to "a seat is either `white` or `black`",
            "SeatTaken" to "that seat is taken",
            "NotSeated" to "only a seated player can do that",
            "AlreadyPlayed" to "you have played at this table — resign instead",
            "GameOver" to "this game is over",
            "MoveLimit" to "this game has reached the move limit",
            "WaitingForOpponent" to "both seats must be taken before a move can be played",
            "NotYourMove" to "it is not your move",
            "BadMove" to "that is not a move in UCI notation",
            "IllegalMove" to "that move is not legal in this position",
            "NoDrawOffer" to "there is no draw offer to answer",
            "NoDrawToClaim" to "there is no draw to claim in this position",
            "GameNotFinished" to "finish this game first",
            "GameLimit" to "this table has played all the games it counts",
        )

    /** The sentence for a contract refusal, or null for a code the app does not know. */
    fun message(appCode: String): String? = MESSAGES[appCode]

    /** `init`'s arguments for a new table: both optional in the contract; `now` a decimal string. */
    fun initArgs(
        title: String,
        now: ULong,
    ): JsonObject =
        buildJsonObject {
            put("title", title)
            put("now", now.toString())
        }
}

// The answer types are the generated client's ([MeroChessClient], from the ABI): every `u64`
// (`createdAt`, `moves[].at`, `startedAt`) is a decimal string on the wire and a [ULong] here.

typealias SeatView = MeroChessClient.SeatView

typealias MoveView = MeroChessClient.MoveView

typealias PlayerView = MeroChessClient.PlayerView

typealias GameSummary = MeroChessClient.GameSummary

/**
 * Everything a client needs to draw the table, in one read: position, legal moves, status and
 * result all come from the same replay of the move list.
 */
typealias TableView = MeroChessClient.TableView
