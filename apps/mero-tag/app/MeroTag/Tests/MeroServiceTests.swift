import MeroKit
import XCTest
@testable import MeroTag

/// The app's contract calls go through the relay: reads as queries, writes as
/// warrant intents, args keyed by the Rust parameter names, and the member id
/// is the signed-in account.
final class MeroServiceTests: XCTestCase {
    private func service(_ t: FakeTransport) -> MeroService {
        MeroService(transport: t, contextId: Fixtures.context, memberId: Fixtures.account, now: { 1234 })
    }

    func testReadsAreQueriesAndDecode() async throws {
        let t = Fixtures.transport()
        let trackers = try await service(t).getTrackers()
        XCTAssertEqual(trackers.map(\.id), ["t2", "t1"])
        XCTAssertEqual(trackers[1].latest?.battery, 76)
        XCTAssertEqual(t.calls, [.init(kind: "query", contextId: Fixtures.context, method: "get_trackers", args: [:])])
    }

    func testJoinIsAWriteAsTheAccount() async throws {
        let t = FakeTransport()
        try await service(t).join(username: "Fran")
        XCTAssertEqual(t.writes, [
            .init(kind: "execute", contextId: Fixtures.context, method: "join",
                  args: ["member_id": .string(Fixtures.account), "username": "Fran", "timestamp": 1234]),
        ])
    }

    func testCreateTrackerOwnedByTheAccountAndReturnsId() async throws {
        let t = FakeTransport()
        t.responses["create_tracker"] = "t9"
        let id = try await service(t).createTracker(id: "t9", name: "Phone")
        XCTAssertEqual(id, "t9")
        XCTAssertEqual(t.writes.first?.args["owner_id"], .string(Fixtures.account))
        XCTAssertEqual(t.writes.first?.args["created_at"], 1234)
    }

    func testUpdateLocationArgs() async throws {
        let t = FakeTransport()
        let loc = Location(latitude: 1.5, longitude: 2.5, altitude: 3, speed: 4, heading: 5, battery: 60, timestamp: 99)
        try await service(t).updateLocation(trackerId: "t1", loc)
        let args = try XCTUnwrap(t.writes.first?.args)
        XCTAssertEqual(t.writes.first?.method, "update_location")
        XCTAssertEqual(args["tracker_id"], "t1")
        XCTAssertEqual(args["latitude"], 1.5)
        XCTAssertEqual(args["battery"], 60)
        XCTAssertEqual(args["timestamp"], 99)
    }

    func testShareUnshareAndPresence() async throws {
        let t = FakeTransport()
        let s = service(t)
        try await s.shareTracker(trackerId: "t1", userId: "u")
        try await s.unshareTracker(trackerId: "t1", userId: "u")
        try await s.updatePresence(online: true)
        XCTAssertEqual(t.writes.map(\.method), ["share_tracker", "unshare_tracker", "update_presence"])
        XCTAssertEqual(t.writes[2].args["user_id"], .string(Fixtures.account))
        XCTAssertEqual(t.writes[2].args["online"], true)
    }

    func testUnexpectedShapeIsAReadableError() async {
        let t = FakeTransport()
        t.responses["get_space"] = "nope"
        do {
            _ = try await service(t).getSpace()
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? ContractError, .unexpectedResponse(method: "get_space"))
        }
    }

    func testNoEventStreamWithoutARelaySession() {
        XCTAssertNil(service(FakeTransport()).events())
    }
}
