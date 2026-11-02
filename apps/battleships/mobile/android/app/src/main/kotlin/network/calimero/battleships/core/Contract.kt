package network.calimero.battleships.core

import com.calimero.mero.app.ContextContract
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.Base64

// The Battleships component contract (`../logic/res/abi.json`), typed by hand: no client is
// generated from a component ABI yet. The same surface as the web app's `src/battleships.ts`:
// camelCase method and argument names, snake_case result fields, 64-bit integers as decimal
// strings, bytes as base64url, refusals as `422 APP_ERROR {code, fields}`. (Swift `Contract.swift`.)

/** The contract's methods by their ABI names: calls go through the app's log, views do not write. */
object BattleshipsMethods {
    val calls = listOf("registerPlayer", "createMatch", "commitBoard", "proposeShot", "acknowledgeShot", "revealBoard")
    val views =
        listOf(
            "getPlayers", "getMatches", "getPlayerStats", "getHistory", "getShots", "getIncomingShots",
            "getMatchState", "getActiveMatchId", "getCurrentTurn", "getWinner", "getCurrentUser",
        )
}

// ---- Results ----------------------------------------------------------------------------------

/** A u64 the contract answers as a decimal string (a number from an older node is read too). */
object U64AsString : KSerializer<ULong> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("U64AsString", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): ULong {
        val element = (decoder as JsonDecoder).decodeJsonElement()
        return element.jsonPrimitive.content.toULong()
    }

    override fun serialize(
        encoder: Encoder,
        value: ULong,
    ) = encoder.encodeString(value.toString())
}

@Serializable
enum class MatchStatus {
    /** Until both fleets are committed. */
    @SerialName("Pending")
    Pending,

    @SerialName("Active")
    Active,

    /** Once the audited result is recorded. */
    @SerialName("Finished")
    Finished,
}

@Serializable
data class MatchSummary(
    @SerialName("match_id") val matchId: String,
    val player1: String,
    val player2: String,
    @SerialName("player2_account") val player2Account: String = player2,
    val status: MatchStatus,
    val winner: String? = null,
    @Serializable(with = U64AsString::class) @SerialName("created_ms") val createdMs: ULong,
)

@Serializable
data class MatchRecord(
    @SerialName("match_id") val matchId: String,
    val winner: String,
    val loser: String,
    @Serializable(with = U64AsString::class) @SerialName("finished_ms") val finishedMs: ULong,
)

@Serializable
data class PlayerStatsView(
    @Serializable(with = U64AsString::class) val wins: ULong,
    @Serializable(with = U64AsString::class) val losses: ULong,
    @Serializable(with = U64AsString::class) @SerialName("games_played") val gamesPlayed: ULong,
)

/** Someone who opened the lobby. On 1.0 both fields are the account id. */
@Serializable
data class PlayerEntry(
    val account: String,
    val player: String,
)

/** The caller's shots (`getShots`) or the shots at the caller (`getIncomingShots`), one [Cell] byte per square. */
@Serializable
data class ShotsView(
    val size: UInt,
    val shots: List<UByte>,
)

/** The shot waiting for its defender's answer. */
@Serializable
data class PendingShotView(
    /** What `acknowledgeShot` takes, so an answer meant for an earlier shot is refused. */
    @SerialName("shot_id") val shotId: UInt,
    val x: UInt,
    val y: UInt,
    /** The player who has to answer. */
    val target: String,
)

/** The match as every reader derives it, in one read. */
@Serializable
data class MatchStateView(
    /** `playing`, `awaiting_reveal`, `won` or `void`. */
    val standing: String,
    val committed: List<String>,
    @SerialName("pending_shot") val pendingShot: PendingShotView? = null,
    /** `sunk` or `impossible_misses`; null while playing. */
    @SerialName("ended_by") val endedBy: String? = null,
    val loser: String? = null,
    val revealed: List<String> = emptyList(),
    @SerialName("audit_failed") val auditFailed: List<String> = emptyList(),
    val winner: String? = null,
)

// ---- The client -------------------------------------------------------------------------------

