import XCTest

@testable import IssueTrackerCore

final class FormatTests: XCTestCase {
    func testShortIssueId() {
        XCTAssertEqual(TrackerFormat.shortIssueId("issue-1712345678901-9f3a2b7c"), "9f3a2b")
        XCTAssertEqual(TrackerFormat.shortIssueId("something-long-id"), "somethin")
        XCTAssertEqual(TrackerFormat.shortIssueId("abc"), "abc")
    }

    func testRelativeTime() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let ms: (Double) -> UInt64 = { UInt64((1_700_000_000 - $0) * 1000) }
        XCTAssertEqual(TrackerFormat.relativeTime(ms(10), now: now), "now")
        XCTAssertEqual(TrackerFormat.relativeTime(ms(300), now: now), "5m")
        XCTAssertEqual(TrackerFormat.relativeTime(ms(7200), now: now), "2h")
        XCTAssertEqual(TrackerFormat.relativeTime(ms(3 * 86400), now: now), "3d")
        XCTAssertEqual(TrackerFormat.relativeTime(ms(14 * 86400), now: now), "2w")
        XCTAssertEqual(TrackerFormat.relativeTime(0, now: now), "")
        XCTAssertEqual(TrackerFormat.ago(ms(10), now: now), "just now")
        XCTAssertEqual(TrackerFormat.ago(ms(300), now: now), "5m ago")
    }

    func testSwatchMatchesWeb() {
        // The web's `(h * 31 + c) | 0` over "label:bug" → |h| % 8.
        var h: Int32 = 0
        for u in "label:bug".utf16 { h = h &* 31 &+ Int32(u) }
        XCTAssertEqual(TrackerFormat.labelSwatch("bug"), Int(abs(Int64(h)) % 8))
        XCTAssertEqual(TrackerFormat.labelSwatch("bug"), TrackerFormat.labelSwatch("bug"))
    }

    func testSearchAndLabels() {
        let issue = FakeTracker.issue("issue-1-a", title: "Sync stalls", labels: ["crdt"])
        XCTAssertTrue(TrackerFormat.matches(issue, query: "  "))
        XCTAssertTrue(TrackerFormat.matches(issue, query: "STALL"))
        XCTAssertTrue(TrackerFormat.matches(issue, query: "crd"))
        XCTAssertFalse(TrackerFormat.matches(issue, query: "zzz"))
        XCTAssertEqual(TrackerFormat.parseLabels(" sync, crdt , ,"), ["sync", "crdt"])
    }

    func testRepoName() {
        XCTAssertEqual(TrackerFormat.repoName(fromURL: "https://github.com/acme/core.git"), "core")
        XCTAssertEqual(TrackerFormat.repoName(fromURL: "https://github.com/acme/web/"), "web")
        XCTAssertNil(TrackerFormat.repoName(fromURL: ""))
        XCTAssertNil(TrackerFormat.repoName(fromURL: "core"))
    }

    func testFixPrompt() {
        let issue = FakeTracker.issue("issue-1-a", title: "Crash")
        let prompt = TrackerFormat.fixPrompt(issue, repoURL: "https://github.com/a/b")
        XCTAssertTrue(prompt.hasPrefix("You are fixing a tracked issue."))
        XCTAssertTrue(prompt.contains("Issue issue-1-a: Crash\nRepository: https://github.com/a/b\n\n## Summary\nS"))
        XCTAssertFalse(TrackerFormat.fixPrompt(issue, repoURL: " ").contains("Repository:"))
    }

    func testKeyTruncation() {
        XCTAssertEqual(TrackerFormat.truncateKey(String(repeating: "ab", count: 32)), "abab…abab")
        XCTAssertEqual(TrackerFormat.truncateKey("Ana"), "Ana")
    }
}
