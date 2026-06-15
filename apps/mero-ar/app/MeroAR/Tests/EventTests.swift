import XCTest
@testable import MeroAR

final class EventTests: XCTestCase {
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
}
