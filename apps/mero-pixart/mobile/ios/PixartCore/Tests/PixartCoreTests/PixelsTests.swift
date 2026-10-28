import XCTest

@testable import PixartCore

final class PixelsTests: XCTestCase {
    func testColoursParse() {
        XCTAssertEqual(RGBA.parse("#ff0000"), RGBA(1, 0, 0))
        XCTAssertEqual(RGBA.parse("#f00"), RGBA(1, 0, 0))
        XCTAssertEqual(RGBA.parse("#00000000"), RGBA(0, 0, 0, 0))
        XCTAssertEqual(RGBA.parse("rgba(255, 255, 255, 0.5)"), RGBA(1, 1, 1, 0.5))
        XCTAssertNil(RGBA.parse("chartreuse-ish"))
    }

    func testBlendModesMapFromTheWire() {
        XCTAssertEqual(BlendMode(wire: "color-dodge"), .colorDodge)
        XCTAssertEqual(BlendMode(wire: "bogus"), .normal)
        XCTAssertEqual(BlendMode.softLight.label, "Soft light")
        XCTAssertEqual(BlendMode.allCases.count, 16)
    }

    func testNeutralAdjustmentsAreNoFilter() {
        let l = Fixtures.layer(Fixtures.layerJSON("a"))
        XCTAssertNil(ColorFilter.from(l.adjustments))
        let f = ColorFilter.from(Fixtures.layer(Fixtures.layerJSON("a", brightness: 50, invert: true)).adjustments)!
        XCTAssertEqual(f.brightness!, 1.5, accuracy: 1e-9)
        XCTAssertTrue(f.invert)
        let (r, g, b) = f.apply(0.2, 0.4, 1)
        XCTAssertEqual(r, 0.7, accuracy: 1e-9)
        XCTAssertEqual(g, 0.4, accuracy: 1e-9)
        XCTAssertEqual(b, 0, accuracy: 1e-9)
    }

    func testMaskTakesAlphaFromLuminance() {
        var img = RGBAImage(width: 2, height: 1, pixels: [255, 0, 0, 255, 0, 255, 0, 255])
        let mask = RGBAImage(width: 2, height: 1, pixels: [255, 255, 255, 255, 0, 0, 0, 255])
        PixelOps.mask(&img, with: mask)
        XCTAssertEqual(img[0, 0].3, 255)
        XCTAssertEqual(img[1, 0].3, 0)
    }

    func testBlurPadsAndKeepsCoverage() {
        var px = [UInt8](repeating: 0, count: 5 * 5 * 4)
        let c = (2 * 5 + 2) * 4
        px[c] = 255
        px[c + 3] = 255
        let out = PixelOps.blur(RGBAImage(width: 5, height: 5, pixels: px), radius: 1)
        XCTAssertEqual(out.width, 5 + 2 * PixelOps.blurPad(1))
        let total = stride(from: 3, to: out.pixels.count, by: 4).reduce(0) { $0 + Int(out.pixels[$1]) }
        XCTAssertEqual(Double(total), 255, accuracy: 40)
        XCTAssertEqual(out[3 + 2, 3 + 2].0, 255)
    }
}
