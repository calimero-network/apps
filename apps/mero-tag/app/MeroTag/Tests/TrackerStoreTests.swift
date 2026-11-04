import MeroKit
import XCTest
@testable import MeroTag

@MainActor
final class TrackerStoreTests: XCTestCase {
    private func store(_ t: FakeTransport) -> TrackerStore {
        TrackerStore(
            service: MeroService(transport: t, appId: Fixtures.app, memberId: Fixtures.account),
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
        XCTAssertEqual(s.connection, .polling, "no event stream → poll")
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
        let (stream, continuation) = AsyncThrowingStream<CloudEvent, Error>.makeStream()
        t.frames = stream
        let s = store(t)
        await s.bootstrap(displayName: "Fran")
        XCTAssertEqual(s.connection, .live)

        t.responses["get_trackers"] = []
        continuation.yield(CloudEvent(id: "1", kind: "TrackerDeleted", data: ["id": "t1"]))
        for _ in 0..<50 where !s.trackers.isEmpty { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertTrue(s.trackers.isEmpty)

        continuation.finish()
        for _ in 0..<50 where s.connection == .live { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertEqual(s.connection, .polling, "a stream that ends falls back to polling")
        s.stop()
    }

    func testRevokedSessionIsReportedNotShown() async {
        let t = Fixtures.transport()
        t.failures["create_tracker"] = LoginRequired("the refresh token was revoked")
        let s = store(t)
        var ended: String?
        s.onSessionEnded = { ended = $0 }
        let ok = await s.createTracker(name: "Phone")
        XCTAssertFalse(ok)
        XCTAssertNotNil(ended)
        XCTAssertNil(s.lastError)
    }

    func testRefusedWriteShowsTheContractsReason() async {
        let t = Fixtures.transport()
        t.failures["rename_tracker"] = AppError("only the tracker's owner can rename it")
        let s = store(t)
        let ok = await s.renameTracker(id: "t1", name: "X")
        XCTAssertFalse(ok)
        XCTAssertEqual(s.lastError, "only the tracker's owner can rename it")
    }

    func testAnUnreachableClusterSaysTheChangeWasNotSaved() async throws {
        let t = Fixtures.transport()
        t.failures["rename_tracker"] = UnavailableError(code: "NETWORK", message: "offline")
        let s = store(t)
        _ = await s.renameTracker(id: "t1", name: "X")
        let error = try XCTUnwrap(s.lastError)
        XCTAssertTrue(error.contains("Can't reach your Calimero cluster"), error)
    }
}
