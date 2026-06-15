import XCTest
@testable import MeroTag

/// The contract emits SSE events as `{ "VariantName": "payloadId" }`. Verify the
/// app decodes each variant the store cares about.
final class EventTests: XCTestCase {
    private func event(_ json: String) -> TagEvent? {
        TagEvent(data: Data(json.utf8))
    }

    func testTrackerUpdated() {
        guard case .trackerUpdated(let id)? = event(#"{"TrackerUpdated":"t1"}"#) else {
            return XCTFail("not trackerUpdated")
        }
        XCTAssertEqual(id, "t1")
    }

    func testTrackerCreatedDeletedShared() {
        if case .trackerCreated(let id)? = event(#"{"TrackerCreated":"a"}"#) { XCTAssertEqual(id, "a") } else { XCTFail() }
        if case .trackerDeleted(let id)? = event(#"{"TrackerDeleted":"b"}"#) { XCTAssertEqual(id, "b") } else { XCTFail() }
        if case .trackerShared(let id)? = event(#"{"TrackerShared":"c"}"#) { XCTAssertEqual(id, "c") } else { XCTFail() }
    }

    func testGroupVariantsCollapse() {
        if case .groupChanged? = event(#"{"GroupUpdated":"g"}"#) {} else { XCTFail("GroupUpdated") }
        if case .groupChanged? = event(#"{"GroupCreated":"g"}"#) {} else { XCTFail("GroupCreated") }
    }

    func testGeofenceAndPresence() {
        if case .geofenceEntered(let id)? = event(#"{"GeofenceEntered":"home"}"#) { XCTAssertEqual(id, "home") } else { XCTFail() }
        if case .geofenceExited? = event(#"{"GeofenceExited":"home"}"#) {} else { XCTFail() }
        if case .presenceUpdated(let id)? = event(#"{"PresenceUpdated":"u1"}"#) { XCTAssertEqual(id, "u1") } else { XCTFail() }
    }

    func testUnknownVariantBecomesOther() {
        guard case .other(let key, _)? = event(#"{"SomethingNew":"x"}"#) else { return XCTFail() }
        XCTAssertEqual(key, "SomethingNew")
    }

    func testGarbageReturnsNil() {
        XCTAssertNil(event("not json"))
        XCTAssertNil(event("{}"))
    }
}
