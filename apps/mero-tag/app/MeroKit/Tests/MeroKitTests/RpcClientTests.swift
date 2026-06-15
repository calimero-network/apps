import XCTest
@testable import MeroKit

final class RpcClientTests: XCTestCase {
    private var client: RpcClient!
    private var store: InMemoryTokenStore!

    override func setUp() {
        super.setUp()
        store = InMemoryTokenStore(nodeUrl: "http://node.test", accessToken: "tok")
        client = RpcClient(store: store, session: MockURLProtocol.makeSession())
    }

    override func tearDown() { MockURLProtocol.handler = nil; super.tearDown() }

    private func respond(_ json: String, status: Int = 200) {
        MockURLProtocol.handler = { req in
            let resp = HTTPURLResponse(url: req.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (resp, Data(json.utf8))
        }
    }

    struct Tracker: Codable, Equatable { let id: String; let name: String }

    func testExecuteDecodesResultOutput() async throws {
        respond(#"{"result":{"output":{"id":"t1","name":"Phone"},"logs":[]}}"#)
        let t: Tracker = try await client.execute(
            contextId: "ctx", method: "get_tracker", args: RpcClient.NoArgs())
        XCTAssertEqual(t, Tracker(id: "t1", name: "Phone"))
    }

    func testExecuteDecodesByteArrayOutput() async throws {
        let inner = #"{"id":"t2","name":"Bag"}"#
        let bytes = Array(inner.utf8).map(Int.init)
        let body = try JSONSerialization.data(withJSONObject: ["result": ["output": bytes]])
        MockURLProtocol.handler = { req in
            (HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, body)
        }
        let t: Tracker = try await client.execute(
            contextId: "ctx", method: "get_tracker", args: RpcClient.NoArgs())
        XCTAssertEqual(t, Tracker(id: "t2", name: "Bag"))
    }

    func testRpcErrorSurfacesWasmReason() async {
        respond(#"{"error":{"message":"exec failed","data":"tracker not found"}}"#)
        do {
            let _: Tracker = try await client.execute(
                contextId: "ctx", method: "get_tracker", args: RpcClient.NoArgs())
            XCTFail("expected throw")
        } catch let e as MeroError {
            XCTAssertEqual(e, .rpc(message: "tracker not found"))
        } catch { XCTFail("wrong error type: \(error)") }
    }

    func testUnauthorizedFiresCallback() async {
        respond("{}", status: 401)
        let expectation = expectation(description: "onUnauthorized")
        client.onUnauthorized = { expectation.fulfill() }
        _ = try? await client.executeRaw(contextId: "ctx", method: "x", args: RpcClient.NoArgs())
        await fulfillment(of: [expectation], timeout: 1)
    }

    func testSendsBearerAndExecuteEnvelope() async throws {
        let captured = Captured()
        MockURLProtocol.handler = { req in
            captured.record(req)
            return MockURLProtocol.ok(req, #"{"result":{"output":null}}"#)
        }
        _ = try? await client.executeVoid(contextId: "ctx-9", method: "ping", args: RpcClient.NoArgs())
        XCTAssertEqual(captured.auth, "Bearer tok")
        let obj = try XCTUnwrap(try JSONSerialization.jsonObject(with: captured.body ?? Data()) as? [String: Any])
        XCTAssertEqual(obj["method"] as? String, "execute")
        let params = obj["params"] as? [String: Any]
        XCTAssertEqual(params?["contextId"] as? String, "ctx-9")
        XCTAssertEqual(params?["method"] as? String, "ping")
    }
}
