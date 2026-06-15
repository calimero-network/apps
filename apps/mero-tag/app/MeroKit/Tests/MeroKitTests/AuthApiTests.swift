import XCTest
@testable import MeroKit

final class AuthApiTests: XCTestCase {
    private var api: AuthApi!
    private var store: InMemoryTokenStore!

    override func setUp() {
        super.setUp()
        store = InMemoryTokenStore()
        api = AuthApi(store: store, session: MockURLProtocol.makeSession())
    }
    override func tearDown() { MockURLProtocol.handler = nil; super.tearDown() }

    func testLoginStoresTokensAndNode() async throws {
        let cap = Captured()
        MockURLProtocol.handler = { req in
            cap.record(req)
            return MockURLProtocol.ok(req, #"{"data":{"access_token":"acc","refresh_token":"ref"}}"#)
        }
        let result = try await api.login(nodeUrl: "http://node.test/", username: "admin", password: "pw")
        XCTAssertEqual(result.access, "acc")
        XCTAssertEqual(result.refresh, "ref")
        XCTAssertEqual(store.accessToken, "acc")
        XCTAssertEqual(store.refreshToken, "ref")
        XCTAssertEqual(store.nodeUrl, "http://node.test") // trailing slash trimmed

        // Posts user_password to /auth/token with credentials in provider_data.
        XCTAssertEqual(cap.request?.url?.absoluteString, "http://node.test/auth/token")
        let obj = try JSONSerialization.jsonObject(with: cap.body ?? Data()) as? [String: Any]
        XCTAssertEqual(obj?["auth_method"] as? String, "user_password")
        let provider = obj?["provider_data"] as? [String: Any]
        XCTAssertEqual(provider?["username"] as? String, "admin")
        XCTAssertEqual(provider?["password"] as? String, "pw")
    }

    func testLoginMissingTokenThrows() async {
        MockURLProtocol.handler = { MockURLProtocol.ok($0, #"{"data":{}}"#) }
        do {
            _ = try await api.login(nodeUrl: "http://node.test", username: "admin", password: "pw")
            XCTFail("expected throw")
        } catch let e as MeroError {
            if case .rpc = e {} else { XCTFail("wrong error: \(e)") }
        } catch { XCTFail("wrong type: \(error)") }
        XCTAssertNil(store.accessToken)
    }

    func testLoginHTTPErrorThrows() async {
        MockURLProtocol.handler = { MockURLProtocol.ok($0, "bad creds", status: 401) }
        do {
            _ = try await api.login(nodeUrl: "http://node.test", username: "x", password: "y")
            XCTFail("expected throw")
        } catch let e as MeroError {
            if case .http(let s, _) = e { XCTAssertEqual(s, 401) } else { XCTFail("wrong: \(e)") }
        } catch { XCTFail("wrong type: \(error)") }
    }
}
