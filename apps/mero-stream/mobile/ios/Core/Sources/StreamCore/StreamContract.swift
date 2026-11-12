import Foundation
import MeroKit

/// A member of a room's call, as the contract's `getMembers` and `join` answer.
/// `memberId` is the member's **account** (64 hex); `joinedAt` and `updatedAt`
/// are unix seconds, sent as decimal strings (u64 on the wire).
public struct Member: Codable, Sendable, Equatable {
    public var memberId: String
    public var username: String
    public var joinedAt: UInt64
    public var updatedAt: UInt64

    public init(memberId: String, username: String, joinedAt: UInt64, updatedAt: UInt64) {
        self.memberId = memberId
        self.username = username
        self.joinedAt = joinedAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey { case memberId, username, joinedAt, updatedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        memberId = try c.decode(String.self, forKey: .memberId)
        username = try c.decodeIfPresent(String.self, forKey: .username) ?? ""
        joinedAt = try Self.u64(c, .joinedAt)
        updatedAt = try Self.u64(c, .updatedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(memberId, forKey: .memberId)
        try c.encode(username, forKey: .username)
        try c.encode(String(joinedAt), forKey: .joinedAt)
        try c.encode(String(updatedAt), forKey: .updatedAt)
    }

    /// A u64 field: a decimal string on the component runtime, a number from an older node.
    private static func u64(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) throws -> UInt64 {
        if let text = try? c.decode(String.self, forKey: key) {
            guard let value = UInt64(text) else {
                throw DecodingError.dataCorruptedError(forKey: key, in: c, debugDescription: "not a u64: \(text)")
            }
            return value
        }
        return try c.decodeIfPresent(UInt64.self, forKey: key) ?? 0
    }
}

/// The room contract (`../../logic`, `res/abi.json`) is `StreamClient`, generated from it into
/// `Generated/` by core's `mero-app-build codegen` (`scripts/mobile-codegen.sh`). The phone calls
/// only `join` and `getMembers`: the probe's in-WASM codec and chunk paths are measurement tools the
/// web keeps. Until the logic derives `AbiType`, the ABI names `Member` without its shape, so the
/// client answers its JSON and the type above reads it.
extension StreamClient {
    /// Every contract method the app calls, with its parameters in ABI order.
    /// `ContractSurfaceTests` pins it to the component ABI.
    public static let methods: [String: [String]] = [
        "join": ["username", "now"],
        "getMembers": [],
    ]

    /// The client for one room's call (app instance), through the signed-in backend.
    public init(backend: any MeroAppBackend, contextId: String) {
        self.init(backend: backend, app: contextId)
    }
}

extension Encodable {
    /// This answer as the app type `T` (`Member`).
    func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
    }
}
