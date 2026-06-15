import XCTest
@testable import MeroKit

final class SseMessageDecoderTests: XCTestCase {

    func testConnectMessage() {
        let msg = SseMessageDecoder.decode(#"{"type":"connect","session_id":"sess-123"}"#)
        XCTAssertEqual(msg, .connect(sessionId: "sess-123"))
    }

    func testEventWithObjectData() throws {
        // WASM emits the variant name as the JSON key: {"TrackerUpdated":"t1"}
        let json = #"{"result":{"contextId":"ctx-1","data":{"TrackerUpdated":"t1"}}}"#
        let msg = SseMessageDecoder.decode(json)
        guard case let .event(contextId, data) = msg else {
            return XCTFail("expected event, got \(msg)")
        }
        XCTAssertEqual(contextId, "ctx-1")
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(obj?["TrackerUpdated"] as? String, "t1")
    }

    func testEventWithByteArrayData() throws {
        let inner = #"{"TrackerUpdated":"t9"}"#
        let bytes = Array(inner.utf8).map { Int($0) }
        let payload: [String: Any] = ["result": ["contextId": "ctx-2", "data": bytes]]
        let jsonData = try JSONSerialization.data(withJSONObject: payload)
        let msg = SseMessageDecoder.decode(String(data: jsonData, encoding: .utf8)!)
        guard case let .event(contextId, data) = msg else {
            return XCTFail("expected event")
        }
        XCTAssertEqual(contextId, "ctx-2")
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(obj?["TrackerUpdated"] as? String, "t9")
    }

    func testGarbageIgnored() {
        XCTAssertEqual(SseMessageDecoder.decode("not json"), .ignored)
        XCTAssertEqual(SseMessageDecoder.decode("{}"), .ignored)
        XCTAssertEqual(SseMessageDecoder.decode(""), .ignored)
    }
}
