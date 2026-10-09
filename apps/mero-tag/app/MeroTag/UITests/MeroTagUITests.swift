import XCTest

/// Smoke UI test: a fresh install lands on Cloud sign-in — one "Continue with
/// Calimero" button, and no node URL or password fields anywhere.
final class MeroTagUITests: XCTestCase {
    func testFreshLaunchShowsCloudSignInOnly() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["appTitle"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["cloudSignInButton"].exists)
        XCTAssertEqual(app.textFields.count, 0, "sign-in must not ask for a node URL or credentials")
        XCTAssertEqual(app.secureTextFields.count, 0)
    }
}
