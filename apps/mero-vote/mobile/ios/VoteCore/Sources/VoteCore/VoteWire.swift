import Foundation
import VoteCrypto

// The contract's JSON shapes (the generated `Wire*` types) to and from the
// protocol's values, as `protocol.ts` does at its bottom.

public enum VoteWire {
    public static func point(_ hex: String, _ what: String = "point") throws -> RistrettoPoint {
        guard hex.count == 64, Hex.decode(hex) != nil else { throw VoteCryptoError("\(what): not 32 bytes of hex") }
        do { return try RistrettoPoint(hex: hex) } catch { throw VoteCryptoError("\(what): not a valid ristretto255 point") }
    }

    public static func scalar(_ hex: String, _ what: String = "scalar") throws -> Scalar {
        guard hex.count == 64, Hex.decode(hex) != nil else { throw VoteCryptoError("\(what): not 32 bytes of hex") }
        do { return try Scalar(hex: hex) } catch { throw VoteCryptoError("\(what): not a canonical scalar") }
    }

    public static func branch(_ b: Branch) -> WireBranch { WireBranch(c: b.c.hex, z: b.z.hex) }

    public static func branch(_ w: WireBranch, _ what: String = "proof") throws -> Branch {
        Branch(c: try scalar(w.c, what), z: try scalar(w.z, what))
    }

    public static func ballot(_ b: Ballot) -> WireBallot {
        WireBallot(
            choices: b.choices.map { WireChoice(a: $0.ct.a.hex, b: $0.ct.b.hex, proof: $0.proof.map(branch)) },
            sumProof: b.sumProof.map(branch))
    }

    public static func ballot(_ w: WireBallot) throws -> Ballot {
        Ballot(
            choices: try w.choices.map { ch in
                EncryptedChoice(
                    ct: Ciphertext(a: try point(ch.a, "ciphertext"), b: try point(ch.b, "ciphertext")),
                    proof: try ch.proof.map { try branch($0, "choice proof") })
            },
            sumProof: try w.sumProof.map { try branch($0, "sum proof") })
    }

    public static func dealing(_ d: Dealing) -> WireDealing {
        WireDealing(
            commitments: d.commitments.map(\.hex), proof: branch(d.proof),
            shares: d.shares.map { WireEncShare(r: $0.r.hex, v: $0.v.hex) })
    }

    public static func dealing(_ w: WireDealing) throws -> Dealing {
        Dealing(
            commitments: try w.commitments.map { try point($0, "commitment") },
            proof: try branch(w.proof, "dealing proof"),
            shares: try w.shares.map { EncryptedShare(r: try point($0.r, "share"), v: try scalar($0.v, "share")) })
    }

    public static func rules(_ def: PollDefinition) -> Rules {
        Rules(options: def.options.count, min: Int(def.minChoices), max: Int(def.maxChoices))
    }
}

/// A trustee's transport secret: the one value on this device that can help
/// decrypt anything. Same JSON as the web's backup file
/// (`utils/trusteeKeys.ts`), so a backup moves between the web and the phone.
public struct TrusteeKey: Codable, Equatable, Sendable {
    public var v: Int
    public var contextId: String
    public var pollId: String
    public var account: String
    /// 64-hex canonical scalar.
    public var secret: String

    public init(contextId: String, pollId: String, account: String, secret: String) {
        self.v = 1
        self.contextId = contextId
        self.pollId = pollId
        self.account = account
        self.secret = secret
    }

    /// The backup file's text, as the web writes it.
    public func json() -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? ""
    }

    public var backupFileName: String { "mero-vote-trustee-\(pollId.prefix(12)).json" }

    /// Parse a backup, refusing one made for a different poll, account or context.
    public static func parse(_ raw: String, contextId: String, pollId: String, account: String) throws -> TrusteeKey {
        guard let key = try? JSONDecoder().decode(TrusteeKey.self, from: Data(raw.utf8)), key.v == 1,
            key.secret.count == 64, key.secret.allSatisfy({ "0123456789abcdef".contains($0) })
        else { throw VoteModelError.message("This isn't a Mero Vote trustee key.") }
        if key.pollId != pollId { throw VoteModelError.message("This key is for a different poll.") }
        if key.account != account { throw VoteModelError.message("This key belongs to a different account.") }
        if key.contextId != contextId { throw VoteModelError.message("This key is for a different voting group.") }
        return key
    }

    /// The storage name, as the web's localStorage key.
    public static func name(contextId: String, pollId: String, account: String) -> String {
        "mero-vote:trustee:\(contextId):\(pollId):\(account)"
    }
}

/// Where trustee keys live on this device. The app uses the Keychain; tests use memory.
public protocol TrusteeKeyStore: AnyObject, Sendable {
    func load(contextId: String, pollId: String, account: String) -> TrusteeKey?
    /// `false` when the device refused to store it.
    func save(_ key: TrusteeKey) -> Bool
}

public final class MemoryTrusteeKeyStore: TrusteeKeyStore, @unchecked Sendable {
    private let lock = NSLock()
    private var keys: [String: TrusteeKey] = [:]
    public var refuses = false

    public init() {}

    public func load(contextId: String, pollId: String, account: String) -> TrusteeKey? {
        lock.lock()
        defer { lock.unlock() }
        return keys[TrusteeKey.name(contextId: contextId, pollId: pollId, account: account)]
    }

    public func save(_ key: TrusteeKey) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if refuses { return false }
        keys[TrusteeKey.name(contextId: key.contextId, pollId: key.pollId, account: key.account)] = key
        return true
    }
}
