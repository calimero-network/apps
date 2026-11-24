import XCTest
import simd
@testable import MeroAR

/// The shared room model: JSON → geometry, the floor, and keeping things inside it.
final class RoomModelTests: XCTestCase {
    private func sample() throws -> RoomModel {
        try XCTUnwrap(RoomModel.sampleLivingRoom(), "the sample room ships in the app bundle")
    }

    func testTheSampleRoomDecodesAsALabelledSample() throws {
        let room = try sample()
        XCTAssertEqual(room.format, RoomModel.currentFormat)
        XCTAssertTrue(room.sample, "the sample must say it's a sample")
        XCTAssertEqual(room.walls.count, 4)
        XCTAssertEqual(room.doors.count, 1)
        XCTAssertEqual(room.windows.count, 2)
        XCTAssertEqual(Set(room.objects.map(\.category)), ["sofa", "table", "chair", "storage", "television"])
    }

    func testTheFloorIsTheRectangleTheWallsEnclose() throws {
        let room = try sample()
        let b = room.floorBounds
        XCTAssertEqual(b.width, 5.2, accuracy: 0.01)
        XCTAssertEqual(b.length, 4.2, accuracy: 0.01)
        XCTAssertEqual(b.centre.x, 0, accuracy: 0.01)
        XCTAssertEqual(b.centre.y, 0, accuracy: 0.01)
        XCTAssertEqual(room.height, 2.6, accuracy: 0.01)
    }

    func testEveryDetectedObjectSitsInsideTheRoom() throws {
        let room = try sample()
        for item in room.objects {
            let c = RoomModel.matrix(item.transform).columns.3
            XCTAssertTrue(room.floorBounds.contains(SIMD3(c.x, c.y, c.z)), "\(item.id) is outside the walls")
        }
    }

    func testClampingKeepsAPointOnTheFloorAndOffTheWalls() {
        let b = FloorBounds(minX: -2, maxX: 2, minZ: -1.5, maxZ: 1.5)
        let outside = b.clamp(SIMD3(5, 1.2, -9), margin: 0.2)
        XCTAssertEqual(outside.x, 1.8, accuracy: 1e-5)
        XCTAssertEqual(outside.z, -1.3, accuracy: 1e-5)
        XCTAssertEqual(outside.y, 0, "snapped to the floor")
        let inside = b.clamp(SIMD3(0.5, 0.3, 0.4), margin: 0.2, floorY: 0.06)
        XCTAssertEqual(inside, SIMD3(0.5, 0.06, 0.4))
    }

    func testARoomNarrowerThanTheMarginClampsToItsCentre() {
        let b = FloorBounds(minX: 0, maxX: 0.2, minZ: 0, maxZ: 3)
        XCTAssertEqual(b.clamp(SIMD3(5, 0, 1), margin: 0.3).x, 0.1, accuracy: 1e-5)
    }

    func testAModelSurvivesTheRoundTripThroughJSON() throws {
        let room = try sample()
        XCTAssertEqual(try RoomModel.decode(try room.encoded()), room)
    }

    func testTransformsRoundTripThroughTheirSixteenFloats() {
        let turn = simd_float4x4(simd_quatf(angle: 0.7, axis: SIMD3(0, 1, 0)))
        var m = turn
        m.columns.3 = SIMD4(1.5, 0.4, -2, 1)
        XCTAssertEqual(RoomModel.matrix(RoomModel.values(m)), m)
        XCTAssertEqual(RoomModel.matrix([1, 2, 3]), matrix_identity_float4x4, "malformed → identity")
    }

    func testOtherFormatsAndWalllessRoomsAreRefused() throws {
        var room = try sample()
        room.format = "someone.else/2"
        XCTAssertThrowsError(try RoomModel.decode(try room.encoded())) {
            XCTAssertEqual($0 as? RoomModel.ModelError, .unsupportedFormat("someone.else/2"))
        }
        let empty = RoomModel(sample: true, walls: [])
        XCTAssertThrowsError(try RoomModel.decode(try empty.encoded())) {
            XCTAssertEqual($0 as? RoomModel.ModelError, .noWalls)
        }
    }

    func testTheContractsScanRecordDecodes() throws {
        let json = """
            {"jsonBlob":"ab12","jsonSize":3625,"usdzBlob":null,"usdzSize":null,"width":5.2,"length":4.2,
             "height":2.6,"objectCount":7,"sample":true,"scannedBy":"cafe","scannedAt":1700000000000,"version":2}
            """
        let record = try JSONDecoder().decode(RoomScanRecord.self, from: Data(json.utf8))
        XCTAssertEqual(record.version, 2)
        XCTAssertTrue(record.sample)
        XCTAssertNil(record.usdzBlob)
        XCTAssertEqual(record.objectCount, 7)
    }
}
