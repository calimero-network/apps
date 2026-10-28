import CryptoKit
import Foundation

// End-to-end encryption for a vault: the native twin of the web's
// `packages/mero-pass/src/crypto.ts`, byte-compatible with it. The test
// vectors in `mobile/test-vectors/vectors.json` (produced by running the web's
// code) hold both implementations to that.
//
//   device key   ECDH P-256, one per phone, kept in the Keychain.
//   vault key    32 random bytes, AES-256-GCM. keyId = hex(SHA-256(key)).
//   key wrap     ECIES: an ephemeral P-256 key agrees with the recipient's
//                device key, HKDF-SHA256 (salt = epk || recipient public,
//                info "mero-pass/key-wrap/v1") derives an AES-256-GCM key,
//                which seals the vault key with the key id as associated data.
//   field seal   AES-256-GCM under the vault key, "<secretId>\0<field>" as
//                associated data: `mp1.<keyId>.<iv>.<ciphertext+tag>`.
//
// Nothing here logs, prints or describes a key or a plaintext.

/// This phone's key pair. The private half never leaves the Keychain except
/// into memory while the app is unlocked.
public struct DeviceKeyPair: Sendable {
    public let privateKey: P256.KeyAgreement.PrivateKey

    public init(privateKey: P256.KeyAgreement.PrivateKey) { self.privateKey = privateKey }

    /// A fresh key pair.
    public static func generate() -> DeviceKeyPair { DeviceKeyPair(privateKey: .init()) }

    /// From the 32-byte private scalar.
    public init(scalar: Data) throws {
        do {
            privateKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: scalar)
        } catch {
            throw PassCryptoError.malformed("private key")
        }
    }

    /// Raw uncompressed point, 65 bytes (`04 || x || y`), as WebCrypto exports it.
    public var publicRaw: Data { privateKey.publicKey.x963Representation }

    /// The 32-byte private scalar, for the Keychain and the recovery code only.
    public var scalar: Data { privateKey.rawRepresentation }
}

extension DeviceKeyPair: CustomStringConvertible, CustomDebugStringConvertible {
    // Never print key material, even by accident in a log or a test failure.
    public var description: String { "DeviceKeyPair(…)" }
    public var debugDescription: String { description }
}

/// A vault key, held in memory so this device can wrap it to others.
public struct VaultKey: Sendable, Equatable {
    public let keyId: String
    public let raw: Data

    public init(raw: Data) {
        self.raw = raw
        keyId = Bytes.hex(Bytes.sha256(raw))
    }

    public static func generate() -> VaultKey { VaultKey(raw: Bytes.random(32)) }

    var symmetric: SymmetricKey { SymmetricKey(data: raw) }
}

extension VaultKey: CustomStringConvertible, CustomDebugStringConvertible {
    public var description: String { "VaultKey(\(keyId.prefix(8))…)" }
    public var debugDescription: String { description }
}

/// Every key this device can open a vault's envelopes with.
public struct Keyring: Sendable {
    private var keys: [String: VaultKey] = [:]

    public init() {}

    public mutating func add(_ key: VaultKey) { keys[key.keyId] = key }
    public func get(_ keyId: String) -> VaultKey? { keys[keyId] }
    public func has(_ keyId: String) -> Bool { keys[keyId] != nil }
    public var count: Int { keys.count }
    public var ids: [String] { Array(keys.keys) }
}

public enum SealError: Error, Equatable {
    case notEncrypted
    case keyNotHeld
    case failedToAuthenticate
}

public enum PassCrypto {
    static let wrapInfo = Data("mero-pass/key-wrap/v1".utf8)
    static let fieldPrefix = "mp1"

    /// `hex(SHA-256(raw public key))`: the id a device is registered under.
    public static func fingerprint(of publicRaw: Data) -> String { Bytes.hex(Bytes.sha256(publicRaw)) }

    // MARK: Key wrap

