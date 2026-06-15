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
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            XCTAssertEqual((obj as? [String: Any])?["TrackerUpdated"] as? String, "t1")
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
