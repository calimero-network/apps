import Foundation
import MeroKit

// The world contract's component ABI (`logic/res/abi.json`). The calls are `MerrariaClient`,
// generated from it into `Generated/` by core's `mero-app-build codegen`
// (`scripts/mobile-codegen.sh`); this file keeps the method lists `ContractTests` checks against the
// ABI, the paging of `getOverrides`, the world's types and the refusal sentences of the web app's
// `app/src/net/merraria.ts`. (Kotlin `network.calimero.merraria.contract.MerrariaContract`.)
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
    public func allOverrides() async throws -> [MerrariaCore.TileEntry] {
        var all: [MerrariaCore.TileEntry] = []
        var cursor: String?
        repeat {
            let page = try await getOverrides(cursor: cursor).decoded(as: MerrariaCore.OverridesPage.self)
            all += page.items
            cursor = page.next
        } while cursor != nil
        return all
    }
}

extension Encodable {
    /// This answer as the app type `T`. The ABI names the world's types (`WorldMeta`, `Edit`,
    /// `OverridesPage`, `Transform`, `PlayerView`) without their shape until the logic derives
    /// `AbiType`, so the generated client takes and answers their JSON and the types below read it.
    func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
    }

    /// This value as the generated client's type `T` (an argument), through its JSON.
    func converted<T: Decodable>() throws -> T {
        try MeroJSON.decode(T.self, from: MeroJSON.encode(self))
    }
}

/// The world's name, seed and day-clock anchor (seconds).
public struct WorldMeta: Codable, Sendable, Equatable {
    public var name: String
    public var seed: UInt32
    public var createdAt: UInt32

    public init(name: String, seed: UInt32, createdAt: UInt32) {
        self.name = name
        self.seed = seed
        self.createdAt = createdAt
    }
}

/// One tile edit: `t` is the tile id (0 = air, dug out).
public struct Edit: Codable, Sendable, Equatable {
    public var x: Int32
    public var y: Int32
    public var t: UInt32

    public init(x: Int32, y: Int32, t: UInt32) {
        self.x = x
        self.y = y
        self.t = t
    }
}

/// One override: `k` is `"x,y"`.
public struct TileEntry: Codable, Sendable, Equatable {
    public var k: String
    public var t: UInt32

    public init(k: String, t: UInt32) {
        self.k = k
        self.t = t
    }
}

/// One page of `getOverrides`: `next` is nil on the last page.
public struct OverridesPage: Codable, Sendable, Equatable {
    public var items: [TileEntry]
    public var next: String?

    public init(items: [TileEntry], next: String?) {
        self.items = items
        self.next = next
    }
}

/// Where an avatar is and what it does.
public struct Transform: Codable, Sendable, Equatable {
    public var name: String
    public var x: Double
    public var y: Double
    /// Facing: -1 or 1.
    public var dir: Double
    public var sel: UInt32
    public var action: String

    public init(name: String, x: Double, y: Double, dir: Double, sel: UInt32, action: String) {
        self.name = name
        self.x = x
        self.y = y
        self.dir = dir
        self.sel = sel
        self.action = action
    }
}

/// One avatar: `id` is its account.
public struct PlayerView: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var x: Double
    public var y: Double
    public var dir: Double
    public var sel: UInt32
    public var action: String
    public var online: Bool

    public init(id: String, name: String, x: Double, y: Double, dir: Double, sel: UInt32, action: String, online: Bool) {
        self.id = id
        self.name = name
        self.x = x
        self.y = y
        self.dir = dir
        self.sel = sel
        self.action = action
        self.online = online
    }
}

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
