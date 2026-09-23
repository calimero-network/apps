import XCTest
@testable import MeroKit

/// Access tokens live one hour and `POST /auth/refresh` is single use, so these
/// tests are about two things only: that the refresh happens at all, and that it
/// never happens twice for the same credential.
final class SessionAuthorityTests: XCTestCase {
    private var store: InMemoryTokenStore!
    private var session: URLSession!
    private var authority: SessionAuthority!
    private var rpc: RpcClient!
    private let counts = Counter()

    override func setUp() {
        super.setUp()
        store = InMemoryTokenStore(nodeUrl: "http://node.test", accessToken: "old", refreshToken: "ref")
        session = MockURLProtocol.makeSession()
        authority = SessionAuthority(store: store, session: session)
        rpc = RpcClient(store: store, session: session, authority: authority)
    }
    override func tearDown() { MockURLProtocol.handler = nil; super.tearDown() }

    private func isRefresh(_ req: URLRequest) -> Bool { req.url?.path == "/auth/refresh" }

    // ── The happy recovery ───────────────────────────────────────────────────

    /// 401 `token_expired` → refresh → the SAME call is retried on the new
    /// token and succeeds. Before this, an hour into a trip the app simply
    /// stopped writing locations and said nothing.
    func testExpiredTokenIsRefreshedAndTheCallRetried() async throws {
        let counts = self.counts
        MockURLProtocol.handler = { [self] req in
            if isRefresh(req) {
                counts.bump("refresh")
                return MockURLProtocol.ok(req, #"{"data":{"access_token":"new","refresh_token":"ref2"}}"#)
            }
            counts.bump("rpc")
            let token = req.value(forHTTPHeaderField: "Authorization")
            if token == "Bearer old" { return MockURLProtocol.authError(req, status: 401, reason: "token_expired") }
            return MockURLProtocol.ok(req, #"{"result":{"output":{"ok":true}}}"#)
        }

        struct Out: Codable { let ok: Bool }
        let out: Out = try await rpc.execute(contextId: "ctx", method: "m", args: RpcClient.NoArgs())
        XCTAssertTrue(out.ok)
        XCTAssertEqual(counts.count("refresh"), 1)
        XCTAssertEqual(counts.count("rpc"), 2, "the original call must be retried, not dropped")
        XCTAssertEqual(store.accessToken, "new")
        XCTAssertEqual(store.refreshToken, "ref2", "the rotated refresh token must be kept")
    }

    /// The body core accepts is exactly `{access_token, refresh_token}` —
    /// `RefreshTokenRequest` is `deny_unknown_fields`, so a superset is a 400
    /// and the session is lost for a reason that looks nothing like the cause.
    func testRefreshSendsExactlyTheTwoDocumentedKeys() async throws {
        let cap = Captured()
        MockURLProtocol.handler = { [self] req in
            if isRefresh(req) {
                cap.record(req)
                return MockURLProtocol.ok(req, #"{"data":{"access_token":"new","refresh_token":"r2"}}"#)
            }
            return req.value(forHTTPHeaderField: "Authorization") == "Bearer old"
                ? MockURLProtocol.authError(req, status: 401, reason: "token_expired")
                : MockURLProtocol.ok(req, #"{"result":{"output":null}}"#)
        }
        try await rpc.executeVoid(contextId: "ctx", method: "m", args: RpcClient.NoArgs())

        let body = try XCTUnwrap(cap.body)
        let obj = try XCTUnwrap(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(Set(obj.keys), ["access_token", "refresh_token"])
        XCTAssertEqual(obj["access_token"] as? String, "old")
        XCTAssertEqual(obj["refresh_token"] as? String, "ref")
    }

    // ── Never twice ──────────────────────────────────────────────────────────

    /// Eight calls expire at once. Exactly ONE refresh may leave the device: the
    /// second would replay a consumed refresh token, which core reads as theft
    /// and answers by revoking the whole family — turning a routine expiry into
    /// a forced logout.
    func testConcurrentExpiriesProduceExactlyOneRefresh() async throws {
        let counts = self.counts
        MockURLProtocol.handler = { [self] req in
            if isRefresh(req) {
                counts.bump("refresh")
                return MockURLProtocol.ok(req, #"{"data":{"access_token":"new","refresh_token":"r2"}}"#)
            }
            return req.value(forHTTPHeaderField: "Authorization") == "Bearer old"
                ? MockURLProtocol.authError(req, status: 401, reason: "token_expired")
                : MockURLProtocol.ok(req, #"{"result":{"output":null}}"#)
        }

        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<8 {
                group.addTask { [rpc] in
                    try? await rpc?.executeVoid(contextId: "ctx", method: "m", args: RpcClient.NoArgs())
                }
            }
        }
        XCTAssertEqual(counts.count("refresh"), 1)
    }

    /// The failure a plain single-flight gate cannot see: a request that left
    /// before the rotation comes back with a 401 about the OLD token, after the
    /// gate has closed and reopened. Answering it with a second refresh replays
    /// the consumed token. The generation stamp is what makes this a no-op.
    func testStale401FromBeforeARotationDoesNotRefreshAgain() async throws {
        let counts = self.counts
        MockURLProtocol.handler = { [self] req in
            if isRefresh(req) {
                counts.bump("refresh")
                return MockURLProtocol.ok(req, #"{"data":{"access_token":"new","refresh_token":"r2"}}"#)
            }
            return req.value(forHTTPHeaderField: "Authorization") == "Bearer old"
                ? MockURLProtocol.authError(req, status: 401, reason: "token_expired")
                : MockURLProtocol.ok(req, #"{"result":{"output":null}}"#)
        }

        // First call rotates the pair: generation 0 → 1.
        try await rpc.executeVoid(contextId: "ctx", method: "m", args: RpcClient.NoArgs())
        XCTAssertEqual(counts.count("refresh"), 1)

        // Now replay a 401 stamped with the generation that has already been
        // replaced — exactly what an in-flight request would carry.
        let recovered = try await authority.recover(from: .tokenExpired, generation: 0)
        XCTAssertEqual(recovered, "new", "the stale 401 must be answered with the token that replaced it")
        XCTAssertEqual(counts.count("refresh"), 1, "a stale 401 must not open a second refresh")
    }

    // ── Terminal ─────────────────────────────────────────────────────────────

    /// A 403 `token_revoked` is not an expiry. Nothing is refreshed, the
    /// credentials are cleared, and the caller is told the session is over.
    func testRevokedIsReportedOnceAndClearsTheCredentials() async throws {
        let counts = self.counts
        let ended = expectation(description: "session ended")
        await authority.setSessionEndedHandler { reason in
            XCTAssertEqual(reason, .tokenRevoked)
            counts.bump("ended")
            ended.fulfill()
        }
        MockURLProtocol.handler = { [self] req in
            if isRefresh(req) { counts.bump("refresh"); return MockURLProtocol.ok(req, "{}", status: 500) }
            return MockURLProtocol.authError(req, status: 403, reason: "token_revoked")
        }

        do {
            try await rpc.executeVoid(contextId: "ctx", method: "m", args: RpcClient.NoArgs())
            XCTFail("expected a revoked session to throw")
        } catch let e as MeroError {
            XCTAssertEqual(e, .authRevoked(.tokenRevoked))
        }
        await fulfillment(of: [ended], timeout: 2)
        XCTAssertEqual(counts.count("refresh"), 0, "a revoked family must never be refreshed")
        XCTAssertNil(store.accessToken)
        XCTAssertNil(store.refreshToken)
        XCTAssertEqual(store.nodeUrl, "http://node.test", "the node stays, so login comes back pointed at it")

        // Later calls fail fast on the latch rather than hitting the node again.
        do {
            try await rpc.executeVoid(contextId: "ctx", method: "m", args: RpcClient.NoArgs())
            XCTFail("expected throw")
        } catch {}
        XCTAssertEqual(counts.count("ended"), 1, "the app must be told once, not once per call")
    }

    /// `token_reuse` on the refresh itself: the family is already gone.
    func testReuseOnRefreshEndsTheSession() async {
        MockURLProtocol.handler = { [self] req in
            isRefresh(req)
                ? MockURLProtocol.authError(req, status: 401, reason: "token_reuse")
                : MockURLProtocol.authError(req, status: 401, reason: "token_expired")
        }
        do {
            try await rpc.executeVoid(contextId: "ctx", method: "m", args: RpcClient.NoArgs())
            XCTFail("expected throw")
        } catch let e as MeroError {
            XCTAssertEqual(e, .authRevoked(.tokenReuse))
        } catch { XCTFail("wrong type: \(error)") }
        XCTAssertNil(store.accessToken)
    }

    /// A refresh that never reached the node says nothing about the session —
    /// on a phone this is just a tunnel. It must not log the user out.
    func testUndeliverableRefreshDoesNotEndTheSession() async {
        MockURLProtocol.handler = { [self] req in
            if isRefresh(req) { throw MeroError.transport("offline") }
            return MockURLProtocol.authError(req, status: 401, reason: "token_expired")
        }
        do {
            try await rpc.executeVoid(contextId: "ctx", method: "m", args: RpcClient.NoArgs())
            XCTFail("expected throw")
        } catch let e as MeroError {
            if case .authRevoked = e { XCTFail("a network blip must not revoke the session") }
        } catch { XCTFail("wrong type: \(error)") }
        XCTAssertEqual(store.accessToken, "old", "the credentials survive a failed delivery")
    }

    /// Logging in again after a dead session must work — the latch is per
    /// session, not per client.
    func testLoginClearsTheTerminalLatch() async throws {
        MockURLProtocol.handler = { MockURLProtocol.authError($0, status: 403, reason: "token_revoked") }
        try? await rpc.executeVoid(contextId: "ctx", method: "m", args: RpcClient.NoArgs())

        let auth = AuthApi(store: store, session: session, authority: authority)
        MockURLProtocol.handler = { MockURLProtocol.ok($0, #"{"data":{"access_token":"fresh","refresh_token":"r"}}"#) }
        _ = try await auth.login(nodeUrl: "http://node.test", username: "admin", password: "pw")

        MockURLProtocol.handler = { MockURLProtocol.ok($0, #"{"result":{"output":null}}"#) }
        try await rpc.executeVoid(contextId: "ctx", method: "m", args: RpcClient.NoArgs())
    }
}
