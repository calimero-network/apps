import XCTest
@testable import MeroKit

/// Box for collecting events from the background consume task.
private final class EventBox: @unchecked Sendable {
    private let lock = NSLock()
    private var _events: [MeroEvent] = []
    func append(_ e: MeroEvent) { lock.lock(); _events.append(e); lock.unlock() }
    var events: [MeroEvent] { lock.lock(); defer { lock.unlock() }; return _events }
}

final class SseClientTests: XCTestCase {
    private var store: InMemoryTokenStore!

    override func setUp() {
        super.setUp()
        store = InMemoryTokenStore(nodeUrl: "http://node.test", accessToken: "tok")
    }
    override func tearDown() { MockURLProtocol.handler = nil; super.tearDown() }

    func testYieldsMatchingContextAndFiltersOthers() async {
        let subscribed = Captured()
        // Stream: connect handshake, one matching event, one for a different context.
        let body = """
        data: {"type":"connect","session_id":"s1"}

        data: {"result":{"contextId":"ctx-1","data":{"TrackerUpdated":"t1"}}}

        data: {"result":{"contextId":"other","data":{"X":"y"}}}

        """
        MockURLProtocol.handler = { req in
            if req.url?.path.hasSuffix("/sse/subscription") == true {
                subscribed.record(req)
                return MockURLProtocol.ok(req, "{}")
            }
            return MockURLProtocol.ok(req, body) // the /sse stream
        }

        let client = SseClient(store: store, session: MockURLProtocol.makeSession(), reconnectDelayMs: 60_000)
        let box = EventBox()
        let got = expectation(description: "event for ctx-1")

        let task = Task {
            for await event in client.events(contexts: ["ctx-1"]) {
                box.append(event)
                got.fulfill()
                break
            }
        }
        await fulfillment(of: [got], timeout: 3)
        task.cancel()

        // Exactly the ctx-1 event surfaced; "other" was filtered out.
        XCTAssertEqual(box.events.count, 1)
        XCTAssertEqual(box.events.first?.contextId, "ctx-1")
        if let data = box.events.first?.data {
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            XCTAssertEqual(obj?["TrackerUpdated"] as? String, "t1")
        }

        // The connect handshake triggered a subscription POST for our context.
        XCTAssertNotNil(subscribed.request)
        if let body = subscribed.body,
           let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
            XCTAssertEqual(obj["method"] as? String, "subscribe")
            XCTAssertEqual(obj["id"] as? String, "s1")
            let params = obj["params"] as? [String: Any]
            XCTAssertEqual(params?["contextIds"] as? [String], ["ctx-1"])
        } else {
            XCTFail("no subscription body captured")
        }
    }
}

/// The reconnect loop is where a 403 costs the most: nothing throws, nothing is
/// logged, the UI keeps its last frame, and the phone retries a dead credential
/// until it is killed.
final class SseAuthTests: XCTestCase {
    private var store: InMemoryTokenStore!

    override func setUp() {
        super.setUp()
        store = InMemoryTokenStore(nodeUrl: "http://node.test", accessToken: "tok", refreshToken: "ref")
    }
    override func tearDown() { MockURLProtocol.handler = nil; super.tearDown() }

    /// A revoked family arrives as **403** with an empty body. The stream must
    /// stop and say so — not reconnect on a timer forever.
    func testRevokedStreamStopsInsteadOfReconnecting() async {
        let counts = Counter()
        MockURLProtocol.handler = { req in
            counts.bump(req.url?.path ?? "?")
            return MockURLProtocol.authError(req, status: 403, reason: "token_revoked")
        }

        let client = SseClient(store: store, session: MockURLProtocol.makeSession(),
                               reconnectDelayMs: 10, maxReconnectDelayMs: 10)
        let reported = expectation(description: "error reported")
        let box = ErrorBox()
        client.onError = { error in box.set(error); reported.fulfill() }

        for await _ in client.events(contexts: ["ctx-1"]) { break }
        await fulfillment(of: [reported], timeout: 3)

        XCTAssertEqual(box.error, .authRevoked(.tokenRevoked))
        // One connect. No refresh (a revoked family is not refreshable), and
        // crucially no second connect on the 10ms reconnect timer.
        XCTAssertEqual(counts.count("/sse"), 1)
        XCTAssertEqual(counts.count("/auth/refresh"), 0)
    }