    private static func kek(_ privateKey: P256.KeyAgreement.PrivateKey, peer: Data, salt: Data) throws -> SymmetricKey {
        let peerKey: P256.KeyAgreement.PublicKey
        do {
            peerKey = try P256.KeyAgreement.PublicKey(x963Representation: peer)
        } catch {
            throw PassCryptoError.malformed("public key")
        }
        let shared = try privateKey.sharedSecretFromKeyAgreement(with: peerKey)
        return shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: wrapInfo, outputByteCount: 32)
    }

    /// Seal `key` to one device public key. `ephemeral` and `iv` are for the
    /// test vectors only; a real wrap always makes fresh ones.
    public static func wrapVaultKey(
        _ key: VaultKey, to recipientPublicRaw: Data, ephemeral: DeviceKeyPair? = nil, iv: Data? = nil
    ) throws -> String {
        let eph = ephemeral ?? .generate()
        let epk = eph.publicRaw
        let kek = try kek(eph.privateKey, peer: recipientPublicRaw, salt: epk + recipientPublicRaw)
        let nonceBytes = iv ?? Bytes.random(12)
        let sealed = try AES.GCM.seal(
            key.raw, using: kek, nonce: try AES.GCM.Nonce(data: nonceBytes), authenticating: Data(key.keyId.utf8))
        let ct = sealed.ciphertext + sealed.tag
        // Written by hand, in `JSON.stringify`'s key order and escaping (base64
        // needs none), so a wrap is the same text the web would have written.
        return "{\"v\":1,\"epk\":\"\(Bytes.b64(epk))\",\"iv\":\"\(Bytes.b64(nonceBytes))\",\"ct\":\"\(Bytes.b64(ct))\"}"
    }

    /// Open a wrap addressed to this device. `nil`, never a throw, for a wrap
    /// that does not open or whose key does not hash to `keyId`: a member can
    /// write garbage into their own wrap slot.
    public static func unwrapVaultKey(_ envelope: String, keyId: String, device: DeviceKeyPair) -> VaultKey? {
        guard let object = try? JSONSerialization.jsonObject(with: Data(envelope.utf8)) as? [String: Any],
            let version = object["v"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(),
            version.doubleValue == 1,
            let epkText = object["epk"] as? String, let ivText = object["iv"] as? String,
            let ctText = object["ct"] as? String,
            let epk = try? Bytes.fromB64(epkText), let iv = try? Bytes.fromB64(ivText),
            let ct = try? Bytes.fromB64(ctText), ct.count >= 16
        else { return nil }
        do {
            let kek = try kek(device.privateKey, peer: epk, salt: epk + device.publicRaw)
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: iv), ciphertext: ct.prefix(ct.count - 16), tag: ct.suffix(16))
            let raw = try AES.GCM.open(box, using: kek, authenticating: Data(keyId.utf8))
            let key = VaultKey(raw: raw)
            return key.keyId == keyId ? key : nil
        } catch {
            return nil
        }
    }

    // MARK: Fields

    private static func aad(_ secretId: String, _ field: String) -> Data { Data("\(secretId)\u{0}\(field)".utf8) }

    /// `mp1.<keyId>.<iv>.<ciphertext>`; an empty value seals to empty.
    public static func sealField(
        _ key: VaultKey, secretId: String, field: String, plaintext: String, iv: Data? = nil
    ) throws -> String {
        if plaintext.isEmpty { return "" }
        let nonceBytes = iv ?? Bytes.random(12)
        let sealed = try AES.GCM.seal(
            Data(plaintext.utf8), using: key.symmetric, nonce: try AES.GCM.Nonce(data: nonceBytes),
            authenticating: aad(secretId, field))
        return [fieldPrefix, key.keyId, Bytes.b64(nonceBytes), Bytes.b64(sealed.ciphertext + sealed.tag)]
            .joined(separator: ".")
    }

    /// Which key sealed an envelope, or `nil` for an empty or foreign value.
    public static func keyId(of envelope: String) -> String? {
        let parts = envelope.split(separator: ".", omittingEmptySubsequences: false)
        return parts.count == 4 && parts[0] == fieldPrefix ? String(parts[1]) : nil
    }

    /// Open an envelope; empty opens to empty. Throws ``SealError``.
    public static func openField(_ keyring: Keyring, secretId: String, field: String, envelope: String) throws -> String {
        if envelope.isEmpty { return "" }
        let parts = envelope.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 4, parts[0] == fieldPrefix else { throw SealError.notEncrypted }
        guard let key = keyring.get(parts[1]) else { throw SealError.keyNotHeld }
        do {
            let iv = try Bytes.fromB64(parts[2])
            let ct = try Bytes.fromB64(parts[3])
            guard ct.count >= 16 else { throw SealError.failedToAuthenticate }
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: iv), ciphertext: ct.prefix(ct.count - 16), tag: ct.suffix(16))
            let plain = try AES.GCM.open(box, using: key.symmetric, authenticating: aad(secretId, field))
            guard let text = String(data: plain, encoding: .utf8) else { throw SealError.failedToAuthenticate }
            return text
        } catch {
            throw SealError.failedToAuthenticate
        }
    }

    /// A fresh secret id, in the shape the contract requires.
    public static func newSecretId() -> String { "secret_\(Bytes.hex(Bytes.random(16)))" }

    /// The short code shown on the device asking to be let in and on the one
    /// approving it: the first 8 hex of the fingerprint mod 10^6, as "123 456".
    public static func confirmationCode(_ fingerprint: String) -> String {
        let n = (UInt64(fingerprint.prefix(8), radix: 16) ?? 0) % 1_000_000
        let digits = String(format: "%06llu", n)
        return "\(digits.prefix(3)) \(digits.suffix(3))"
    }
}
