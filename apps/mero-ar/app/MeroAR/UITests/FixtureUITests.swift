import XCTest

/// The UI end to end with no node: the app is launched with `MEROAR_FIXTURE=1`,
/// which signs it in to an in-memory Calimero cluster with Mero AR's contract
/// (`FixtureCluster`, debug builds only). The fixture's state is kept in a file
/// between launches, so relaunching as someone else is a second person on the
/// same cluster.
final class FixtureUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    // MARK: - One person, every screen

    /// Nickname → empty lobby → new home → objects, a label, the 3D room, the
    /// floor plan, the inspector, notes, People (invite, nickname) → back in
    /// the lobby: the home, its invite, a second room.
    func testBuildAHomeFromAnEmptyLobby() {
        let app = launch(as: "maya", reset: true, nickname: nil)

        // First run asks for a nickname.
        let nickname = app.textFields["nicknameInput"]
        expect(nickname, 15, "no nickname prompt on first run")
        nickname.tap()
        nickname.typeText("Maya")
        app.buttons["saveNicknameButton"].tap()

        // An empty lobby offers to create a home.
        expect(app.buttons["createFirstHomeButton"], 10, "an empty lobby didn't offer a first home")
        XCTAssertTrue(app.staticTexts["No homes yet"].exists)
        XCTAssertTrue(app.staticTexts["Hi, Maya"].exists)

        let homeName = app.textFields["homeNameInput"]
        tap(app.buttons["createHomeButton"], until: homeName)
        homeName.tap()
        homeName.typeText("Our flat")
        XCTAssertEqual(app.textFields["roomNameInput"].value as? String, "Living room", "the first room isn't prefilled")
        app.buttons["confirmCreateHomeButton"].tap()

        // In the room.
        let add = app.buttons["addObjectButton"]
        expect(add, 30, "the new room didn't open")
        expectStatus(app, "0 objects")
        XCTAssertTrue(app.staticTexts["Living room"].exists)

        for kind in ["cube", "sphere"] { place(app, kind) }
        expectStatus(app, "2 objects")

        let label = app.textFields["labelInput"]
        tap(add, until: label)
        label.tap()
        label.typeText("Window\n")
        expectStatus(app, "3 objects")

        // The 3D room.
        let sample = app.buttons["Try a sample room"]
        tap(app.buttons["addRoomPrompt"], until: sample)
        sample.tap()
        let pill = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Sample room'")).firstMatch
        expect(pill, 20, "the sample room wasn't shared")
        XCTAssertFalse(app.buttons["addRoomPrompt"].exists, "still offering to add a room that's there")

        // Floor plan; select an object and use the inspector.
        app.buttons["floorPlanButton"].tap()
        let object = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'sceneObject-'")).firstMatch
        expect(object, 10, "no placed object on the floor plan")
        object.tap()
        expect(app.buttons["closeInspectorButton"], 10, "tapping an object didn't select it")
        app.buttons["nudge-right"].tap()
        app.buttons["rotate"].tap()
        let lock = app.buttons["lockObjectButton"]
        lock.tap()
        expect(app.buttons.matching(NSPredicate(format: "identifier == 'lockObjectButton' AND label CONTAINS 'Unlock'")).firstMatch, 10)
        lock.tap()
        app.buttons["deleteObjectButton"].tap()
        expectStatus(app, "2 objects")

        // Notes.
        let note = app.textFields["commentInput"]
        tap(app.buttons["commentsButton"], until: note)
        note.tap()
        note.typeText("Sofa goes here\n")
        expect(app.staticTexts["Sofa goes here"], 10, "the note didn't post")
        closeSheet(app)

        // People: an invite to the room, and a new nickname.
        let invite = app.buttons["createInviteButton"]
        tap(app.buttons["peopleButton"], until: invite)
        expect(app.staticTexts["Maya (you)"], 10)
        invite.tap()
        let link = app.descendants(matching: .any)["inviteLink"]
        expect(link, 15, "no invite link")
        XCTAssertTrue((link.value as? String ?? "").hasPrefix("https://links.calimero.network/"), "\(link.value ?? "")")
        XCTAssertTrue(app.buttons["shareInviteButton"].exists)

        let edit = app.buttons["editNicknameButton"]
        edit.tap()
        let rename = app.textFields["nicknameInput"]
        expect(rename, 5)
        rename.tap()
        rename.clearAndType("Maya R")
        app.buttons["saveNicknameButton"].tap()
        expect(app.staticTexts["Maya R (you)"], 10, "the roster didn't take the new nickname")
        closeSheet(app)

        // Back in the lobby: the home, with its room.
        app.buttons["leaveButton"].tap()
        expect(app.staticTexts["Our flat"], 10, "the home isn't listed")
        XCTAssertTrue(app.staticTexts["Living room"].exists)

        // Invite to the whole home.
        let homeInvite = app.buttons["createInviteButton"]
        tap(app.buttons["inviteHomeButton"], until: homeInvite)
        homeInvite.tap()
        expect(app.descendants(matching: .any)["inviteLink"], 15, "no home invite link")
        closeSheet(app)

        // A second room in the home.
        let roomName = app.textFields["roomNameInput"]
        tap(app.buttons["createRoomButton"], until: roomName)
        roomName.tap()
        roomName.typeText("Bedroom")
        app.buttons["confirmCreateRoomButton"].tap()
        expect(app.buttons["addObjectButton"], 30, "the second room didn't open")
        XCTAssertTrue(app.staticTexts["Bedroom"].exists)
        app.buttons["leaveButton"].tap()
        expect(app.staticTexts["Bedroom"], 10)
        XCTAssertTrue(app.staticTexts["Living room"].exists)
        XCTAssertTrue(app.staticTexts["2 rooms"].exists)
    }

    // MARK: - Two people

    /// Maya builds and invites; Sam joins with the link, sees the 3D room and
    /// the objects view-only; Maya makes Sam an editor; Sam adds something.
    func testAnInviteeJoinsSeesTheRoomAndCanEditOnceGranted() {
        // Maya: a home, a room with an object and the 3D room, an invite.
        var app = launch(as: "maya", reset: true, nickname: "Maya")
        let homeName = app.textFields["homeNameInput"]
        tap(app.buttons["createHomeButton"], until: homeName)
        homeName.tap()
        homeName.typeText("Our flat\n")
        expect(app.buttons["addObjectButton"], 30, "the room didn't open")
        place(app, "cube")
        expectStatus(app, "1 objects")
        let sample = app.buttons["Try a sample room"]
        tap(app.buttons["addRoomPrompt"], until: sample)
        sample.tap()
        expect(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Sample room'")).firstMatch, 20)
        app.buttons["leaveButton"].tap()
        let mint = app.buttons["createInviteButton"]
        tap(app.buttons["inviteHomeButton"], until: mint)
        mint.tap()
        let linkElement = app.descendants(matching: .any)["inviteLink"]
        expect(linkElement, 15)
        let link = linkElement.value as? String ?? ""
        XCTAssertFalse(link.isEmpty, "couldn't read the invite link")
        app.terminate()

        // Sam: a nickname, an empty lobby, then Join with the link.
        app = launch(as: "sam", nickname: nil, freshUser: true)
        let nickname = app.textFields["nicknameInput"]
        expect(nickname, 15)
        nickname.tap()
        nickname.typeText("Sam")
        app.buttons["saveNicknameButton"].tap()
        expect(app.staticTexts["No homes yet"], 10, "Sam sees a home before being invited")

        let field = app.textFields["roomInput"]
        tap(app.buttons["joinRoomButton"], until: field)
        field.tap()
        field.typeText(link)
        let join = app.buttons["enterRoomButton"]
        expect(app.staticTexts["Invite to Our flat"], 5, "the pasted link wasn't recognised")
        join.tap()
        expect(app.descendants(matching: .any)["homeNotice"], 20, "joining the home said nothing")
        expect(app.staticTexts["Our flat"], 5)

        // The room, as a viewer: the 3D room and the object, no tools.
        enterFirstRoom(app)
        expect(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Sample room'")).firstMatch, 20,
               "the invitee doesn't see the shared 3D room")
        expectStatus(app, "1 objects")
        expect(app.staticTexts["View only"], 10)
        XCTAssertFalse(app.buttons["addObjectButton"].exists, "a viewer is offered Add")
        app.terminate()

        // Maya makes Sam an editor.
        app = launch(as: "maya", nickname: "Maya")
        enterFirstRoom(app)
        let toggle = app.switches.matching(NSPredicate(format: "identifier BEGINSWITH 'editorToggle-'")).firstMatch
        tap(app.buttons["peopleButton"], until: toggle)
        expect(app.staticTexts["Sam"], 5, "Sam isn't on the roster")
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)).tap()
        expect(app.switches.matching(NSPredicate(format: "identifier BEGINSWITH 'editorToggle-' AND value == '1'")).firstMatch, 10,
               "granting editor didn't stick")
        app.terminate()

        // Sam can add now.
        app = launch(as: "sam", nickname: nil)
        enterFirstRoom(app)
        expect(app.buttons["addObjectButton"], 20, "Sam still can't edit after the grant")
        place(app, "sphere")
        expectStatus(app, "2 objects")
    }

    /// A broken or foreign link is refused with a message, and nothing is joined.
    func testAJunkInviteIsRefused() {
        let app = launch(as: "maya", reset: true, nickname: "Maya")
        let field = app.textFields["roomInput"]
        tap(app.buttons["joinRoomButton"], until: field)
        field.tap()
        field.typeText("not-a-room")
        app.buttons["enterRoomButton"].tap()
        expect(app.descendants(matching: .any)["roomError"], 15, "a bad room id was accepted silently")
        closeSheet(app)
        XCTAssertTrue(app.staticTexts["No homes yet"].exists)
    }

    // MARK: - Helpers

    private func launch(as user: String, reset: Bool = false, nickname: String? = "Maya", freshUser: Bool = false)
        -> XCUIApplication
    {
        let app = XCUIApplication()
        app.launchEnvironment["MEROAR_FIXTURE"] = "1"
        app.launchEnvironment["MEROAR_FIXTURE_RESET"] = reset ? "1" : "0"
        app.launchEnvironment["MEROAR_FIXTURE_FRESH_USER"] = freshUser ? "1" : "0"
        app.launchEnvironment["MEROAR_FIXTURE_USER"] = user
        app.launchEnvironment["MEROAR_PREVIEW"] = "1"
        if let nickname { app.launchArguments += ["-meroar.username", nickname] }
        app.launch()
        return app
    }

    private func place(_ app: XCUIApplication, _ kind: String) {
        let tile = app.buttons["place-\(kind)"]
        tap(app.buttons["addObjectButton"], until: tile)
        tile.tap()
        _ = tile.waitForNonExistence(timeout: 5)
    }

    private func enterFirstRoom(_ app: XCUIApplication) {
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'roomRow-'")).firstMatch
        expect(row, 20, "no room listed")
        tap(row, until: app.buttons["peopleButton"])
    }

    private func expectStatus(_ app: XCUIApplication, _ text: String, file: StaticString = #filePath, line: UInt = #line) {
        let status = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier == 'roomStatus' AND label CONTAINS %@", text)
        ).firstMatch
        expect(status, 20, "room status never said \(text)", file: file, line: line)
    }

    private func closeSheet(_ app: XCUIApplication) {
        let close = app.buttons["closeSheetButton"].firstMatch
        if close.waitForExistence(timeout: 3) {
            close.tap()
            _ = close.waitForNonExistence(timeout: 5)
        }
    }

    private func tap(_ button: XCUIElement, until target: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<3 {
            if button.waitForExistence(timeout: 5) { button.tap() }
            if target.waitForExistence(timeout: 4) { return }
        }
        expect(target, 1, "tapping \(button) never showed it", file: file, line: line)
    }

    private func expect(
        _ element: XCUIElement, _ timeout: TimeInterval, _ message: String = "", file: StaticString = #filePath,
        line: UInt = #line
    ) {
        if element.waitForExistence(timeout: timeout) { return }
        print("UI-TREE:\n\(XCUIApplication().debugDescription)")
        XCTFail("missing \(element): \(message)", file: file, line: line)
    }
}

private extension XCUIElement {
    func clearAndType(_ text: String) {
        if let current = value as? String, !current.isEmpty {
            typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        typeText(text)
    }
}
