import XCTest

@testable import DesignCore

final class SceneTests: XCTestCase {
    func testColours() {
        XCTAssertEqual(CSSColor.parse("#fff"), RGBA(1, 1, 1))
        XCTAssertEqual(CSSColor.parse("#FF000080")?.a ?? 0, 128.0 / 255, accuracy: 0.001)
        XCTAssertEqual(CSSColor.parse("rgba(0, 0, 255, 0.5)"), RGBA(0, 0, 1, 0.5))
        XCTAssertNil(CSSColor.parse("transparent"))
        XCTAssertNil(CSSColor.parse(""))
        XCTAssertEqual(CSSColor.ink(on: "#111111"), .white)
        XCTAssertEqual(CSSColor.ink(on: "#FFE27A"), .darkInk)
        XCTAssertEqual(CSSColor.ink(on: "transparent"), .darkInk)
    }

    func testLabelExtras() {
        let (label, meta) = ElementMeta.unpack("screen/Home\u{1F}s=dashed&b=sticky&c=%23ff0000&i=1&h=star")
        XCTAssertEqual(label, "screen/Home")
        XCTAssertEqual(meta, ElementMeta(strokeStyle: "dashed", box: "sticky", textColor: "#ff0000", shape: "star", hidden: true))
        XCTAssertEqual(ElementMeta.unpack("\u{1F}l=1").label, nil)
        XCTAssertEqual(ElementMeta.unpack("plain").meta, ElementMeta())
        XCTAssertEqual(ElementMeta.unpack("x\u{1F}s=wavy").meta.strokeStyle, nil)
    }

    func testPathData() {
        let cmds = PathData.parse("M 10 10 l 5 5 H 30 v -10 Q 40 0 50 10 T 70 10 C 1,2 3,4 5,6 z")
        XCTAssertEqual(cmds[0], .move(Point(10, 10)))
        XCTAssertEqual(cmds[1], .line(Point(15, 15)))
        XCTAssertEqual(cmds[2], .line(Point(30, 15)))
        XCTAssertEqual(cmds[3], .line(Point(30, 5)))
        XCTAssertEqual(cmds[4], .quad(control: Point(40, 0), to: Point(50, 10)))
        XCTAssertEqual(cmds[5], .quad(control: Point(60, 20), to: Point(70, 10)))
        XCTAssertEqual(cmds[6], .cubic(c1: Point(1, 2), c2: Point(3, 4), to: Point(5, 6)))
        XCTAssertEqual(cmds.last, .close)
        // Implicit linetos after a moveto, and exponent / signless numbers.
        XCTAssertEqual(PathData.parse("M0 0 10 10 1e1-5"), [.move(Point(0, 0)), .line(Point(10, 10)), .line(Point(10, -5))])
        XCTAssertEqual(PathData.parse(""), [])
    }

    func testShapesFillTheirBox() {
        for kind in ["triangle", "diamond", "star", "cloud"] {
            let pts = Shapes.outline(kind, width: 200, height: 100)!.compactMap { cmd -> Point? in
                switch cmd {
                case .move(let p), .line(let p): return p
                default: return nil
                }
            }
            XCTAssertEqual(pts.map(\.x).min(), 0, kind)
            XCTAssertEqual(pts.map(\.x).max(), 200, kind)
            XCTAssertEqual(pts.map(\.y).min(), 0, kind)
            XCTAssertEqual(pts.map(\.y).max(), 100, kind)
        }
        XCTAssertNil(Shapes.outline("hexagon", width: 1, height: 1))
        XCTAssertEqual(Shapes.dash("dashed", strokeWidth: 2), [6, 4])
        XCTAssertNil(Shapes.dash(nil, strokeWidth: 2))
    }

    func testWrapKeepsIndentAndBreaksLongWords() {
        let m: Measure = { Double($0.count) * 10 }
        XCTAssertEqual(TextLayout.wrap("hello world foo", maxWidth: 100, measure: m), ["hello", "world foo"])
        XCTAssertEqual(TextLayout.wrap("  indented\nnext", maxWidth: 1000, measure: m), ["  indented", "next"])
        XCTAssertEqual(TextLayout.wrap("abcdefghij", maxWidth: 40, measure: m), ["abcd", "efgh", "ij"])
    }

    func testScreensInPresentationOrder() {
        let els = Fixtures.decode(
            "[" + [
                Fixtures.element("b", Fixtures.rect, x: 500, y: 0, label: "screen/Second"),
                Fixtures.element("a", Fixtures.rect, x: 0, y: 10, label: "screen/First"),
                Fixtures.element("c", Fixtures.rect, x: 0, y: 900, label: "screen/Pinned @1"),
                Fixtures.element("d", Fixtures.rect, x: 0, y: 2000, label: "screen/Hidden\u{1F}i=1"),
                Fixtures.element("e", Fixtures.rect, label: "screen/header/logo"),
                Fixtures.element("f", Fixtures.text("x"), label: "screen/Text"),
            ].joined(separator: ",") + "]")
        let screens = Screens.list(els)
        XCTAssertEqual(screens.map(\.name), ["Pinned", "First", "Second"])
        XCTAssertEqual(screens.first?.order, 1)
    }

