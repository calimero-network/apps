import Foundation
import MeroKit

// The world contract (`../../logic`, `res/abi.json`), as the component runtime speaks it:
// camelCase methods, u64 values (`now`, `seed`, `createdAt`) as decimal strings, and the growing
// reads (`getOverrides`, `getPlayers`) paged at 1,000 rows. Hand-written: no client is generated
// from a component ABI yet. Same types and calls as the Kotlin `BlocksClient`.

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

/// The world contract, bound to one world's app instance.
public struct BlocksClient: Sendable {
    /// Every method this client calls, with its parameters in ABI order. Tests pin it to the
    /// component ABI. `device` is left out: one avatar per account (`PlayerView.id` = account).
    public static let methods: [String: [String]] = [
        "worldMeta": [], "getOverrides": ["cursor", "limit"], "getPlayers": ["now", "cursor", "limit"],
        "overrideCount": [], "join": ["name", "now", "device"], "heartbeat": ["t", "now", "device"],
        "leave": ["now", "device"], "setBlocks": ["edits", "now", "device"],
    ]
    /// Pages a read follows at most: 1,000 rows each, so ~1M rows (a world full of edits).
    public static let maxPages = 1_100

    public let transport: any ContextContractCalling

    public init(transport: any ContextContractCalling) {
        self.transport = transport
    }

    public func worldMeta() async throws -> WorldMeta {
        try await view("worldMeta", [:])
    }

    /// Every changed block, following the pages.
    public func getOverrides() async throws -> [BlockEntry] {
        try await allPages("getOverrides", [:])
    }

    /// Every player, online or not, following the pages. `now` is unix seconds.
    public func getPlayers(now: UInt64) async throws -> [PlayerView] {
        try await allPages("getPlayers", ["now": .string(String(now))])
    }

    public func overrideCount() async throws -> UInt32 {
        try await view("overrideCount", [:])
    }

    @discardableResult
    public func join(name: String, now: UInt64) async throws -> PlayerView {
        try await call("join", ["name": .string(name), "now": .string(String(now))])
    }

    public func heartbeat(t: Transform, now: UInt64) async throws {
        let _: JSONValue? = try await call("heartbeat", ["t": try Self.value(t), "now": .string(String(now))])
    }

    public func leave(now: UInt64) async throws {
        let _: JSONValue? = try await call("leave", ["now": .string(String(now))])
    }

    /// How many of `edits` changed a block.
    @discardableResult
    public func setBlocks(edits: [Edit], now: UInt64) async throws -> UInt32 {
        try await call("setBlocks", ["edits": try Self.value(edits), "now": .string(String(now))])
    }

    // MARK: Wire

    private func view<T: Decodable>(_ method: String, _ args: [String: JSONValue]) async throws -> T {
        let data = try await transport.query(method: method, argsJSON: try JSONEncoder().encode(JSONValue.object(args)))
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func call<T: Decodable>(_ method: String, _ args: [String: JSONValue]) async throws -> T {
        let data = try await transport.execute(method: method, argsJSON: try JSONEncoder().encode(JSONValue.object(args)))
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func allPages<Row: Decodable>(_ method: String, _ args: [String: JSONValue]) async throws -> [Row] {
        var rows: [Row] = []
        var cursor: String?
        for _ in 0..<Self.maxPages {
            var a = args
            if let cursor { a["cursor"] = .string(cursor) }
            let page: Page<Row> = try await view(method, a)
            rows += page.items
            guard let next = page.next else { return rows }
            cursor = next
        }
        throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "\(method): more than \(Self.maxPages) pages"))
    }

    private static func value<T: Encodable>(_ value: T) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }
}
