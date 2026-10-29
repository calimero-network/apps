import CryptoKit
import Foundation

/// The recovery key: a P-256 key pair whose private scalar is shown once, as a
/// code, and then forgotten. The web's `app/src/lib/recoveryKey.ts`, same format:
/// Crockford base32 of `d` (32 bytes) and the first 3 bytes of the key's
/// fingerprint, 56 characters in groups of 4.
public enum RecoveryCode {
    static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    static let codeBytes = 35
    static let prefixBytes = 3

    public enum Failure: Error, Equatable, LocalizedError {
        case length
        case character(Character)
        case noMatch
        case nothingOpened

        public var errorDescription: String? {
            switch self {
            case .length: return "A recovery code has 56 characters."
            case .character(let c): return "\"\(c)\" is not in a recovery code."
            case .noMatch: return "That code does not match a recovery key in any of your vaults."
            case .nothingOpened: return "That code did not open any vault. Check it for typos."
            }
        }
    }

    public static func encode(_ bytes: Data) -> String {
        var bits = 0
        var value = 0
        var out: [Character] = []
        for byte in bytes {
            value = ((value << 8) | Int(byte)) & 0xFFFF
            bits += 8
            while bits >= 5 {
                out.append(alphabet[(value >> (bits - 5)) & 31])
                bits -= 5
            }
        }
        if bits > 0 { out.append(alphabet[(value << (5 - bits)) & 31]) }
        return stride(from: 0, to: out.count, by: 4)
            .map { String(out[$0..<min($0 + 4, out.count)]) }
            .joined(separator: "-")
    }

    /// Case, dashes and spaces are ignored; O reads as 0, I and L as 1.
    public static func decode(_ text: String) throws -> Data {
        let clean = text.uppercased()
            .filter { !$0.isWhitespace && $0 != "-" }
            .map { $0 == "O" ? "0" : ($0 == "I" || $0 == "L") ? "1" : $0 }
        guard clean.count == (codeBytes * 8 + 4) / 5 else { throw Failure.length }
        var out = Data()
        var bits = 0
        var value = 0
        for c in clean {
            guard let v = alphabet.firstIndex(of: c) else { throw Failure.character(c) }
            value = ((value << 5) | v) & 0xFFFF
            bits += 5
            if bits >= 8 {
                out.append(UInt8((value >> (bits - 8)) & 0xFF))
                bits -= 8
            }
        }
        return out
    }

    /// A new recovery key: the code to show once, and the public half to keep.
    public static func create() -> (code: String, key: RecoveryPublic) {
        let pair = DeviceKeyPair.generate()
        let fingerprint = PassCrypto.fingerprint(of: pair.publicRaw)
        var bytes = pair.scalar
        bytes.append(contentsOf: (try? Bytes.fromHex(String(fingerprint.prefix(prefixBytes * 2)))) ?? Data())
        let code = encode(bytes)
        bytes.resetBytes(in: 0..<bytes.count)
        return (code, RecoveryPublic(publicRaw: pair.publicRaw, fingerprint: fingerprint))
    }

    /// Rebuild the recovery key pair from its code and the registered recovery
    /// device it belongs to; `nil` when no candidate matches.
    public static func pair(from code: String, candidates: [DeviceRecord]) throws -> (
        device: DeviceKeyPair, fingerprint: String
    )? {
        let bytes = try decode(code)
        let prefix = Bytes.hex(bytes.suffix(from: 32))
        let scalar = bytes.prefix(32)
        for c in candidates where c.kind == DeviceKind.recovery.rawValue && c.fingerprint.hasPrefix(prefix) {
            guard let raw = try? Bytes.fromB64(c.publicKey), raw.count == 65, raw.first == 4,
                let pair = try? DeviceKeyPair(scalar: Data(scalar)), pair.publicRaw == raw
            else { continue }
            return (pair, c.fingerprint)
        }
        return nil
    }
}

/// The public half of a recovery key, remembered so vaults opened later get it.
public struct RecoveryPublic: Codable, Equatable, Sendable {
    public let publicRaw: Data
    public let fingerprint: String

    public init(publicRaw: Data, fingerprint: String) {
        self.publicRaw = publicRaw
        self.fingerprint = fingerprint
    }
}
