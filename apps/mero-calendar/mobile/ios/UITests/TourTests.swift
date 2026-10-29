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

        // Teams → Atlas Design Studio.
        tap("teams.card.0", after: 2.0, snap: "01-teams")
        // Its calendars → Studio schedule.
        tap("calendars.card.0", after: 1.8, snap: "02-calendars")

        // Month view, today's events under the grid.
        wait("month.event.0")
        pause(2.0)
        snap("03-month")
        app.swipeUp(velocity: .slow)
        pause(1.2)
        app.swipeDown(velocity: .fast)
        pause(0.8)

        // Tomorrow: the busy day.
        element("month.day.\(dayKey(daysFromToday: 1))").tap()
        pause(1.8)
        snap("04-month-tomorrow")

        // Week, then day.
        mode("Week")
        pause(2.2)
        snap("05-week")
        mode("Day")
        pause(2.2)
        snap("06-day")

        // Agenda from today.
        mode("Agenda")
        pause(1.0)
        element("calendar.today").tap()
        wait("agenda.event.0.0")
        pause(1.8)
        snap("07-agenda")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("08-agenda-scrolled")
        app.swipeDown(velocity: .fast)
        app.swipeDown(velocity: .fast)
        pause(1.0)

        // New event, shared with two teammates.
        element("calendar.add").tap()
        let title = wait("editor.title")
        pause(0.8)
        title.tap()
        type("Onboarding v2: design review")
        pause(0.8)
        app.swipeUp(velocity: .slow)
        pause(0.6)
        app.swipeUp(velocity: .slow)
        for index in [2, 4] {
            let person = element("editor.invitee.\(index)")
            if person.waitForExistence(timeout: 3) {
                person.tap()
                pause(0.6)
            }
        }
        pause(1.0)
        snap("09-new-event")
        element("sheet.action").tap()
        pause(2.2)
        snap("10-event-created")

        // Open a teammate's event (read-only for us).
        let critique = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Design critique")).firstMatch
        XCTAssertTrue(critique.waitForExistence(timeout: 10), "the critique event never appeared")
        critique.tap()
        wait("sheet.cancel")
        pause(2.0)
        snap("11-event")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("12-event-details")
        element("sheet.cancel").tap()
        pause(1.2)

        // Members.
        element("calendar.more").tap()
        pause(0.8)
        let members = element("calendar.members")
        (members.waitForExistence(timeout: 2) ? members : app.buttons["Members"].firstMatch).tap()
        wait("sheet.done")
        pause(2.0)
        snap("13-members")
        element("sheet.done").tap()
        pause(1.2)

        // Back to the teams, then an invitation link.
        back()
        pause(1.2)
        back()
        tap("teams.invite.0", after: 1.2, snap: nil)
        wait("sheet.done")
        pause(2.0)
        snap("14-invite")
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

    /// Pick Month / Week / Day / Agenda in the calendar's segmented control.
    private func mode(_ title: String) {
        let segment = wait("calendar.mode").buttons[title]
        (segment.exists ? segment : app.segmentedControls.buttons[title]).tap()
    }

    private func back() {
        app.navigationBars.buttons.element(boundBy: 0).tap()
    }

    /// `2026-10-29`, the month view's day-cell identifier suffix.
    private func dayKey(daysFromToday days: Int) -> String {
        let cal = Calendar.current
        let day = cal.date(byAdding: .day, value: days, to: cal.startOfDay(for: Date())) ?? Date()
        let c = cal.dateComponents([.year, .month, .day], from: day)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
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

    /// A named screenshot, kept in the result bundle (`01-teams`, ...).
    private func snap(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
