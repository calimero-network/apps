package network.calimero.pixart

import network.calimero.pixart.core.ArgbImage
import network.calimero.pixart.core.BlendMode
import network.calimero.pixart.core.ColorFilter
import network.calimero.pixart.core.LayerGeometry
import network.calimero.pixart.core.LayerSource
import network.calimero.pixart.core.LayerStack
import network.calimero.pixart.core.LayerTree
import network.calimero.pixart.core.PixartFormat
import network.calimero.pixart.core.PixelOps
import network.calimero.pixart.core.Point
import network.calimero.pixart.core.Rgba
import network.calimero.pixart.core.Warp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as the iOS `GeometryTests`, `PixelsTests` and `StackTests`. */
class CoreTest {
    private fun near(
        a: Point,
        b: Point,
    ) {
        assertEquals(b.x, a.x, 1e-6)
        assertEquals(b.y, a.y, 1e-6)
    }

    @Test
    fun `a plain layer sits at its position`() {
        val m = LayerGeometry.matrix(Fixtures.layer(Fixtures.layerJson("a", x = 10, y = 20, w = 100, h = 50)))
        near(m.apply(Point(0.0, 0.0)), Point(10.0, 20.0))
        near(m.apply(Point(100.0, 50.0)), Point(110.0, 70.0))
    }

    @Test
    fun `rotation turns about the box centre`() {
        val m = LayerGeometry.matrix(Fixtures.layer(Fixtures.layerJson("a", w = 100, h = 50, rotation = 90)))
        near(m.apply(Point(50.0, 25.0)), Point(50.0, 25.0))
        near(m.apply(Point(0.0, 0.0)), Point(75.0, -25.0))
        near(m.inverted!!.apply(m.apply(Point(3.0, 9.0))), Point(3.0, 9.0))
    }

    @Test
    fun `warp parses and drops neutral`() {
        assertNull(Warp.parse(""))
        assertNull(Warp.parse("nope"))
        assertNull(Warp.parse("""{"tl":[0,0],"tr":[0,0],"br":[0,0],"bl":[0,0]}"""))
        val w = Warp.parse("""{"tl":[5,-2],"tr":[0,0],"br":[0,0]}""")!!
        assertEquals(Point(5.0, -2.0), w.tl)
        val mesh = w.mesh(100.0, 100.0)
        assertEquals(Warp.STEPS * Warp.STEPS * 2, mesh.size)
        near(mesh[0].transform.apply(Point(0.0, 0.0)), Point(5.0, -2.0))
    }

    @Test
    fun `colours and blend modes parse`() {
        assertEquals(Rgba(1.0, 0.0, 0.0), Rgba.parse("#ff0000"))
        assertEquals(Rgba(1.0, 0.0, 0.0), Rgba.parse("#f00"))
        assertEquals(Rgba(0.0, 0.0, 0.0, 0.0), Rgba.parse("#00000000"))
        assertEquals(Rgba(1.0, 1.0, 1.0, 0.5), Rgba.parse("rgba(255, 255, 255, 0.5)"))
        assertNull(Rgba.parse("chartreuse-ish"))
        assertEquals(BlendMode.COLOR_DODGE, BlendMode.of("color-dodge"))
        assertEquals(BlendMode.NORMAL, BlendMode.of("bogus"))
        assertEquals("Soft light", BlendMode.SOFT_LIGHT.label)
        assertEquals(16, BlendMode.entries.size)
    }

    @Test
    fun `adjustments become a filter`() {
        assertNull(ColorFilter.from(Fixtures.layer(Fixtures.layerJson("a")).adjustments))
        val f = ColorFilter.from(Fixtures.layer(Fixtures.layerJson("a", brightness = 50, invert = true)).adjustments)!!
        assertEquals(1.5, f.brightness!!, 1e-9)
        val (r, g, b) = f.apply(0.2, 0.4, 1.0)
        assertEquals(0.7, r, 1e-9)
        assertEquals(0.4, g, 1e-9)
        assertEquals(0.0, b, 1e-9)
    }

