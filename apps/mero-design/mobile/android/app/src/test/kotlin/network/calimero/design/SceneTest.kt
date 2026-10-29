package network.calimero.design

import network.calimero.design.core.BoardScene
import network.calimero.design.core.CssColor
import network.calimero.design.core.DesignFormat
import network.calimero.design.core.ElementMeta
import network.calimero.design.core.PathCommand
import network.calimero.design.core.PathData
import network.calimero.design.core.Point
import network.calimero.design.core.Rect
import network.calimero.design.core.Rgba
import network.calimero.design.core.SceneNode
import network.calimero.design.core.Screens
import network.calimero.design.core.Shapes
import network.calimero.design.core.TextLayout
import network.calimero.design.core.TextStyle
import network.calimero.design.core.Viewport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as the iOS `SceneTests`, so both platforms draw a board the same way. */
class SceneTest {
    @Test
    fun colours() {
        assertEquals(Rgba(1.0, 1.0, 1.0), CssColor.parse("#fff"))
        assertEquals(128.0 / 255, CssColor.parse("#FF000080")!!.a, 0.001)
        assertEquals(Rgba(0.0, 0.0, 1.0, 0.5), CssColor.parse("rgba(0, 0, 255, 0.5)"))
        assertNull(CssColor.parse("transparent"))
        assertNull(CssColor.parse(""))
        assertEquals(Rgba.WHITE, CssColor.inkOn("#111111"))
        assertEquals(Rgba.DARK_INK, CssColor.inkOn("#FFE27A"))
        assertEquals(Rgba.DARK_INK, CssColor.inkOn("transparent"))
    }

    @Test
    fun labelExtras() {
        val (label, meta) = ElementMeta.unpack("screen/Home\u001Fs=dashed&b=sticky&c=%23ff0000&i=1&h=star")
        assertEquals("screen/Home", label)
        assertEquals(ElementMeta("dashed", "sticky", "#ff0000", "star", hidden = true), meta)
        assertNull(ElementMeta.unpack("\u001Fl=1").first)
        assertEquals(ElementMeta(), ElementMeta.unpack("plain").second)
        assertNull(ElementMeta.unpack("x\u001Fs=wavy").second.strokeStyle)
    }

    @Test
    fun pathData() {
        val cmds = PathData.parse("M 10 10 l 5 5 H 30 v -10 Q 40 0 50 10 T 70 10 C 1,2 3,4 5,6 z")
        assertEquals(PathCommand.Move(Point(10.0, 10.0)), cmds[0])
        assertEquals(PathCommand.Line(Point(15.0, 15.0)), cmds[1])
        assertEquals(PathCommand.Line(Point(30.0, 15.0)), cmds[2])
        assertEquals(PathCommand.Line(Point(30.0, 5.0)), cmds[3])
        assertEquals(PathCommand.Quad(Point(40.0, 0.0), Point(50.0, 10.0)), cmds[4])
        assertEquals(PathCommand.Quad(Point(60.0, 20.0), Point(70.0, 10.0)), cmds[5])
        assertEquals(PathCommand.Cubic(Point(1.0, 2.0), Point(3.0, 4.0), Point(5.0, 6.0)), cmds[6])
        assertEquals(PathCommand.Close, cmds.last())
        assertEquals(
            listOf(PathCommand.Move(Point(0.0, 0.0)), PathCommand.Line(Point(10.0, 10.0)), PathCommand.Line(Point(10.0, -5.0))),
            PathData.parse("M0 0 10 10 1e1-5"),
        )
        assertEquals(emptyList<PathCommand>(), PathData.parse(""))
    }

    @Test
    fun shapesFillTheirBox() {
        for (kind in listOf("triangle", "diamond", "star", "cloud")) {
            val pts =
                Shapes.outline(kind, 200.0, 100.0)!!.mapNotNull {
                    when (it) {
                        is PathCommand.Move -> it.p
                        is PathCommand.Line -> it.p
                        else -> null
                    }
                }
            assertEquals(kind, 0.0, pts.minOf { it.x }, 0.0)
            assertEquals(kind, 200.0, pts.maxOf { it.x }, 0.0)
            assertEquals(kind, 0.0, pts.minOf { it.y }, 0.0)
            assertEquals(kind, 100.0, pts.maxOf { it.y }, 0.0)
        }
        assertNull(Shapes.outline("hexagon", 1.0, 1.0))
        assertEquals(listOf(6.0, 4.0), Shapes.dash("dashed", 2.0))
        assertNull(Shapes.dash(null, 2.0))
    }

    @Test
    fun wrapKeepsIndentAndBreaksLongWords() {
        val m: (String) -> Double = { it.length * 10.0 }
        assertEquals(listOf("hello", "world foo"), TextLayout.wrap("hello world foo", 100.0, m))
        assertEquals(listOf("  indented", "next"), TextLayout.wrap("  indented\nnext", 1000.0, m))
        assertEquals(listOf("abcd", "efgh", "ij"), TextLayout.wrap("abcdefghij", 40.0, m))
    }

