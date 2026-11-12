package network.calimero.battleships.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.serializer
import network.calimero.battleships.generated.BattleshipsClient
import java.util.Base64

// The Battleships component contract (`../logic/res/abi.json`). The calls are [BattleshipsClient],
// generated from it by core's `mero-app-build codegen` (`scripts/mobile-codegen.sh`), and so are the
// answer types but [ShotsView]; this file keeps the method lists of the web app's
// `src/battleships.ts`: camelCase method and argument names,
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

// The answer types are the generated client's ([BattleshipsClient], from the ABI), field names as
// the contract has them (`match_id`, `created_ms`, ...). [ShotsView] is the one the ABI still leaves
// `unknown`, so it is read from the generated client's JSON below.

typealias MatchStatus = BattleshipsClient.MatchStatus

typealias MatchSummary = BattleshipsClient.MatchSummary

typealias MatchRecord = BattleshipsClient.MatchRecord

typealias PlayerStatsView = BattleshipsClient.PlayerStatsView

/** Someone who opened the lobby. On 1.0 both fields are the account id. */
typealias PlayerEntry = BattleshipsClient.PlayerEntry

/**
 * The shot waiting for its defender's answer: `shot_id` is what `acknowledgeShot` takes, so an
 * answer meant for an earlier shot is refused; `target` is the player who has to answer.
 */
typealias PendingShotView = BattleshipsClient.PendingShotView

/**
 * The match as every reader derives it, in one read: `standing` is `playing`, `awaiting_reveal`,
 * `won` or `void`; `ended_by` is `sunk` or `impossible_misses`, null while playing.
 */
typealias MatchStateView = BattleshipsClient.MatchStateView

/** The caller's shots (`getShots`) or the shots at the caller (`getIncomingShots`), one [Cell] byte per square. */
@Serializable
data class ShotsView(
    val size: UInt,
    val shots: List<UByte>,
)

// ---- Reading the generated client's answers ---------------------------------------------------

/** The JSON the contract speaks. */
internal val contractJson = Json { ignoreUnknownKeys = true }

/**
 * This answer of the generated [BattleshipsClient] as the app type [T]. The ABI leaves `ShotsView`
 * `unknown` (its `shots` are bytes the logic does not describe yet), so the client answers its JSON
 * and [ShotsView] reads it.
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

/** The JSON between the app's types and the generated client's: every default written, unknown keys and missing options tolerated. */
val contractArgJson =
    Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
        explicitNulls = false
    }
