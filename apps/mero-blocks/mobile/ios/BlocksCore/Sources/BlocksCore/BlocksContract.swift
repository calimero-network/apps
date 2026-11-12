import Foundation
import MeroKit

// The world contract (`../../logic`, `res/abi.json`), as the component runtime speaks it:
// camelCase methods, u64 values (`now`, `seed`, `createdAt`) as decimal strings, and the growing
// reads (`getOverrides`, `getPlayers`) paged at 1,000 rows. The calls are `BlocksClient`, generated
// from the ABI into `Generated/` by core's `mero-app-build codegen` (`scripts/mobile-codegen.sh`);
// this file keeps the world's types and the paged reads. Same as the Kotlin `BlocksContract.kt`.

/// One block change: world coordinates and the block id (0 = air).
public struct Edit: Codable, Sendable, Equatable {
    public var x: Int32
    public var y: Int32
    public var z: Int32
    public var b: UInt8

    public init(x: Int32, y: Int32, z: Int32, b: UInt8) {
        self.x = x
        self.y = y
        self.z = z
        self.b = b
    }
}

/// A player's pose and name, as `heartbeat` sends it.
public struct Transform: Codable, Sendable, Equatable {
    public var name: String
    public var x: Double
    public var y: Double
    public var z: Double
    public var yaw: Double
    public var pitch: Double
    public var sel: UInt8

    public init(name: String, x: Double, y: Double, z: Double, yaw: Double, pitch: Double, sel: UInt8) {
        self.name = name
        self.x = x
        self.y = y
        self.z = z
        self.yaw = yaw
        self.pitch = pitch
        self.sel = sel
    }
}

/// One changed block: `k` is `"x,y,z"`.
public struct BlockEntry: Codable, Sendable, Equatable {
    public var k: String
    public var b: UInt8

    public init(k: String, b: UInt8) {
        self.k = k
        self.b = b
    }
}

/// A player as `getPlayers` and `join` answer. `id` is the account, or `"<account>/<device>"`.
public struct PlayerView: Codable, Sendable, Equatable {
    public var id: String
    public var account: String
    public var device: String
    public var name: String
    public var x: Double
    public var y: Double
    public var z: Double
    public var yaw: Double
    public var pitch: Double
    public var sel: UInt8
    public var online: Bool

    public init(
        id: String, account: String = "", device: String = "", name: String, x: Double, y: Double, z: Double,
        yaw: Double, pitch: Double, sel: UInt8, online: Bool
    ) {
        self.id = id
        self.account = account
        self.device = device
        self.name = name
        self.x = x
        self.y = y
        self.z = z
        self.yaw = yaw
        self.pitch = pitch
        self.sel = sel
        self.online = online
    }

    enum CodingKeys: String, CodingKey { case id, account, device, name, x, y, z, yaw, pitch, sel, online }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        account = try c.decodeIfPresent(String.self, forKey: .account) ?? ""
        device = try c.decodeIfPresent(String.self, forKey: .device) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        x = try c.decode(Double.self, forKey: .x)
        y = try c.decode(Double.self, forKey: .y)
        z = try c.decode(Double.self, forKey: .z)
        yaw = try c.decode(Double.self, forKey: .yaw)
        pitch = try c.decode(Double.self, forKey: .pitch)
        sel = try c.decode(UInt8.self, forKey: .sel)
        online = try c.decode(Bool.self, forKey: .online)
    }
}

/// The world's identity. On the wire `seed` and `createdAt` are decimal strings; this type encodes
/// them as numbers, the shape the game page reads.
public struct WorldMeta: Codable, Sendable, Equatable {
    public var name: String
    /// Terrain seed; clients generate identical terrain from it.
    public var seed: UInt64
    /// Unix seconds; the day/night cycle is counted from here.
    public var createdAt: UInt64

    public init(name: String, seed: UInt64, createdAt: UInt64) {
        self.name = name
        self.seed = seed
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey { case name, seed, createdAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        seed = try WireU64.decode(c, .seed)
        createdAt = try WireU64.decode(c, .createdAt)
    }
}

/// A u64 read off the wire: a decimal string on the component runtime, a number elsewhere.
enum WireU64 {
    static func decode<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) throws -> UInt64 {
        if let text = try? c.decode(String.self, forKey: key) {
            guard let value = UInt64(text) else {
                throw DecodingError.dataCorruptedError(forKey: key, in: c, debugDescription: "not a u64: \(text)")
            }
            return value
        }
        return try c.decodeIfPresent(UInt64.self, forKey: key) ?? 0
    }
}

/// One page of a paged view.
struct Page<Row: Decodable>: Decodable {
    let items: [Row]
    let next: String?
}

extension BlocksClient {
    /// Every method this app calls, with its parameters in ABI order. Tests pin it to the
    /// component ABI. `device` is left unset: one avatar per account (`PlayerView.id` = account).
    public static let methods: [String: [String]] = [
        "worldMeta": [], "getOverrides": ["cursor", "limit"], "getPlayers": ["now", "cursor", "limit"],
        "overrideCount": [], "join": ["name", "now", "device"], "heartbeat": ["t", "now", "device"],
        "leave": ["now", "device"], "setBlocks": ["edits", "now", "device"],
    ]
    /// Pages a read follows at most: 1,000 rows each, so ~1M rows (a world full of edits).
    public static let maxPages = 1_100

    /// Every changed block, following the pages.
    public func allOverrides() async throws -> [BlocksCore.BlockEntry] {
        try await Self.allPages("getOverrides") { cursor in
            try await getOverrides(cursor: cursor).decoded(as: Page<BlocksCore.BlockEntry>.self)
        }
    }

    /// Every player, online or not, following the pages. `now` is unix seconds.
    public func allPlayers(now: UInt64) async throws -> [BlocksCore.PlayerView] {
        try await Self.allPages("getPlayers") { cursor in
            try await getPlayers(now: now, cursor: cursor).decoded(as: Page<BlocksCore.PlayerView>.self)
        }
    }

    private static func allPages<Row: Decodable>(
        _ method: String, _ page: (String?) async throws -> Page<Row>
    ) async throws -> [Row] {
        var rows: [Row] = []
        var cursor: String?
        for _ in 0..<maxPages {
            let next = try await page(cursor)
            rows += next.items
            guard let more = next.next else { return rows }
            cursor = more
        }
        throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "\(method): more than \(maxPages) pages"))
    }
}

extension Encodable {
    /// This answer as the app type `T`. The ABI names the world's types (`WorldMeta`, `Edit`,
    /// `PlayerView`, `Transform`, the pages) without their shape until the logic derives `AbiType`,
    /// so the generated client takes and answers their JSON and the types above read it.
    func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
    }

    /// This value as the generated client's type `T` (an argument), through its JSON.
    func converted<T: Decodable>() throws -> T {
        try MeroJSON.decode(T.self, from: MeroJSON.encode(self))
    }
}
