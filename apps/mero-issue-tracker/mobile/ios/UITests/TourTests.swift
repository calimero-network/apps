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

        // The issue list, grouped by status.
        wait("issues.row.0")
        pause(2.2)
        snap("01-issues")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("02-issues-scrolled")
        app.swipeDown(velocity: .fast)
        app.swipeDown(velocity: .fast)
        pause(1.0)

        // The repository switcher.
        element("repo.switcher").tap()
        pause(1.5)
        snap("03-repo-switcher")
        app.buttons["sync-engine"].firstMatch.tap()
        pause(1.0)

        // Filters: high priority only.
        element("issues.filters").tap()
        wait("sheet.done")
        pause(1.0)
        element("filters.priority").tap()
        pause(0.8)
        app.buttons["High"].firstMatch.tap()
        pause(1.5)
        snap("04-filters")
        element("sheet.done").tap()
        pause(2.0)
        snap("05-filtered")
        element("issues.clearFilters").tap()
        pause(1.2)

        // The board: Open, then "Move to…" on a card.
        app.tabBars.buttons["Board"].tap()
        wait("board.card.open.0")
        pause(2.0)
        snap("06-board-open")
        element("board.move.open.1").tap()
        pause(1.5)
        snap("07-move-to")
        tapMenuItem("move.in-progress", label: "In progress")
        pause(1.8)

        // Swipe through the columns.
        app.swipeLeft()
        pause(2.0)
        snap("08-board-in-progress")
        app.swipeLeft()
        pause(1.8)
        snap("09-board-blocked")
        app.swipeLeft()
        pause(1.8)
        snap("10-board-done")

        // An issue, its sections and its comments.
        app.tabBars.buttons["Issues"].tap()
        tap("issues.row.0", after: 1.0, snap: nil)
        wait("detail.commentField")
        pause(2.0)
        snap("11-issue")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("12-issue-sections")
        app.swipeUp(velocity: .slow)
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("13-comments")

        // Comment.
        element("detail.commentField").tap()
        pause(0.6)
        type("Pairing with Marcus on the fix this afternoon, will post the PR here.")
        pause(0.8)
        snap("14-comment-typing")
        element("detail.send").tap()
        pause(2.0)
        app.swipeUp(velocity: .slow)
        pause(1.2)
        snap("15-comment-sent")
        back()
        pause(1.2)

        // File a new issue.
        element("issues.new").tap()
        wait("newIssue.title")
        pause(1.0)
        snap("16-new-issue")
        element("newIssue.title").tap()
        type("Sync stalls when switching from Wi-Fi to cellular")
        element("newIssue.summary").tap()
        type("Queued edits stay pending after a network change until the app restarts.")
        element("newIssue.impact").tap()
        type("Field teams lose minutes of edits on every commute.")
        element("newIssue.repro").tap()
        type("1. Edit offline 2. Turn Wi-Fi off 3. Watch the queue")
        element("newIssue.resolution").tap()
        type("The queue drains within 5 s of any network change.")
        app.swipeUp(velocity: .slow)
        pause(0.6)
        app.buttons["Medium"].firstMatch.tap()
        element("newIssue.labels").tap()
        type("network, sync")
        pause(1.2)
        snap("17-new-issue-filled")
        element("sheet.action").tap()
        pause(2.2)
        snap("18-issue-filed")

        // The workspace, then an invitation.
        app.tabBars.buttons["Workspace"].tap()
        wait("workspace.invite")
        pause(2.0)
        snap("19-workspace")
        element("workspace.invite").tap()
        tap("invite.generate", after: 1.0, snap: nil)
        pause(1.8)
        snap("20-invite")
        element("sheet.done").tap()
        pause(1.5)
    }

    /// A menu item by identifier, falling back to its title.
    private func tapMenuItem(_ id: String, label: String) {
        let byId = element(id)
        if byId.waitForExistence(timeout: 2) {
            byId.tap()
        } else {
            app.buttons[label].firstMatch.tap()
        }
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
    private let pace = 0.65

    private func pause(_ seconds: TimeInterval) {
        Thread.sleep(forTimeInterval: seconds * pace)
    }

    /// A named screenshot, kept in the result bundle (`01-spaces`, ...).
    private func snap(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
