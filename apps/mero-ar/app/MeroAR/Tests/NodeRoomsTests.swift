import XCTest
import MeroKit
@testable import MeroAR

/// The lobby's node listing: a failed listing must not read as "no rooms
/// yet", which invites creating a duplicate room (the 2026-10-21 chat incident's
/// bug 4, in this app's shape). Rooms whose home can't be told stay listed,
/// as loose rooms; rooms in a namespace are listed under it.
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
        XCTAssertTrue(app.looseRooms.isEmpty)
        XCTAssertNotNil(app.homesError, "a failed listing was reported as a node with no rooms")
    }

    func testAFailedRefreshKeepsTheRoomsAlreadyListed() async {
        stubListing()
        let app = makeApp()
        await signIn(app)
        XCTAssertEqual(app.looseRooms.map(\.id), [roomId])
        XCTAssertNil(app.homesError)

        RelayStub.on("GET", "/admin-api/contexts", status: 503, json: #"{"error":"unavailable"}"#)
        await app.loadHomes()
        XCTAssertEqual(app.looseRooms.map(\.id), [roomId], "a failed refresh wiped the room list")
        XCTAssertNotNil(app.homesError)

        stubListing()
        await app.loadHomes()
        XCTAssertNil(app.homesError, "a successful listing should clear the error")
    }

    /// Pull-to-refresh is cancelled when the lobby is replaced on entering a
    /// room; coming back must not show a listing failure that never happened.
    func testACancelledLoadIsNotReportedAsAFailure() async {
        stubListing()
        let app = makeApp()
        await signIn(app)

        RelayStub.on("GET", "/admin-api/applications", status: 500, json: #"{"error":"boom"}"#)
        let load = Task { await app.loadHomes() }
        load.cancel()
        await load.value
        XCTAssertNil(app.homesError, "a cancelled load was reported as a failed listing")
        XCTAssertEqual(app.looseRooms.map(\.id), [roomId])
        XCTAssertFalse(app.isLoadingHomes)
    }

    func testANodeWithoutTheAppIsGenuinelyEmpty() async {
        RelayStub.on("GET", "/admin-api/applications", json: #"{"data":{"apps":[]}}"#)
        let app = makeApp()
        await signIn(app)
        XCTAssertTrue(app.looseRooms.isEmpty)
        XCTAssertNil(app.homesError)
    }

    func testARoomIsListedUnderItsHome() async {
        let home = String(repeating: "cc", count: 32)
        stubListing()
        RelayStub.on(
            "GET", "/admin-api/namespaces",
            json: """
                {"data":[{"namespaceId":"\(home)","appKey":"k","targetApplicationId":"\(appId)","createdAt":1,
                "name":"Our flat","memberCount":2,"contextCount":1,"subgroupCount":0}]}
                """)
        RelayStub.on("GET", "/admin-api/namespaces/\(home)/groups", json: #"{"data":[]}"#)
        RelayStub.on("GET", "/admin-api/contexts/\(roomId)/group", json: "{\"data\":\"\(home)\"}")
        let app = makeApp()
        await signIn(app)
        XCTAssertNil(app.homesError)
        XCTAssertEqual(app.homes.map(\.id), [home])
        XCTAssertEqual(app.homes.first?.name, "Our flat")
        XCTAssertEqual(app.homes.first?.memberCount, 2)
        XCTAssertEqual(app.homes.first?.rooms.map(\.id), [roomId])
        XCTAssertTrue(app.looseRooms.isEmpty, "a room in a home was also listed as loose")
    }
}
