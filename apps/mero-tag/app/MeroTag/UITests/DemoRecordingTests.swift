import XCTest

/// Drives the flows the landing page's screen recordings show, slowly enough
/// to film. Skipped unless `TEST_RUNNER_DEMO_RECORD=1`; `scripts/record-demo.sh`
/// sets it, starts `simctl io recordVideo` around each test, and runs the
/// seeder that moves the demo friends.
final class DemoRecordingTests: XCTestCase {
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard env["DEMO_RECORD"] == "1" else { throw XCTSkip("demo recordings only (DEMO_RECORD=1)") }
    }

    private func pause(_ seconds: Double) { Thread.sleep(forTimeInterval: seconds) }

    /// Note the wall-clock time of `mark` ("start" / "end") for the recording
    /// script, which trims each video to the flow itself.
    private func mark(_ mark: String) {
        guard let dir = env["DEMO_MARKS"] else { return }
        let name = String(name.split(separator: " ").last?.dropLast() ?? "test")
        let path = "\(dir)/\(name).\(mark)"
        try? String(Date().timeIntervalSince1970).write(toFile: path, atomically: true, encoding: .utf8)
    }


    private func launchSignedIn() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["MEROTAG_NODE"] = env["MEROTAG_NODE"] ?? "http://localhost:4201"
        app.launchEnvironment["MEROTAG_NODE_USER"] = "dev"
        app.launchEnvironment["MEROTAG_NODE_PASS"] = "dev-password"
        app.launchEnvironment["MEROTAG_SPACE"] = env["MEROTAG_SPACE"] ?? ""
        app.launchEnvironment["MEROTAG_NAME"] = "Sam"
        app.launch()
        return app
    }

    func test1SignIn() {
        let app = XCUIApplication()
        app.launchEnvironment["MEROTAG_PREFILL_URL"] = env["MEROTAG_NODE"] ?? "http://localhost:4201"
        // A secure field can't take synthesized typing reliably in the Simulator.
        app.launchEnvironment["MEROTAG_PREFILL_PASS"] = "dev-password"
        app.launch()
        XCTAssertTrue(app.buttons["manualNode"].waitForExistence(timeout: 10))
        mark("start")
        pause(4)
        app.buttons["manualNode"].tap()
        pause(1.5)
        pause(2)
        app.buttons["nodeConnectButton"].tap()
        pause(4)
        mark("end")
    }

    func test2LiveMap() {
        let app = launchSignedIn()
        XCTAssertTrue(app.buttons["personChip"].firstMatch.waitForExistence(timeout: 30))
        mark("start")
        pause(5)
        app.buttons.matching(identifier: "personChip").element(boundBy: 0).tap()
        pause(5)
        app.buttons.matching(identifier: "personChip").element(boundBy: 1).tap()
        pause(5)
        app.buttons["Show everyone"].tap()
        pause(4)
        mark("end")
    }

    func test3ShareThisPhone() {
        let app = launchSignedIn()
        XCTAssertTrue(app.tabBars.buttons["People"].waitForExistence(timeout: 30))
        mark("start")
        pause(2)
        app.tabBars.buttons["People"].tap()
        pause(2.5)
        app.buttons["newTrackerButton"].tap()
        let name = app.textFields["trackerNameField"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Sam's iPhone")
        pause(1)
        app.buttons["createTrackerButton"].tap()
        pause(3)
        app.tabBars.buttons["Map"].tap()
        pause(7)
        mark("end")
    }

    func test4InvitePeople() {
        let app = launchSignedIn()
        XCTAssertTrue(app.tabBars.buttons["Space"].waitForExistence(timeout: 30))
        mark("start")
        pause(1.5)
        app.tabBars.buttons["Space"].tap()
        pause(3)
        if app.buttons["createInviteButton"].waitForExistence(timeout: 5) {
            app.buttons["createInviteButton"].tap()
            pause(6)
        }
        app.swipeUp()
        pause(3)
        mark("end")
    }
}
