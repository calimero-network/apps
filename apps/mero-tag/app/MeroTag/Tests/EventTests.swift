import MeroKit
import XCTest
@testable import MeroTag

/// Contract events reach the app inside a `StateMutation` SSE frame as
/// `data.events[] = { kind, data: [bytes] }`. Verify the variants the store
/// acts on decode, whatever shape the payload bytes take.
final class EventTests: XCTestCase {
    private func bytes(_ s: String) -> JSONValue { .array(Array(s.utf8).map { .number(Double($0)) }) }

    private func frame(_ events: [(String, JSONValue)], type: String = "StateMutation") -> JSONValue {
        [
            "contextId": "ctx", "type": .string(type),
            "data": ["newRoot": "r", "events": .array(events.map { ["kind": .string($0.0), "data": $0.1] })],
        ]
    }

    func testTrackerUpdatedFromJsonStringBytes() {
        XCTAssertEqual(TagEvent.events(inFrame: frame([("TrackerUpdated", bytes(#""t1""#))])), [.trackerUpdated("t1")])
    }

    func testPayloadAsOneKeyObjectOrRawBytes() {
        XCTAssertEqual(
            TagEvent.events(inFrame: frame([("TrackerCreated", bytes(#"{"TrackerCreated":"a"}"#))])),
            [.trackerCreated("a")])
        XCTAssertEqual(TagEvent.events(inFrame: frame([("TrackerDeleted", bytes("b"))])), [.trackerDeleted("b")])
    }

    func testPayloadAsBase64OrPlainString() {
        let b64 = Data(#""c""#.utf8).base64EncodedString()
        XCTAssertEqual(TagEvent.events(inFrame: frame([("TrackerShared", .string(b64))])), [.trackerShared("c")])
        XCTAssertEqual(TagEvent.events(inFrame: frame([("PresenceUpdated", "u1")])), [.presenceUpdated("u1")])
    }

    func testSeveralEventsInOneFrame() {
        let events = TagEvent.events(inFrame: frame([
            ("GroupUpdated", bytes(#""g""#)), ("GeofenceEntered", bytes(#""home""#)), ("MemberJoined", bytes(#""m""#)),
        ]))
        XCTAssertEqual(events, [.groupChanged("g"), .geofenceEntered("home"), .memberJoined("m")])
    }

    func testStateMutationWithoutEventsMeansRefresh() {
        XCTAssertEqual(TagEvent.events(inFrame: frame([])), [.stateChanged])
    }

    func testSyncStatusFramesAreIgnored() {
        XCTAssertEqual(TagEvent.events(inFrame: frame([], type: "SyncStatus")), [])
    }

    func testUnknownVariantBecomesOther() {
        XCTAssertEqual(TagEvent.events(inFrame: frame([("SomethingNew", bytes(#""x""#))])), [.other("SomethingNew", "x")])
    }

    func testSerdeShapedEventStillDecodes() {
        XCTAssertEqual(TagEvent(data: Data(#"{"GeofenceExited":"home"}"#.utf8)), .geofenceExited("home"))
        XCTAssertNil(TagEvent(data: Data("not json".utf8)))
        XCTAssertNil(TagEvent(data: Data("{}".utf8)))
    }
}
