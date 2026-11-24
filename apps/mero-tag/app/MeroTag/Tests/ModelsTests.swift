import XCTest
@testable import MeroTag

/// Decodes contract-shaped JSON (camelCase, as the WASM contract emits) into the
/// app models — guards against drift between the Rust types and Swift mirrors.
final class ModelsTests: XCTestCase {
    private let dec = JSONDecoder()

    func testDecodeTrackerWithLocation() throws {
        let json = """
        {"id":"t1","name":"Phone","ownerId":"admin","viewers":["bob"],
         "latest":{"latitude":40.1,"longitude":-74.2,"altitude":10.0,"speed":1.5,
                   "heading":90.0,"battery":88,"timestamp":2000},
         "createdAt":1000,"updatedAt":2000}
        """
        let t = try dec.decode(Tracker.self, from: Data(json.utf8))
        XCTAssertEqual(t.id, "t1")
        XCTAssertEqual(t.name, "Phone")
        XCTAssertEqual(t.ownerId, "admin")
        XCTAssertEqual(t.viewers, ["bob"])
        XCTAssertEqual(t.latest?.battery, 88)
        XCTAssertEqual(t.latest?.latitude ?? 0, 40.1, accuracy: 0.0001)
        XCTAssertEqual(t.updatedAt, 2000)
    }

    func testDecodeTrackerWithoutLocation() throws {
        let json = #"{"id":"t2","name":"Bag","ownerId":"a","viewers":[],"latest":null,"createdAt":1,"updatedAt":1}"#
        let t = try dec.decode(Tracker.self, from: Data(json.utf8))
        XCTAssertNil(t.latest)
    }

    func testDecodeSpaceInfo() throws {
        let json = #"{"name":"Tracking space","trackerCount":3,"memberCount":2,"groupCount":1}"#
        let s = try dec.decode(SpaceInfo.self, from: Data(json.utf8))
        XCTAssertEqual(s.trackerCount, 3)
        XCTAssertEqual(s.memberCount, 2)
    }

    func testDecodeArrayOfTrackers() throws {
        let json = """
        [{"id":"a","name":"A","ownerId":"x","viewers":[],"latest":null,"createdAt":1,"updatedAt":1},
         {"id":"b","name":"B","ownerId":"x","viewers":[],"latest":null,"createdAt":2,"updatedAt":2}]
        """
        let arr = try dec.decode([Tracker].self, from: Data(json.utf8))
        XCTAssertEqual(arr.map(\.id), ["a", "b"])
    }
}
