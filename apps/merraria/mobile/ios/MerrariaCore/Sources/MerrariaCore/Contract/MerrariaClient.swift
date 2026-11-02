import Foundation
import MeroKit

// The world contract's component ABI (`logic/res/abi.json`, `calimero:app@0.5.0`), typed by hand:
// no Swift client is generated from a component ABI yet. It mirrors the web app's
// `app/src/net/merraria.ts`, and `ContractTests` checks the method lists against the committed ABI.
// (Kotlin `network.calimero.merraria.contract.MerrariaClient`.)
//
// Wire format (component ABI):
// - method names are camelCase (`worldMeta`, `setTiles`, `getOverrides`, `getPlayers`);
// - `seed`, `createdAt` and every `now` are u32 seconds: plain JSON numbers;
// - `init()` takes nothing; the creator then calls `createWorld(name, seed, now)` once;
// - `getOverrides` answers one page (`{items, next}`), at most 1,000 entries;
// - a refusal is `422 APP_ERROR {code, fields}` (`NoWorld`, `WorldExists`, `WorldFull`,
//   `TooManyEdits`), an `AppError` (see `MerrariaRefusal`).

/// Typed calls to a world. Views go through `query` (`POST /apps/{app}/views`), calls through
/// `execute` (an intent).
public struct MerrariaClient: Sendable {
    /// The contract's calls (writes), by their ABI names.
    public static let calls = ["createWorld", "heartbeat", "join", "leave", "setTiles"]
    /// The contract's views (reads), by their ABI names.
    public static let views = ["getOverrides", "getPlayers", "worldMeta"]
    /// The most overrides one `getOverrides` answers (its default and largest `limit`).
    public static let overridesPage: UInt32 = 1000

    public let transport: any ContextContractCalling

    public init(transport: any ContextContractCalling) {
        self.transport = transport
    }

    /// Found the world: its name and seed. Only the instance's owner, once.
    public func createWorld(name: String, seed: UInt32, now: UInt32) async throws {
        _ = try await transport.execute(method: "createWorld", argsJSON: try encode(CreateWorldArgs(name: name, seed: seed, now: now)))
    }

    /// The world's name, seed and day-clock anchor.
    public func worldMeta() async throws -> WorldMeta {
        try decode(WorldMeta.self, try await transport.query(method: "worldMeta", argsJSON: Data("{}".utf8)))
    }

    /// Write tile edits; answers how many were applied.
    @discardableResult
    public func setTiles(edits: [Edit], now: UInt32) async throws -> UInt32 {
        try decode(UInt32.self, try await transport.execute(method: "setTiles", argsJSON: try encode(SetTilesArgs(edits: edits, now: now))))
    }

    /// One page of overrides, from `cursor` (nil for the first).
    public func getOverrides(cursor: String? = nil, limit: UInt32? = nil) async throws -> OverridesPage {
        let args = try encode(OverridesArgs(cursor: cursor, limit: limit))
        return try decode(OverridesPage.self, try await transport.query(method: "getOverrides", argsJSON: args))
    }

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

    /// Enter the world (or come back); answers this account's avatar.
    public func join(name: String, now: UInt32) async throws -> PlayerView {
        try decode(PlayerView.self, try await transport.execute(method: "join", argsJSON: try encode(JoinArgs(name: name, now: now))))
    }

    /// This account's avatar, moved.
    public func heartbeat(t: Transform, now: UInt32) async throws {
        _ = try await transport.execute(method: "heartbeat", argsJSON: try encode(HeartbeatArgs(t: t, now: now)))
    }

    /// Leave the world.
    public func leave(now: UInt32) async throws {
        _ = try await transport.execute(method: "leave", argsJSON: try encode(NowArgs(now: now)))
    }

    /// Everyone in the world, at most 1,000.
    public func getPlayers(now: UInt32) async throws -> [PlayerView] {
        try decode([PlayerView].self, try await transport.query(method: "getPlayers", argsJSON: try encode(NowArgs(now: now))))
    }

    private func encode<T: Encodable>(_ value: T) throws -> Data { try JSONEncoder().encode(value) }
    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T { try JSONDecoder().decode(type, from: data) }

    private struct NowArgs: Encodable { let now: UInt32 }
    private struct CreateWorldArgs: Encodable {
        let name: String
        let seed: UInt32
        let now: UInt32
    }
    private struct SetTilesArgs: Encodable {
        let edits: [Edit]
        let now: UInt32
    }
    private struct JoinArgs: Encodable {
        let name: String
        let now: UInt32
    }
    private struct HeartbeatArgs: Encodable {
        let t: Transform
        let now: UInt32
    }
    /// Absent keys, not nulls: the contract refuses unknown or malformed arguments.
    private struct OverridesArgs: Encodable {
        let cursor: String?
        let limit: UInt32?
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encodeIfPresent(cursor, forKey: .cursor)
            try c.encodeIfPresent(limit, forKey: .limit)
        }
        enum CodingKeys: String, CodingKey { case cursor, limit }
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
