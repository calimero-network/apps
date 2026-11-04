import MeroKit
import XCTest
@testable import MeroTag

/// The app's contract calls: reads are views, writes are calls, args keyed by
/// the Rust parameter names, and no owner, member or time is ever sent — on
/// core 1.0 the contract takes those from the caller and the leader.
final class MeroServiceTests: XCTestCase {
    private func service(_ t: FakeTransport) -> MeroService {
        MeroService(transport: t, appId: Fixtures.app, memberId: Fixtures.account)
    }

    func testOpenAsksWhoAmI() async throws {
        let t = Fixtures.transport()
        let s = try await MeroService.open(transport: t, appId: Fixtures.app)
        XCTAssertEqual(s.memberId, Fixtures.account)
        XCTAssertEqual(t.calls, [.init(kind: "query", appId: Fixtures.app, method: "whoami", args: [:])])
    }

    func testReadsAreViewsAndDecode() async throws {
        let t = Fixtures.transport()
        let trackers = try await service(t).getTrackers()
        XCTAssertEqual(trackers.map(\.id), ["t2", "t1"])
        XCTAssertEqual(trackers[1].latest?.battery, 76)
        XCTAssertEqual(t.calls, [.init(kind: "query", appId: Fixtures.app, method: "get_trackers", args: [:])])
    }

    func testJoinSendsOnlyTheName() async throws {
        let t = FakeTransport()
        try await service(t).join(username: "Fran")
        XCTAssertEqual(t.writes, [.init(kind: "execute", appId: Fixtures.app, method: "join", args: ["username": "Fran"])])
    }

    func testCreateTrackerSendsNoOwnerOrTime() async throws {
        let t = FakeTransport()
        t.responses["create_tracker"] = "t9"
        let id = try await service(t).createTracker(id: "t9", name: "Phone")
        XCTAssertEqual(id, "t9")
        XCTAssertEqual(t.writes.first?.args, ["id": "t9", "name": "Phone"])
    }

    func testUpdateLocationKeepsTheFixTime() async throws {
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

    func testShareUnshareGeofenceAndPresence() async throws {
        let t = FakeTransport()
        let s = service(t)
        try await s.shareTracker(trackerId: "t1", userId: "u")
        try await s.unshareTracker(trackerId: "t1", userId: "u")
        try await s.createGeofence(id: "g", name: "Home", lat: 45, lng: 16, radius: 100)
        try await s.updatePresence(online: true)
        XCTAssertEqual(t.writes.map(\.method), ["share_tracker", "unshare_tracker", "create_geofence", "update_presence"])
        XCTAssertEqual(t.writes[0].args, ["tracker_id": "t1", "user_id": "u"])
        XCTAssertNil(t.writes[2].args["created_by"])
        XCTAssertEqual(t.writes[3].args, ["online": true])
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

    func testNoEventStreamMeansPolling() {
        XCTAssertNil(service(FakeTransport()).events())
    }
}
