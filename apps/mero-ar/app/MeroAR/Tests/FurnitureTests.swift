import XCTest
import simd
@testable import MeroAR

final class FurnitureTests: XCTestCase {
    /// A furniture object goes over the wire as the contract's tagged variant:
    /// `{"kind":"furniture","item":"sofa"}` and nothing else.
    func testFurnitureObjectDataWireShape() throws {
        let data = try JSONEncoder().encode(ObjectData(furniture: .sofa))
        let obj = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(obj.count, 2)
        XCTAssertEqual(obj["kind"] as? String, "furniture")
        XCTAssertEqual(obj["item"] as? String, "sofa")
        let back = try JSONDecoder().decode(ObjectData.self, from: data)
        XCTAssertEqual(back.furniture, .sofa)
        XCTAssertEqual(back.displayTitle, "Sofa")
    }

    func testImageObjectIsAFramedPicture() throws {
        let photo = ObjectData(kind: "image", blobId: "b1", naturalWidth: 800, naturalHeight: 400)
        let parts = try XCTUnwrap(photo.furnitureParts)
        let art = try XCTUnwrap(parts.first { $0.role == .art })
        XCTAssertGreaterThan(art.size.x, art.size.y, "a landscape photo hangs landscape")
        XCTAssertEqual(art.centre.y, 1.45, accuracy: 1e-6)
        XCTAssertEqual(photo.displayTitle, "Photo")
    }

    func testShapesHaveNoFurnitureParts() {
        XCTAssertNil(ObjectData(kind: "cube").furnitureParts)
        XCTAssertNil(ObjectData(kind: "text", content: "hi").furnitureParts)
    }

    func testUnknownItemStillDraws() {
        let future = ObjectData(kind: "furniture", item: "piano")
        XCTAssertNil(future.furniture)
        XCTAssertNotNil(future.furnitureParts)
        XCTAssertEqual(future.displayTitle, "Piano")
    }

    /// Every piece stands on the floor and stays inside its stated size, so
    /// scaling a scan to that size fits.
    func testCatalogueFitsItsSize() {
        for piece in FurnitureItem.allCases {
            XCTAssertLessThanOrEqual(piece.rawValue.count, 32, piece.rawValue)
            for part in piece.parts {
                let lo = part.centre - part.size / 2
                let hi = part.centre + part.size / 2
                XCTAssertGreaterThanOrEqual(lo.y, -1e-4, "\(piece) dips below the floor")
                XCTAssertLessThanOrEqual(hi.y, piece.size.y + 1e-3, "\(piece) is taller than its size")
                XCTAssertLessThanOrEqual(abs(part.centre.x) + part.size.x / 2, piece.size.x / 2 + 1e-3, "\(piece) is wider")
                XCTAssertLessThanOrEqual(abs(part.centre.z) + part.size.z / 2, piece.size.z / 2 + 1e-3, "\(piece) is deeper")
            }
        }
    }

    func testWallPiecesHangAtWallHeight() {
        for piece in FurnitureItem.allCases where piece.isWallMounted {
            XCTAssertGreaterThan(piece.parts.map(\.centre.y).min() ?? 0, 1.2, "\(piece)")
        }
    }

    func testScannedSofaBecomesAMovableSofa() throws {
        let turn = simd_float4x4(simd_quatf(angle: .pi / 2, axis: SIMD3(0, 1, 0)))
        var m = turn
        m.columns.3 = SIMD4(1.5, 0.42, -2, 1)
        let scanned = RoomModel.Item(id: "s1", category: "sofa", dimensions: [2.4, 0.85, 0.9], transform: RoomModel.values(m))
        let (data, transform) = try XCTUnwrap(FurnitureItem.sceneData(fromScanned: scanned))
        XCTAssertEqual(data.furniture, .sofa)
        XCTAssertEqual(transform.position.x, 1.5, accuracy: 1e-5)
        XCTAssertEqual(transform.position.y, 0, "stands on the floor")
        XCTAssertEqual(transform.position.z, -2, accuracy: 1e-5)
        XCTAssertEqual(transform.scale.x, 1.2, accuracy: 1e-5)
        XCTAssertEqual(transform.scale.y, 1, accuracy: 1e-5)
        let angle = transform.rotation.simd.angle * (transform.rotation.simd.axis.y < 0 ? -1 : 1)
        XCTAssertEqual(angle, .pi / 2, accuracy: 1e-4)
    }

    func testScanScaleIsClamped() throws {
        let tiny = RoomModel.Item(id: "c", category: "chair", dimensions: [0.01, 9, 0.45], transform: RoomModel.values(matrix_identity_float4x4))
        let (_, transform) = try XCTUnwrap(FurnitureItem.sceneData(fromScanned: tiny))
        XCTAssertEqual(transform.scale.x, 0.2, accuracy: 1e-6)
        XCTAssertEqual(transform.scale.y, 6, accuracy: 1e-6)
    }

    func testScannedTelevisionKeepsWallHeight() throws {
        let tv = RoomModel.Item(id: "t", category: "television", dimensions: [2.9, 0.9, 0.08], transform: RoomModel.values(matrix_identity_float4x4))
        let (data, transform) = try XCTUnwrap(FurnitureItem.sceneData(fromScanned: tv))
        XCTAssertEqual(data.furniture, .wallTV)
        XCTAssertEqual(transform.scale.x, 2, accuracy: 1e-5)
        XCTAssertEqual(transform.scale.y, 1)
    }

    func testFixturesStayPartOfTheRoom() {
        XCTAssertNil(FurnitureItem.forScanCategory("sink"))
        XCTAssertNil(FurnitureItem.forScanCategory("stairs"))
        let sink = RoomModel.Item(id: "k", category: "sink", dimensions: [1, 1, 1], transform: [])
        XCTAssertNil(FurnitureItem.sceneData(fromScanned: sink))
    }
}
