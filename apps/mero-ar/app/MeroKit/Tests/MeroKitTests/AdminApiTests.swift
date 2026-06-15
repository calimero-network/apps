import XCTest
@testable import MeroKit

final class AdminApiTests: XCTestCase {
    private var api: AdminApi!
    private var store: InMemoryTokenStore!

    override func setUp() {
        super.setUp()
        store = InMemoryTokenStore(nodeUrl: "http://node.test/", accessToken: "tok")
        api = AdminApi(store: store, session: MockURLProtocol.makeSession())
    }
    override func tearDown() { MockURLProtocol.handler = nil; super.tearDown() }

    struct App: Codable, Equatable { let id: String }

    func testGetUnwrapsDataEnvelope() async throws {
        MockURLProtocol.handler = { MockURLProtocol.ok($0, #"{"data":{"id":"app-1"}}"#) }
        let app: App = try await api.get("/applications/app-1")
        XCTAssertEqual(app, App(id: "app-1"))
    }

    func testGetDecodesBareBody() async throws {
        MockURLProtocol.handler = { MockURLProtocol.ok($0, #"{"id":"app-2"}"#) }
        let app: App = try await api.get("/applications/app-2")
        XCTAssertEqual(app, App(id: "app-2"))
    }

    func testGetSendsBearerAndPath() async throws {
        let cap = Captured()
        MockURLProtocol.handler = { cap.record($0); return MockURLProtocol.ok($0, #"{"data":{"id":"x"}}"#) }
        let _: App = try await api.get("/applications/x")
        XCTAssertEqual(cap.auth, "Bearer tok")
        XCTAssertEqual(cap.request?.url?.absoluteString, "http://node.test/admin-api/applications/x")
        XCTAssertEqual(cap.request?.httpMethod, "GET")
    }

    func testPostSendsJSONBody() async throws {
        struct Body: Encodable { let name: String }
        let cap = Captured()
        MockURLProtocol.handler = { cap.record($0); return MockURLProtocol.ok($0, #"{"data":{"id":"n"}}"#) }
        let _: App = try await api.post("/namespaces", body: Body(name: "Space"))
        XCTAssertEqual(cap.request?.httpMethod, "POST")
        XCTAssertEqual(cap.contentType, "application/json")
        let obj = try JSONSerialization.jsonObject(with: cap.body ?? Data()) as? [String: Any]
        XCTAssertEqual(obj?["name"] as? String, "Space")
    }

    /// Core quirk: DELETE must carry Content-Type: application/json + an empty {} body.
    func testDeleteSendsEmptyJSONBody() async throws {
        let cap = Captured()
        MockURLProtocol.handler = { cap.record($0); return MockURLProtocol.ok($0, #"{"data":{"id":"d"}}"#) }
        let _: App = try await api.delete("/groups/g1")
        XCTAssertEqual(cap.request?.httpMethod, "DELETE")
        XCTAssertEqual(cap.contentType, "application/json")
        XCTAssertEqual(String(data: cap.body ?? Data(), encoding: .utf8), "{}")
    }

    func testHTTPErrorThrows() async {
        MockURLProtocol.handler = { MockURLProtocol.ok($0, "nope", status: 500) }
        do {
            let _: App = try await api.get("/applications/x")
            XCTFail("expected throw")
        } catch let e as MeroError {
            if case .http(let status, _) = e { XCTAssertEqual(status, 500) }
            else { XCTFail("wrong error: \(e)") }
        } catch { XCTFail("wrong type: \(error)") }
    }
}
