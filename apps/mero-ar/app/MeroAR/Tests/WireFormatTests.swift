import XCTest
import MeroKit
@testable import MeroAR

/// The contract mixes casings on purpose: top-level `argsJson` keys are Rust
/// parameter names (snake_case) while nested structs carry serde's camelCase
/// rename. `MeroJSON` applies no key strategy, so anything that silently
/// re-cased a key here would only fail against a live node. These pin the
/// model→`JSONValue` bridge the service builds its arguments with.
final class WireFormatTests: XCTestCase {

    func testTransformBridgesToCamelCaseJSON() throws {
        let transform = Transform(
            position: Vec3(1, 2, 3), rotation: Quat(0, 0, 0, 1), scale: Vec3(1, 1, 1))
        let value = try JSONValue(encoding: transform)

        XCTAssertEqual(value["position"]?["x"]?.doubleValue, 1)
        XCTAssertEqual(value["position"]?["z"]?.doubleValue, 3)
        XCTAssertEqual(value["rotation"]?["w"]?.doubleValue, 1)
        XCTAssertEqual(value["scale"]?["y"]?.doubleValue, 1)
    }

    func testSceneObjectBridgeKeepsContractKeys() throws {
        let object = SceneObject(
            id: "o1", data: ObjectData(kind: "cube"),
            transform: Transform(position: Vec3(0, 0, 0), rotation: Quat(0, 0, 0, 1), scale: Vec3(1, 1, 1)),
            color: "7A6CFF", lockedBy: nil, createdBy: "pk", createdAt: 10, updatedAt: 10, version: 0)
        let value = try JSONValue(encoding: object)

        // camelCase, exactly as the contract's `rename_all = "camelCase"` expects.
        XCTAssertEqual(value["createdBy"]?.stringValue, "pk")
        XCTAssertEqual(value["createdAt"]?.doubleValue, 10)
        XCTAssertEqual(value["version"]?.doubleValue, 0)
        XCTAssertEqual(value["data"]?["kind"]?.stringValue, "cube")
        XCTAssertNil(value["created_by"])
        XCTAssertNil(value["locked_by"])
    }

    /// `owner` is new in the rc.20 contract and absent on rooms nobody has
    /// renamed yet — decoding must tolerate both.
    func testRoomInfoDecodesWithAndWithoutOwner() throws {
        let withOwner = """
        {"name":"Studio","objectCount":2,"memberCount":3,"worldMapBlob":"b1","version":7,"owner":"pk1"}
        """
        let room = try JSONDecoder().decode(RoomInfo.self, from: Data(withOwner.utf8))
        XCTAssertEqual(room.owner, "pk1")
        XCTAssertEqual(room.objectCount, 2)

        let withoutOwner = """
        {"name":"Studio","objectCount":0,"memberCount":1,"worldMapBlob":"","version":0}
        """
        let fresh = try JSONDecoder().decode(RoomInfo.self, from: Data(withoutOwner.utf8))
        XCTAssertNil(fresh.owner)
    }

    /// Millisecond timestamps are `u64` on the contract, but `JSONValue` carries
    /// numbers as `Double` — so the bridge must still emit `1755000000000`, never
    /// `1.755e+12` (serde rejects the exponent form for an integer) and never
    /// `…000.0`. This is the failure that would only ever show up against a live
    /// node, as a deserialization panic in the guest.
    func testLargeTimestampsEncodeAsPlainIntegers() throws {
        let args: [String: JSONValue] = [
            "timestamp": .number(Double(1_755_000_000_000 as UInt64)),
            "updated_at": .number(Double(1_755_000_000_123 as UInt64)),
        ]
        let json = String(decoding: try JSONEncoder().encode(args), as: UTF8.self)

        XCTAssertFalse(json.lowercased().contains("e+"), "exponent form in \(json)")
        XCTAssertFalse(json.contains("."), "fractional form in \(json)")
        XCTAssertTrue(json.contains("1755000000000"), json)
        XCTAssertTrue(json.contains("1755000000123"), json)
    }

    /// Same hazard through the model bridge: `SceneObject.createdAt` is a `UInt64`
    /// that gets re-encoded via `JSONValue`.
    func testSceneObjectTimestampsSurviveTheBridge() throws {
        let object = SceneObject(
            id: "o1", data: ObjectData(kind: "cube"),
            transform: Transform(position: Vec3(0, 0, 0), rotation: Quat(0, 0, 0, 1), scale: Vec3(1, 1, 1)),
            color: "7A6CFF", lockedBy: nil, createdBy: "pk",
            createdAt: 1_755_000_000_000, updatedAt: 1_755_000_000_000, version: 3)
        let json = String(decoding: try JSONEncoder().encode(try JSONValue(encoding: object)), as: UTF8.self)

        XCTAssertTrue(json.contains("1755000000000"), json)
        XCTAssertFalse(json.lowercased().contains("e+"), "exponent form in \(json)")
        // `version: 3` must not arrive as `3.0` either.
        XCTAssertFalse(json.contains("3.0"), json)
    }

    func testMemberRoleCapabilities() throws {
        let json = """
        [{"member":"pk1","role":"admin"},{"member":"pk2","role":"editor"},{"member":"pk3","role":"viewer"}]
        """
        let roles = try JSONDecoder().decode([MemberRole].self, from: Data(json.utf8))
        XCTAssertEqual(roles.count, 3)
        XCTAssertTrue(roles[0].isAdmin)
        XCTAssertTrue(roles[0].canEdit)
        XCTAssertFalse(roles[1].isAdmin)
        XCTAssertTrue(roles[1].canEdit)
        XCTAssertFalse(roles[2].canEdit)
        // `id` is the member key, so SwiftUI lists stay stable across refreshes.
        XCTAssertEqual(roles[2].id, "pk3")
    }
}
