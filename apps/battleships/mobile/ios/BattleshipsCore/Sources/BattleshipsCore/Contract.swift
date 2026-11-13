import Foundation
import MeroKit

// The Battleships component contract (`../logic/res/abi.json`). The calls are `BattleshipsClient`,
// generated from it into `Generated/` by core's `mero-app-build codegen`
// (`scripts/mobile-codegen.sh`), and so are the answer types; this file keeps the
// method lists of the web app's `src/battleships.ts`: camelCase method and argument names, snake_case result fields, 64-bit
// integers as decimal strings, bytes as base64url, refusals as `422 APP_ERROR {code, fields}`.
// (Kotlin `Contract.kt`.)

/// The contract's methods by their ABI names: a call goes through the app's log, a view is
/// answered by a node without writing. `ContractTests` checks both lists against the ABI.
public enum BattleshipsMethods {
    public static let calls = [
        "registerPlayer", "createMatch", "commitBoard", "proposeShot", "acknowledgeShot", "revealBoard",
    ]
    public static let views = [
        "getPlayers", "getMatches", "getPlayerStats", "getHistory", "getShots", "getIncomingShots",
        "getMatchState", "getActiveMatchId", "getCurrentTurn", "getWinner", "getCurrentUser",
    ]
}

// MARK: - Results

// The answer types are the generated client's (`Generated/BattleshipsClient.swift`, from the ABI),
// field names as the contract has them (`match_id`, `created_ms`, ...).

public typealias MatchStatus = BattleshipsClient.MatchStatus
public typealias MatchSummary = BattleshipsClient.MatchSummary
public typealias MatchRecord = BattleshipsClient.MatchRecord
public typealias PlayerStatsView = BattleshipsClient.PlayerStatsView
/// Someone who opened the lobby. On 1.0 both fields are the account id.
public typealias PlayerEntry = BattleshipsClient.PlayerEntry
/// The shot waiting for its defender's answer: `shot_id` is what `acknowledgeShot` takes, so an
/// answer meant for an earlier shot is refused; `target` is the player who has to answer.
public typealias PendingShotView = BattleshipsClient.PendingShotView
/// The match as every reader derives it, in one read: `standing` is `playing`,
/// `awaiting_reveal`, `won` or `void`; `ended_by` is `sunk` or `impossible_misses`, `nil` while
/// playing.
public typealias MatchStateView = BattleshipsClient.MatchStateView

/// The caller's shots (`getShots`) or the shots at the caller (`getIncomingShots`): one ``Cell``
/// byte per square, row-major, a JSON array of bytes, which the logic marks `#[abi(plain)]`.
public typealias ShotsView = BattleshipsClient.ShotsView

/// Bytes as the contract takes them: base64url, no padding.
public enum Base64URL {
    public static func encode(_ bytes: [UInt8]) -> String {
        Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ text: String) -> [UInt8]? {
        var base = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base.count % 4 != 0 { base += "=" }
        return Data(base64Encoded: base).map { [UInt8]($0) }
    }
}
