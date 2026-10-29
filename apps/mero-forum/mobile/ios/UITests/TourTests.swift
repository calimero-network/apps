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

        // Spaces → a space.
        tap("spaces.card.0", after: 2.0, snap: "01-spaces")
        // The space's forums → General.
        tap("forums.card.1", after: 1.8, snap: "02-forums")

        // The timeline, scrolled.
        wait("feed.post.0")
        pause(2.0)
        snap("03-timeline")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("04-timeline-scrolled")
        app.swipeUp(velocity: .slow)
        pause(1.2)
        app.swipeDown(velocity: .fast)
        app.swipeDown(velocity: .fast)
        pause(1.0)

        // Top, then back to Latest.
        element("feed.tab.top").tap()
        pause(2.0)
        snap("05-top")
        element("feed.tab.new").tap()
        pause(1.5)

        // A post and its replies.
        element("feed.post.0").tap()
        wait("thread.replyField")
        pause(2.0)
        snap("06-post")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("07-replies")

        // Reply.
        element("thread.replyField").tap()
        pause(0.6)
        type("Here's my setup: a tiny script that replays the same writes on both simulators, then diffs the state.")
        pause(1.0)
        snap("08-reply-typing")
        element("thread.send").tap()
        pause(2.0)
        app.swipeUp(velocity: .slow)
        pause(1.0)
        snap("09-reply-sent")
        back()
        pause(1.5)

        // Compose and post.
        element("feed.compose").tap()
        wait("compose.title")
        pause(0.8)
        type("Sharing my sync test script")
        element("compose.body").tap()
        type("It replays the same writes on two simulators and diffs the state after both come back online. Comments welcome!")
        pause(1.0)
        snap("10-compose")
        element("sheet.action").tap()
        pause(2.2)
        snap("11-posted")

        // Vote on a post.
        let target = element("feed.post.1")
        target.buttons["vote.up"].firstMatch.tap()
        pause(1.5)
        snap("12-voted")

        // About this forum.
        element("feed.info").tap()
        wait("sheet.done")
        pause(2.0)
        snap("13-about")
        app.swipeUp(velocity: .slow)
        pause(1.2)
        element("sheet.done").tap()
        pause(1.2)

        // Back to the spaces, then the account sheet.
        back()
        pause(1.0)
        back()
        tap("spaces.account", after: 1.2, snap: nil)
        wait("sheet.done")
        pause(2.0)
        snap("14-account")
        element("sheet.done").tap()
        pause(1.5)
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
    private let pace = 0.7

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
