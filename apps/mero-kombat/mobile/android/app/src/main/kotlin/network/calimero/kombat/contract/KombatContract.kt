package network.calimero.kombat.contract

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.kombat.generated.KombatClient

// The arena contract's component ABI (`logic/res/abi.json`). The calls are [KombatClient],
// generated from it by core's `mero-app-build codegen` (`scripts/mobile-codegen.sh`), and so are
// the answer types; this file keeps the method lists `ContractTest` checks against the
// ABI, `initArgs` and the refusal sentences of the web app's `app/src/kombat.ts`. (Swift
// `Contract/KombatContract.swift`.)
//
// Wire format (component ABI):
// - argument and result fields are camelCase (`matchIndex`, `mySeat`, `roundsWon`, …);
// - every `u64` travels as a decimal string (`now`, `createdAt`, `totalActions`, `hits[].at`,
//   `startedAt`); the generated types' fields are `ULong`;
// - a refusal is `422 APP_ERROR {code, fields}`, an `AppError` (see [KombatRefusal]).

/** What the app keeps of the contract beside the generated [KombatClient]. */
object KombatContract {
    /** The contract's calls (writes), by their ABI names. */
    val CALLS = listOf("act", "join", "pick", "rematch", "sit", "stand")

    /** The contract's views (reads), by their ABI names. */
    val VIEWS = listOf("arena", "history")

    /** The JSON the contract speaks. */
    val JSON = Json { ignoreUnknownKeys = true }

    /** The `init` arguments a new arena instance is created with (`init(title?, now?)`). */
    fun initArgs(
        title: String,
        now: ULong,
    ): JsonObject =
        buildJsonObject {
            put("title", title)
            put("now", now.toString())
        }
}

// The answer types are the generated client's ([KombatClient], from the ABI).

/** Everything the arena draws, in one read (the contract's `ArenaView`). */
typealias ArenaView = KombatClient.ArenaView

/** One corner (the contract's `FighterView`). */
typealias FighterView = KombatClient.FighterView

/** One blow of the current round (the contract's `HitView`). */
typealias HitView = KombatClient.HitView

/** One match of the arena's record (the contract's `MatchSummary`). */
typealias MatchSummary = KombatClient.MatchSummary

/** The contract's refusals (`#[app::error]`), in the words the web app shows (`kombat.ts` `MESSAGES`). (Swift `KombatRefusal`.) */
object KombatRefusal {
    val MESSAGES: Map<String, String> =
        mapOf(
            "UnknownSeat" to "A corner is either p1 or p2.",
            "UnknownFighter" to "Unknown fighter.",
            "UnknownMove" to "Unknown move.",
            "CornerTaken" to "That corner is taken.",
            "InOtherCorner" to "You are already in the other corner.",
            "NotInCorner" to "Only a fighter in a corner can do that.",
            "AlreadyFought" to "You have already fought here.",
            "WaitingForOpponent" to "Waiting for an opponent.",
            "MatchOver" to "This match is over.",
            "WrongMatch" to "That match is not being fought.",
            "RoundOver" to "That round is over.",
            "ActionLimit" to "This round has reached its action limit.",
            "MatchNotFinished" to "Finish this match first.",
            "MatchLimit" to "This arena has fought all the matches it counts.",
        )

    /** The sentence for an `APP_ERROR` code, or null for a code the contract does not declare. */
    fun message(code: String): String? = MESSAGES[code]
}
