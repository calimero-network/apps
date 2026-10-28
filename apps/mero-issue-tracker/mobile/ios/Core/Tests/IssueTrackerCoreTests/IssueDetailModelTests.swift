import XCTest

@testable import IssueTrackerCore

@MainActor
final class IssueDetailModelTests: XCTestCase {
    private let ctx = "ctx-1"
    private let me = String(repeating: "ab", count: 32)
    private let them = String(repeating: "cd", count: 32)

    private func model(_ fake: FakeTracker, _ id: String = "i1") -> IssueDetailModel {
        IssueDetailModel(
            client: IssueTrackerClient(contract: fake.backend.contract, contextId: ctx), issueId: id, account: me)
    }

    func testPropertiesAndLabels() async {
        let fake = FakeTracker(account: me)
        fake.seed(FakeTracker.issue("i1", labels: ["ci"]), in: ctx)
        let m = model(fake)
        await m.load()
        XCTAssertTrue(m.isCreator)
        await m.setStatus("In progress")
        await m.setPriority("urgent")
        await m.setAssignee("  Ana ")
        await m.addLabel("sync")
        await m.removeLabel("ci")
        XCTAssertEqual(m.issue?.status, "In progress")
        XCTAssertEqual(m.issue?.priority, "urgent")
        XCTAssertEqual(m.issue?.assignee, "Ana")
        XCTAssertEqual(m.issue?.labels, ["sync"])
        await m.setAssignee("")
        XCTAssertNil(m.issue?.assignee)
        XCTAssertEqual(
            String(data: fake.backend.recording.calls("set_assignee").last?.argsJSON ?? Data(), encoding: .utf8)?
                .contains("\"assignee\""), false)  // null is left out, meaning unassigned
    }

    func testCommentsAreAuthorGated() async {
        let fake = FakeTracker(account: me)
        fake.seed(FakeTracker.issue("i1", createdBy: them), in: ctx)
        fake.seedComment(CommentView(id: "c0", issueId: "i1", author: them, body: "theirs", createdAt: 0), in: ctx)
        let m = model(fake)
        await m.load()
        XCTAssertFalse(m.isCreator)
        await m.addComment("  Seen on main. ")
        XCTAssertEqual(m.comments.map(\.body), ["theirs", "Seen on main."])
        XCTAssertFalse(m.isMine(m.comments[0]))
        XCTAssertTrue(m.isMine(m.comments[1]))
        await m.editComment(m.comments[1].id, body: "Seen twice")
        XCTAssertEqual(m.comments[1].body, "Seen twice")
        XCTAssertNotNil(m.comments[1].editedAt)
        await m.deleteComment(m.comments[1].id)
        XCTAssertEqual(m.comments.map(\.id), ["c0"])
    }

    func testSaveSectionsSendsOnlyChanges() async {
        let fake = FakeTracker(account: me)
        fake.seed(FakeTracker.issue("i1"), in: ctx)
        let m = model(fake)
        await m.load()
        var draft = SectionsDraft(m.issue!)
        draft.impact = "Everyone"
        draft.repro = "1. boot\n2. crash"
        let saved = await m.saveSections(draft)
        XCTAssertTrue(saved)
        XCTAssertEqual(fake.backend.recording.calls.map(\.method).filter { $0.hasPrefix("set_") }, ["set_impact", "set_repro"])
        XCTAssertEqual(m.issue?.repro, "1. boot\n2. crash")
        draft.summary = " "
        let refused = await m.saveSections(draft)
        XCTAssertFalse(refused)
        XCTAssertEqual(m.notice, "All four sections are required.")
    }

    func testDeleteAndFixPrompt() async {
        let fake = FakeTracker(account: me)
        fake.seed(FakeTracker.issue("i1", title: "Crash"), in: ctx)
        let m = model(fake)
        await m.load()
        XCTAssertTrue(m.fixPrompt(repoURL: nil)?.contains("Issue i1: Crash") ?? false)
        let deleted = await m.delete()
        XCTAssertTrue(deleted)
        XCTAssertTrue(m.isGone)
        XCTAssertNil(fake.issue("i1", in: ctx))
    }

    func testMissingIssue() async {
        let fake = FakeTracker(account: me)
        let m = model(fake, "nope")
        await m.load()
        guard case .failed(let text) = m.phase else { return XCTFail("expected failure") }
        XCTAssertTrue(text.hasPrefix("Issue not found."))
    }
}
