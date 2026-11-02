import Foundation
import MeroKit
import XCTest

@testable import UpdatesCore

final class ErrorTextTests: XCTestCase {
    func testContractRefusalsInWords() {
        func app(_ code: String, _ message: String?) -> AppError {
            AppError(
                "refused",
                details: ["code": .string(code), "fields": .object(message.map { ["message": .string($0)] } ?? [:])])
        }
        XCTAssertEqual(
            ErrorText.describe(app("Forbidden", "only the team may publish an update")),
            "Only the team may publish an update.")
        XCTAssertEqual(ErrorText.describe(app("NotFound", nil)), "That is no longer here. It may have been deleted.")
        XCTAssertEqual(ErrorText.describe(app("Invalid", "")), "Check what you entered and try again.")
    }

    func testClusterErrorsInWords() {
        XCTAssertEqual(ErrorText.describe(ConfirmCancelled()), "The passkey prompt was cancelled, so nothing changed.")
        XCTAssertEqual(ErrorText.describe(LoginRequired("expired")), "Your session ended. Sign in again.")
        XCTAssertTrue(ErrorText.describe(WrongNode("moved")).contains("Sign in again"))
        XCTAssertTrue(ErrorText.describe(ReleaseDeadlineError("late")).contains("Approvals"))
    }
}
