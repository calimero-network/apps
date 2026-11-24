import MeroKit
import XCTest
@testable import MeroTag

/// Contract events arrive as the app instance's server-sent events: the
/// variant as the event kind, `{"id": "…"}` as the payload.
final class EventTests: XCTestCase {
    private func event(_ kind: String, _ data: JSONValue) -> CloudEvent {
        CloudEvent(id: "7", kind: kind, data: data)
    }

    func testNamedIdPayloadDecodes() {
        XCTAssertEqual(TagEvent(event("TrackerUpdated", ["id": "t1"])), .trackerUpdated("t1"))
        XCTAssertEqual(TagEvent(event("GeofenceExited", ["id": "home"])), .geofenceExited("home"))
    }

    func testGroupVariantsAreOneChange() {
        for kind in ["GroupCreated", "GroupUpdated", "GroupDeleted"] {
            XCTAssertEqual(TagEvent(event(kind, ["id": "g"])), .groupChanged("g"))
        }
    }

    func testABareStringPayloadStillDecodes() {
        XCTAssertEqual(TagEvent(event("MemberJoined", "m")), .memberJoined("m"))
    }

    func testUnknownVariantBecomesOther() {
        XCTAssertEqual(TagEvent(event("SomethingNew", ["id": "x"])), .other("SomethingNew", "x"))
    }

    func testAFrameWithNoKindIsNothing() {
        XCTAssertNil(TagEvent(event("", ["id": "x"])))
    }

    func testServiceStreamsEventsAsBatches() async throws {
        let t = FakeTransport()
        let (stream, continuation) = AsyncThrowingStream<CloudEvent, Error>.makeStream()
        t.frames = stream
        let service = MeroService(transport: t, appId: Fixtures.app, memberId: Fixtures.account)
        let events = try XCTUnwrap(service.events())
        continuation.yield(event("TrackerDeleted", ["id": "t1"]))
        continuation.yield(event("", .null))
        continuation.yield(event("PresenceUpdated", ["id": "u"]))
        continuation.finish()
        var seen: [TagEvent] = []
        for try await batch in events { seen += batch }
        XCTAssertEqual(seen, [.trackerDeleted("t1"), .presenceUpdated("u")])
    }
}
