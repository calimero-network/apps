import XCTest
@testable import MeroAR

final class ModelsTests: XCTestCase {
    private let dec = JSONDecoder()

    func testDecodeSceneObjectCube() throws {
        let json = """
        {"id":"o1","data":{"kind":"cube"},
         "transform":{"position":{"x":1,"y":0.5,"z":-2},"rotation":{"x":0,"y":0,"z":0,"w":1},
                      "scale":{"x":1,"y":1,"z":1}},
         "color":"3A86FF","lockedBy":null,"createdBy":"admin","createdAt":1000,"updatedAt":2000,"version":2}
        """
        let o = try dec.decode(SceneObject.self, from: Data(json.utf8))
        XCTAssertEqual(o.id, "o1")
        XCTAssertEqual(o.data.kind, "cube")
        XCTAssertNil(o.data.content)
        XCTAssertNil(o.lockedBy)
        XCTAssertEqual(o.version, 2)
        XCTAssertEqual(o.transform.position.x, 1, accuracy: 1e-6)
    }

    func testDecodeLockedTextObject() throws {
        let json = """
        {"id":"o2","data":{"kind":"text","content":"hi"},
         "transform":{"position":{"x":0,"y":0,"z":0},"rotation":{"x":0,"y":0,"z":0,"w":1},
                      "scale":{"x":1,"y":1,"z":1}},
         "color":"fff","lockedBy":"bob","createdBy":"a","createdAt":1,"updatedAt":1,"version":1}
        """
        let o = try dec.decode(SceneObject.self, from: Data(json.utf8))
        XCTAssertEqual(o.data.kind, "text")
        XCTAssertEqual(o.data.content, "hi")
        XCTAssertEqual(o.lockedBy, "bob")
    }

    /// Cube ObjectData should encode to just {"kind":"cube"} (no nil fields),
    /// which is what the contract's tagged enum expects.
    func testEncodeObjectDataOmitsNils() throws {
        let data = try JSONEncoder().encode(ObjectData(kind: "cube"))
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(obj?["kind"] as? String, "cube")
        XCTAssertNil(obj?["content"])
        XCTAssertNil(obj?["blobId"])
        XCTAssertEqual(obj?.count, 1)
    }

    func testEncodeImageObjectData() throws {
        let data = try JSONEncoder().encode(ObjectData(kind: "image", blobId: "b1", naturalWidth: 100, naturalHeight: 50))
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(obj?["kind"] as? String, "image")
        XCTAssertEqual(obj?["blobId"] as? String, "b1")
        XCTAssertEqual(obj?["naturalWidth"] as? Int, 100)
    }

    func testDecodePresence() throws {
        let json = """
        {"identity":"u1","cameraPosition":{"x":0,"y":1.6,"z":0},
         "cameraRotation":{"x":0,"y":0,"z":0,"w":1},"updatedAt":42}
        """
        let p = try dec.decode(Presence.self, from: Data(json.utf8))
        XCTAssertEqual(p.identity, "u1")
        XCTAssertEqual(p.cameraPosition.y, 1.6, accuracy: 1e-6)
    }
}
