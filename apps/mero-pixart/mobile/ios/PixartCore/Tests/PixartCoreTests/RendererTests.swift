import XCTest

@testable import PixartCore

final class RendererTests: XCTestCase {
    func render(_ items: [String], background: String = "#ffffff", images: [String: Bitmap] = [:], overrides: [String: Bool] = [:]) -> Bitmap {
        let ops = LayerStack.drawOps(Fixtures.layers(items), overrides: overrides)
        return Renderer.composite(width: 4, height: 4, background: background, ops: ops, images: images)!
    }

    func testBackgroundThenAFill() {
        let out = render([Fixtures.layerJSON("a", kind: "fill", x: 2, w: 2, h: 4, fill: "#0000ff")])
        XCTAssertEqual(out.pixel(0, 0).0, 255)
        XCTAssertEqual(out.pixel(3, 0).2, 255)
        XCTAssertEqual(out.pixel(3, 0).0, 0)
    }

    func testOpacityAndMultiply() {
        let out = render([
            Fixtures.layerJSON("a", kind: "fill", index: 0, fill: "#ff0000"),
            Fixtures.layerJSON("b", kind: "fill", index: 1, blend: "multiply", fill: "#00ff00"),
        ])
        // red × green = black
        XCTAssertEqual(out.pixel(1, 1).0, 0)
        XCTAssertEqual(out.pixel(1, 1).1, 0)
        let half = render([Fixtures.layerJSON("a", kind: "fill", opacity: 50, fill: "#000000")])
        XCTAssertEqual(Double(half.pixel(1, 1).0), 127.5, accuracy: 2)
    }

    func testRasterBlobIsDrawnTopLeftAndMasked() {
        let red = Renderer.decode(Fixtures.png(w: 2, h: 2, RGBA(1, 0, 0)))!
        let black = Renderer.decode(Fixtures.png(w: 2, h: 2, RGBA(0, 0, 0)))!
        let out = render([Fixtures.layerJSON("a", w: 4, h: 4, blob: "px")], images: ["px": red])
        XCTAssertEqual(out.pixel(0, 0).1, 0)  // red
        XCTAssertEqual(out.pixel(3, 3).1, 255)  // white background: the 2×2 image does not stretch
        let masked = render([Fixtures.layerJSON("a", w: 2, h: 2, blob: "px", mask: "m")], images: ["px": red, "m": black])
        XCTAssertEqual(masked.pixel(0, 0).1, 255)
    }

    func testLocalHideLeavesItOut() {
        let out = render([Fixtures.layerJSON("a", kind: "fill", fill: "#000000")], overrides: ["a": false])
        XCTAssertEqual(out.pixel(1, 1).0, 255)
    }

    func testInvertAdjustment() {
        let out = render([Fixtures.layerJSON("a", kind: "fill", fill: "#000000", invert: true)])
        XCTAssertEqual(out.pixel(1, 1).0, 255)
        XCTAssertEqual(out.pixel(1, 1).3, 255)
    }

    func testTextPaintsSomething() {
        let ops = LayerStack.drawOps(Fixtures.layers([Fixtures.layerJSON("t", kind: "text", w: 60, h: 20, text: "Hello")]))
        let out = Renderer.composite(width: 60, height: 20, background: "", ops: ops, images: [:])!
        let px = Renderer.rgba(out.image, 60, 20).pixels
        XCTAssertTrue(stride(from: 3, to: px.count, by: 4).contains { px[$0] > 0 })
    }

    func testPNGRoundTripsAndScales() {
        let out = render([Fixtures.layerJSON("a", kind: "fill", fill: "#00ff00")])
        let data = Renderer.png(out)!
        XCTAssertEqual(Renderer.decode(data)?.width, 4)
        let ops = LayerStack.drawOps(Fixtures.layers([Fixtures.layerJSON("a", kind: "fill")]))
        XCTAssertEqual(Renderer.composite(width: 400, height: 200, background: "", ops: ops, images: [:], scale: 0.5)?.width, 200)
    }
}
