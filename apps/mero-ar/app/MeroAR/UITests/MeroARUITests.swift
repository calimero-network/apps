import XCTest

/// Smoke UI test — launches the app on a clean install and checks the Cloud
/// sign-in screen. There is no node URL or password field to find: mobile
/// sign-in is "Continue with Calimero" only. Run from Xcode or `make app-test`.
final class MeroARUITests: XCTestCase {
    func testSignInScreenIsCloudOnly() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Mero AR"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["cloudSignInButton"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["Node URL"].exists)
        XCTAssertFalse(app.secureTextFields["Password"].exists)
    }
}
