package network.calimero.design.core

import network.calimero.design.generated.Element
import network.calimero.design.generated.ElementData
import network.calimero.design.generated.ElementData_Text
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** An outline: colour, width, dash pattern and cap. */
data class Stroke(
    val color: Rgba,
    val width: Double,
    val dash: List<Double>?,
    val roundCap: Boolean,
    val roundJoin: Boolean,
)

data class Shadow(
    val color: Rgba,
    val dx: Double,
    val dy: Double,
    val blur: Double,
)

/** How the words in a text node are set. */
data class TextStyle(
    val size: Double,
    val bold: Boolean,
    val italic: Boolean,
    val design: Design,
    val align: Align,
) {
    enum class Design { SANS, SERIF, MONO }

    enum class Align { LEFT, CENTER, RIGHT }

    companion object {
        /** The web's font families, mapped to the platform's own three designs. */
        fun design(family: String): Design {
            val f = family.lowercase()
            return when {
                "mono" in f || "courier" in f -> Design.MONO
                f == "serif" || "georgia" in f || "times" in f -> Design.SERIF
                else -> Design.SANS
            }
        }
    }
}

/** One line of text in the node's coordinates: [x] is the anchor per alignment, [y] the line's top. */
data class TextLine(
    val text: String,
    val x: Double,
    val y: Double,
)

/**
 * One drawable thing, in its own coordinates: translate to ([x], [y]), rotate by [rotation]
 * degrees clockwise about that corner, draw within [width]×[height]. (Swift `SceneNode`.)
 */
data class SceneNode(
    val id: String,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val rotation: Double,
    val opacity: Double,
    val shadow: Shadow?,
    val shape: Shape,
) {
    sealed class Shape {
        data class Rect(
            val fill: Rgba?,
            val stroke: Stroke?,
            val cornerRadius: Double,
        ) : Shape()

        /** The web canvas draws a circle of radius `width / 2`. */
        data class Ellipse(
            val fill: Rgba?,
            val stroke: Stroke?,
        ) : Shape()

        data class Path(
            val commands: List<PathCommand>,
            val fill: Rgba?,
            val stroke: Stroke?,
        ) : Shape()

        data class Line(
            val from: Point,
            val to: Point,
            val stroke: Stroke,
            val arrowHead: List<Point>?,
        ) : Shape()

        data class Text(
            val lines: List<TextLine>,
            val style: TextStyle,
            val color: Rgba,
            val clip: Boolean,
        ) : Shape()

        /** Bytes from the blob store; until then (and always for SVG) a placeholder box. */
        data class Image(
            val blobId: String,
            val svg: Boolean,
        ) : Shape()
    }
}

/** A text measurer for one style: the width of a string in pixels. */
typealias Measure = (String) -> Double

/** Measurers per style; the app passes the platform's font metrics. */
typealias MeasureFactory = (TextStyle) -> Measure

/** The average-glyph estimate the web uses where it has no canvas (tests). */
val estimateMeasure: MeasureFactory = { style -> { s -> s.length * style.size * 0.55 } }

/** A board drawn read-only: contract elements to nodes, back to front. (Swift `BoardScene`.) */
data class BoardScene(
    val nodes: List<SceneNode>,
    /** The content box, rotation and stroke included; null for an empty board. */
    val bounds: Rect?,
    val screens: List<Screen>,
) {
    /** The nodes painted at least partly inside [rect] (a screen's slide). */
    fun nodesIn(rect: Rect): List<SceneNode> = nodes.filter { SceneBuilder.box(it).intersects(rect) }

    companion object {
        val EMPTY = BoardScene(emptyList(), null, emptyList())

        /** Hidden layers are left out, as in every web export. */
        fun of(
            elements: List<Element>,
            measure: MeasureFactory = estimateMeasure,
        ): BoardScene {
            val visible = elements.filter { !it.meta.hidden }.sortedBy { it.layerIndex }
            return BoardScene(
                visible.flatMap { SceneBuilder.nodes(it, measure) },
                SceneBuilder.bounds(visible),
                Screens.list(elements),
            )
        }
    }
}