    @Test
    fun screensInPresentationOrder() {
        val els =
            Fixtures.decode(
                "[" +
                    listOf(
                        Fixtures.element("b", Fixtures.RECT, x = 500, y = 0, label = "screen/Second"),
                        Fixtures.element("a", Fixtures.RECT, x = 0, y = 10, label = "screen/First"),
                        Fixtures.element("c", Fixtures.RECT, x = 0, y = 900, label = "screen/Pinned @1"),
                        Fixtures.element("d", Fixtures.RECT, x = 0, y = 2000, label = "screen/Hidden\u001Fi=1"),
                        Fixtures.element("e", Fixtures.RECT, label = "screen/header/logo"),
                        Fixtures.element("f", Fixtures.text("x"), label = "screen/Text"),
                    ).joinToString(",") + "]",
            )
        val screens = Screens.list(els)
        assertEquals(listOf("Pinned", "First", "Second"), screens.map { it.name })
        assertEquals(1, screens.first().order)
    }

    @Test
    fun fitScreen() {
        val (scale, scrolls) = Screens.fit(1440.0, 900.0, 390.0, 800.0)
        assertEquals(390.0 / 1440, scale, 0.0001)
        assertFalse(scrolls)
        val (longScale, longScrolls) = Screens.fit(400.0, 6000.0, 390.0, 800.0)
        assertEquals(390.0 / 400, longScale, 0.0001)
        assertTrue(longScrolls)
    }

    @Test
    fun sceneBuildsNodesBackToFront() {
        val els =
            Fixtures.decode(
                "[" +
                    listOf(
                        Fixtures.element("top", Fixtures.CIRCLE, layer = 2, fill = "#ef4444", stroke = "transparent"),
                        Fixtures.element("bottom", Fixtures.RECT, x = -10, y = -20, layer = 1, cornerRadius = 999),
                        Fixtures.element("ghost", Fixtures.RECT, layer = 3, label = "\u001Fi=1"),
                        Fixtures.element(
                            "sticky",
                            Fixtures.text("Ship it on Friday", size = 20, align = "center"),
                            x = 300,
                            w = 120,
                            h = 120,
                            layer = 4,
                            fill = "#FFE27A",
                            label = "\u001Fb=sticky",
                        ),
                        Fixtures.element("arrow", """{"kind":"arrow","points":"0,0 100,0"}""", layer = 5, stroke = "", strokeWidth = 0),
                        Fixtures.element("pic", Fixtures.image("blob1"), layer = 6),
                    ).joinToString(",") + "]",
            )
        val scene = BoardScene.of(els)
        assertEquals(listOf("bottom", "top", "sticky", "sticky#text", "arrow", "pic"), scene.nodes.map { it.id })
        val rect = scene.nodes[0].shape as SceneNode.Shape.Rect
        assertEquals(25.0, rect.cornerRadius, 0.0)
        assertEquals(2.0, rect.stroke!!.width, 0.0)
        val circle = scene.nodes[1].shape as SceneNode.Shape.Ellipse
        assertEquals(CssColor.parse("#ef4444"), circle.fill)
        assertNull(circle.stroke)
        val words = scene.nodes[3].shape as SceneNode.Shape.Text
        assertTrue(words.clip)
        assertEquals(TextStyle.Align.CENTER, words.style.align)
        assertEquals(Rgba.DARK_INK, words.color)
        assertTrue(words.lines.size > 1)
        assertEquals(60.0, words.lines[0].x, 0.0)
        val arrow = scene.nodes[4].shape as SceneNode.Shape.Line
        assertEquals(Point(100.0, 0.0), arrow.to)
        assertEquals(Rgba.DEFAULT_INK, arrow.stroke.color)
        assertEquals(2.0, arrow.stroke.width, 0.0)
        assertEquals(3, arrow.arrowHead!!.size)
        assertEquals(SceneNode.Shape.Image("blob1", svg = false), scene.nodes[5].shape)
        assertEquals(-11.0, scene.bounds!!.x, 0.001)
        assertEquals(-21.0, scene.bounds!!.y, 0.001)
    }

    @Test
    fun viewportFitAndZoom() {
        val v = Viewport.fit(Rect(0.0, 0.0, 1000.0, 500.0), 400.0, 800.0, padding = 0.0)
        assertEquals(0.4, v.scale, 0.0001)
        assertEquals(200.0, v.viewPoint(Point(500.0, 250.0)).x, 0.0001)
        assertEquals(400.0, v.viewPoint(Point(500.0, 250.0)).y, 0.0001)
        val z = v.zoomed(2.0, 200.0, 400.0)
        assertEquals(0.8, z.scale, 0.0001)
        assertEquals(Point(500.0, 250.0), z.canvasPoint(200.0, 400.0))
        assertEquals(1.0, Viewport.fit(Rect(0.0, 0.0, 10.0, 10.0), 400.0, 400.0).scale, 0.0)
        assertEquals(Viewport.MAX_SCALE, v.zoomed(1000.0, 0.0, 0.0).scale, 0.0)
    }

    @Test
    fun boardLinkRoundTrips() {
        val link = DesignFormat.boardLink("t1", "c1")
        assertEquals("https://links.calimero.network/com.calimero.mero-design/board?team=t1&board=c1", link)
        assertEquals("c1", DesignFormat.parseBoardLink(link)?.second)
        assertEquals("t", DesignFormat.parseBoardLink("calimero://com.calimero.mero-design/board?team=t&board=b")?.first)
        assertNull(DesignFormat.parseBoardLink("https://links.calimero.network/com.calimero.chat/board?team=t&board=b"))
        assertEquals("abab…abab", DesignFormat.shortId("ab".repeat(32)))
        assertEquals("AM", DesignFormat.initials("ana maria"))
    }
}
