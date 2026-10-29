import XCTest

@testable import PixartCore

final class GeometryTests: XCTestCase {
    func near(_ a: Point, _ b: Point, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a.x, b.x, accuracy: 1e-6, file: file, line: line)
        XCTAssertEqual(a.y, b.y, accuracy: 1e-6, file: file, line: line)
    }

    func testAPlainLayerSitsAtItsPosition() {
        let m = LayerGeometry.matrix(Fixtures.layer(Fixtures.layerJSON("a", x: 10, y: 20, w: 100, h: 50)))
        near(m.apply(Point(0, 0)), Point(10, 20))
        near(m.apply(Point(100, 50)), Point(110, 70))
    }

    func testRotationTurnsAboutTheBoxCentre() {
        let m = LayerGeometry.matrix(Fixtures.layer(Fixtures.layerJSON("a", x: 0, y: 0, w: 100, h: 50, rotation: 90)))
        near(m.apply(Point(50, 25)), Point(50, 25))
        near(m.apply(Point(0, 0)), Point(75, -25))
    }

    func testInverseUndoesTheMatrix() {
        let m = LayerGeometry.matrix(Fixtures.layer(Fixtures.layerJSON("a", x: 5, y: 7, w: 30, h: 40, rotation: 33)))
        near(m.inverted!.apply(m.apply(Point(3, 9))), Point(3, 9))
    }

    func testWarpParsesAndDropsNeutral() {
        XCTAssertNil(Warp.parse(""))
        XCTAssertNil(Warp.parse("nope"))
        XCTAssertNil(Warp.parse(#"{"tl":[0,0],"tr":[0,0],"br":[0,0],"bl":[0,0]}"#))
        let w = Warp.parse(#"{"tl":[5,-2],"tr":[0,0],"br":[0,0]}"#)
        XCTAssertEqual(w?.tl, Point(5, -2))
        XCTAssertEqual(w?.bl, Point(0, 0))
    }

    func testWarpMeshCoversTheQuad() {
        let w = Warp(tl: Point(10, 0), tr: Point(0, 0), br: Point(0, 0), bl: Point(0, 0))
        let mesh = w.mesh(width: 100, height: 100)
        XCTAssertEqual(mesh.count, Warp.steps * Warp.steps * 2)
        // The first cell's source corner (0,0) lands on the pinned corner.
        near(mesh[0].transform.apply(Point(0, 0)), Point(10, 0))
        near(w.point(width: 100, height: 100, u: 1, v: 1), Point(100, 100))
    }
}