internal object SceneBuilder {
    @Suppress("CyclomaticComplexMethod", "LongMethod", "NestedBlockDepth")
    fun nodes(
        el: Element,
        measure: MeasureFactory,
    ): List<SceneNode> {
        val meta = el.meta
        val w = el.width.toDouble()
        val h = el.height.toDouble()
        val opacity = (el.opacity.toDouble() / 100).coerceIn(0.0, 1.0)
        val blur = el.shadowBlur?.toDouble() ?: 0.0
        val shadow =
            if (blur > 0) {
                Shadow(
                    CssColor.parse(el.shadowColor) ?: Rgba(0.0, 0.0, 0.0, 0.3),
                    (el.shadowOffsetX ?: 0).toDouble(),
                    (el.shadowOffsetY ?: 4).toDouble(),
                    blur,
                )
            } else {
                null
            }

        fun node(
            shape: SceneNode.Shape,
            id: String = el.id,
        ) = SceneNode(id, el.x.toDouble(), el.y.toDouble(), w, h, el.rotation.toDouble(), opacity, shadow, shape)

        val fill = CssColor.parse(el.fill)
        val outline = shapeStroke(el, meta)
        val radius = max(0.0, min((el.cornerRadius ?: 0u).toDouble(), min(w, h) / 2))

        return when (val data = el.data) {
            ElementData.Rect -> listOf(node(SceneNode.Shape.Rect(fill, outline, radius)))
            ElementData.Circle -> listOf(node(SceneNode.Shape.Ellipse(fill, outline)))
            is ElementData.Line -> listOf(node(lineShape(el, meta, data.value.points, arrow = false)))
            is ElementData.Arrow -> listOf(node(lineShape(el, meta, data.value.points, arrow = true)))
            is ElementData.Path -> {
                val kind = meta.shape
                val outlineCommands = kind?.let { Shapes.outline(it, w, h) }
                if (outlineCommands != null) {
                    return listOf(node(SceneNode.Shape.Path(outlineCommands, fill, outline?.copy(roundJoin = true))))
                }
                val commands = PathData.parse(data.value.points)
                if (commands.isEmpty()) return emptyList()
                val width = max(1.0, if (el.strokeWidth == 0u) 2.0 else el.strokeWidth.toDouble())
                val stroke =
                    Stroke(
                        CssColor.parse(el.stroke) ?: Rgba.DEFAULT_INK,
                        width,
                        Shapes.dash(meta.strokeStyle, width),
                        roundCap = true,
                        roundJoin = true,
                    )
                listOf(node(SceneNode.Shape.Path(commands, null, stroke)))
            }
            is ElementData.Text -> {
                val t = data.value
                if (meta.box == "box" || meta.box == "sticky") {
                    val out = mutableListOf(node(SceneNode.Shape.Rect(fill, outline, radius)))
                    if (t.content.isNotEmpty()) {
                        val style = style(t, 16.0)
                        val pad = TextLayout.padding(meta.box)
                        val lineHeight = style.size * TextLayout.BOX_LINE_HEIGHT
                        val lines = TextLayout.wrap(t.content, w - pad * 2, measure(style))
                        val block = lines.size * lineHeight
                        val top =
                            when (t.verticalAlign ?: "top") {
                                "middle" -> (h - block) / 2
                                "bottom" -> h - pad - block
                                else -> pad
                            }
                        val anchorX =
                            when (style.align) {
                                TextStyle.Align.CENTER -> w / 2
                                TextStyle.Align.RIGHT -> w - pad
                                TextStyle.Align.LEFT -> pad
                            }
                        val color = meta.textColor?.let { CssColor.parse(it) } ?: CssColor.inkOn(el.fill)
                        val set =
                            lines.mapIndexed { i, line ->
                                TextLine(line, anchorX, top + i * lineHeight + (lineHeight - style.size) / 2)
                            }
                        out += node(SceneNode.Shape.Text(set, style, color, clip = true), id = el.id + "#text").copy(shadow = null)
                    }
                    return out
                }
                val style = style(t, 24.0)
                val lineHeight = style.size * TextLayout.PLAIN_LINE_HEIGHT
                val lines = t.content.split("\n")
                val m = measure(style)
                val boxWidth = if (style.align == TextStyle.Align.LEFT) w else max(w, lines.maxOfOrNull(m) ?: 0.0)
                val x =
                    when (style.align) {
                        TextStyle.Align.CENTER -> boxWidth / 2
                        TextStyle.Align.RIGHT -> boxWidth
                        TextStyle.Align.LEFT -> 0.0
                    }
                val block = lines.size * lineHeight
                val offset =
                    when (t.verticalAlign ?: "top") {
                        "middle" -> max(0.0, (h - block) / 2)
                        "bottom" -> max(0.0, h - block)
                        else -> 0.0
                    }
                val set = lines.mapIndexed { i, line -> TextLine(line, x, offset + lineHeight * i + (lineHeight - style.size) / 2) }
                listOf(node(SceneNode.Shape.Text(set, style, fill ?: Rgba.DEFAULT_INK, clip = false)))
            }
            is ElementData.Image -> listOf(node(SceneNode.Shape.Image(data.value.blobId, svg = false)))
            is ElementData.Svg -> listOf(node(SceneNode.Shape.Image(data.value.blobId, svg = true)))
        }
    }

