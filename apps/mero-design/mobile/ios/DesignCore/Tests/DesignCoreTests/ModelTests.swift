import MeroKit
import MeroKitTestSupport
import XCTest

@testable import DesignCore

@MainActor
final class ModelTests: XCTestCase {
    func testTeamsListThisAccountsTeams() async {
        let backend = Fixtures.backend()
        backend.namespaces.append(AppNamespace(id: "zz", name: nil, applicationId: "x"))
        let model = TeamsModel(backend: backend)
        await model.load()
        XCTAssertEqual(model.state, .loaded)
        XCTAssertEqual(model.teams.map(\.name), ["Studio", "Team zz"])
    }

    func testTeamsFailureIsShown() async {
        let backend = Fixtures.backend()
        backend.failure = URLError(.notConnectedToInternet)
        let model = TeamsModel(backend: backend)
        await model.load()
        XCTAssertEqual(model.state, .failed("You're offline. Check your connection and try again."))
    }

    func testBoardsTakeTheBoardsOwnName() async {
        let backend = Fixtures.backend()
        let model = BoardsModel(backend: backend, teamId: Fixtures.team)
        await model.load()
        XCTAssertEqual(model.boards.count, 1)
        XCTAssertEqual(model.boards[0].name, "Landing v2")
        XCTAssertEqual(model.boards[0].description, "Hero and pricing")
        XCTAssertEqual(model.boards[0].elementCount, 3)
        XCTAssertEqual(backend.recording.calls("get_board").first?.path, .query)
    }

    func testOpeningJoinsTheBoardThenDrawsIt() async {
        let backend = Fixtures.backend(
            elements: "[" + Fixtures.element("r", Fixtures.rect) + "," + Fixtures.element("p", Fixtures.image("blob9")) + "]",
            memberOfBoard: false)
        let blobs = FakeBlobs()
        let model = BoardModel(backend: backend, teamId: Fixtures.team, contextId: Fixtures.board, blobs: blobs)
        await model.open()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(backend.log.contains("joinContext \(Fixtures.board)"))
        XCTAssertEqual(model.scene.nodes.count, 2)
        XCTAssertEqual(model.name, "Landing v2")
        XCTAssertEqual(model.role, "editor")
        XCTAssertTrue(model.canComment)
        for _ in 0..<50 where model.images["blob9"] == nil { await Task.yield() }
        XCTAssertEqual(model.images["blob9"], Data([1, 2, 3]))
        XCTAssertEqual(blobs.asked, ["blob9@\(Fixtures.board)"])
    }

    func testViewerCannotComment() async {
        let backend = Fixtures.backend(role: "viewer")
        let model = BoardModel(backend: backend, teamId: Fixtures.team, contextId: Fixtures.board)
        await model.open()
        XCTAssertFalse(model.canComment)
    }

    func testFirstCommentJoinsTheRosterThenPins() async throws {
        let backend = Fixtures.backend()
        let model = BoardModel(
            backend: backend, teamId: Fixtures.team, contextId: Fixtures.board,
            now: { Date(timeIntervalSince1970: 1_700_000_000) })
        await model.open()
        XCTAssertNil(model.myName)
        try await model.addComment("  Bigger logo?  ", at: Point(120.4, 89.6), joinAs: "Fran")
        let join = try XCTUnwrap(backend.recording.calls("join").first)
        XCTAssertEqual(join.path, .execute)
        XCTAssertEqual(join.args["username"], .string("Fran"))
        let add = try XCTUnwrap(backend.recording.calls("add_comment").first)
        XCTAssertEqual(add.path, .execute)
        XCTAssertEqual(add.args["content"], .string("Bigger logo?"))
        XCTAssertEqual(add.args["x"], .number(120))
        XCTAssertEqual(add.args["y"], .number(90))
        XCTAssertEqual(add.args["created_at"], .number(1_700_000_000_000))
        XCTAssertEqual(model.myName, "Fran")
        XCTAssertEqual(model.comments.count, 1)
        XCTAssertEqual(model.name(for: Fixtures.me), "Fran")
    }

