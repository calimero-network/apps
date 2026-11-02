package network.calimero.chess.contract

import com.calimero.mero.app.ContextContractCalling
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * The table's contract on Calimero 1.0, typed by hand from `logic/res/abi.json` (no client is
 * generated from a component ABI yet). The port of the web app's `src/chess.ts`; Swift
 * `ChessContract`:
 *
 * - method names are the ABI's camelCase ones (`offerDraw`, not v1's `offer_draw`);
 * - every `now` argument and every `u64` in an answer is a decimal string on the wire
 *   (`createdAt`, `moves[].at`, `startedAt`); [WireULong] reads either a string or a number;
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

/** Typed calls to one table's contract. Views go through `query`, everything else through `execute`. (Swift `MeroChessClient`.) */
@Suppress("TooManyFunctions")
class MeroChessClient(
    private val transport: ContextContractCalling,
) {
    // ---- views ----

    /** The whole table in one read. */
    suspend fun table(now: ULong): TableView = view("table", TableView.serializer(), mapOf("now" to JsonPrimitive(now.toString())))

    /** Every game this table has played, oldest first. */
    suspend fun history(): List<GameSummary> = view("history", ListSerializer(GameSummary.serializer()), emptyMap())

    // ---- calls ----

    suspend fun join(
        name: String,
        now: ULong,
    ) {
        execute("join", now, "name" to JsonPrimitive(name))
    }

    suspend fun heartbeat(now: ULong) {
        execute("heartbeat", now)
    }

    suspend fun sit(
        seat: String,
        name: String,
        now: ULong,
    ) {
        execute("sit", now, "seat" to JsonPrimitive(seat), "name" to JsonPrimitive(name))
    }

    suspend fun stand(now: ULong) {
        execute("stand", now)
    }

    /** Play a move in UCI (`e2e4`, `e7e8q`). Returns its SAN. */
    suspend fun play(
        uci: String,
        now: ULong,
    ): String = JSON.parseToJsonElement(execute("play", now, "uci" to JsonPrimitive(uci))).jsonPrimitive.content

    suspend fun resign(now: ULong) {
        execute("resign", now)
    }

    suspend fun offerDraw(now: ULong) {
        execute("offerDraw", now)
    }

    suspend fun acceptDraw(now: ULong) {
        execute("acceptDraw", now)
    }

    suspend fun declineDraw(now: ULong) {
        execute("declineDraw", now)
    }

    suspend fun claimDraw(now: ULong) {
        execute("claimDraw", now)
    }

    /** Start the next game (colours swap). Returns its index. */
    suspend fun rematch(now: ULong): UInt =
        JSON
            .parseToJsonElement(execute("rematch", now))
            .jsonPrimitive.content
            .toUInt()

    // ---- wire ----

    private suspend fun <T> view(
        method: String,
        serializer: KSerializer<T>,
        args: Map<String, JsonElement>,
    ): T = JSON.decodeFromString(serializer, transport.query(method, JsonObject(args).toString()))

    private suspend fun execute(
        method: String,
        now: ULong,
        vararg args: Pair<String, JsonElement>,
    ): String = transport.execute(method, JsonObject(mapOf(*args) + ("now" to JsonPrimitive(now.toString()))).toString())

    companion object {
        val JSON = Json { ignoreUnknownKeys = true }
    }
}

/** A `u64` off the wire: a decimal string (the component ABI), or a plain number. Written as a string. */
object WireULong : KSerializer<ULong> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("WireULong", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: ULong,
    ) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): ULong {
        val text =
            if (decoder is JsonDecoder) {
                decoder.decodeJsonElement().jsonPrimitive.content
            } else {
                decoder.decodeString()
            }
        return text.toULongOrNull() ?: throw IllegalArgumentException("not a u64: $text")
    }
}

@Serializable
data class SeatView(
    /** `white` or `black`: which chair this is, i.e. its colour in game 0. */
    val seat: String,
    /** The account holding it, or `""` when the chair is free. */
    val member: String,
    val name: String,
    val online: Boolean,
)

@Serializable
data class MoveView(
    val ply: UInt,
    val uci: String,
    val san: String,
    val by: String,
    @Serializable(with = WireULong::class) val at: ULong,
)

@Serializable
data class PlayerView(
    val id: String,
    val name: String,
    val online: Boolean,
    /** `white`, `black` or `""`: this player's colour in the current game. */
    val color: String,
)

@Serializable
data class GameSummary(
    val index: UInt,
    @Serializable(with = WireULong::class) val startedAt: ULong,
    val result: String,
    val reason: String,
    val plies: UInt,
    /** The accounts that held the chairs when the game ended. */
    val white: String,
    val black: String,
)

/**
 * Everything a client needs to draw the table, in one read: position, legal moves, status and
 * result all come from the same replay of the move list.
 */
@Serializable
data class TableView(
    val title: String,
    @Serializable(with = WireULong::class) val createdAt: ULong,
    /** Index of the game being played now. */
    val game: UInt,
    /** The position after every move played, as a FEN. */
    val fen: String,
    /** `white` or `black`. */
    val sideToMove: String,
    val moves: List<MoveView>,
    /** Every legal move in this position, in UCI, sorted (empty unless it is your move). */
    val legalMoves: List<String>,
    /** `awaitingPlayers`, `inProgress` or `finished`. */
    val status: String,
    /** `1-0`, `0-1`, `1/2-1/2`, or `*` while unfinished. */
    val result: String,
    /** Why it ended (`checkmate`, `resignation`, …), or `""`. */
    val reason: String,
    val check: Boolean,
    /** `threefold`, `fiftyMove` or `""`: a draw the side to move may claim. */
    val claimableDraw: String,
    val white: SeatView,
    val black: SeatView,
    /** The caller's account, as the contract sees it. */
    val me: String,
    /** The caller's colour in this game, or `""` for a spectator. */
    val myColor: String,
    val myTurn: Boolean,
    /** The account whose draw offer stands in this position, or `""`. */
    val drawOfferFrom: String,
    /** In join order. */
    val players: List<PlayerView>,
    /** How many games this table has started, including the current one. */
    val gamesPlayed: UInt,
)
