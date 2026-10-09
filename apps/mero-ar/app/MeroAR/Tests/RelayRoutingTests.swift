import XCTest
import MeroKit
@testable import MeroAR

/// Every contract call goes through the account's relay: reads as Bearer
/// queries, writes as signed warrant intents. These pin which is which, and
/// that the argument casing the contract expects is what the warrant carries.
final class RelayRoutingTests: XCTestCase {
    override func setUp() {
        super.setUp()
        RelayStub.reset()
    }

    func testReadsAreBearerQueries() async throws {
        let ctx = Fixture.context()
        RelayStub.on(
            "POST", "/admin-api/contexts/\(ctx)/query",
            json: #"{"data":{"returns":{"name":"Studio","objectCount":2,"memberCount":1,"worldMapBlob":"","version":3}}}"#)

        let room = try await Fixture.service(context: ctx).getRoom()

        XCTAssertEqual(room.name, "Studio")
        XCTAssertEqual(room.objectCount, 2)
        let request = try XCTUnwrap(RelayStub.requests.first)
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.headers["Authorization"], "Bearer bearer-token")
        XCTAssertEqual(request.body?["method"]?.stringValue, "get_room")
        // A read never signs a warrant.
        XCTAssertFalse(RelayStub.requests.contains { $0.path.hasSuffix("/intents") })
    }

    func testAnAbsentObjectIsNil() async throws {
        let ctx = Fixture.context()
        RelayStub.on("POST", "/admin-api/contexts/\(ctx)/query", json: #"{"data":{"returns":null}}"#)

        let object = try await Fixture.service(context: ctx).getObject(id: "o1")

        XCTAssertNil(object)
        XCTAssertEqual(RelayStub.requests.first?.body?["argsJson"]?["id"]?.stringValue, "o1")
    }

    func testWritesAreWarrantIntents() async throws {
        let ctx = Fixture.context()
        Fixture.stubDescribe(ctx)
        RelayStub.on("POST", "/admin-api/contexts/\(ctx)/intents", json: #"{"data":{"rootHash":"r1"}}"#)

        try await Fixture.service(context: ctx).grantEditor(member: "m1")

        let intent = try XCTUnwrap(RelayStub.requests.first { $0.method == "POST" })
        XCTAssertEqual(intent.path, "/admin-api/contexts/\(ctx)/intents")
        XCTAssertEqual(intent.body?["method"]?.stringValue, "grant_editor")
        XCTAssertEqual(intent.body?["argsJson"]?["member"]?.stringValue, "m1")
        XCTAssertEqual(intent.body?["authorProof"]?.stringValue, "00")
        XCTAssertFalse((intent.body?["warrant"]?.stringValue ?? "").isEmpty, "no warrant on the intent")
    }

    /// Top-level args snake_case, nested structs camelCase — inside the warrant
    /// too, since the warrant hashes exactly these bytes.
    func testWriteArgumentsKeepTheContractsCasing() async throws {
        let ctx = Fixture.context()
        Fixture.stubDescribe(ctx)
        RelayStub.on("POST", "/admin-api/contexts/\(ctx)/intents", json: #"{"data":{}}"#)

        try await Fixture.service(context: ctx).updateTransform(
            id: "o1",
            transform: Transform(position: Vec3(1, 2, 3), rotation: Quat(0, 0, 0, 1), scale: Vec3(1, 1, 1)))

        let args = try XCTUnwrap(RelayStub.requests.first { $0.method == "POST" }?.body?["argsJson"])
        XCTAssertNotNil(args["updated_at"])
        XCTAssertNil(args["updatedAt"])
        XCTAssertEqual(args["transform"]?["position"]?["z"]?.doubleValue, 3)
    }

    /// A refused intent must surface the contract's own sentence, not a
    /// transport error.
    func testARefusedWriteSurfacesTheContractsReason() async {
        let ctx = Fixture.context()
        Fixture.stubDescribe(ctx)
        RelayStub.on(
            "POST", "/admin-api/contexts/\(ctx)/intents", status: 403,
            json: #"{"error":"view-only: ask an admin for editor access"}"#)

        do {
            try await Fixture.service(context: ctx).deleteObject(id: "o1")
            XCTFail("a refused intent was reported as success")
        } catch {
            XCTAssertEqual(userMessage(error), "view-only: ask an admin for editor access")
        }
    }

    func testOpeningARoomTheRelayDoesNotServeFails() async {
        let ctx = Fixture.context()
        do {
            _ = try await MeroARService.open(
                relay: Fixture.relay(), mero: nil, contextId: ctx, account: Fixture.account)
            XCTFail("opened a room the relay does not hold")
        } catch {}
    }

    func testOpeningARoomAsksTheContractWhoWeAre() async throws {
        let ctx = Fixture.context()
        Fixture.stubDescribe(ctx)
        RelayStub.on("POST", "/admin-api/contexts/\(ctx)/query", json: #"{"data":{"returns":"acct-from-contract"}}"#)

        let service = try await MeroARService.open(
            relay: Fixture.relay(), mero: nil, contextId: ctx, account: Fixture.account)

        XCTAssertEqual(service.memberId, "acct-from-contract")
        XCTAssertFalse(service.hasBearerSession)
    }

    /// No Bearer session → no SSE: the stream ends at once and the store polls.
    func testEventsEndImmediatelyWithoutABearerSession() async {
        let service = Fixture.service(context: Fixture.context(), withBearer: false)
        var count = 0
        for await _ in service.events() { count += 1 }
        XCTAssertEqual(count, 0)
    }
}
