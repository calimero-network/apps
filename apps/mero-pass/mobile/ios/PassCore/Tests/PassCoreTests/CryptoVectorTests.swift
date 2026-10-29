import Foundation
import XCTest

@testable import PassCore

/// The native crypto against the web's, through `mobile/test-vectors/vectors.json`
/// (written by running the web's own code, see generate.mjs). Android's
/// `CryptoVectorTest` asserts the same file, case for case.
final class CryptoVectorTests: XCTestCase {
    struct Vectors: Decodable {
        struct Device: Decodable {
            let d: String
            let publicRaw: String
            let fingerprint: String
            let confirmationCode: String
        }
        struct VaultKeyVector: Decodable {
            let raw: String
            let keyId: String
        }
        struct Wrap: Decodable {
            let keyRaw: String
            let keyId: String
            let recipient: String
            let ephemeralD: String
            let ephemeralPublic: String
            let iv: String
            let envelope: String
        }
        struct WrapReject: Decodable {
            let why: String
            let envelope: String
            let keyId: String
            let recipient: String
        }
        struct Field: Decodable {
            let keyRaw: String
            let keyId: String
            let secretId: String
            let field: String
            let plaintext: String
            let iv: String
            let envelope: String
        }
        struct FieldReject: Decodable {
            let why: String
            let secretId: String
            let field: String
            let envelope: String
        }
        struct Recovery: Decodable {
            let device: String
            let d: String
            let fingerprint: String
            let code: String
        }
        struct Share: Decodable {
            let fragment: String
            let passphrase: String?
            let now: Int64
            let secret: SecretShare.Payload
            let iv: String
            let key: String?
            let salt: String?
        }
        struct ShareReject: Decodable {
            let why: String
            let fragment: String
            let passphrase: String?
            let now: Int64
            let error: String
        }
        struct TotpVector: Decodable {
            let input: String
            let atMs: Int64
            let code: String
            let secondsRemaining: Int
            let digits: Int
            let period: Int
            let algorithm: String
            let issuer: String?
            let account: String?
        }
        struct Strength: Decodable {
            let password: String
            let score: Int
        }

        let devices: [String: Device]
        let vaultKeys: [VaultKeyVector]
        let wraps: [Wrap]
        let wrapRejects: [WrapReject]
        let fields: [Field]
        let fieldRejects: [FieldReject]
        let recoveryCodes: [Recovery]
        let recoverySloppyInput: String
        let shareLinks: [Share]
        let shareRejects: [ShareReject]
        let totp: [TotpVector]
        let totpInvalid: [String]
        let strength: [Strength]
    }

