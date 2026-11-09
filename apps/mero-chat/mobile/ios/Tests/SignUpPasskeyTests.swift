import Foundation
import MeroKit
import XCTest

/// The sign-up's second prompt (`412 CONFIRM_REQUIRED`) waits for its own
/// tap, and the relying party is the node's, passed through untouched.
final class SignUpPasskeyTests: XCTestCase {
    private final class Recorder: PasskeyProvider, @unchecked Sendable {
        private let lock = NSLock()
        private var _calls: [String] = []
        var calls: [String] { lock.withLock { _calls } }
        func note(_ call: String) { lock.withLock { _calls.append(call) } }

        func create(options: JSONValue) async throws -> RegistrationJSON {
            note("create \(options["rp"]?["id"]?.stringValue ?? "-")")
            return RegistrationJSON(attestationObject: "att", clientDataJson: "cd")
        }

        func get(challenge: Data, rpId: String, allowCredentials: [String]?) async throws -> AssertionJSON {
            note("get \(rpId)")
            return AssertionJSON(credentialId: "id", authenticatorData: "ad", clientDataJson: "cd", signature: "sig")
        }
    }

    func testCreatePassesStraightThrough() async throws {
        let base = Recorder()
        let passkey = SignUpPasskey(base: base) { XCTFail("create waits for no tap") }
        _ = try await passkey.create(options: ["rp": ["id": "calimero.network"]])
        XCTAssertEqual(base.calls, ["create calimero.network"])
    }

    func testGetWaitsForTheTapThenSignsForTheNodesRelyingParty() async throws {
        let base = Recorder()
        let taps = Recorder()
        let passkey = SignUpPasskey(base: base) {
            XCTAssertTrue(base.calls.isEmpty, "the prompt starts only after the tap")
            taps.note("tap")
        }
        _ = try await passkey.get(challenge: Data([1, 2, 3]), rpId: "calimero.network", allowCredentials: nil)
        XCTAssertEqual(taps.calls, ["tap"])
        XCTAssertEqual(base.calls, ["get calimero.network"])
    }

    func testBackingOutPromptsNothing() async {
        let base = Recorder()
        let passkey = SignUpPasskey(base: base) { throw PasskeyCancelled() }
        do {
            _ = try await passkey.get(challenge: Data([1]), rpId: "calimero.network", allowCredentials: nil)
            XCTFail("expected PasskeyCancelled")
        } catch {
            XCTAssertTrue(error is PasskeyCancelled)
        }
        XCTAssertTrue(base.calls.isEmpty)
    }
}
