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

        // Workspaces, then the product team's.
        tap("workspaces.card.0", after: 2.0, snap: "01-workspaces")

        // Its home: recents, folders, everything by last change.
        wait("workspace.folder.0")
        pause(2.0)
        snap("02-workspace")
        app.swipeUp(velocity: .slow)
        pause(1.5)
        snap("03-recently-updated")
        app.swipeDown(velocity: .fast)
        app.swipeDown(velocity: .fast)
        pause(1.0)

        // Search titles and text.
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        pause(0.6)
        type("offline")
        wait("search.result.0")
        pause(2.2)
        snap("04-search")
        app.buttons["Cancel"].firstMatch.tap()
        pause(1.2)

        // Engineering, and one of its subfolders.
        tap("workspace.folder.1", after: 0.6, snap: nil)
        wait("folder.doc.0")
        pause(2.0)
        snap("05-folder")
        tap("folder.sub.0", after: 0.6, snap: nil)
        wait("folder.doc.0")
        pause(1.8)
        snap("06-subfolder")
        back()
        pause(1.2)

        // The launch plan, read top to bottom.
        tap("folder.doc.0", after: 0.6, snap: nil)
        wait("doc.block.0")
        pause(2.2)
        snap("07-document")
        app.swipeUp(velocity: .slow)
        pause(1.6)
        snap("08-document-lists")
        app.swipeUp(velocity: .slow)
        pause(1.6)
        snap("09-document-checklist")
        app.swipeUp(velocity: .slow)
        pause(1.8)
        snap("10-document-code-image")
        app.swipeUp(velocity: .slow)
        pause(1.6)
        snap("11-document-end")

        // Long-press a block, comment on it.
        let block = element("doc.block.26")
        var tries = 0
        while !(block.exists && block.isHittable) && tries < 4 {
            app.swipeDown(velocity: .slow)
            tries += 1
        }
        pause(0.8)
        block.press(forDuration: 1.2)
        let comment = app.buttons["Comment"].firstMatch
        XCTAssertTrue(comment.waitForExistence(timeout: 5))
        pause(1.5)
        snap("12-block-menu")
        comment.tap()
        wait("comments.field")
        pause(1.8)
        snap("13-block-comments")
        element("comments.field").tap()
        pause(0.6)
        type("Can we add a fallback: if divergence alerts fire in week 2, we pause at 10% and page the sync owner.")
        pause(1.0)
        snap("14-comment-typing")
        element("comments.send").tap()
        pause(2.0)
        snap("15-comment-sent")
        element("sheet.done").tap()
        pause(1.5)

        // Every thread on the document.
        element("doc.comments").tap()
        wait("sheet.done")
        pause(2.2)
        snap("16-comments")
        app.swipeUp(velocity: .slow)
        pause(1.6)
        snap("17-comments-more")
        element("sheet.done").tap()
        pause(1.2)

        // Back home: the plan is now the most recent, then the account sheet.
        back()
        pause(1.0)
        back()
        wait("workspace.recent.0")
        pause(1.8)
        snap("18-workspace-recent")
        back()
        tap("workspaces.account", after: 1.2, snap: nil)
        wait("sheet.done")
        pause(2.0)
        snap("19-account")
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