    func testFitScreen() {
        let whole = Screens.fit(width: 1440, height: 900, viewW: 390, viewH: 800)
        XCTAssertEqual(whole.scale, 390.0 / 1440, accuracy: 0.0001)
        XCTAssertFalse(whole.scrolls)
        let long = Screens.fit(width: 400, height: 6000, viewW: 390, viewH: 800)
        XCTAssertEqual(long.scale, 390.0 / 400, accuracy: 0.0001)
        XCTAssertTrue(long.scrolls)
    }

    func testSceneBuildsNodesBackToFront() {
        let els = Fixtures.decode(
            "[" + [
                Fixtures.element("top", Fixtures.circle, layer: 2, fill: "#ef4444", stroke: "transparent"),
                Fixtures.element("bottom", Fixtures.rect, x: -10, y: -20, layer: 1, cornerRadius: 999),
                Fixtures.element("ghost", Fixtures.rect, layer: 3, label: "\u{1F}i=1"),
                Fixtures.element(
                    "sticky", Fixtures.text("Ship it on Friday", size: 20, align: "center"), x: 300, w: 120, h: 120,
                    layer: 4, fill: "#FFE27A", label: "\u{1F}b=sticky"),
                Fixtures.element("arrow", #"{"kind":"arrow","points":"0,0 100,0"}"#, layer: 5, stroke: "", strokeWidth: 0),
                Fixtures.element("pic", Fixtures.image("blob1"), layer: 6),
            ].joined(separator: ",") + "]")
        let scene = BoardScene(elements: els)
        XCTAssertEqual(scene.nodes.map(\.id), ["bottom", "top", "sticky", "sticky#text", "arrow", "pic"])
        guard case .rect(_, let stroke, let radius) = scene.nodes[0].shape else { return XCTFail() }
        XCTAssertEqual(radius, 25)
        XCTAssertEqual(stroke?.width, 2)
        guard case .ellipse(let fill, let none) = scene.nodes[1].shape else { return XCTFail() }
        XCTAssertEqual(fill, CSSColor.parse("#ef4444"))
        XCTAssertNil(none)
        guard case .text(let lines, let style, let color, let clip) = scene.nodes[3].shape else { return XCTFail() }
        XCTAssertTrue(clip)
        XCTAssertEqual(style.align, .center)
        XCTAssertEqual(color, .darkInk)
        XCTAssertGreaterThan(lines.count, 1)
        XCTAssertEqual(lines[0].x, 60)
        guard case .line(_, let to, let s, let head) = scene.nodes[4].shape else { return XCTFail() }
        XCTAssertEqual(to, Point(100, 0))
        XCTAssertEqual(s.color, .defaultInk)
        XCTAssertEqual(s.width, 2)
        XCTAssertEqual(head?.count, 3)
        XCTAssertEqual(scene.nodes[5].shape, .image(blobId: "blob1", svg: false))
        // The hidden rect is not in the bounds either.
        XCTAssertEqual(scene.bounds?.x ?? 0, -11, accuracy: 0.001)
        XCTAssertEqual(scene.bounds?.y ?? 0, -21, accuracy: 0.001)
    }

    func testViewportFitAndZoom() {
        let v = Viewport.fit(Rect(x: 0, y: 0, width: 1000, height: 500), viewW: 400, viewH: 800, padding: 0)
        XCTAssertEqual(v.scale, 0.4, accuracy: 0.0001)
        XCTAssertEqual(v.viewPoint(Point(500, 250)).x, 200, accuracy: 0.0001)
        XCTAssertEqual(v.viewPoint(Point(500, 250)).y, 400, accuracy: 0.0001)
        let z = v.zoomed(by: 2, aboutX: 200, y: 400)
        XCTAssertEqual(z.scale, 0.8, accuracy: 0.0001)
        XCTAssertEqual(z.canvasPoint(viewX: 200, viewY: 400), Point(500, 250))
        XCTAssertEqual(Viewport.fit(Rect(x: 0, y: 0, width: 10, height: 10), viewW: 400, viewH: 400).scale, 1)
        XCTAssertEqual(v.zoomed(by: 1000, aboutX: 0, y: 0).scale, Viewport.maxScale)
    }

    func testBoardLinkRoundTrips() {
        let link = DesignFormat.boardLink(teamId: "t1", contextId: "c1")
        XCTAssertEqual(link, "https://links.calimero.network/com.calimero.mero-design/board?team=t1&board=c1")
        XCTAssertEqual(DesignFormat.parseBoardLink(link)?.contextId, "c1")
        XCTAssertEqual(DesignFormat.parseBoardLink("calimero://com.calimero.mero-design/board?team=t&board=b")?.teamId, "t")
        XCTAssertNil(DesignFormat.parseBoardLink("https://links.calimero.network/com.calimero.chat/board?team=t&board=b"))
        XCTAssertEqual(DesignFormat.shortId(String(repeating: "ab", count: 32)), "abab…abab")
        XCTAssertEqual(DesignFormat.initials("ana maria"), "AM")
    }
}
