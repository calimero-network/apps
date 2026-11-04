import XCTest

/// Sign-in UI tests. A fresh install lands on passkey sign-in with the
/// cluster address; account creation and the development cluster sit behind
/// their own links.
final class MeroTagUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testFreshLaunchShowsPasskeySignInFirst() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["appTitle"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["passkeySignInButton"].exists)
        XCTAssertTrue(app.textFields["clusterURLField"].exists)
        XCTAssertEqual(app.secureTextFields.count, 0, "passkeys: there is no password field")
    }

    func testDevelopmentClusterSwapsInTheNodeForm() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["showDevelopment"].waitForExistence(timeout: 10))
        app.buttons["showDevelopment"].tap()
        XCTAssertTrue(app.buttons["devConnectButton"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["nodeURLField"].exists)
        app.buttons["showSignIn"].tap()
        XCTAssertTrue(app.buttons["passkeySignInButton"].waitForExistence(timeout: 5))
    }

    func testCreateAccountAsksForAName() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["showCreateAccount"].waitForExistence(timeout: 10))
        app.buttons["showCreateAccount"].tap()
        XCTAssertTrue(app.textFields["accountNameField"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["createAccountButton"].exists)
    }

    /// Against a `merod local` cluster: `TEST_RUNNER_MEROTAG_DEV_NODE=http://localhost:2501
    /// TEST_RUNNER_MEROTAG_SPACE=<app id> xcodebuild test …`. Skipped otherwise.
    func testDevClusterSignInOpensTheSpaceOnTheMap() throws {
        let env = ProcessInfo.processInfo.environment
        guard let node = env["MEROTAG_DEV_NODE"], let space = env["MEROTAG_SPACE"] else {
            throw XCTSkip("set TEST_RUNNER_MEROTAG_DEV_NODE and TEST_RUNNER_MEROTAG_SPACE to run against a cluster")
        }
        let app = XCUIApplication()
        app.launchEnvironment["MEROTAG_DEV_NODE"] = node
        app.launchEnvironment["MEROTAG_SPACE"] = space
        app.launchEnvironment["MEROTAG_NAME"] = "Sam"
        app.launch()
        XCTAssertTrue(app.buttons["personChip"].firstMatch.waitForExistence(timeout: 30), "no people on the map")
        app.tabBars.buttons["People"].tap()
        XCTAssertTrue(app.buttons["trackerRow"].firstMatch.waitForExistence(timeout: 10))
    }
}
