package network.calimero.battleships.core

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
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import java.util.Base64

// The Battleships component contract (`../logic/res/abi.json`). The calls are
// [network.calimero.battleships.generated.BattleshipsClient], generated from it by core's
// `mero-app-build codegen` (`scripts/mobile-codegen.sh`); this file keeps the method lists and the
// answer types of the web app's `src/battleships.ts`: camelCase method and argument names,
// snake_case result fields, 64-bit integers as decimal strings, bytes as base64url, refusals as
// `422 APP_ERROR {code, fields}`. (Swift `Contract.swift`.)

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

// ---- Reading the generated client's answers ---------------------------------------------------

/** The JSON the contract speaks. */
internal val contractJson = Json { ignoreUnknownKeys = true }

/**
 * This answer of the generated [network.calimero.battleships.generated.BattleshipsClient] as the
 * app type [T]. The ABI names the contract's types (`MatchSummary`, `MatchStateView`, `ShotsView`,
 * ...) without their shape until the logic derives `AbiType`, so the client answers their JSON.
 */
internal inline fun <reified T> Any.toAppType(): T = contractJson.decodeFromJsonElement<T>(asContractJson())

/** Bytes as the generated client takes them (it writes base64url itself). */
internal fun List<Int>.toBytes(): ByteArray = ByteArray(size) { this[it].toByte() }

/** Bytes as the contract takes them: base64url, no padding. */
object Base64Url {
    fun encode(bytes: List<Int>): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(bytes.size) { bytes[it].toByte() })

    fun decode(text: String): List<Int>? = runCatching { Base64.getUrlDecoder().decode(text).map { it.toInt() and 0xff } }.getOrNull()
}

/** A value of the generated client (a typed record, or the JSON of a type the ABI does not describe) as its JSON. */
fun Any.asContractJson(): JsonElement = this as? JsonElement ?: contractArgJson.encodeToJsonElement(serializer(javaClass), this)

/** [this] (an app type) as the generated client's type [R] (an argument), through its JSON. */
inline fun <reified R> Any.asContractArg(): R = contractArgJson.decodeFromJsonElement(serializer<R>(), asContractJson())

/** The JSON between the app's types and the generated client's: every default written, unknown keys and missing options tolerated. */
val contractArgJson =
    Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
        explicitNulls = false
    }