    func testReplyAndNamesFromTheRoster() async throws {
        let members = #"[{"id":"\#(Fixtures.ana)","username":"Ana","avatar":null,"joinedAt":1,"usernameUpdatedAt":1},{"id":"\#(Fixtures.me)","username":"Fran","avatar":null,"joinedAt":1,"usernameUpdatedAt":1}]"#
        let comments = #"[{"id":"c2","x":5,"y":5,"content":"later","author":"\#(Fixtures.ana)","createdAt":20,"replies":[]},{"id":"c1","x":1,"y":1,"content":"first","author":"\#(Fixtures.ana)","createdAt":10,"replies":[]}]"#
        let backend = Fixtures.backend(comments: comments, members: members)
        let model = BoardModel(backend: backend, teamId: Fixtures.team, contextId: Fixtures.board)
        await model.open()
        XCTAssertEqual(model.comments.map(\.id), ["c1", "c2"])
        XCTAssertEqual(model.name(for: Fixtures.ana), "Ana")
        XCTAssertEqual(model.name(for: "ff"), "ff")
        try await model.reply(to: "c1", "Agreed")
        XCTAssertTrue(backend.recording.calls("join").isEmpty)
        let reply = try XCTUnwrap(backend.recording.calls("add_reply").first)
        XCTAssertEqual(reply.args["comment_id"], .string("c1"))
        XCTAssertEqual(reply.args["content"], .string("Agreed"))
    }

    func testViewersAreOthersWhoMovedRecently() async {
        let now: UInt64 = 1_700_000_000_000
        let cursors = #"[{"identity":"i1","account":"\#(Fixtures.ana)","x":10,"y":20,"updatedAt":\#(now - 2000)},{"identity":"i2","account":"\#(Fixtures.me)","x":0,"y":0,"updatedAt":\#(now)},{"identity":"i3","account":"ee","x":0,"y":0,"updatedAt":\#(now - 60000)}]"#
        let backend = Fixtures.backend(cursors: cursors)
        let model = BoardModel(
            backend: backend, teamId: Fixtures.team, contextId: Fixtures.board,
            now: { Date(timeIntervalSince1970: Double(now) / 1000) })
        await model.open()
        XCTAssertEqual(model.viewers.map(\.account), [Fixtures.ana])
        XCTAssertEqual(model.viewers.first?.point, Point(10, 20))
    }

    func testEventsReloadTheBoard() async {
        let backend = Fixtures.backend()
        let model = BoardModel(backend: backend, teamId: Fixtures.team, contextId: Fixtures.board)
        await model.open()
        let before = backend.recording.calls("get_elements").count
        let task = Task { await model.live() }
        for _ in 0..<500 where backend.recording.calls("get_elements").count == before {
            backend.emit(AppContextEvent(contextId: Fixtures.board, kind: "StateMutation"))
            await Task.yield()
        }
        XCTAssertGreaterThan(backend.recording.calls("get_elements").count, before)
        task.cancel()
        backend.finishEvents()
    }

    func testAFailedReadIsShown() async {
        let backend = Fixtures.backend()
        backend.recording.setRawHandler { _ in throw URLError(.notConnectedToInternet) }
        let model = BoardModel(backend: backend, teamId: Fixtures.team, contextId: Fixtures.board)
        await model.open()
        XCTAssertEqual(model.phase, .failed("You're offline. Check your connection and try again."))
    }
}

final class FakeBlobs: BlobLoading, @unchecked Sendable {
    private let lock = NSLock()
    private var log: [String] = []
    var asked: [String] {
        lock.lock()
        defer { lock.unlock() }
        return log
    }
    func blob(id: String, contextId: String) async throws -> Data {
        record("\(id)@\(contextId)")
        return Data([1, 2, 3])
    }
    private func record(_ entry: String) {
        lock.lock()
        log.append(entry)
        lock.unlock()
    }
}
