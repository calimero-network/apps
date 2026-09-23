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

    /// Asserted as a KEY SET, not with `contains`. Core's `BaseTokenRequest` is
    /// `#[serde(deny_unknown_fields)]` — one of the 37 bodies closed at rc.38 —
    /// so a request carrying a field beside these six is a 400, and a
    /// `contains` check passes happily with the fatal extra key sitting next to
    /// the ones it looked for.
    func testTokenRequestSendsExactlyTheAcceptedKeySet() async throws {
        let cap = Captured()
        MockURLProtocol.handler = { req in
            cap.record(req)
            return MockURLProtocol.ok(req, #"{"data":{"access_token":"a","refresh_token":"r"}}"#)
        }
        _ = try await api.login(nodeUrl: "http://node.test", username: "admin", password: "pw")

        let obj = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: try XCTUnwrap(cap.body)) as? [String: Any])
        XCTAssertEqual(
            Set(obj.keys),
            ["auth_method", "public_key", "client_name", "timestamp", "permissions", "provider_data"])
        let provider = try XCTUnwrap(obj["provider_data"] as? [String: Any])
        XCTAssertEqual(Set(provider.keys), ["username", "password"])
    }

    /// Stated as a property of the grant set rather than another entry in the
    /// list, because the list is the thing that was wrong — it was EMPTY.
    ///
    /// Core maps `/sse`, `/sse/subscription`, `/sse/session/{id}` and `/ws` to
    /// `Context(Subscribe(Global))`, so a token minted without this grant is
    /// refused 403 `permission_denied` on all four while every other call keeps
    /// working. The node-owner login this app uses today is minted `admin`,
    /// which satisfies everything — so nothing here depends on the field yet,
    /// and everything does the moment the app logs in as anything else.
    func testAsksForContextSubscribeWithoutWhichNoEventArrives() async throws {
        XCTAssertTrue(AuthApi.permissions.contains("context:subscribe"))

        let cap = Captured()
        MockURLProtocol.handler = { req in
            cap.record(req)
            return MockURLProtocol.ok(req, #"{"data":{"access_token":"a"}}"#)
        }
        _ = try await api.login(nodeUrl: "http://node.test", username: "admin", password: "pw")
        let obj = try JSONSerialization.jsonObject(with: try XCTUnwrap(cap.body)) as? [String: Any]
        let sent = try XCTUnwrap(obj?["permissions"] as? [String])
        XCTAssertEqual(sent, AuthApi.permissions)
        XCTAssertFalse(sent.isEmpty, "an empty grant set is a token refused on every stream route")
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
