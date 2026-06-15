import XCTest

/// Smoke UI test — launches the app, checks the animated welcome screen, then
/// reveals the login card. Run from Xcode or `make app-test`.
final class MeroARUITests: XCTestCase {
    func testWelcomeThenLoginAppears() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Mero AR"].waitForExistence(timeout: 5))
        let enter = app.buttons["Enter a Room"]
        XCTAssertTrue(enter.waitForExistence(timeout: 5))
        enter.tap()
        XCTAssertTrue(app.buttons["Enter Room"].waitForExistence(timeout: 3))
    }
}
