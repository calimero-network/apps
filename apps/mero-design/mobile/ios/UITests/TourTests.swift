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

        // Teams → Atlas Product → the onboarding board.
        tap("teams.card.0", after: 2.0, snap: "01-teams")
        tap("boards.card.0", after: 2.2, snap: "02-boards")

        // The whole board, fitted.
        let canvas = wait("board.canvas")
        wait("board.present")
        pause(2.5)
        snap("03-board")

        // Pinch in, then pan over to the welcome screen.
        canvas.pinch(withScale: 2.4, velocity: 1.5)
        pause(1.8)
        snap("04-zoomed")
        canvas.swipeRight(velocity: .slow)
        pause(0.6)
        canvas.swipeDown(velocity: .slow)
        pause(1.8)
        snap("05-zoomed-welcome")
        element("board.fit").tap()
        pause(1.5)

        // A comment pin → its thread, then the list.
        element("board.pin.0").tap()
        wait("composer.field")
        pause(2.0)
        snap("06-comment-thread")
        app.navigationBars["Thread"].buttons.element(boundBy: 0).tap()
        wait("comments.row.0")
        pause(1.8)
        snap("07-comments")

        // Add a comment, pinned where the board is centred.
        element("composer.field").tap()
        pause(0.6)
        type("Love the flow. Can the reminder screen preview the actual notification?")
        pause(1.0)
        snap("08-comment-typing")
        element("composer.send").tap()
        pause(2.0)
        app.swipeUp(velocity: .slow)
        pause(1.0)
        snap("09-comment-added")
        closeComments()
        pause(1.5)
        snap("10-board-pins")

        // Present: swipe through the four screens, then the grid.
        element("board.present").tap()
        wait("present.close")
        pause(2.2)
        snap("11-present-welcome")
        for name in ["12-present-habits", "13-present-reminder", "14-present-today"] {
            app.swipeLeft()
            pause(2.0)
            snap(name)
        }
        element("present.all").tap()
        wait("present.thumb.0")
        pause(2.0)
        snap("15-all-screens")
        element("present.thumb.1").tap()
        pause(1.5)
        element("present.close").tap()
        pause(1.5)

        // About this board.
        element("board.menu").tap()
        pause(0.8)
        let about = element("board.about")
        (about.waitForExistence(timeout: 3) ? about : app.buttons["About this board"]).tap()
        wait("sheet.done")
        pause(2.0)
        snap("16-about")
        app.swipeUp(velocity: .slow)
        pause(1.2)
        element("sheet.done").tap()
        pause(1.2)

        // Back to the teams, then the account sheet.
        back()
        pause(1.2)
        back()
        tap("teams.account", after: 1.2, snap: nil)
        wait("sheet.done")
        pause(2.0)
        snap("17-account")
        element("sheet.done").tap()
        pause(1.5)
    }

    // MARK: Helpers

    /// Swipe the comments sheet down until it is gone (the keyboard and the
    /// large detent can each take one swipe).
    private func closeComments() {
        for _ in 0..<3 {
            let bar = app.navigationBars["Comments"]
            guard bar.exists else { return }
            bar.swipeDown(velocity: .fast)
            pause(0.8)
        }
    }

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

    private func back() {
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    /// Type a few words at a time, so the recording reads like a person typing.
    private func type(_ text: String) {
        let words = text.split(separator: " ").map(String.init)
        stride(from: 0, to: words.count, by: 3).forEach { start in
            let chunk = words[start..<min(start + 3, words.count)].joined(separator: " ")
            app.typeText(chunk + (start + 3 < words.count ? " " : ""))
        }
    }

    /// Scales every linger; lower it to shorten the whole tour.
    private let pace = 0.8

    private func pause(_ seconds: TimeInterval) {
        Thread.sleep(forTimeInterval: seconds * pace)
    }

    /// A named screenshot, kept in the result bundle (`01-teams`, ...).
    private func snap(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