    @Test
    fun `mask takes alpha from luminance`() {
        val img = ArgbImage(2, 1, intArrayOf(0xFFFF0000.toInt(), 0xFF00FF00.toInt()))
        PixelOps.mask(img, ArgbImage(2, 1, intArrayOf(0xFFFFFFFF.toInt(), 0xFF000000.toInt())))
        assertEquals(255, img[0, 0] ushr 24)
        assertEquals(0, img[1, 0] ushr 24)
    }

    @Test
    fun `blur pads and keeps coverage`() {
        val px = IntArray(25)
        px[12] = 0xFFFF0000.toInt()
        val out = PixelOps.blur(ArgbImage(5, 5, px), 1.0)
        assertEquals(5 + 2 * PixelOps.blurPad(1.0), out.width)
        val total = out.pixels.sumOf { it ushr 24 }
        assertEquals(255.0, total.toDouble(), 40.0)
        assertEquals(255, (out[5, 5] shr 16) and 0xFF)
    }

    private val stack =
        Fixtures.layers(
            Fixtures.layerJson("folder", kind = "group", index = 2, opacity = 50),
            Fixtures.layerJson("inside", parent = "folder", index = 3, opacity = 50, blob = "b1"),
            Fixtures.layerJson("bg", kind = "fill", index = 0, fill = "#ff0000"),
            Fixtures.layerJson("blank", index = 1),
            Fixtures.layerJson("title", kind = "text", index = 4, text = "Hi"),
        )

    @Test
    fun `draws bottom to top skipping folders and blank rasters`() {
        val ops = LayerStack.drawOps(stack)
        assertEquals(listOf("bg", "inside", "title"), ops.map { it.layerId })
        assertEquals(LayerSource.Fill(Rgba(1.0, 0.0, 0.0)), ops[0].source)
        assertEquals(LayerSource.Raster("b1"), ops[1].source)
        assertEquals(0.25, ops[1].alpha, 1e-9)
        assertEquals(listOf("b1"), LayerStack.blobIds(ops))
    }

    @Test
    fun `hiding a folder hides its contents on this phone only`() {
        assertEquals(listOf("bg", "title"), LayerStack.drawOps(stack, mapOf("folder" to false)).map { it.layerId })
        val rows = LayerTree.rows(stack, mapOf("folder" to false))
        assertEquals(listOf("title", "folder", "inside", "blank", "bg"), rows.map { it.id })
        assertTrue(rows[1].overridden)
        assertEquals(1, rows[2].depth)
        assertTrue(rows[2].hiddenByFolder)
    }

    @Test
    fun `showing a layer the document hides`() {
        val hidden = Fixtures.layers(Fixtures.layerJson("a", kind = "fill", visible = false))
        assertTrue(LayerStack.drawOps(hidden).isEmpty())
        assertEquals(1, LayerStack.drawOps(hidden, mapOf("a" to true)).size)
    }

    @Test
    fun `a cycle falls back to the top level`() {
        val loop = Fixtures.layers(Fixtures.layerJson("a", kind = "group", parent = "b"), Fixtures.layerJson("b", kind = "group", parent = "a"))
        assertEquals(2, LayerTree.rows(loop).size)
    }

    @Test
    fun `project links round trip`() {
        val link = PixartFormat.projectLink("t1", "c1")
        assertEquals("c1", PixartFormat.parseProjectLink(link)?.second)
        assertEquals("t1", PixartFormat.parseProjectLink("calimero://com.calimero.mero-pixart/project?team=t1&project=c1")?.first)
        assertNull(PixartFormat.parseProjectLink("https://links.calimero.network/com.calimero.mero-design/project?team=t&project=c"))
        assertEquals("Spring - Poster.png", PixartFormat.fileName("Spring / Poster"))
    }
}
