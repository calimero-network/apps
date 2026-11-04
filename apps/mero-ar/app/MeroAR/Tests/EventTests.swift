import XCTest
import MeroKit
@testable import MeroAR

/// Contract events as a core 1.0 node streams them on `GET /apps/{app}/events`:
/// `event:` is the variant name and `data:` the named-field payload,
/// `{"id": "…"}`, or nothing for a unit variant.
final class EventTests: XCTestCase {
    private func event(_ kind: String, _ data: JSONValue = .null) -> ARSceneEvent? {
        ARSceneEvent(CloudEvent(id: "7:0", kind: kind, data: data))
    }

    func testObjectLifecycle() {
        XCTAssertEqual(event("ObjectAdded", ["id": "o1"]), .objectAdded("o1"))
        XCTAssertEqual(event("ObjectUpdated", ["id": "o2"]), .objectUpdated("o2"))
        XCTAssertEqual(event("ObjectDeleted", ["id": "o3"]), .objectDeleted("o3"))
    }

    func testLocking() {
        XCTAssertEqual(event("ObjectLocked", ["id": "o1"]), .objectLocked("o1"))
        XCTAssertEqual(event("ObjectUnlocked", ["id": "o1"]), .objectUnlocked("o1"))
    }

    func testUnitVariantsCarryNoPayload() {
        XCTAssertEqual(event("AnchorsUpdated"), .anchorsUpdated)
        XCTAssertEqual(event("RoomUpdated", [:]), .roomUpdated)
        XCTAssertEqual(event("RoomScanUpdated", ["id": "2"]), .roomScanUpdated)
    }

    func testRolesPresenceAndMembers() {
        XCTAssertEqual(event("RoleUpdated", ["id": "m1"]), .roleUpdated("m1"))
        XCTAssertEqual(event("OwnerTransferred", ["id": "m2"]), .ownerTransferred("m2"))
        XCTAssertEqual(event("PresenceUpdated", ["id": "m3"]), .presenceUpdated("m3"))
        XCTAssertEqual(event("MemberJoined", ["id": "m4"]), .memberJoined("m4"))
    }

    func testABareStringPayloadStillDecodes() {
        XCTAssertEqual(event("ObjectAdded", "o9"), .objectAdded("o9"))
    }

    func testAByteEncodedPayloadStillDecodes() {
        let bytes = Array(Data(#""o7""#.utf8)).map { JSONValue.number(Double($0)) }
        XCTAssertEqual(event("ObjectAdded", .array(bytes)), .objectAdded("o7"))
    }

    func testUnknownVariantSurvivesAsOther() {
        XCTAssertEqual(event("Mystery", ["id": "x"]), .other("Mystery", "x"))
    }

    func testAFrameWithNoKindIsNotAnEvent() {
        XCTAssertNil(event("", ["id": "x"]))
    }
}
