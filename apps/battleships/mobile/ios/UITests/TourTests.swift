import XCTest

/// The demo tour: every main screen and sheet at a human pace, on the demo
/// account (`-MeroDemo YES`, Debug only), with a named screenshot at each stop.
/// apps-capture/ios-capture.sh records the simulator while this runs and
/// exports the screenshots from the result bundle.
final class TourTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-MeroDemo", "YES"]
    }

    func testTour() {
        app.launch()

        // Lobbies → Anchor Bay Regulars.
        tap("lobbies.card.0", after: 2.0, snap: "01-lobbies")

        // The lobby: matches, players, record and history.
        wait("lobby.match.0")
        pause(2.0)
        snap("02-matches")
        segment("Players")
        pause(1.8)
        snap("03-players")
        segment("Record")
        pause(1.8)
        snap("04-record")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("05-history")
        app.swipeDown(velocity: .fast)
        pause(0.8)
        segment("Matches")
        pause(1.0)

        // Invite players.
        element("lobby.invite").tap()
        wait("invite.share")
        pause(2.0)
        snap("06-invite")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
        pause(1.2)

        // New match: challenge a player.
        element("lobby.newMatch").tap()
        let opponent = wait("challenge.player.0")
        pause(1.8)
        snap("07-new-match")
        opponent.buttons["Challenge"].firstMatch.tap()

        // Place the fleet: tap to place, switch to "Down", tap a ship to turn it.
        wait("match.placing")
        pause(1.8)
        snap("08-placement")
        tap("place.C2", after: 0.6, snap: nil)  // carrier, across
        pause(0.8)
        element("match.orientation").tap()
        pause(0.6)
        element("place.I4").tap()  // battleship, down
        pause(1.2)
        snap("09-placing")
        element("place.E2").tap()  // turn the carrier
        pause(1.5)
        snap("10-rotated")
        element("place.E9").tap()  // cruiser
        pause(0.7)
        element("place.G4").tap()  // submarine
        pause(0.7)
        element("place.A9").tap()  // destroyer
        pause(1.5)
        snap("11-fleet-placed")
        element("match.deploy").tap()
        wait("match.waiting")
        pause(2.0)
        snap("12-deployed")
        back()

        // The match against Ines, late in the game: hits, misses, four ships sunk.
        tap("lobby.match.1", after: 1.2, snap: nil)
        wait("match.turn")
        pause(2.0)
        snap("13-battle")
        segment("Your fleet")
        pause(1.8)
        snap("14-your-fleet")
        segment("Their waters")
        pause(1.0)

        // Aim at H6, next to the hit on her destroyer, and fire: it sinks her last ship.
        element("target.H6").tap()
        pause(1.4)
        snap("15-aim")
        element("match.fire").tap()
        wait("match.result")
        pause(2.2)
        snap("16-victory")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("17-result-board")

        // Back in the lobby: the win is in the matches and the record.
        element("match.lobby").tap()
        wait("lobby.match.0")
        pause(1.5)
        snap("18-lobby-after")
        segment("Record")
        pause(1.8)
        snap("19-record-after")
    }

    // MARK: Helpers

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @discardableResult
    private func wait(_ id: String, timeout: TimeInterval = 10) -> XCUIElement {
        let found = element(id)
        XCTAssertTrue(found.waitForExistence(timeout: timeout), "\(id) never appeared")
        return found
    }

    /// Wait for `id`, linger, take a screenshot (when named), then tap it.
    private func tap(_ id: String, after seconds: TimeInterval, snap name: String?) {
        let target = wait(id)
        pause(seconds)
        if let name { snap(name) }
        target.tap()
    }

    /// A segment of the screen's segmented control, by its title.
    private func segment(_ title: String) {
        let button = app.segmentedControls.buttons[title].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 5), "segment \(title) never appeared")
        button.tap()
    }

    private func back() {
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    /// Scales every linger; lower it to shorten the whole tour.
    private let pace = 0.8

    private func pause(_ seconds: TimeInterval) {
        Thread.sleep(forTimeInterval: seconds * pace)
    }

    /// A named screenshot, kept in the result bundle (`01-lobbies`, ...).
    private func snap(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