    /// Expiry is the recoverable one: refresh, then reconnect at once rather
    /// than after the reconnect delay.
    func testExpiredStreamRefreshesAndReconnects() async {
        let counts = Counter()
        let body = """
        data: {"type":"connect","session_id":"s1"}

        data: {"result":{"contextId":"ctx-1","data":{"TrackerUpdated":"t1"}}}

        """
        MockURLProtocol.handler = { req in
            switch req.url?.path {
            case "/auth/refresh":
                counts.bump("refresh")
                return MockURLProtocol.ok(req, #"{"data":{"access_token":"new","refresh_token":"r2"}}"#)
            case "/sse/subscription":
                return MockURLProtocol.ok(req, #"{"result":{"status":"subscribed","contexts":["ctx-1"]}}"#)
            default:
                counts.bump("sse")
                return req.value(forHTTPHeaderField: "Authorization") == "Bearer tok"
                    ? MockURLProtocol.authError(req, status: 401, reason: "token_expired")
                    : MockURLProtocol.ok(req, body)
            }
        }

        let client = SseClient(store: store, session: MockURLProtocol.makeSession(),
                               reconnectDelayMs: 10, maxReconnectDelayMs: 10)
        let got = expectation(description: "event after refresh")
        let task = Task {
            for await _ in client.events(contexts: ["ctx-1"]) { got.fulfill(); break }
        }
        await fulfillment(of: [got], timeout: 3)
        task.cancel()

        XCTAssertEqual(counts.count("refresh"), 1)
        XCTAssertEqual(counts.count("sse"), 2, "the stream is reopened on the refreshed token")
        XCTAssertEqual(store.accessToken, "new")
    }

    /// The node does not refuse a context the caller may not observe — it drops
    /// it, subscribes to the rest and answers 200. Ignoring that body leaves a
    /// stream that is indistinguishable from an idle one for as long as the app
    /// runs.
    func testSilentlyDroppedContextIsReported() async {
        let body = """
        data: {"type":"connect","session_id":"s1"}

        """
        MockURLProtocol.handler = { req in
            req.url?.path == "/sse/subscription"
                // Asked for two, granted one.
                ? MockURLProtocol.ok(req, #"{"result":{"status":"subscribed","contexts":["ctx-1"],"groups":[]}}"#)
                : MockURLProtocol.ok(req, body)
        }

        let client = SseClient(store: store, session: MockURLProtocol.makeSession(),
                               reconnectDelayMs: 10, maxReconnectDelayMs: 10)
        let reported = expectation(description: "drop reported")
        let box = ErrorBox()
        client.onError = { error in box.set(error); reported.fulfill() }

        for await _ in client.events(contexts: ["ctx-1", "ctx-2"]) { break }
        await fulfillment(of: [reported], timeout: 3)

        XCTAssertEqual(box.error, .notSubscribed(contexts: ["ctx-2"]))
    }

    /// An older node that answers the subscribe with something this client
    /// cannot read is not evidence of a drop, and must not kill the stream.
    func testUnreadableSubscribeResponseIsNotTreatedAsADrop() async {
        let body = """
        data: {"type":"connect","session_id":"s1"}

        data: {"result":{"contextId":"ctx-1","data":{"TrackerUpdated":"t1"}}}

        """
        MockURLProtocol.handler = { req in
            req.url?.path == "/sse/subscription"
                ? MockURLProtocol.ok(req, "{}")
                : MockURLProtocol.ok(req, body)
        }
        let client = SseClient(store: store, session: MockURLProtocol.makeSession(),
                               reconnectDelayMs: 10, maxReconnectDelayMs: 10)
        let box = ErrorBox()
        client.onError = { box.set($0) }
        let got = expectation(description: "event")
        let task = Task {
            for await _ in client.events(contexts: ["ctx-1"]) { got.fulfill(); break }
        }
        await fulfillment(of: [got], timeout: 3)
        task.cancel()
        XCTAssertNil(box.error)
    }
}

/// Thread-safe box for the error reported from the stream task.
private final class ErrorBox: @unchecked Sendable {
    private let lock = NSLock()
    private var _error: MeroError?
    func set(_ e: MeroError) { lock.lock(); _error = e; lock.unlock() }
    var error: MeroError? { lock.lock(); defer { lock.unlock() }; return _error }
}
