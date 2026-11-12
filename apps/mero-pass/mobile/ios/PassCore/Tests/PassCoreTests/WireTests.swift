import Foundation
import MeroKit
import MeroKitTestSupport
import PassCore
import PassGenerated
import XCTest

/// The client speaks the component ABI the web app's `meroPass.ts` speaks.
final class WireTests: XCTestCase {
    static let calls = [
        "renameVault", "setRole", "removeMember", "setDefaultRole", "registerDevice", "revokeDevice", "addKeyWraps",
        "rotateKey", "addSecret", "updateSecret", "trashSecret", "restoreSecret", "purgeSecret",
    ]
    static let views = [
        "vaultInfo", "vaultName", "listMembers", "listDevices", "keyWrapsFor", "wrappedPairs", "secretHistory",
        "getSecret", "listSecrets", "getAuditLogs",
    ]

    func testEveryMethodGoesOutCamelCase() async throws {
        let backend = InMemoryAppBackend()
        let ctx = "app-1"
        backend.recording.setRawHandler { call in
            switch call.method {
            case "addKeyWraps": return Data("0".utf8)
            case "addSecret", "vaultName": return Data(#""x""#.utf8)
            case "wrappedPairs", "listMembers", "listDevices", "keyWrapsFor", "secretHistory", "listSecrets",
                "getAuditLogs":
                return Data("[]".utf8)
            default: return Data("null".utf8)
            }
        }
        let client = PassClient.make(contract: backend.contract, contextId: ctx)
        _ = try? await client.vaultInfo()
        _ = try await client.vaultName()
        _ = try await client.listMembers()
        _ = try await client.listDevices()
        _ = try await client.keyWrapsFor(recipient: "r")
        _ = try await client.wrappedPairs()
        _ = try await client.secretHistory(id: "s")
        let missing = try await client.getSecret(id: "s")
        XCTAssertNil(missing, "an unknown id answers null")
        _ = try await client.listSecrets()
        _ = try await client.getAuditLogs()
        try await client.renameVault(name: "V")
        try await client.setRole(account: "a", role: "editor")
        try await client.removeMember(account: "a")
        try await client.setDefaultRole(role: "viewer")
        try await client.registerDevice(fingerprint: "f", publicKey: "pk", label: "l", kind: "mobile")
        try await client.revokeDevice(fingerprint: "f")
        _ = try await client.addKeyWraps(
            wraps: [KeyWrapInput(keyId: "k", recipient: "r", wrapper: "w", envelope: "e")])
        try await client.rotateKey(keyId: "k")
        _ = try await client.addSecret(id: "s", kind: "login", name: "n", tags: "", fields: [:])
        try await client.updateSecret(id: "s", fields: [:], rekey: false)
        try await client.trashSecret(id: "s")
        try await client.restoreSecret(id: "s")
        try await client.purgeSecret(id: "s")

        for method in Self.calls { XCTAssertEqual(backend.recording.calls(method).first?.path, .execute, method) }
        for method in Self.views { XCTAssertEqual(backend.recording.calls(method).first?.path, .query, method) }
        let device = try XCTUnwrap(backend.recording.calls("registerDevice").first)
        XCTAssertEqual(device.args["publicKey"]?.stringValue, "pk")
        XCTAssertNil(device.args["public_key"])
        XCTAssertEqual(backend.recording.calls("rotateKey").first?.args["keyId"]?.stringValue, "k")
        let wraps = try XCTUnwrap(backend.recording.calls("addKeyWraps").first?.args["wraps"]?.arrayValue?.first?.objectValue)
        XCTAssertEqual(wraps["keyId"]?.stringValue, "k")
        let update = try XCTUnwrap(backend.recording.calls("updateSecret").first)
        XCTAssertEqual(update.args["name"], .null, "option<string> goes out as an explicit null")
        XCTAssertEqual(update.args["tags"], .null)
    }

    func testU64AnswersArriveAsDecimalStrings() throws {
        let json = #"""
        [{"id":"s","kind":"login","name":"n","tags":"","fields":{"username":"u"},"createdAt":"1761000000123",
          "createdBy":"a","updatedAt":"1761000000456","updatedBy":"a","trashed":false,"trashedAt":"0"}]
        """#
        let secrets = try JSONDecoder().decode([SecretView].self, from: Data(json.utf8))
        XCTAssertEqual(secrets.first?.createdAt, 1_761_000_000_123)
        XCTAssertEqual(secrets.first?.updatedAt, 1_761_000_000_456)
        XCTAssertEqual(secrets.first?.fields["username"], "u")
        let device = try JSONDecoder().decode(
            DeviceView.self,
            from: Data(
                #"{"fingerprint":"f","publicKey":"pk","label":"l","kind":"mobile","account":"a","addedAt":"42","revoked":false}"#
                    .utf8))
        XCTAssertEqual(device.addedAt, 42)
        XCTAssertEqual(device.publicKey, "pk")
        let info = try JSONDecoder().decode(
            VaultInfo.self,
            from: Data(#"{"name":"V","currentKey":"k","defaultRole":"viewer","myAccount":"a","myRole":"admin"}"#.utf8))
        XCTAssertEqual(info.myRole, "admin")
        XCTAssertEqual(info.currentKey, "k")
    }

    func testTheContractsRefusalsReadAsPlainWords() {
        func app(_ code: String, _ message: String? = nil) -> AppError {
            var fields: [String: JSONValue] = [:]
            if let message { fields["message"] = .string(message) }
            return AppError("app error", details: ["code": .string(code), "fields": .object(fields)])
        }
        XCTAssertEqual(PassErrorText.describe(app("Forbidden")), "Your role in this vault can't do that.")
        XCTAssertEqual(PassErrorText.describe(app("Conflict", "already exists")), "Already exists.")
        XCTAssertEqual(
            PassErrorText.describe(app("Forbidden", "only a vault admin can do that")), "Only a vault Admin can do that.")
        XCTAssertEqual(PassErrorText.describe(ConfirmCancelled()), "You cancelled the passkey prompt, so nothing changed.")
        XCTAssertTrue(PassErrorText.describe(ConsentStale("x")).contains("already decided"))
    }

    func testReadsTheWebAppsInviteLinks() {
        let web = PassInvitation.parse("https://pass.example.com/?invite=inv_abc123")
        XCTAssertEqual(web?.invitation.token, "inv_abc123")
        XCTAssertEqual(web?.kind, .team)
        XCTAssertEqual(PassInvitation.parse("inv_abc123")?.invitation.token, "inv_abc123")
        XCTAssertNil(PassInvitation.parse("https://pass.example.com/?other=1"))
    }

    @MainActor
    func testAWebLinkJoinsTheTeamTheNodeNames() async {
        let backend = InMemoryAppBackend()
        let model = InvitationModel(vaultAttempts: 1, vaultRetryDelay: .milliseconds(1))
        XCTAssertTrue(model.open("https://pass.example.com/?invite=inv_abc123"))
        await model.accept(backend: { backend }, didJoin: {})
        guard case .joined = model.stage else { return XCTFail("expected joined: \(model.stage)") }
    }
}
