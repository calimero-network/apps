import XCTest
import MeroKit
@testable import MeroAR

final class EventTests: XCTestCase {

    // ── The shape a real rc.20 node sends ─────────────────────────────────────

    /// A `StateMutation` envelope: the variant name is `kind`, and the payload is
    /// a byte array holding JSON — so a string id arrives quoted.
    private func mutation(_ events: [(String, String?)]) -> JSONValue {
        let entries: [JSONValue] = events.map { kind, id in
            var entry: [String: JSONValue] = ["kind": .string(kind), "handler": .null]
            if let id {
                let bytes = Array(Data("\"\(id)\"".utf8)).map { JSONValue.number(Double($0)) }
                entry["data"] = .array(bytes)
            } else {
                entry["data"] = .array([])
            }
            return .object(entry)
        }
        return .object([
            "contextId": .string("ctx"),
            "type": .string("ExecutionEvent"),
            "data": .object(["newRoot": .string("root"), "events": .array(entries)]),
        ])
    }

    func testDecodesStateMutationEnvelope() {
        let decoded = ARSceneEvent.from(payload: mutation([("ObjectAdded", "o1")]))
        XCTAssertEqual(decoded, [.objectAdded("o1")])
    }

    /// One mutation can carry several events — dropping all but the first would
    /// silently lose edits.
    func testDecodesEveryEventInOneMutation() {
        let decoded = ARSceneEvent.from(payload: mutation([
            ("ObjectAdded", "o1"), ("ObjectUpdated", "o2"), ("ObjectDeleted", "o3"),
        ]))
        XCTAssertEqual(decoded, [.objectAdded("o1"), .objectUpdated("o2"), .objectDeleted("o3")])
    }

    func testDecodesUnitVariantsWithNoPayload() {
        XCTAssertEqual(ARSceneEvent.from(payload: mutation([("AnchorsUpdated", nil)])), [.anchorsUpdated])
        XCTAssertEqual(ARSceneEvent.from(payload: mutation([("RoomUpdated", nil)])), [.roomUpdated])
    }

    func testDecodesRoleEvents() {
        XCTAssertEqual(ARSceneEvent.from(payload: mutation([("RoleUpdated", "pk1")])), [.roleUpdated("pk1")])
        XCTAssertEqual(
            ARSceneEvent.from(payload: mutation([("OwnerTransferred", "pk2")])), [.ownerTransferred("pk2")])
    }

    func testUnknownVariantSurvivesAsOther() {
        XCTAssertEqual(ARSceneEvent.from(payload: mutation([("Mystery", "x")])), [.other("Mystery", "x")])
    }

    func testNonEventEnvelopeYieldsNothing() {
        XCTAssertTrue(ARSceneEvent.from(payload: .object(["contextId": .string("ctx")])).isEmpty)
        XCTAssertTrue(ARSceneEvent.from(payload: .null).isEmpty)
    }

    // ── Legacy / fixture form: { "VariantName": "payload" } ───────────────────

    private func event(_ json: String) -> ARSceneEvent? {
        ARSceneEvent(data: Data(json.utf8))
    }

    func testObjectLifecycle() {
        if case .objectAdded(let id)? = event(#"{"ObjectAdded":"o1"}"#) { XCTAssertEqual(id, "o1") } else { XCTFail() }
        if case .objectUpdated(let id)? = event(#"{"ObjectUpdated":"o2"}"#) { XCTAssertEqual(id, "o2") } else { XCTFail() }
        if case .objectDeleted(let id)? = event(#"{"ObjectDeleted":"o3"}"#) { XCTAssertEqual(id, "o3") } else { XCTFail() }
    }

    func testLocking() {
        if case .objectLocked(let id)? = event(#"{"ObjectLocked":"o1"}"#) { XCTAssertEqual(id, "o1") } else { XCTFail() }
        if case .objectUnlocked? = event(#"{"ObjectUnlocked":"o1"}"#) {} else { XCTFail() }
    }

    func testPresenceAndAnchors() {
        if case .presenceUpdated(let id)? = event(#"{"PresenceUpdated":"u1"}"#) { XCTAssertEqual(id, "u1") } else { XCTFail() }
        if case .anchorsUpdated? = event(#"{"AnchorsUpdated":""}"#) {} else { XCTFail() }
    }

    func testUnknownAndGarbage() {
        if case .other(let key, _)? = event(#"{"Mystery":"x"}"#) { XCTAssertEqual(key, "Mystery") } else { XCTFail() }
        XCTAssertNil(event("not json"))
    }

    /// A legacy node that sends the emission itself, byte-encoded, still decodes.
    func testLegacyByteArrayPayload() {
        let bytes = Array(Data(#"{"ObjectAdded":"o9"}"#.utf8)).map { JSONValue.number(Double($0)) }
        let payload = JSONValue.object(["contextId": .string("ctx"), "data": .array(bytes)])
        XCTAssertEqual(ARSceneEvent.from(payload: payload), [.objectAdded("o9")])
    }
}
