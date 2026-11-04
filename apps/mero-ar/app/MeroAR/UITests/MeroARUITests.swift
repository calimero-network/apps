import XCTest

/// UI tests. The first runs anywhere; the rest drive a development cluster
/// (`merod local`, mock attestation) and skip unless one is given:
///
///     TEST_RUNNER_MEROAR_TEST_NODE=http://localhost:2501 \
///       xcodebuild test … -only-testing:MeroARUITests
///
/// `TEST_RUNNER_MEROAR_PAUSE=1` holds each screen for a moment.
final class MeroARUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment

    override func setUp() {
        continueAfterFailure = false
    }

    func testSignInOffersCloudAndADevelopmentCluster() {
        let app = XCUIApplication()
        app.launch()
        expect(app.staticTexts["Mero AR"], 8)
        expect(app.buttons["cloudSignInButton"], 5)
        XCTAssertTrue(app.textFields["clusterURLField"].exists)
        XCTAssertTrue(app.buttons["createAccountButton"].exists)
        XCTAssertFalse(app.textFields["nodeURLField"].exists, "the development form is behind the link")
        pause()
        app.buttons["manualNode"].tap()
        expect(app.textFields["nodeURLField"], 5)
        XCTAssertTrue(app.buttons["nodeConnectButton"].exists)
        pause()
        app.buttons["useCloud"].tap()
        expect(app.buttons["cloudSignInButton"], 5)
    }

    /// Node sign-in → new room → place objects → a note → an invite → leave.
    func testBuildARoomOnANode() throws {
        guard let node = env["MEROAR_TEST_NODE"]
        else { throw XCTSkip("set MEROAR_TEST_NODE to run against a development cluster") }
        let app = XCUIApplication()
        app.launchArguments += ["-meroar.devNodeURL", node, "-meroar.username", "Maya"]
        app.launchEnvironment["MEROAR_PREVIEW"] = "1"
        app.launch()

        expect(app.buttons["manualNode"], 8)
        pause(2)
        app.buttons["manualNode"].tap()
        let password = app.textFields["nodeURLField"]
        expect(password, 5)
        password.tap()
        pause(1)
        let create = app.buttons["createHomeButton"]
        signIn(app, password: password, until: create)
        dismissSavePassword(app)
        pause(2)
        let name = app.textFields["homeNameInput"]
        tap(create, until: name)
        name.tap()
        name.typeText((env["MEROAR_TEST_ROOM"] ?? "Living room") + "\n")

        let add = app.buttons["addObjectButton"]
        expect(add, 90, "room did not open")
        XCTAssertTrue(app.staticTexts["3D preview · live AR needs an ARKit iPhone or iPad"].exists || app.otherElements["previewBanner"].exists)
        pause(2)
        for kind in ["cube", "sphere", "marker"] {
            let place = app.buttons["place-\(kind)"]
            tap(add, until: place)
            pause(1)
            place.tap()
            pause(1.5)
        }
        XCTAssertTrue(
            app.staticTexts.containing(NSPredicate(format: "label CONTAINS '3 objects'")).firstMatch
                .waitForExistence(timeout: 20)
                || app.otherElements["roomStatus"].label.contains("3 objects"),
            "objects did not land")

        let comment = app.textFields["commentInput"]
        tap(app.buttons["commentsButton"], until: comment)
        comment.tap()
        comment.typeText("Sofa goes here\n")
        expect(app.staticTexts["Sofa goes here"], 20, "note not posted")
        pause(2)
        closeSheet(app)

        let invite = app.buttons["createInviteButton"]
        tap(app.buttons["membersButton"], until: invite)
        pause(1)
        invite.tap()
        expect(app.buttons["shareInviteButton"], 30, "invite not minted")
        pause(3)
        closeSheet(app)
        pause(4)

        app.buttons["leaveButton"].tap()
        expect(app.buttons["createHomeButton"], 10)
        pause(3)
    }

    /// The sample room, shared: put the sample in a new room, add two items,
    /// drag one across the floor plan. `scripts/e2e-room-scan.sh` runs this,
    /// then checks a second node (Leo) sees the room and the items.
    func testSampleRoomAddAndMoveItems() throws {
        guard let node = env["MEROAR_TEST_NODE"]
        else { throw XCTSkip("set MEROAR_TEST_NODE to run against a development cluster") }
        let app = XCUIApplication()
        app.launchArguments += ["-meroar.devNodeURL", node, "-meroar.username", "Maya"]
        app.launchEnvironment["MEROAR_PREVIEW"] = "1"
        if let bundle = env["MEROAR_APP_BUNDLE"] { app.launchEnvironment["MEROAR_APP_BUNDLE"] = bundle }
        app.launch()

        expect(app.buttons["manualNode"], 10)
        app.buttons["manualNode"].tap()
        let password = app.textFields["nodeURLField"]
        expect(password, 5)
        password.tap()
        let create = app.buttons["createHomeButton"]
        signIn(app, password: password, until: create)
        dismissSavePassword(app)
        let name = app.textFields["homeNameInput"]
        tap(create, until: name)
        name.tap()
        name.typeText((env["MEROAR_TEST_ROOM"] ?? "Sample room test") + "\n")
        expect(app.buttons["addObjectButton"], 90, "room did not open")
        pause(2)

        // The sample room, clearly labelled.
        let sampleItem = app.buttons["Try a sample room"]
        tap(app.buttons["addRoomPrompt"], until: sampleItem)
        sampleItem.tap()
        let pill = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Sample room'")).firstMatch
        expect(pill, 30, "the sample room was not shared")
        pause(3)

        // Two items.
        for kind in ["cube", "sphere"] {
            let place = app.buttons["place-\(kind)"]
            tap(app.buttons["addObjectButton"], until: place)
            pause(1)
            place.tap()
            pause(1.5)
        }
        expect(app.staticTexts.containing(NSPredicate(format: "label CONTAINS '2 objects'")).firstMatch, 20)

        // Floor plan, then drag one item across the floor (the canvas lists
        // placed objects to accessibility at their on-screen positions).
        app.buttons["floorPlanButton"].tap()
        pause(2)
        let item = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'sceneObject-'")).firstMatch
        expect(item, 10, "no placed object on the floor plan")
        let start = item.frame
        item.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.3, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.42)))
        pause(3)
        expect(app.buttons["closeInspectorButton"], 10, "dragging didn't pick the item up")
        let moved = app.buttons.matching(NSPredicate(format: "identifier == %@", item.identifier)).firstMatch
        XCTAssertGreaterThan(hypot(moved.frame.midX - start.midX, moved.frame.midY - start.midY), 30, "the item didn't move")
        app.buttons["closeInspectorButton"].tap()
        pause(env["MEROAR_HOLD"].flatMap(Double.init) ?? 2)
    }

    /// Submit the node form from the keyboard (Return runs the same connect as
    /// the button, which a tap can miss while the keyboard is up), then the
    /// button as a fallback.
    private func signIn(_ app: XCUIApplication, password: XCUIElement, until lobby: XCUIElement) {
        password.typeText("\n")
        if lobby.waitForExistence(timeout: 15) { return }
        let connect = app.buttons["nodeConnectButton"]
        if connect.exists { connect.tap() }
        expect(lobby, 20, "did not reach the lobby")
    }

    private func closeSheet(_ app: XCUIApplication) {
        let close = app.buttons["closeSheetButton"].firstMatch
        if close.waitForExistence(timeout: 3) {
            close.tap()
            _ = close.waitForNonExistence(timeout: 5)
        }
    }

    /// iOS offers to save the node password after sign-in; that sheet sits
    /// over the app and swallows the next tap.
    private func dismissSavePassword(_ app: XCUIApplication) {
        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: 3) {
            notNow.tap()
            _ = notNow.waitForNonExistence(timeout: 5)
        }
    }

    /// Taps `button` until `target` appears (a sheet can swallow a tap that
    /// lands while another is still animating away).
    private func tap(_ button: XCUIElement, until target: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<3 {
            if button.waitForExistence(timeout: 5) { button.tap() }
            if target.waitForExistence(timeout: 4) { return }
        }
        expect(target, 1, "tapping \(button) never showed it", file: file, line: line)
    }

    /// Waits for `element`; on a miss, prints the screen's element tree so the
    /// log says what was there instead.
    private func expect(
        _ element: XCUIElement, _ timeout: TimeInterval, _ message: String = "", file: StaticString = #filePath,
        line: UInt = #line
    ) {
        if element.waitForExistence(timeout: timeout) { return }
        print("UI-TREE:\n\(XCUIApplication().debugDescription)")
        XCTFail("missing \(element): \(message)", file: file, line: line)
    }

    /// Holds the screen when `MEROAR_PAUSE` is set, for recordings.
    private func pause(_ seconds: Double = 1.5) {
        if env["MEROAR_PAUSE"] != nil { Thread.sleep(forTimeInterval: seconds) }
    }
}
