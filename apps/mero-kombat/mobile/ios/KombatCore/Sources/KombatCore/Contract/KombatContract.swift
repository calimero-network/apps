import Foundation
import MeroKit

// The arena contract's component ABI (`logic/res/abi.json`). The calls are `KombatClient`, generated
// from it into `Generated/` by core's `mero-app-build codegen` (`scripts/mobile-codegen.sh`); this
// file keeps the method lists `ContractTests` checks against the ABI, `initArgs` and the refusal
// sentences of the web app's `app/src/kombat.ts`. (Kotlin
// `network.calimero.kombat.contract.KombatContract`.)
//
// Wire format (component ABI):
// - argument and result fields are camelCase (`matchIndex`, `mySeat`, `roundsWon`, …);
// - every `u64` travels as a decimal string (`now`, `createdAt`, `totalActions`, `hits[].at`,
//   `startedAt`); the generated types' fields are `UInt64`;
// - a refusal is `422 APP_ERROR {code, fields}`, an `AppError` (see `KombatRefusal`).

extension KombatClient {
    /// The contract's calls (writes), by their ABI names.
    public static let calls = ["act", "join", "pick", "rematch", "sit", "stand"]
    /// The contract's views (reads), by their ABI names.
    public static let views = ["arena", "history"]

    /// The `init` arguments a new arena instance is created with (`init(title?, now?)`).
    public static func initArgs(title: String, now: UInt64) -> JSONValue {
        .object(["title": .string(title), "now": .string(String(now))])
    }
}

// The answer types are the generated client's (`Generated/KombatClient.swift`, from the ABI).

/// Everything the arena draws, in one read (the contract's `ArenaView`).
public typealias ArenaView = KombatClient.ArenaView
/// One corner (the contract's `FighterView`).
public typealias FighterView = KombatClient.FighterView
/// One blow of the current round (the contract's `HitView`).
public typealias HitView = KombatClient.HitView
/// One match of the arena's record (the contract's `MatchSummary`).
public typealias MatchSummary = KombatClient.MatchSummary

/// The contract's refusals (`#[app::error]`), in the words the web app shows (`kombat.ts`
/// `MESSAGES`). (Kotlin `KombatRefusal`.)
public enum KombatRefusal {
    public static let messages: [String: String] = [
        "UnknownSeat": "A corner is either p1 or p2.",
        "UnknownFighter": "Unknown fighter.",
        "UnknownMove": "Unknown move.",
        "CornerTaken": "That corner is taken.",
        "InOtherCorner": "You are already in the other corner.",
        "NotInCorner": "Only a fighter in a corner can do that.",
        "AlreadyFought": "You have already fought here.",
        "WaitingForOpponent": "Waiting for an opponent.",
        "MatchOver": "This match is over.",
        "WrongMatch": "That match is not being fought.",
        "RoundOver": "That round is over.",
        "ActionLimit": "This round has reached its action limit.",
        "MatchNotFinished": "Finish this match first.",
        "MatchLimit": "This arena has fought all the matches it counts.",
    ]

    /// The sentence for an `APP_ERROR` code, or nil for a code the contract does not declare.
    public static func message(code: String) -> String? { messages[code] }
}
