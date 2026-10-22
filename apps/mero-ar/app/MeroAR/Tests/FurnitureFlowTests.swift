import SceneKit
import UIKit
import XCTest
import simd
import MeroKit
@testable import MeroAR

/// The furniture, photo and scan flows end to end against a stubbed relay:
/// what the store sends, what it keeps when the relay refuses, and that every
/// catalogue piece renders. Headless: no simulator UI, no node.
@MainActor
final class FurnitureFlowTests: XCTestCase {
    private let blob = String(repeating: "9f", count: 32)

    override func setUp() {
        super.setUp()
        RelayStub.reset()
    }

    private func intents(_ method: String) -> [RecordedRequest] {
        RelayStub.requests.filter { $0.method == "POST" && $0.path.hasSuffix("/intents") && $0.body?["method"]?.stringValue == method }
    }

    private func stubWrites(_ ctx: String) {
        Fixture.stubDescribe(ctx)
        RelayStub.on("POST", "/admin-api/contexts/\(ctx)/intents", json: #"{"data":{"rootHash":"r1"}}"#)
    }

    // MARK: Furniture

    func testEveryPieceIsAddedUprightOnTheFloor() async throws {
        let ctx = Fixture.context()
        stubWrites(ctx)
        let store = SceneStore(service: Fixture.service(context: ctx))
        // Where the 3D room's placement landed: a tabletop spot, ×3 for shapes.
        var placed = Transform.at(Vec3(0.4, 0.06, -0.3)).rotatedY(30)
        placed.scale = Vec3(3, 3, 3)

        for piece in FurnitureItem.allCases {
            let ok = await store.addObject(
                data: ObjectData(furniture: piece), transform: placed.standing(keepHeight: false),
                color: piece.defaultColor)
            XCTAssertTrue(ok, "\(piece)")
        }

        let adds = intents("add_object")
        XCTAssertEqual(adds.count, FurnitureItem.allCases.count)
        for (request, piece) in zip(adds, FurnitureItem.allCases) {
            let object = try XCTUnwrap(request.body?["argsJson"]?["object"])
            XCTAssertEqual(object["data"]?["kind"]?.stringValue, "furniture")
            XCTAssertEqual(object["data"]?["item"]?.stringValue, piece.rawValue)
            XCTAssertEqual(object["data"]?.objectValue?.count, 2, "only kind and item on the wire")
            let t = try XCTUnwrap(object["transform"])
            XCTAssertEqual(t["position"]?["x"]?.doubleValue ?? .nan, 0.4, accuracy: 1e-9)
            XCTAssertEqual(t["position"]?["y"]?.doubleValue, 0, "on the floor")
            XCTAssertEqual(t["rotation"]?["w"]?.doubleValue, 1, "upright, unturned")
            XCTAssertEqual(t["rotation"]?["y"]?.doubleValue, 0)
            for axis in ["x", "y", "z"] { XCTAssertEqual(t["scale"]?[axis]?.doubleValue, 1, "real size") }
        }
        XCTAssertEqual(store.objects.count, FurnitureItem.allCases.count)
    }

    func testLiveARKeepsTheSurfaceHeight() {
        let t = Transform.at(Vec3(1, 0.74, -2)).standing(keepHeight: true)
        XCTAssertEqual(t.position.y, 0.74, accuracy: 1e-9)
        XCTAssertEqual(t.scale, Vec3(1, 1, 1))
    }

    func testARefusedAddLeavesNoGhost() async {
        let ctx = Fixture.context()
        Fixture.stubDescribe(ctx)
        RelayStub.on(
            "POST", "/admin-api/contexts/\(ctx)/intents", status: 403,
            json: #"{"error":"view-only: editor or admin access is required to change this room"}"#)
        let store = SceneStore(service: Fixture.service(context: ctx))

        let ok = await store.addObject(data: ObjectData(furniture: .sofa), transform: .at(Vec3(0, 0, 0)), color: "6D6A8C")

        XCTAssertFalse(ok)
        XCTAssertTrue(store.objects.isEmpty, "the optimistic sofa was not taken back")
        XCTAssertEqual(store.lastError, "view-only: editor or admin access is required to change this room")
    }

    // MARK: Photos

    private func jpeg(width: Int, height: Int) -> Data {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { ctx in
            UIColor.systemTeal.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }.jpegData(compressionQuality: 0.9)!
    }

    func testALargePhotoIsShrunkKeepingItsShape() throws {
        let prepared = try XCTUnwrap(PictureCache.prepare(jpeg(width: 3000, height: 1500)))
        XCTAssertEqual(prepared.width, 1024)
        XCTAssertEqual(prepared.height, 512)
        let image = try XCTUnwrap(UIImage(data: prepared.jpeg))
        XCTAssertEqual(image.size.width * image.scale, 1024)
    }

    func testASmallPhotoIsNotEnlarged() throws {
        let prepared = try XCTUnwrap(PictureCache.prepare(jpeg(width: 600, height: 800)))
        XCTAssertEqual(prepared.width, 600)
        XCTAssertEqual(prepared.height, 800)
    }

    func testNotAPhotoIsRefused() {
        XCTAssertNil(PictureCache.prepare(Data("not an image".utf8)))
    }

    func testAPhotoIsUploadedIntoTheRoomThenHung() async throws {
        let ctx = Fixture.context()
        stubWrites(ctx)
        RelayStub.on("PUT", "/admin-api/blobs", json: #"{"data":{"blob_id":"\#(blob)","size":3}}"#)
        let store = SceneStore(service: Fixture.service(context: ctx))
        let prepared = try XCTUnwrap(PictureCache.prepare(jpeg(width: 2048, height: 1536)))

        await store.addPicture(
            jpeg: prepared.jpeg, width: prepared.width, height: prepared.height,
            transform: Transform.at(Vec3(0.5, 0.2, -1)).standing(keepHeight: false))

        XCTAssertNil(store.lastError)
        let upload = try XCTUnwrap(RelayStub.requests.first { $0.method == "PUT" })
        XCTAssertEqual(upload.path, "/admin-api/blobs")
        XCTAssertEqual(upload.query, "context_id=\(ctx)")
        let add = try XCTUnwrap(intents("add_object").first)
        let data = try XCTUnwrap(add.body?["argsJson"]?["object"]?["data"])
        XCTAssertEqual(data["kind"]?.stringValue, "image")
        XCTAssertEqual(data["blobId"]?.stringValue, blob)
        XCTAssertEqual(data["naturalWidth"]?.doubleValue, 1024)
        XCTAssertEqual(data["naturalHeight"]?.doubleValue, 768)
        XCTAssertNotNil(PictureCache.shared.image(for: blob), "the uploader shows its photo without downloading it")
        XCTAssertFalse(store.isUploadingPicture)
    }

    func testWithoutTheBearerSessionAPhotoSaysWhyAndSendsNothing() async {
        let ctx = Fixture.context()
        let store = SceneStore(service: Fixture.service(context: ctx, withBearer: false))

        await store.addPicture(jpeg: jpeg(width: 10, height: 10), width: 10, height: 10, transform: .at(Vec3(0, 0, 0)))

        XCTAssertTrue(RelayStub.requests.isEmpty, "a request went out with no session to carry it")
        XCTAssertTrue(store.objects.isEmpty)
        XCTAssertEqual(
            store.lastError,
            "Photos need the live connection to your relay, which isn't up yet. Try again in a moment.")
    }

    // MARK: Scanned furniture

    /// The sample room plus a sink, which must stay part of the room.
    private func roomWithAFixture() throws -> RoomModel {
        var room = try XCTUnwrap(RoomModel.sampleLivingRoom(bundle: Bundle(for: SceneStore.self)))
        var sink = room.objects[0]
        sink.id = "sink-1"
        sink.category = "sink"
        room.objects.append(sink)
        return room
    }

    /// Publishing reads the scan back; answer with a record naming `blob`,
    /// whose bytes are `model`.
    private func stubScan(_ ctx: String, model: RoomModel) throws {
        RelayStub.on("PUT", "/admin-api/blobs", json: #"{"data":{"blob_id":"\#(blob)","size":10}}"#)
        RelayStub.on(
            "POST", "/admin-api/contexts/\(ctx)/query",
            json: """
                {"data":{"returns":{"jsonBlob":"\(blob)","jsonSize":10,"usdzBlob":null,"usdzSize":null,
                "width":5.2,"length":4.2,"height":2.6,"objectCount":\(model.objects.count),"sample":true,
                "scannedBy":"\(Fixture.account)","scannedAt":1,"version":1}}}
                """)
        RelayStub.on("GET", "/admin-api/blobs/\(blob)", json: String(decoding: try model.encoded(), as: UTF8.self))
    }

    func testScannedFurnitureBecomesMovableAndLeavesTheRoom() async throws {
        let ctx = Fixture.context()
        stubWrites(ctx)
        let room = try roomWithAFixture()
        try stubScan(ctx, model: room)
        let store = SceneStore(service: Fixture.service(context: ctx))
        let published = await store.publishRoomScan(room)
        XCTAssertTrue(published)
        XCTAssertEqual(store.roomModel?.objects.count, room.objects.count)
        // What the room will hold once the conversion republishes it.
        var remaining = room
        remaining.objects.removeAll { FurnitureItem.forScanCategory($0.category) != nil }
        try stubScan(ctx, model: remaining)
        let before = RelayStub.requests.count

        let count = await store.makeScannedFurnitureMovable()

        let movable = room.objects.filter { FurnitureItem.forScanCategory($0.category) != nil }
        XCTAssertEqual(count, movable.count)
        XCTAssertEqual(count, 7, "sofa, table, two chairs, two storage units, television")
        let sent = RelayStub.requests.dropFirst(before)
        let adds = sent.filter { $0.body?["method"]?.stringValue == "add_object" }
        XCTAssertEqual(adds.count, movable.count)
        for (request, scanned) in zip(adds, movable) {
            let object = try XCTUnwrap(request.body?["argsJson"]?["object"])
            XCTAssertEqual(object["data"]?["item"]?.stringValue, FurnitureItem.forScanCategory(scanned.category)?.rawValue)
            let m = RoomModel.matrix(scanned.transform)
            XCTAssertEqual(object["transform"]?["position"]?["x"]?.doubleValue ?? .nan, Double(m.columns.3.x), accuracy: 1e-4)
            XCTAssertEqual(object["transform"]?["position"]?["z"]?.doubleValue ?? .nan, Double(m.columns.3.z), accuracy: 1e-4)
            XCTAssertEqual(object["transform"]?["position"]?["y"]?.doubleValue, 0, "on the floor")
            for axis in ["x", "y", "z"] {
                let v = object["transform"]?["scale"]?[axis]?.doubleValue ?? .nan
                XCTAssert((0.2...6).contains(v), "\(scanned.category) scale \(axis) = \(v)")
            }
        }
        // Then the room again, without the converted pieces.
        let republish = try XCTUnwrap(sent.last { $0.body?["method"]?.stringValue == "set_room_scan" })
        XCTAssertEqual(republish.body?["argsJson"]?["object_count"]?.doubleValue, 1, "only the sink is left")
        XCTAssertEqual(store.roomModel?.objects.map(\.category), ["sink"], "the fixture stays part of the room")
        XCTAssertEqual(store.objects.count, movable.count)
    }

    func testARefusedConversionKeepsTheScanWhole() async throws {
        let ctx = Fixture.context()
        stubWrites(ctx)
        let room = try roomWithAFixture()
        try stubScan(ctx, model: room)
        let store = SceneStore(service: Fixture.service(context: ctx))
        _ = await store.publishRoomScan(room)
        RelayStub.on("POST", "/admin-api/contexts/\(ctx)/intents", status: 403, json: #"{"error":"view-only"}"#)
        let before = RelayStub.requests.count

        let count = await store.makeScannedFurnitureMovable()

        XCTAssertEqual(count, 0)
        XCTAssertNil(
            RelayStub.requests.dropFirst(before).first { $0.body?["method"]?.stringValue == "set_room_scan" },
            "the scan was republished without furniture nobody could move")
        XCTAssertEqual(store.roomModel?.objects.count, room.objects.count)
        XCTAssertTrue(store.objects.isEmpty)
        XCTAssertNotNil(store.lastError)
    }

    // MARK: Catalogue

    func testEveryPieceIsComplete() {
        for piece in FurnitureItem.allCases {
            XCTAssertFalse(piece.title.isEmpty)
            XCTAssertNotNil(UIImage(systemName: piece.symbol), "\(piece): no SF Symbol \(piece.symbol)")
            XCTAssertTrue(piece.size.x > 0 && piece.size.y > 0 && piece.size.z > 0, "\(piece)")
            XCTAssertFalse(piece.parts.isEmpty, "\(piece)")
            XCTAssertNotNil(FurnitureItem(rawValue: piece.rawValue))
            XCTAssertEqual(piece.defaultColor.count, 6, "\(piece) colour")
            XCTAssertNotNil(UInt32(piece.defaultColor, radix: 16), "\(piece) colour")
        }
        XCTAssertNotNil(UIImage(systemName: "photo.artframe"))
    }

    func testEveryScanCategoryIsFurnitureOrAFixture() {
        for category in FurnitureItem.scanCategories {
            let mapped = FurnitureItem.forScanCategory(category) != nil
            let fixture = FurnitureItem.scanFixtures.contains(category)
            XCTAssertTrue(mapped != fixture, "\(category) must be exactly one of furniture or fixture")
        }
        XCTAssertTrue(FurnitureItem.scanFixtures.isSubset(of: Set(FurnitureItem.scanCategories)))
    }

    // MARK: Renderers

    /// The union of a node's children's boxes, in the node's own space.
    private func extent(_ node: SCNNode) -> (min: SIMD3<Float>, max: SIMD3<Float>) {
        var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = -lo
        for child in node.childNodes {
            guard child.geometry != nil else { continue }
            let (a, b) = child.boundingBox
            lo = simd_min(lo, SIMD3(a.x, a.y, a.z) + child.simdPosition)
            hi = simd_max(hi, SIMD3(b.x, b.y, b.z) + child.simdPosition)
        }
        return (lo, hi)
    }

    private func object(_ data: ObjectData) -> SceneObject {
        SceneObject(
            id: "o-\(data.item ?? data.kind)", data: data, transform: .at(Vec3(0, 0, 0)), color: "8B5CF6",
            lockedBy: nil, createdBy: Fixture.account, createdAt: 1, updatedAt: 1, version: 1)
    }

    func testEveryPieceRendersAtItsCatalogueSize() {
        for piece in FurnitureItem.allCases {
            for selected in [false, true] {
                let node = PreviewScene.makeNode(for: object(ObjectData(furniture: piece)), selected: selected)
                XCTAssertEqual(node.name, "o-\(piece.rawValue)")
                XCTAssertEqual(node.childNodes.filter { $0.geometry != nil }.count, piece.parts.count + (selected ? 1 : 0))
            }
            let (lo, hi) = extent(PreviewScene.makeNode(for: object(ObjectData(furniture: piece)), selected: false))
            let size = hi - lo
            for axis in [0, 2] {
                XCTAssertEqual(size[axis], piece.size[axis], accuracy: 0.03, "\(piece) axis \(axis)")
            }
            XCTAssertEqual(hi.y, piece.size.y, accuracy: 0.03, "\(piece) height")
            if piece.isWallMounted {
                XCTAssertGreaterThan(lo.y, 0.9, "\(piece) hangs on the wall")
            } else {
                XCTAssertEqual(lo.y, 0, accuracy: 0.01, "\(piece) stands on the floor")
            }
        }
    }

    func testAPhotoRendersAsAFrameShapedLikeIt() {
        let portrait = PreviewScene.makeNode(
            for: object(ObjectData(kind: "image", blobId: "nothing-cached", naturalWidth: 600, naturalHeight: 900)),
            selected: false)
        let (lo, hi) = extent(portrait)
        XCTAssertGreaterThan(hi.y - lo.y, hi.x - lo.x, "a portrait photo hangs portrait")
        XCTAssertGreaterThan(lo.y, 1, "hung on the wall")
        // An image object with no size yet still draws.
        _ = PreviewScene.makeNode(for: object(ObjectData(kind: "image")), selected: true)
    }

    func testShapesStillRender() {
        for kind in ["cube", "sphere", "arrow", "marker"] {
            XCTAssertNotNil(PreviewScene.makeNode(for: object(ObjectData(kind: kind)), selected: false).childNodes.first?.geometry)
        }
    }
}
