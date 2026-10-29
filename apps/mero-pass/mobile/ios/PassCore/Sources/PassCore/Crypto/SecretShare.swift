import CommonCrypto
import CryptoKit
import Foundation

/// One secret shared with someone outside the team: the web's
/// `app/src/lib/shareLink.ts`, same format, so a link made here opens on the
/// web's `/share` page. The secret travels sealed in the URL fragment; the key
/// is in the link (`k=`) or derived from a passphrase (PBKDF2-SHA256, 600,000
/// rounds) told to the recipient another way. Nothing is written to the vault.
public enum SecretShare {
    public static let iterations: UInt32 = 600_000
    /// Where the web app opens share links.
    public static let webBase = "https://mero-pass.vercel.app/share"

    public struct Payload: Codable, Equatable, Sendable {
        public var name: String
        public var kind: String
        public var fields: [String: String]
        /// Milliseconds since the epoch.
        public var expiresAt: Int64
        public var sharedBy: String?

        public init(name: String, kind: String, fields: [String: String], expiresAt: Int64, sharedBy: String? = nil) {
            self.name = name
            self.kind = kind
            self.fields = fields
            self.expiresAt = expiresAt
            self.sharedBy = sharedBy
        }
    }

    public enum Failure: Error, Equatable, LocalizedError {
        case message(String)
        public var errorDescription: String? {
            switch self {
            case .message(let text): return text
            }
        }
    }

    /// The fragment (everything after `#`). `iv`, `key` and `salt` are for the
    /// test vectors; a real link always gets fresh ones.
    public static func createFragment(
        _ payload: Payload, passphrase: String? = nil, iv: Data? = nil, key: Data? = nil, salt: Data? = nil
    ) throws -> String {
        let nonce = iv ?? Bytes.random(12)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let plain = try encoder.encode(payload)
        if let passphrase, !passphrase.isEmpty {
            let s = salt ?? Bytes.random(16)
            let ct = try seal(plain, key: try pbkdf2(passphrase, salt: s), iv: nonce)
            return "v=1&p=1&s=\(Bytes.b64url(s))&iv=\(Bytes.b64url(nonce))&d=\(Bytes.b64url(ct))"
        }
        let raw = key ?? Bytes.random(32)
        let ct = try seal(plain, key: SymmetricKey(data: raw), iv: nonce)
        return "v=1&iv=\(Bytes.b64url(nonce))&d=\(Bytes.b64url(ct))&k=\(Bytes.b64url(raw))"
    }

    public static func url(fragment: String) -> String { "\(webBase)#\(fragment)" }

    public static func needsPassphrase(_ fragment: String) -> Bool { params(fragment)["p"] == "1" }

    public static func openFragment(
        _ fragment: String, passphrase: String? = nil, now: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) throws -> Payload {
        let q = params(fragment.hasPrefix("#") ? String(fragment.dropFirst()) : fragment)
        guard q["v"] == "1" else { throw Failure.message("This is not a Mero Pass share link.") }
        guard let ivText = q["iv"], let data = q["d"] else { throw Failure.message("This link is incomplete.") }
        let key: SymmetricKey
        if q["p"] == "1" {
            guard let saltText = q["s"], let passphrase, !passphrase.isEmpty else {
                throw Failure.message("This link needs a passphrase.")
            }
            key = try pbkdf2(passphrase, salt: try Bytes.fromB64url(saltText))
        } else {
            guard let k = q["k"] else { throw Failure.message("This link is missing its key.") }
            key = SymmetricKey(data: try Bytes.fromB64url(k))
        }
        let payload: Payload
        do {
            let ct = try Bytes.fromB64url(data)
            guard ct.count >= 16 else { throw PassCryptoError.malformed("link") }
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: try Bytes.fromB64url(ivText)), ciphertext: ct.prefix(ct.count - 16),
                tag: ct.suffix(16))
            payload = try JSONDecoder().decode(Payload.self, from: try AES.GCM.open(box, using: key))
        } catch {
            throw Failure.message("Wrong passphrase, or the link was altered.")
        }
        if now > payload.expiresAt { throw Failure.message("This link has expired.") }
        return payload
    }

    private static func seal(_ plain: Data, key: SymmetricKey, iv: Data) throws -> Data {
        let sealed = try AES.GCM.seal(plain, using: key, nonce: try AES.GCM.Nonce(data: iv))
        return sealed.ciphertext + sealed.tag
    }

    private static func params(_ fragment: String) -> [String: String] {
        var out: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard let name = parts.first?.removingPercentEncoding else { continue }
            if out[name] == nil {
                out[name] = parts.count > 1 ? (parts[1].replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? parts[1]) : ""
            }
        }
        return out
    }

    /// PBKDF2-HMAC-SHA256 to a 32-byte AES key, as WebCrypto's `deriveKey`.
    static func pbkdf2(_ passphrase: String, salt: Data, rounds: UInt32 = iterations) throws -> SymmetricKey {
        let password = Array(passphrase.utf8)
        var derived = [UInt8](repeating: 0, count: 32)
        let status = salt.withUnsafeBytes { saltBytes in
            password.withUnsafeBufferPointer { passwordBytes in
                passwordBytes.baseAddress!.withMemoryRebound(to: Int8.self, capacity: password.count) { pw in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2), pw, password.count,
                        saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), rounds, &derived, derived.count)
                }
            }
        }
        guard status == kCCSuccess else { throw PassCryptoError.unsupported("Could not derive a key from that passphrase.") }
        defer { derived.withUnsafeMutableBufferPointer { $0.initialize(repeating: 0) } }
        return SymmetricKey(data: derived)
    }
}
