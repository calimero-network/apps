import XCTest

/// Smoke UI test — launches the app, checks the animated welcome screen, then
/// reveals the login card. Run from Xcode or `make app-test`.
final class MeroTagUITests: XCTestCase {
    func testWelcomeThenLoginAppears() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Mero Tag"].waitForExistence(timeout: 5))
        let getStarted = app.buttons["Get Started"]
        XCTAssertTrue(getStarted.waitForExistence(timeout: 5))
        getStarted.tap()
        XCTAssertTrue(app.buttons["Connect"].waitForExistence(timeout: 3))
    }
}
