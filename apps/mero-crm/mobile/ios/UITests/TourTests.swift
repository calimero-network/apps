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

        // Workspaces → Halden Analytics / New business.
        tap("workspaces.pipeline.0.0", after: 2.0, snap: "01-workspaces")

        // The board, first column.
        wait("board.card.0.0")
        pause(2.2)
        snap("02-pipeline")

        // Move a lead on: its card menu → Qualified.
        element("board.card.0.0.menu").tap()
        wait("actions.stage.1")
        pause(1.8)
        snap("03-move-deal")
        element("actions.stage.1").tap()
        pause(2.0)
        snap("04-deal-moved")

        // Swipe through the columns.
        app.swipeLeft()
        pause(2.0)
        snap("05-qualified")
        app.swipeLeft()
        pause(1.4)
        app.swipeLeft()
        pause(2.0)
        snap("06-proposal")
        app.swipeLeft()
        pause(2.0)
        snap("07-negotiation")

        // Every deal as a list, then the won ones.
        tab("Deals")
        wait("deals.row.0")
        pause(2.0)
        snap("08-deals")
        element("deals.filter.won").tap()
        pause(1.8)
        snap("09-deals-won")
        element("deals.filter.open").tap()
        pause(1.2)

        // A deal: the assistant, then schedule its suggested next step.
        element("deals.row.0").tap()
        wait("deal.assistant")
        pause(2.2)
        snap("10-deal")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("11-deal-assistant")
        if element("deal.step.0").exists {
            element("deal.step.0").tap()
            pause(2.0)
        }
        app.swipeUp(velocity: .slow)
        pause(1.8)
        snap("12-deal-activities")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("13-deal-notes")
        back()
        pause(1.2)

        // People, a person, then companies and one company.
        tab("People")
        wait("people.row.0")
        pause(1.8)
        snap("14-people")
        element("people.row.0").tap()
        pause(2.0)
        snap("15-person")
        back()
        pause(1.0)
        element("people.mode.companies").tap()
        wait("companies.row.0")
        pause(1.6)
        snap("16-companies")
        element("companies.row.0").tap()
        pause(2.0)
        snap("17-company")
        back()
        pause(1.0)

        // To-dos: tick off an overdue one.
        tab("To-dos")
        wait("todos.overdue.0")
        pause(2.0)
        snap("18-todos")
        element("todos.overdue.0").buttons["activity.done"].firstMatch.tap()
        pause(2.0)
        snap("19-todo-done")

        // More → Insights.
        tab("More")
        tap("more.insights", after: 1.6, snap: "20-more")
        pause(2.2)
        snap("21-insights")
        app.swipeUp(velocity: .slow)
        pause(1.8)
        snap("22-insights-forecast")
        app.swipeUp(velocity: .slow)
        pause(1.8)
        snap("23-insights-owners")
        back()
        pause(1.2)
    }

    private func tab(_ name: String) {
        app.tabBars.buttons[name].firstMatch.tap()
        pause(0.6)
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
    private let pace = 0.8

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
