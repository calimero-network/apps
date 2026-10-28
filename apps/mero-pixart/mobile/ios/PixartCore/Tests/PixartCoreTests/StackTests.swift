import XCTest

@testable import PixartCore

final class StackTests: XCTestCase {
    let layers = Fixtures.layers([
        Fixtures.layerJSON("folder", kind: "group", index: 2, opacity: 50),
        Fixtures.layerJSON("inside", parent: "folder", index: 3, opacity: 50, blob: "b1"),
        Fixtures.layerJSON("bg", kind: "fill", index: 0, fill: "#ff0000"),
        Fixtures.layerJSON("blank", index: 1),
        Fixtures.layerJSON("title", kind: "text", index: 4, text: "Hi"),
    ])

    func testDrawsBottomToTopSkippingFoldersAndBlankRasters() {
        let ops = LayerStack.drawOps(layers)
        XCTAssertEqual(ops.map(\.layerId), ["bg", "inside", "title"])
        XCTAssertEqual(ops[0].source, .fill(RGBA(1, 0, 0)))
        XCTAssertEqual(ops[1].source, .raster(blobId: "b1"))
        XCTAssertEqual(ops[1].alpha, 0.25, accuracy: 1e-9)
        XCTAssertEqual(LayerStack.blobIds(ops), ["b1"])
    }

    func testHidingAFolderHidesItsContentsOnThisPhoneOnly() {
        let ops = LayerStack.drawOps(layers, overrides: ["folder": false])
        XCTAssertEqual(ops.map(\.layerId), ["bg", "title"])
        let rows = LayerTree.rows(layers, overrides: ["folder": false])
        XCTAssertEqual(rows.map(\.id), ["title", "folder", "inside", "blank", "bg"])
        XCTAssertEqual(rows[1].overridden, true)
        XCTAssertEqual(rows[2].depth, 1)
        XCTAssertTrue(rows[2].hiddenByFolder)
    }

    func testShowingALayerTheDocumentHides() {
        let hidden = Fixtures.layers([Fixtures.layerJSON("a", kind: "fill", visible: false)])
        XCTAssertTrue(LayerStack.drawOps(hidden).isEmpty)
        XCTAssertEqual(LayerStack.drawOps(hidden, overrides: ["a": true]).count, 1)
    }

    func testACycleFallsBackToTheTopLevel() {
        let loop = Fixtures.layers([
            Fixtures.layerJSON("a", kind: "group", parent: "b"), Fixtures.layerJSON("b", kind: "group", parent: "a"),
        ])
        XCTAssertEqual(LayerTree.rows(loop).count, 2)
    }
}
