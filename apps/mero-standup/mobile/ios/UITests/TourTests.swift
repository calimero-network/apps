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

        // Teams → Core Platform.
        tap("teams.card.0", after: 2.0, snap: "01-teams")

        // Today's standup: the week strip, your empty slot, the team's updates.
        wait("standup.post")
        pause(2.0)
        snap("02-standup")
        app.swipeUp(velocity: .slow)
        pause(1.6)
        snap("03-team-updates")

        // Who has not posted, and what blocks people right now.
        scroll(to: "standup.blockers")
        pause(1.8)
        snap("04-blockers")
        app.swipeDown(velocity: .fast)
        app.swipeDown(velocity: .fast)
        app.swipeDown(velocity: .fast)
        pause(1.0)

        // The week strip: yesterday, then back to today.
        element("standup.prevDay").tap()
        wait("standup.today")
        pause(2.0)
        snap("05-yesterday")
        element("standup.today").tap()
        pause(1.4)

        // Post today's update; Done is carried forward from yesterday's Next.
        element("standup.post").tap()
        wait("update.next")
        pause(1.5)
        element("update.next").tap()
        pause(0.5)
        type("Pair with Priya on the staging cert, then start the snapshot compaction spike")
        pause(1.0)
        snap("06-post-update")
        element("update.post").tap()
        wait("standup.mine")
        pause(2.0)
        snap("07-posted")

        // The week, per person; then last week.
        app.tabBars.buttons["Week"].tap()
        wait("week.person.0")
        pause(2.0)
        snap("08-week")
        app.swipeUp(velocity: .slow)
        pause(1.2)
        app.swipeDown(velocity: .fast)
        pause(0.6)
        element("week.prev").tap()
        wait("week.person.0")
        pause(2.0)
        snap("09-last-week")

        // The decision log, one decision, the timeline.
        app.tabBars.buttons["Decisions"].tap()
        let first = wait("decisions.card.0")
        pause(2.0)
        snap("10-decisions")
        first.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.08)).tap()
        pause(2.0)
        snap("11-decision")
        back()
        pause(1.2)
        app.segmentedControls.buttons["Timeline"].tap()
        pause(2.0)
        snap("12-timeline")
        app.swipeUp(velocity: .slow)
        pause(1.2)
        app.swipeDown(velocity: .fast)
        pause(0.6)

        // Log a decision.
        element("decisions.compose").tap()
        wait("decision.title")
        pause(1.2)
        if element("decision.with.1").exists { element("decision.with.1").tap() }
        if element("decision.with.3").exists { element("decision.with.3").tap() }
        pause(0.5)
        field("decision.title")
        type("Relay uploads retry three times")
        field("decision.body")
        type("At most 3 retries with jittered backoff, then the app shows the error.")
        field("decision.why")
        type("Unbounded retries doubled posts during last week's relay outage.")
        field("decision.tags")
        type("infra, sync")
        pause(1.0)
        snap("13-log-decision")
        element("decision.log").tap()
        pause(2.2)
        snap("14-decision-logged")
        app.segmentedControls.buttons["List"].tap()
        pause(1.5)

        // The team: name, invite link, people.
        app.tabBars.buttons["Team"].tap()
        wait("team.invite")
        pause(2.0)
        snap("15-team")
        element("team.invite").tap()
        pause(2.0)
        snap("16-invite")
        app.swipeUp(velocity: .slow)
        pause(1.8)
        snap("17-people")
        app.tabBars.buttons["Standup"].tap()
        pause(1.5)
    }

    /// Swipe up until `id` is on screen (a few tries).
    private func scroll(to id: String) {
        let target = element(id)
        for _ in 0..<5 where !(target.exists && target.isHittable) {
            app.swipeUp(velocity: .slow)
            pause(0.6)
        }
    }

    /// Focus a sheet field, scrolling it out from under the keyboard first.
    private func field(_ id: String) {
        let target = wait(id)
        if !target.isHittable { app.swipeUp(velocity: .slow) }
        target.tap()
        pause(0.4)
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
