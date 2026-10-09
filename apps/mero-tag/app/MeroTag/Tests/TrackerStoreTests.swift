import MeroKit
import XCTest
@testable import MeroTag

@MainActor
final class TrackerStoreTests: XCTestCase {
    private func store(_ t: FakeTransport) -> TrackerStore {
        TrackerStore(
            service: MeroService(transport: t, contextId: Fixtures.context, memberId: Fixtures.account),
            pollInterval: 3600)
    }

    func testBootstrapJoinsOnceThenAnnouncesPresence() async {
        let t = Fixtures.transport()
        let s = store(t)
        await s.bootstrap(displayName: "Fran")
        XCTAssertEqual(t.writes.map(\.method), ["join", "update_presence"])
        XCTAssertEqual(s.trackers.map(\.name), ["Alpha", "Bike"], "sorted by name")
        XCTAssertEqual(s.space?.name, "Family")
        XCTAssertTrue(s.isOnline("someone"))
        XCTAssertEqual(s.connection, .polling, "no relay session → poll")
        s.stop()
    }

    func testAlreadyAMemberDoesNotJoinAgain() async {
        let t = Fixtures.transport()
        t.responses["get_members"] = [["id": .string(Fixtures.account), "username": "Fran", "joinedAt": 1]]
        let s = store(t)
        await s.bootstrap(displayName: "Fran")
        XCTAssertEqual(t.writes.map(\.method), ["update_presence"])
        XCTAssertEqual(s.displayName(for: Fixtures.account), "Fran (you)")
        s.stop()
    }

    func testLiveEventsRefreshTrackers() async throws {
        let t = Fixtures.transport()
        let (stream, continuation) = AsyncThrowingStream<JSONValue, Error>.makeStream()
        t.frames = stream
        let s = store(t)
        await s.bootstrap(displayName: "Fran")
        XCTAssertEqual(s.connection, .live)

        t.responses["get_trackers"] = []
        continuation.yield(["type": "StateMutation", "data": ["events": [["kind": "TrackerDeleted", "data": "t1"]]]])
        for _ in 0..<50 where !s.trackers.isEmpty { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertTrue(s.trackers.isEmpty)

        continuation.finish()
        for _ in 0..<50 where s.connection == .live { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertEqual(s.connection, .polling, "a stream that ends falls back to polling")
        s.stop()
    }

    func testRevokedSessionIsReportedNotShown() async {
        let t = Fixtures.transport()
        t.failures["create_tracker"] = MeroError.authRevoked(
            reason: "token_revoked", http: HTTPError(status: 403, statusText: "Forbidden", url: "x", headers: [:]))
        let s = store(t)
        var ended: String?
        s.onSessionEnded = { ended = $0 }
        let ok = await s.createTracker(name: "Phone")
        XCTAssertFalse(ok)
        XCTAssertNotNil(ended)
        XCTAssertNil(s.lastError)
    }

    func testRefusedWriteShowsTheRelaysReason() async {
        let t = Fixtures.transport()
        t.failures["rename_tracker"] = AccountError.intentRefused(reason: "not a member", retryable: false, status: 403)
        let s = store(t)
        let ok = await s.renameTracker(id: "t1", name: "X")
        XCTAssertFalse(ok)
        XCTAssertEqual(s.lastError, "The relay refused that change: not a member")
    }
}
