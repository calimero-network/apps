import Foundation
import MeroKit

// The world contract's component ABI (`logic/res/abi.json`). The calls are `MerrariaClient`,
// generated from it into `Generated/` by core's `mero-app-build codegen`
// (`scripts/mobile-codegen.sh`); this file keeps the method lists `ContractTests` checks against the
// ABI, the paging of `getOverrides` and the refusal sentences of the web app's
// `app/src/net/merraria.ts`; the world's types are the generated ones. (Kotlin
// `network.calimero.merraria.contract.MerrariaContract`.)
//
// Wire format (component ABI):
// - method names are camelCase (`worldMeta`, `setTiles`, `getOverrides`, `getPlayers`);
// - `seed`, `createdAt` and every `now` are u32 seconds: plain JSON numbers;
// - `init()` takes nothing; the creator then calls `createWorld(name, seed, now)` once;
// - `getOverrides` answers one page (`{items, next}`), at most 1,000 entries;
// - a refusal is `422 APP_ERROR {code, fields}` (`NoWorld`, `WorldExists`, `WorldFull`,
//   `TooManyEdits`), an `AppError` (see `MerrariaRefusal`).

extension MerrariaClient {
    /// The contract's calls (writes), by their ABI names.
    public static let calls = ["createWorld", "heartbeat", "join", "leave", "setTiles"]
    /// The contract's views (reads), by their ABI names.
    public static let views = ["getOverrides", "getPlayers", "worldMeta"]
    /// The most overrides one `getOverrides` answers (its default and largest `limit`).
    public static let overridesPage: UInt32 = 1000

    /// Every override, page after page until `next` is nil (the web app's `readAllOverrides`).
    public func allOverrides() async throws -> [TileEntry] {
        var all: [TileEntry] = []
        var cursor: String?
        repeat {
            let page = try await getOverrides(cursor: cursor)
            all += page.items
            cursor = page.next
        } while cursor != nil
        return all
    }
}

// The world's types are the generated client's (`Generated/MerrariaClient.swift`, from the ABI).

/// The world's name, seed and day-clock anchor (seconds).
public typealias WorldMeta = MerrariaClient.WorldMeta
/// One tile edit: `t` is the tile id (0 = air, dug out).
public typealias Edit = MerrariaClient.Edit
/// One override: `k` is `"x,y"`.
public typealias TileEntry = MerrariaClient.TileEntry
/// One page of `getOverrides`: `next` is nil on the last page.
public typealias OverridesPage = MerrariaClient.OverridesPage
/// Where an avatar is and what it does (`dir`, facing: -1 or 1).
public typealias Transform = MerrariaClient.Transform
/// One avatar: `id` is its account.
public typealias PlayerView = MerrariaClient.PlayerView

/// The contract's refusals (`#[app::error]`) in words. (Kotlin `MerrariaRefusal`.)
public enum MerrariaRefusal {
    /// The sentence for an `APP_ERROR` code (with its `fields`), or nil for a code the contract does
    /// not declare.
    public static func message(code: String, fields: [String: JSONValue] = [:]) -> String? {
        let max = fields["max"].flatMap { value -> Int? in
            if case .number(let n) = value { return Int(n) }
            return nil
        }
        switch code {
        case "NoWorld": return "This world is still being created. Try again in a moment."
        case "WorldExists": return "This world was already created."
        case "WorldFull": return "This world is full\(max.map { " (\($0) players)" } ?? ""). Try another world."
        case "TooManyEdits": return "Too many tile changes at once\(max.map { " (at most \($0))" } ?? ""). Try again."
        default: return nil
        }
    }
}
