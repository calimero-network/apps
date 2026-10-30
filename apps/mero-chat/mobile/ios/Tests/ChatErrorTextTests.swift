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

    func testClusterErrorsInWords() {
        XCTAssertEqual(ChatErrorText.describe(ConfirmCancelled()), "The passkey prompt was cancelled.")
        XCTAssertEqual(ChatErrorText.describe(LoginRequired("expired")), "Your session ended. Sign in again.")
        XCTAssertTrue(ChatErrorText.describe(ReleaseDeadlineError("deadline passed")).contains("needs approval"))
        XCTAssertTrue(ChatErrorText.describe(URLError(.notConnectedToInternet)).contains("can't be reached"))
    }
}