    fun style(
        t: ElementData_Text,
        defaultSize: Double,
    ): TextStyle {
        val align =
            when (t.textAlign ?: "left") {
                "center" -> TextStyle.Align.CENTER
                "right" -> TextStyle.Align.RIGHT
                else -> TextStyle.Align.LEFT
            }
        return TextStyle(
            if (t.fontSize > 0u) t.fontSize.toDouble() else defaultSize,
            t.bold,
            t.italic,
            TextStyle.design(t.fontFamily),
            align,
        )
    }

    /** The outline of a filled shape: only when its colour is painted and its width is not 0. */
    fun shapeStroke(
        el: Element,
        meta: ElementMeta,
    ): Stroke? {
        if (!CssColor.isPainted(el.stroke) || el.strokeWidth == 0u) return null
        val color = CssColor.parse(el.stroke) ?: return null
        val width = el.strokeWidth.toDouble()
        return Stroke(color, width, Shapes.dash(meta.strokeStyle, width), Shapes.roundCap(meta.strokeStyle), roundJoin = false)
    }

    /** A line or arrow: its stroke is the shape, so it always has one. */
    fun lineShape(
        el: Element,
        meta: ElementMeta,
        points: String,
        arrow: Boolean,
    ): SceneNode.Shape {
        val (a, b) = endpoints(points, el.width.toDouble(), el.height.toDouble())
        val width = max(1.0, if (el.strokeWidth == 0u) 2.0 else el.strokeWidth.toDouble())
        val stroke =
            Stroke(
                CssColor.parse(el.stroke) ?: Rgba.DEFAULT_INK,
                width,
                Shapes.dash(meta.strokeStyle, width),
                roundCap = true,
                roundJoin = false,
            )
        if (!arrow) return SceneNode.Shape.Line(a, b, stroke, null)
        val size = max(8.0, width * 3.5)
        val angle = atan2(b.y - a.y, b.x - a.x)

        fun tip(
            len: Double,
            spread: Double,
        ) = Point(
            b.x - len * cos(angle) + spread * cos(angle + Math.PI / 2),
            b.y - len * sin(angle) + spread * sin(angle + Math.PI / 2),
        )
        return SceneNode.Shape.Line(a, b, stroke, listOf(b, tip(size, size * 0.42), tip(size, -size * 0.42)))
    }

    /** `"x1,y1 x2,y2"` relative to the element; the box's diagonal when unreadable. */
    fun endpoints(
        raw: String,
        width: Double,
        height: Double,
    ): Pair<Point, Point> {
        val nums = raw.split(',', ' ', '\n', '\t').mapNotNull { it.toDoubleOrNull() }
        if (nums.size >= 4) return Point(nums[0], nums[1]) to Point(nums[2], nums[3])
        return Point(0.0, 0.0) to Point(width, height)
    }

    /** The four corners of a box at ([x], [y]) rotated about that corner. */
    fun corners(
        x: Double,
        y: Double,
        w: Double,
        h: Double,
        rotation: Double,
    ): List<Point> {
        val rad = rotation * Math.PI / 180
        val c = cos(rad)
        val s = sin(rad)
        return listOf(0.0 to 0.0, w to 0.0, w to h, 0.0 to h).map { (dx, dy) -> Point(x + dx * c - dy * s, y + dx * s + dy * c) }
    }

    /** The board's content box (`boundsOf`): rotation and half the stroke included. */
    fun bounds(elements: List<Element>): Rect? {
        if (elements.isEmpty()) return null
        var minX = Double.POSITIVE_INFINITY
        var minY = Double.POSITIVE_INFINITY
        var maxX = Double.NEGATIVE_INFINITY
        var maxY = Double.NEGATIVE_INFINITY
        for (el in elements) {
            val pad = if (CssColor.isPainted(el.stroke)) el.strokeWidth.toDouble() / 2 else 0.0
            for (p in corners(el.x.toDouble(), el.y.toDouble(), el.width.toDouble(), el.height.toDouble(), el.rotation.toDouble())) {
                minX = min(minX, p.x - pad)
                minY = min(minY, p.y - pad)
                maxX = max(maxX, p.x + pad)
                maxY = max(maxY, p.y + pad)
            }
        }
        return Rect(minX, minY, max(1.0, maxX - minX), max(1.0, maxY - minY))
    }

    /** A node's axis-aligned box on the board. */
    fun box(n: SceneNode): Rect {
        val pts = corners(n.x, n.y, n.width, n.height, n.rotation)
        val minX = pts.minOf { it.x }
        val minY = pts.minOf { it.y }
        return Rect(minX, minY, pts.maxOf { it.x } - minX, pts.maxOf { it.y } - minY)
    }
}
