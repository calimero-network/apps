import XCTest

@testable import IssueTrackerCore

@MainActor
final class IssuesModelTests: XCTestCase {
    private let ctx = "ctx-1"

    private func model(_ fake: FakeTracker) -> IssuesModel {
        IssuesModel(client: IssueTrackerClient(contract: fake.backend.contract, contextId: ctx), repoId: ctx)
    }

    func testLoadGroupsByStatusNewestFirst() async {
        let fake = FakeTracker()
        fake.seed(FakeTracker.issue("i1", status: "Open", createdAt: 1), in: ctx)
        fake.seed(FakeTracker.issue("i2", status: "Done", createdAt: 2), in: ctx)
        fake.seed(FakeTracker.issue("i3", status: "Open", createdAt: 3), in: ctx)
        let m = model(fake)
        await m.load()
        XCTAssertEqual(m.phase, .loaded)
        XCTAssertEqual(m.sections.map(\.status), ["Open", "Done"])
        XCTAssertEqual(m.sections[0].issues.map(\.id), ["i3", "i1"])
        XCTAssertEqual(m.column("In progress"), [])
        XCTAssertEqual(fake.backend.recording.calls("list_issues").first?.path, .query)
    }

    func testFiltersAndSearch() async {
        let fake = FakeTracker()
        fake.seed(FakeTracker.issue("i1", title: "Crash on boot", priority: "urgent", assignee: "Ana", labels: ["ci"]), in: ctx)
        fake.seed(FakeTracker.issue("i2", title: "Slow sync", priority: "low", labels: ["sync"]), in: ctx)
        let m = model(fake)
        await m.load()
        m.filters.priority = "urgent"
        XCTAssertEqual(m.visible.map(\.id), ["i1"])
        m.filters = IssueFilters(assignee: "ana")
        XCTAssertEqual(m.visible.map(\.id), ["i1"])
        m.filters = IssueFilters(label: "sync")
        XCTAssertEqual(m.visible.map(\.id), ["i2"])
        XCTAssertEqual(m.filters.activeCount, 1)
        m.clearFilters()
        m.query = "crash"
        XCTAssertEqual(m.visible.map(\.id), ["i1"])
        XCTAssertEqual(m.knownLabels, ["ci", "sync"])
        XCTAssertEqual(m.knownAssignees, ["Ana"])
    }

    func testMoveToAnotherColumn() async {
        let fake = FakeTracker()
        fake.seed(FakeTracker.issue("i1"), in: ctx)
        let m = model(fake)
        await m.load()
        await m.move("i1", to: "Blocked")
        XCTAssertEqual(m.column("Blocked").map(\.id), ["i1"])
        XCTAssertEqual(fake.issue("i1", in: ctx)?.status, "Blocked")
        XCTAssertEqual(fake.backend.recording.calls("set_status").first?.path, .execute)
    }

    func testMoveIsPutBackWhenTheWriteFails() async {
        let fake = FakeTracker()
        fake.seed(FakeTracker.issue("i1"), in: ctx)
        let m = model(fake)
        await m.load()
        fake.failWrites = URLError(.timedOut)
        await m.move("i1", to: "Done")
        XCTAssertEqual(m.column("Open").map(\.id), ["i1"])
        XCTAssertEqual(m.notice, "The relay took too long to answer. Try again.")
    }

    func testCreateSendsTheFourSections() async throws {
        let fake = FakeTracker()
        let m = model(fake)
        var draft = IssueDraft()
        draft.title = "Crash"
        XCTAssertFalse(draft.isValid)
        draft.summary = " s "
        draft.impact = "i"
        draft.repro = "r"
        draft.resolution = "c"
        draft.priority = "medium"
        draft.labels = "ci, sync"
        let id = try await m.create(draft)
        let made = try XCTUnwrap(fake.issue(id, in: ctx))
        XCTAssertEqual(made.summary, "s")
        XCTAssertEqual(made.priority, "medium")
        XCTAssertEqual(made.labels, ["ci", "sync"])
        XCTAssertEqual(m.issues.map(\.id), [id])
    }

    func testFailedFirstLoad() async {
        let fake = FakeTracker()
        fake.backend.hasRelay = false
        let m = model(fake)
        await m.load()
        guard case .failed(let text) = m.phase else { return XCTFail("expected failure") }
        XCTAssertTrue(text.contains("No relay"))
    }
}