    static let vectors: Vectors = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("test-vectors/vectors.json")
        let data = try! Data(contentsOf: url)
        return try! JSONDecoder().decode(Vectors.self, from: data)
    }()

    var v: Vectors { Self.vectors }

    func device(_ name: String) throws -> DeviceKeyPair {
        try DeviceKeyPair(scalar: Bytes.fromHex(v.devices[name]!.d))
    }

    func testDevicePublicKeysFingerprintsAndCodes() throws {
        for (name, d) in v.devices {
            let pair = try device(name)
            XCTAssertEqual(Bytes.b64(pair.publicRaw), d.publicRaw, name)
            XCTAssertEqual(PassCrypto.fingerprint(of: pair.publicRaw), d.fingerprint, name)
            XCTAssertEqual(PassCrypto.confirmationCode(d.fingerprint), d.confirmationCode, name)
        }
    }

    func testVaultKeyIds() throws {
        for k in v.vaultKeys {
            XCTAssertEqual(VaultKey(raw: try Bytes.fromB64(k.raw)).keyId, k.keyId)
        }
    }

    func testWrapIsByteForByteTheWebs() throws {
        for w in v.wraps {
            let key = VaultKey(raw: try Bytes.fromB64(w.keyRaw))
            let eph = try DeviceKeyPair(scalar: Bytes.fromHex(w.ephemeralD))
            XCTAssertEqual(Bytes.b64(eph.publicRaw), w.ephemeralPublic)
            let envelope = try PassCrypto.wrapVaultKey(
                key, to: try device(w.recipient).publicRaw, ephemeral: eph, iv: Bytes.fromB64(w.iv))
            XCTAssertEqual(envelope, w.envelope)
        }
    }

    func testWebWrapsOpenNatively() throws {
        for w in v.wraps {
            let opened = PassCrypto.unwrapVaultKey(w.envelope, keyId: w.keyId, device: try device(w.recipient))
            XCTAssertEqual(opened?.keyId, w.keyId)
            XCTAssertEqual(opened?.raw, try Bytes.fromB64(w.keyRaw))
        }
    }

    func testWrapsThatMustNotOpen() throws {
        for r in v.wrapRejects {
            XCTAssertNil(PassCrypto.unwrapVaultKey(r.envelope, keyId: r.keyId, device: try device(r.recipient)), r.why)
        }
    }

    func testFreshWrapRoundTrips() throws {
        let key = VaultKey.generate()
        let bob = try device("bob")
        let envelope = try PassCrypto.wrapVaultKey(key, to: bob.publicRaw)
        XCTAssertEqual(PassCrypto.unwrapVaultKey(envelope, keyId: key.keyId, device: bob), key)
        XCTAssertNil(PassCrypto.unwrapVaultKey(envelope, keyId: key.keyId, device: try device("alice")))
    }

    func testFieldSealIsByteForByteTheWebs() throws {
        for f in v.fields {
            let key = VaultKey(raw: try Bytes.fromB64(f.keyRaw))
            XCTAssertEqual(key.keyId, f.keyId)
            let envelope = try PassCrypto.sealField(
                key, secretId: f.secretId, field: f.field, plaintext: f.plaintext, iv: Bytes.fromB64(f.iv))
            XCTAssertEqual(envelope, f.envelope, f.field)
            XCTAssertEqual(PassCrypto.keyId(of: envelope), f.keyId)
        }
    }

    func testWebFieldsOpenNatively() throws {
        var ring = Keyring()
        for k in v.vaultKeys { ring.add(VaultKey(raw: try Bytes.fromB64(k.raw))) }
        for f in v.fields {
            XCTAssertEqual(
                try PassCrypto.openField(ring, secretId: f.secretId, field: f.field, envelope: f.envelope), f.plaintext)
        }
        XCTAssertEqual(try PassCrypto.openField(ring, secretId: "x", field: "y", envelope: ""), "")
        XCTAssertEqual(try PassCrypto.sealField(VaultKey.generate(), secretId: "x", field: "y", plaintext: ""), "")
    }

    func testFieldsThatMustNotOpen() throws {
        var ring = Keyring()
        for k in v.vaultKeys { ring.add(VaultKey(raw: try Bytes.fromB64(k.raw))) }
        for r in v.fieldRejects {
            XCTAssertThrowsError(
                try PassCrypto.openField(ring, secretId: r.secretId, field: r.field, envelope: r.envelope), r.why)
        }
    }

    func testRecoveryCodes() throws {
        for r in v.recoveryCodes {
            var bytes = try Bytes.fromHex(r.d)
            bytes.append(try Bytes.fromHex(String(r.fingerprint.prefix(6))))
            XCTAssertEqual(RecoveryCode.encode(bytes), r.code)
            XCTAssertEqual(try RecoveryCode.decode(r.code), bytes)
            let candidate = DeviceRecord(
                fingerprint: r.fingerprint, publicKey: v.devices[r.device]!.publicRaw, label: "Recovery key",
                kind: "recovery", account: "a")
            let pair = try RecoveryCode.pair(from: r.code, candidates: [candidate])
            XCTAssertEqual(pair?.fingerprint, r.fingerprint)
            XCTAssertEqual(pair.map { Bytes.b64($0.device.publicRaw) }, v.devices[r.device]!.publicRaw)
        }
        XCTAssertEqual(try RecoveryCode.decode(v.recoverySloppyInput), try RecoveryCode.decode(v.recoveryCodes[0].code))
        XCTAssertThrowsError(try RecoveryCode.decode("ABCD"))
        // A code only opens the recovery device it was made for.
        let other = DeviceRecord(
            fingerprint: v.recoveryCodes[0].fingerprint, publicKey: v.devices["bob"]!.publicRaw, label: "",
            kind: "recovery", account: "a")
        XCTAssertNil(try RecoveryCode.pair(from: v.recoveryCodes[0].code, candidates: [other]))
    }

    func testFreshRecoveryKeyRoundTrips() throws {
        let made = RecoveryCode.create()
        let candidate = DeviceRecord(
            fingerprint: made.key.fingerprint, publicKey: Bytes.b64(made.key.publicRaw), label: "", kind: "recovery",
            account: "a")
        XCTAssertEqual(try RecoveryCode.pair(from: made.code, candidates: [candidate])?.fingerprint, made.key.fingerprint)
    }

    func testWebShareLinksOpenNatively() throws {
        for s in v.shareLinks {
            let opened = try SecretShare.openFragment(s.fragment, passphrase: s.passphrase, now: s.now)
            XCTAssertEqual(opened, s.secret)
            XCTAssertEqual(SecretShare.needsPassphrase(s.fragment), s.passphrase != nil)
        }
        for r in v.shareRejects {
            XCTAssertThrowsError(try SecretShare.openFragment(r.fragment, passphrase: r.passphrase, now: r.now)) {
                XCTAssertEqual($0.localizedDescription, r.error, r.why)
            }
        }
    }

    func testNativeShareLinksUseTheWebsFormat() throws {
        let key = v.shareLinks[0]
        let fragment = try SecretShare.createFragment(key.secret, iv: Bytes.fromB64(key.iv), key: Bytes.fromB64(key.key!))
        // Same iv and key: everything but the ciphertext (JSON key order may differ) matches.
        XCTAssertTrue(fragment.hasPrefix(String(key.fragment.prefix(while: { $0 != "d" }))))
        XCTAssertEqual(try SecretShare.openFragment(fragment, now: key.now), key.secret)
        let pass = v.shareLinks[1]
        let withPass = try SecretShare.createFragment(
            pass.secret, passphrase: pass.passphrase, iv: Bytes.fromB64(pass.iv), salt: Bytes.fromB64(pass.salt!))
        XCTAssertTrue(withPass.hasPrefix(String(pass.fragment.prefix(while: { $0 != "d" }))))
        XCTAssertEqual(try SecretShare.openFragment(withPass, passphrase: pass.passphrase, now: pass.now), pass.secret)
        XCTAssertTrue(SecretShare.url(fragment: "v=1").hasPrefix("https://"))
    }

    func testTotp() {
        for t in v.totp {
            guard let params = Totp.parse(t.input) else { return XCTFail("did not parse \(t.input)") }
            XCTAssertEqual(params.digits, t.digits)
            XCTAssertEqual(params.period, t.period)
            XCTAssertEqual(params.algorithm.rawValue, t.algorithm)
            XCTAssertEqual(params.issuer, t.issuer)
            XCTAssertEqual(params.account, t.account)
            XCTAssertEqual(Totp.code(params, atMs: t.atMs), t.code, "\(t.input) @ \(t.atMs)")
            XCTAssertEqual(Totp.secondsRemaining(period: t.period, atMs: t.atMs), t.secondsRemaining)
        }
        for bad in v.totpInvalid { XCTAssertNil(Totp.parse(bad), bad) }
    }

    func testStrength() {
        for s in v.strength { XCTAssertEqual(PasswordTools.strength(s.password), s.score, s.password) }
    }

    func testGeneratorAndSecretIds() {
        let pw = PasswordTools.generate(length: 32)
        XCTAssertEqual(pw.count, 32)
        XCTAssertNotEqual(pw, PasswordTools.generate(length: 32))
        XCTAssertTrue(PassCrypto.newSecretId().range(of: "^secret_[0-9a-f]{32}$", options: .regularExpression) != nil)
        XCTAssertEqual(PassCrypto.confirmationCode(String(repeating: "0", count: 64)), "000 000")
    }

    func testKeysNeverDescribeThemselves() {
        let key = VaultKey.generate()
        XCTAssertFalse("\(key)".contains(Bytes.b64(key.raw)))
        let pair = DeviceKeyPair.generate()
        XCTAssertEqual("\(pair)", "DeviceKeyPair(…)")
    }
}
