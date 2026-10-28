import CryptoKit
import Foundation
import Security

/// The board's commit-reveal, byte for byte the web app's (`app/src/lib/board.ts`) and the
/// contract's (`compute_commitment` in `crates/game/src/lib.rs`):
///
///     commitment = hex(SHA256(borsh(Vec<u8> cells) || salt))
///
/// `borsh(Vec<u8>)` is a 4-byte little-endian length, then the bytes; the salt is 16 random bytes.
/// The cells and the salt never leave the device until `GameClient.reveal(matchId:cells:salt:)`
/// publishes them at the end. (Kotlin `Commitment`.)
public enum Commitment {
    public static let saltBytes = 16

    /// What `reveal_board` takes as `board_bytes`, and the hash's first part.
    public static func boardBytes(_ cells: [UInt8]) -> [UInt8] {
        let count = UInt32(cells.count)
        let length: [UInt8] = [
            UInt8(count & 0xFF), UInt8((count >> 8) & 0xFF), UInt8((count >> 16) & 0xFF), UInt8((count >> 24) & 0xFF),
        ]
        return length + cells
    }

    /// `hex(SHA256(borsh(cells) || salt))`: what `commit_board` records.
    public static func compute(cells: [UInt8], salt: [UInt8]) throws -> String {
        guard salt.count == saltBytes else { throw BattleshipsError.invalid("A salt is \(saltBytes) bytes.") }
        var hasher = SHA256()
        hasher.update(data: Data(boardBytes(cells)))
        hasher.update(data: Data(salt))
        return Hex.lower(Array(hasher.finalize()))
    }

    /// 16 bytes from the system's secure random source.
    public static func randomSalt() -> [UInt8] {
        var salt = [UInt8](repeating: 0, count: saltBytes)
        let status = SecRandomCopyBytes(kSecRandomDefault, saltBytes, &salt)
        if status != errSecSuccess {
            var generator = SystemRandomNumberGenerator()
            for index in salt.indices { salt[index] = UInt8.random(in: 0...255, using: &generator) }
        }
        return salt
    }
}

/// Lower-case hex, as the web app writes salts and commitments.
public enum Hex {
    public static func lower(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    public static func bytes(_ hex: String) -> [UInt8]? {
        let clean = hex.trimmingCharacters(in: .whitespaces).lowercased()
        guard clean.count % 2 == 0 else { return nil }
        var out: [UInt8] = []
        out.reserveCapacity(clean.count / 2)
        var index = clean.startIndex
        while index < clean.endIndex {
            let next = clean.index(index, offsetBy: 2)
            guard let byte = UInt8(clean[index..<next], radix: 16) else { return nil }
            out.append(byte)
            index = next
        }
        return out
    }
}

/// A placed fleet as this device keeps it: the cells, the salt (hex) and what was committed.
/// The same JSON as the web app's `StoredBoard` (`app/src/lib/boardStore.ts`). (Kotlin `StoredBoard`.)
public struct StoredBoard: Codable, Equatable, Sendable {
    public let cells: [UInt8]
    public let salt: String
    public let commitment: String
    public let savedAt: Double

    public init(cells: [UInt8], salt: String, commitment: String, savedAt: Double = Date().timeIntervalSince1970 * 1000) {
        self.cells = cells
        self.salt = salt
        self.commitment = commitment
        self.savedAt = savedAt
    }

    public var saltBytes: [UInt8] { Hex.bytes(salt) ?? [] }

    /// A fresh board for `layout`: a new salt and its commitment.
    public static func sealing(_ layout: FleetLayout, salt: [UInt8] = Commitment.randomSalt()) throws -> StoredBoard {
        let cells = layout.cells
        return StoredBoard(cells: cells, salt: Hex.lower(salt), commitment: try Commitment.compute(cells: cells, salt: salt))
    }
}

/// Where boards live: on this device only, keyed by the player key and the match, as the web
/// app's `boardKey`. The app's store is the Keychain; tests use ``InMemoryBoardStore``.
/// (Kotlin `BoardStore`.)
public protocol BoardStore: AnyObject, Sendable {
    func load(owner: String, matchId: String) -> StoredBoard?
    /// `false` when the store refused it: a fleet that cannot be kept cannot answer shots.
    func save(_ board: StoredBoard, owner: String, matchId: String) -> Bool
    func clear(owner: String, matchId: String)
}

extension BoardStore {
    /// `battleships:board:v1:<owner>:<matchId>`, the web app's key.
    public static func key(owner: String, matchId: String) -> String {
        "battleships:board:v1:\(owner):\(matchId)"
    }
}

public final class InMemoryBoardStore: BoardStore, @unchecked Sendable {
    private let lock = NSLock()
    private var boards: [String: StoredBoard] = [:]
    public var refuses = false

    public init() {}

    public func load(owner: String, matchId: String) -> StoredBoard? {
        lock.lock()
        defer { lock.unlock() }
        return boards[Self.key(owner: owner, matchId: matchId)]
    }

    public func save(_ board: StoredBoard, owner: String, matchId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if refuses { return false }
        boards[Self.key(owner: owner, matchId: matchId)] = board
        return true
    }

    public func clear(owner: String, matchId: String) {
        lock.lock()
        defer { lock.unlock() }
        boards[Self.key(owner: owner, matchId: matchId)] = nil
    }
}
