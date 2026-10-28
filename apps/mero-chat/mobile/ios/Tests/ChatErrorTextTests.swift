import MeroKit
import XCTest

final class ChatErrorTextTests: XCTestCase {
    func testARelayTooOldToInstallChatIsNamedWithBothVersions() {
        let error = AccountError.intentRefused(
            reason: "founded ns but could not give it its application: install failed: "
                + "bundle requires runtime version 0.12.0-rc.1 but current runtime is 0.11.0-rc.90",
            retryable: false, status: 409)
        let text = ChatErrorText.describe(error)
        XCTAssertTrue(text.contains("Calimero 0.11.0-rc.90"), text)
        XCTAssertTrue(text.contains("needs 0.12.0-rc.1 or newer"), text)
        XCTAssertTrue(text.contains("upgraded"), text)
    }

    func testAnOlderChatOnTheRelayIsNamedWhenAChannelsInitFails() {
        let error = AccountError.intentRefused(
            reason: "init failed: guest panicked: failed to deserialize arguments: unknown field `context_type`, "
                + "expected `name` at line 1 column 15",
            retryable: false, status: 400)
        XCTAssertTrue(ChatErrorText.describe(error).contains("older Mero Chat"))
    }

    func testAnyOtherRefusalKeepsTheRelaysOwnReason() {
        let error = AccountError.intentRefused(reason: "not a member", retryable: false, status: 403)
        XCTAssertEqual(ChatErrorText.describe(error), "The relay refused this (403): not a member")
    }
}
