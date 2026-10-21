import XCTest
import MeroKit
@testable import MeroAR

/// The lobby's node room listing: a failed listing must not read as "no rooms
/// yet", which invites creating a duplicate room (the 2026-10-21 chat incident's
/// bug 4, in this app's shape).
@MainActor
final class NodeRoomsTests: XCTestCase {
    private let roomId = String(repeating: "aa", count: 32)
    private let appId = "mero-ar-app"

    override func setUp() {
        super.setUp()
        RelayStub.reset()
        RelayStub.on(
            "POST", "/auth/token", json: #"{"data":{"access_token":"access","refresh_token":"refresh"}}"#)
    }

    private func makeApp() -> AppState {
        let defaults = UserDefaults(suiteName: "NodeRoomsTests-\(UUID().uuidString)")!
        return AppState(defaults: defaults, urlSession: RelayStub.session)
    }

    private func stubListing() {
        RelayStub.on(
            "GET", "/admin-api/applications",
            json: """
                {"data":{"apps":[{"id":"\(appId)","blob":{"bytecode":"b","compiled":"c"},"size":1,
                "source":"registry","metadata":[],"signer_id":"s","package":"\(AppState.package)","version":"1"}]}}
                """)
        RelayStub.on(
            "GET", "/admin-api/contexts",
            json: """
                {"data":{"contexts":[{"id":"\(roomId)","applicationId":"\(appId)","contextStateHash":"h","dagHeads":[]}]}}
                """)
    }

    private func signIn(_ app: AppState) async {
        await app.connectNode(Fixture.relayURL, username: "admin", password: "pw")
        XCTAssertEqual(app.phase, .lobby, app.nodeError ?? "")
    }

    func testAFailedFirstListingIsAnErrorNotAnEmptyNode() async {
        RelayStub.on("GET", "/admin-api/applications", status: 500, json: #"{"error":"boom"}"#)
        let app = makeApp()
        await signIn(app)
        XCTAssertTrue(app.nodeRooms.isEmpty)
        XCTAssertNotNil(app.roomsError, "a failed listing was reported as a node with no rooms")
    }

    func testAFailedRefreshKeepsTheRoomsAlreadyListed() async {
        stubListing()
        let app = makeApp()
        await signIn(app)
        XCTAssertEqual(app.nodeRooms.map(\.id), [roomId])
        XCTAssertNil(app.roomsError)

        RelayStub.on("GET", "/admin-api/contexts", status: 503, json: #"{"error":"unavailable"}"#)
        await app.loadNodeRooms()
        XCTAssertEqual(app.nodeRooms.map(\.id), [roomId], "a failed refresh wiped the room list")
        XCTAssertNotNil(app.roomsError)

        stubListing()
        await app.loadNodeRooms()
        XCTAssertNil(app.roomsError, "a successful listing should clear the error")
    }

    /// Pull-to-refresh is cancelled when the lobby is replaced on entering a
    /// room; coming back must not show a listing failure that never happened.
    func testACancelledLoadIsNotReportedAsAFailure() async {
        stubListing()
        let app = makeApp()
        await signIn(app)

        RelayStub.on("GET", "/admin-api/applications", status: 500, json: #"{"error":"boom"}"#)
        let load = Task { await app.loadNodeRooms() }
        load.cancel()
        await load.value
        XCTAssertNil(app.roomsError, "a cancelled load was reported as a failed listing")
        XCTAssertEqual(app.nodeRooms.map(\.id), [roomId])
        XCTAssertFalse(app.isLoadingRooms)
    }

    func testANodeWithoutTheAppIsGenuinelyEmpty() async {
        RelayStub.on("GET", "/admin-api/applications", json: #"{"data":{"apps":[]}}"#)
        let app = makeApp()
        await signIn(app)
        XCTAssertTrue(app.nodeRooms.isEmpty)
        XCTAssertNil(app.roomsError)
    }
}