/**
 * One lobby's contract: the app instance [appId], through the session's [ContextContract].
 * (Swift `BattleshipsContract`; the web app's `battleships(client, app)`.)
 */
class BattleshipsContract(
    val contract: ContextContract,
    val appId: String,
) {
    suspend fun registerPlayer(): String = call("registerPlayer").string()

    suspend fun createMatch(player2: String): String = call("createMatch", buildJsonObject { put("player2", player2) }).string()

    suspend fun commitBoard(
        matchId: String,
        commitment: String,
    ) {
        call(
            "commitBoard",
            buildJsonObject {
                put("matchId", matchId)
                put("commitment", commitment)
            },
        )
    }

    suspend fun proposeShot(
        matchId: String,
        x: Int,
        y: Int,
    ) {
        call(
            "proposeShot",
            buildJsonObject {
                put("matchId", matchId)
                put("x", x)
                put("y", y)
            },
        )
    }

    /** `"hit"` or `"miss"`. */
    suspend fun acknowledgeShot(
        matchId: String,
        shotId: UInt,
        hit: Boolean,
    ): String? =
        call(
            "acknowledgeShot",
            buildJsonObject {
                put("matchId", matchId)
                put("shotId", shotId.toLong())
                put("hit", hit)
            },
        ).stringOrNull()

    /** Open the board at the end: `cells` as borsh bytes and the 16-byte salt, both base64url. */
    suspend fun revealBoard(
        matchId: String,
        cells: List<Int>,
        salt: List<Int>,
    ) {
        call(
            "revealBoard",
            buildJsonObject {
                put("matchId", matchId)
                put("boardBytes", Base64Url.encode(Commitment.boardBytes(cells)))
                put("salt", Base64Url.encode(salt))
            },
        )
    }

    suspend fun getPlayers(): List<PlayerEntry> = view("getPlayers").decode()

    suspend fun getMatches(): List<MatchSummary> = view("getMatches").decode()

    suspend fun getPlayerStats(player: String): PlayerStatsView? = view("getPlayerStats", buildJsonObject { put("player", player) }).decode()

    suspend fun getHistory(): List<MatchRecord> = view("getHistory").decode()

    suspend fun getShots(matchId: String): ShotsView = view("getShots", match(matchId)).decode()

    suspend fun getIncomingShots(matchId: String): ShotsView = view("getIncomingShots", match(matchId)).decode()

    suspend fun getMatchState(matchId: String): MatchStateView = view("getMatchState", match(matchId)).decode()

    suspend fun getActiveMatchId(): String? = view("getActiveMatchId").stringOrNull()

    /** Whose turn it is, null once the match is over. */
    suspend fun getCurrentTurn(matchId: String): String? = view("getCurrentTurn", match(matchId)).stringOrNull()

    suspend fun getWinner(matchId: String): String? = view("getWinner", match(matchId)).stringOrNull()

    suspend fun getCurrentUser(): String = view("getCurrentUser").string()

    // ---- wire ----

    private fun match(matchId: String) = buildJsonObject { put("matchId", matchId) }

    private suspend fun call(
        method: String,
        args: JsonObject = JsonObject(emptyMap()),
    ): JsonElement = contract.execute(appId, method, args) ?: JsonNull

    private suspend fun view(
        method: String,
        args: JsonObject = JsonObject(emptyMap()),
    ): JsonElement = contract.query(appId, method, args) ?: JsonNull

    private inline fun <reified T> JsonElement.decode(): T = json.decodeFromJsonElement<T>(this)

    private fun JsonElement.stringOrNull(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    private fun JsonElement.string(): String = stringOrNull() ?: error("expected a string, got $this")

    companion object {
        val json = Json { ignoreUnknownKeys = true }
    }
}

/** Bytes as the contract takes them: base64url, no padding. */
object Base64Url {
    fun encode(bytes: List<Int>): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(bytes.size) { bytes[it].toByte() })

    fun decode(text: String): List<Int>? = runCatching { Base64.getUrlDecoder().decode(text).map { it.toInt() and 0xff } }.getOrNull()
}
