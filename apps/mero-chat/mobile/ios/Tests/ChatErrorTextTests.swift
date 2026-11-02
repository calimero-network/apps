import MeroKit
import XCTest

final class ChatErrorTextTests: XCTestCase {
    func testAnOlderChatIsNamedWhenAChannelsInitFails() {
        let error = AppError(
            "init failed: guest panicked: failed to deserialize arguments: unknown field `context_type`, "
                + "expected `name` at line 1 column 15")
        XCTAssertTrue(ChatErrorText.describe(error).contains("older Mero Chat"))
    }

    func testTheContractsOwnRefusalKeepsItsMessage() {
        XCTAssertEqual(ChatErrorText.describe(AppError("not a member")), "not a member")
    }

    /// `422 APP_ERROR {code, fields: {message}}`: v1's text when the contract sent it, else words for the code.
    func testTheComponentContractsCodesReadAsWords() {
        let banned = AppError(
            "app error", details: ["code": "Banned", "fields": .object(["message": "you are banned from this channel"])])
        XCTAssertEqual(ChatErrorText.describe(banned), "you are banned from this channel")
        let forbidden = AppError("app error", details: ["code": "Forbidden", "fields": .object([:])])
        XCTAssertEqual(ChatErrorText.describe(forbidden), "You can't do that in this channel.")
    }

    func testClusterErrorsInWords() {
        XCTAssertEqual(
            ChatErrorText.describe(ConfirmCancelled()), "You dismissed the passkey prompt, so nothing changed.")
        XCTAssertEqual(
            ChatErrorText.describe(WrongNode("not approved")),
            "This node runs a release your account hasn't approved. Try another node of the cluster.")
        XCTAssertEqual(ChatErrorText.describe(LoginRequired("expired")), "Your session ended. Sign in again.")
        XCTAssertTrue(ChatErrorText.describe(ReleaseDeadlineError("deadline passed")).contains("needs approval"))
        XCTAssertTrue(ChatErrorText.describe(URLError(.notConnectedToInternet)).contains("can't be reached"))
    }
}
