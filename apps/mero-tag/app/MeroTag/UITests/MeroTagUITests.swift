import XCTest

/// Sign-in UI tests. A fresh install lands on Calimero Cloud sign-in; the node
/// form only appears behind "Manually enter node URL".
final class MeroTagUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testFreshLaunchShowsCloudSignInFirst() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["appTitle"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["cloudSignInButton"].exists)
        XCTAssertEqual(app.textFields.count, 0, "the node form stays hidden until asked for")
        XCTAssertEqual(app.secureTextFields.count, 0)
    }

    func testManualNodeURLSwapsInTheNodeForm() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["manualNode"].waitForExistence(timeout: 10))
        app.buttons["manualNode"].tap()
        XCTAssertTrue(app.buttons["nodeConnectButton"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["nodeURLField"].exists)
        XCTAssertTrue(app.secureTextFields["nodePassField"].exists)
        app.buttons["useCloud"].tap()
        XCTAssertTrue(app.buttons["cloudSignInButton"].waitForExistence(timeout: 5))
    }

    /// Against a live node: `TEST_RUNNER_MEROTAG_NODE=http://localhost:4201
    /// TEST_RUNNER_MEROTAG_SPACE=<context id> xcodebuild test …` (admin dev /
    /// dev-password). Skipped otherwise.
    func testNodeSignInOpensTheSpaceOnTheMap() throws {
        let env = ProcessInfo.processInfo.environment
        guard let node = env["MEROTAG_NODE"], let space = env["MEROTAG_SPACE"] else {
            throw XCTSkip("set TEST_RUNNER_MEROTAG_NODE and TEST_RUNNER_MEROTAG_SPACE to run against a node")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEROTAG_NODE"] = node
        app.launchEnvironment["MEROTAG_NODE_USER"] = env["MEROTAG_NODE_USER"] ?? "dev"
        app.launchEnvironment["MEROTAG_NODE_PASS"] = env["MEROTAG_NODE_PASS"] ?? "dev-password"
        app.launchEnvironment["MEROTAG_SPACE"] = space
        app.launchEnvironment["MEROTAG_NAME"] = "Sam"
        app.launch()
        XCTAssertTrue(app.buttons["personChip"].firstMatch.waitForExistence(timeout: 30), "no people on the map")
        app.tabBars.buttons["People"].tap()
        XCTAssertTrue(app.buttons["trackerRow"].firstMatch.waitForExistence(timeout: 10))
    }
}
