package network.calimero.design.core

import network.calimero.design.generated.Element
import java.net.URLDecoder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

/** A point in canvas pixels. */
data class Point(
    val x: Double,
    val y: Double,
)

/** An axis-aligned rectangle in canvas pixels. */
data class Rect(
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
) {
    val maxX: Double get() = x + width
    val maxY: Double get() = y + height
    val center: Point get() = Point(x + width / 2, y + height / 2)

    fun intersects(o: Rect): Boolean = x < o.maxX && maxX > o.x && y < o.maxY && maxY > o.y
}

/** A colour as the canvas stores it, resolved to sRGB components 0..1. */
data class Rgba(
    val r: Double,
    val g: Double,
    val b: Double,
    val a: Double = 1.0,
) {
    /** Packed ARGB for android.graphics. */
    fun argb(): Int {
        fun c(v: Double) = (v.coerceIn(0.0, 1.0) * 255).roundToLong().toInt()
        return (c(a) shl 24) or (c(r) shl 16) or (c(g) shl 8) or c(b)
    }

    companion object {
        fun hex(v: Long): Rgba = Rgba(((v shr 16) and 0xFF) / 255.0, ((v shr 8) and 0xFF) / 255.0, (v and 0xFF) / 255.0)

        val WHITE = Rgba(1.0, 1.0, 1.0)

        /** What a line, arrow or freehand stroke falls back to with no stroke colour. */
        val DEFAULT_INK = hex(0x111111)

        /** `inkFor` on a light fill. */
        val DARK_INK = hex(0x1E1E1E)

        /** An image whose bytes have not arrived (the web export's placeholder). */
        val PLACEHOLDER_FILL = hex(0xE8E8E8)
        val PLACEHOLDER_STROKE = hex(0xCCCCCC)
    }
}

/**
 * CSS colour strings the web canvas writes: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`,
 * `rgb()`/`rgba()`, `transparent`/`none`, and the basic names. (Swift `CSSColor`.)
 */
object CssColor {
    /** Whether the web would paint this colour at all (`isPainted`). */
    fun isPainted(value: String?): Boolean {
        val v = value?.trim().orEmpty()
        return v.isNotEmpty() && v != "transparent" && v != "none"
    }

    /** The colour, or null for `transparent`, `none` or anything unreadable. */
    fun parse(value: String?): Rgba? {
        val raw = value?.trim()?.lowercase() ?: return null
        if (!isPainted(raw)) return null
        if (raw.startsWith("#")) return hex(raw.drop(1))
        if (raw.startsWith("rgb")) return functional(raw)
        return NAMED[raw]
    }

    private fun hex(s: String): Rgba? {
        if (!s.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return null
        val digits =
            when (s.length) {
                3, 4 -> s.flatMap { listOf(it, it) }.joinToString("")
                6, 8 -> s
                else -> return null
            }

        fun byte(i: Int) = digits.substring(i, i + 2).toInt(16) / 255.0
        return Rgba(byte(0), byte(2), byte(4), if (digits.length == 8) byte(6) else 1.0)
    }

    @Suppress("ReturnCount")
    private fun functional(s: String): Rgba? {
        val open = s.indexOf('(')
        val close = s.lastIndexOf(')')
        if (open < 0 || close <= open) return null
        val parts = s.substring(open + 1, close).split(',', ' ', '/').filter { it.isNotEmpty() }
        if (parts.size < 3) return null

        fun channel(p: String): Double? = if (p.endsWith("%")) p.dropLast(1).toDoubleOrNull()?.div(100) else p.toDoubleOrNull()?.div(255)
        val r = channel(parts[0]) ?: return null
        val g = channel(parts[1]) ?: return null
        val b = channel(parts[2]) ?: return null
        var a = 1.0
        if (parts.size >= 4) {
            val p = parts[3]
            a = if (p.endsWith("%")) (p.dropLast(1).toDoubleOrNull() ?: 100.0) / 100 else (p.toDoubleOrNull() ?: 1.0)
        }
        return Rgba(r.coerceIn(0.0, 1.0), g.coerceIn(0.0, 1.0), b.coerceIn(0.0, 1.0), a.coerceIn(0.0, 1.0))
    }

    /** WCAG relative luminance of a `#rgb` / `#rrggbb` colour (`luminance` in shapes.ts). */
    fun luminance(value: String): Double? {
        val v = value.trim()
        if (!v.startsWith("#") || (v.length != 4 && v.length != 7)) return null
        val c = parse(v) ?: return null

        fun lin(x: Double) = if (x <= 0.03928) x / 12.92 else ((x + 0.055) / 1.055).pow(2.4)
        return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    }

    /** Text colour for words on [fill] when none was chosen (`inkFor`). */
    fun inkOn(fill: String?): Rgba {
        if (fill == null || !isPainted(fill)) return Rgba.DARK_INK
        val l = luminance(fill) ?: return Rgba.DARK_INK
        return if (l < 0.35) Rgba.WHITE else Rgba.DARK_INK
    }

    private val NAMED: Map<String, Rgba> =
        mapOf(
            "black" to 0x000000L, "white" to 0xFFFFFFL, "red" to 0xFF0000L, "green" to 0x008000L,
            "blue" to 0x0000FFL, "yellow" to 0xFFFF00L, "orange" to 0xFFA500L, "purple" to 0x800080L,
            "gray" to 0x808080L, "grey" to 0x808080L, "pink" to 0xFFC0CBL, "brown" to 0xA52A2AL,
            "cyan" to 0x00FFFFL, "magenta" to 0xFF00FFL, "lime" to 0x00FF00L, "navy" to 0x000080L,
            "teal" to 0x008080L, "silver" to 0xC0C0C0L,
        ).mapValues { Rgba.hex(it.value) }
}

/**
 * The extras the web app carries inside an element's `label` (`app/src/utils/elementMeta.ts`):
 * `<visible label>\u001F<key>=<value>&…`, values URL-encoded. (Swift `ElementMeta`.)
 */
data class ElementMeta(
    val strokeStyle: String? = null,
    val box: String? = null,
    val textColor: String? = null,
    val shape: String? = null,
    val hidden: Boolean = false,
) {
    companion object {
        private const val SEPARATOR = '\u001F'
        private val STROKE_STYLES = setOf("dashed", "dotted", "dashdot", "dotted3", "long")
        private val BOXES = setOf("box", "sticky")
        private val SHAPES = setOf("triangle", "diamond", "star", "cloud")

        /** A stored label split into the label people see and its extras (`unpackLabel`). */
        fun unpack(raw: String?): Pair<String?, ElementMeta> {
            if (raw == null) return null to ElementMeta()
            val at = raw.indexOf(SEPARATOR)
            if (at < 0) return raw to ElementMeta()
            val visible = raw.substring(0, at)
            val params = mutableMapOf<String, String>()
            for (pair in raw.substring(at + 1).split('&')) {
                if (pair.isEmpty()) continue
                val key = pair.substringBefore('=')
                val value = if ('=' in pair) pair.substringAfter('=') else ""
                val decoded = runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
                params.putIfAbsent(key, decoded)
            }
            val meta =
                ElementMeta(
                    strokeStyle = params["s"]?.takeIf { it in STROKE_STYLES },
                    box = params["b"]?.takeIf { it in BOXES },
                    textColor = params["c"]?.takeIf { it.isNotEmpty() },
                    shape = params["h"]?.takeIf { it in SHAPES },
                    hidden = params["i"] == "1",
                )
            return visible.ifEmpty { null } to meta
        }
    }
}

val Element.meta: ElementMeta get() = ElementMeta.unpack(label).second

/** `splitPath` in groups.ts: a label's `/`-separated segments, trimmed, empties dropped. */
fun splitLabelPath(label: String?): List<String> = (label ?: "").split('/').map { it.trim() }.filter { it.isNotEmpty() }

/** One absolute drawing command; every SVG path command reduces to these. */
sealed class PathCommand {
    data class Move(
        val p: Point,
    ) : PathCommand()

    data class Line(
        val p: Point,
    ) : PathCommand()

    data class Quad(
        val control: Point,
        val to: Point,
    ) : PathCommand()

    data class Cubic(
        val c1: Point,
        val c2: Point,
        val to: Point,
    ) : PathCommand()

    object Close : PathCommand()
}

/**
 * SVG path data to absolute commands: M L H V C S Q T Z, absolute and relative. An arc (A) is
 * drawn as a straight segment to its end point: the web app never writes one. (Swift `PathData`.)
 */
object PathData {
    @Suppress("CyclomaticComplexMethod", "LongMethod", "NestedBlockDepth", "LoopWithTooManyJumpStatements", "ReturnCount")
    fun parse(d: String): List<PathCommand> {
        val tokens = Tokenizer(d)
        val out = mutableListOf<PathCommand>()
        var current = Point(0.0, 0.0)
        var start = current
        var lastCubic: Point? = null
        var lastQuad: Point? = null
        var command: Char? = null

        while (true) {
            val next = tokens.peek() ?: break
            if (next is Token.Command) {
                command = next.c
                tokens.next()
                if (next.c == 'Z' || next.c == 'z') {
                    out += PathCommand.Close
                    current = start
                    lastCubic = null
                    lastQuad = null
                    continue
                }
            }
            val cmd = command
            if (cmd == null) {
                tokens.next()
                continue
            }
            val relative = cmd.isLowerCase()
            val base = current

            fun pt(
                x: Double,
                y: Double,
            ) = if (relative) Point(base.x + x, base.y + y) else Point(x, y)

            when (cmd.uppercaseChar()) {
                'M' -> {
                    val x = tokens.number() ?: return out
                    val y = tokens.number() ?: return out
                    current = pt(x, y)
                    start = current
                    out += PathCommand.Move(current)
                    command = if (relative) 'l' else 'L'
                    lastCubic = null
                    lastQuad = null
                }
                'L' -> {
                    val x = tokens.number() ?: return out
                    val y = tokens.number() ?: return out
                    current = pt(x, y)
                    out += PathCommand.Line(current)
                    lastCubic = null
                    lastQuad = null
                }
                'H' -> {
                    val x = tokens.number() ?: return out
                    current = Point(if (relative) current.x + x else x, current.y)
                    out += PathCommand.Line(current)
                    lastCubic = null
                    lastQuad = null
                }
                'V' -> {
                    val y = tokens.number() ?: return out
                    current = Point(current.x, if (relative) current.y + y else y)
                    out += PathCommand.Line(current)
                    lastCubic = null
                    lastQuad = null
                }
                'C' -> {
                    val n = tokens.numbers(6) ?: return out
                    val c1 = pt(n[0], n[1])
                    val c2 = pt(n[2], n[3])
                    current = pt(n[4], n[5])
                    out += PathCommand.Cubic(c1, c2, current)
                    lastCubic = c2
                    lastQuad = null
                }
                'S' -> {
                    val n = tokens.numbers(4) ?: return out
                    val c1 = lastCubic?.let { Point(2 * current.x - it.x, 2 * current.y - it.y) } ?: current
                    val c2 = pt(n[0], n[1])
                    current = pt(n[2], n[3])
                    out += PathCommand.Cubic(c1, c2, current)
                    lastCubic = c2
                    lastQuad = null
                }
                'Q' -> {
                    val n = tokens.numbers(4) ?: return out
                    val c = pt(n[0], n[1])
                    current = pt(n[2], n[3])
                    out += PathCommand.Quad(c, current)
                    lastQuad = c
                    lastCubic = null
                }
                'T' -> {
                    val n = tokens.numbers(2) ?: return out
                    val c = lastQuad?.let { Point(2 * current.x - it.x, 2 * current.y - it.y) } ?: current
                    current = pt(n[0], n[1])
                    out += PathCommand.Quad(c, current)
                    lastQuad = c
                    lastCubic = null
                }
                'A' -> {
                    val n = tokens.numbers(7) ?: return out
                    current = pt(n[5], n[6])
                    out += PathCommand.Line(current)
                    lastCubic = null
                    lastQuad = null
                }
                else -> tokens.next()
            }
        }
        return out
    }

    /** Closed polygon through [points] (`closedPath` in shapes.ts). */
    fun polygon(points: List<Point>): List<PathCommand> {
        if (points.isEmpty()) return emptyList()
        return listOf(PathCommand.Move(points.first())) + points.drop(1).map { PathCommand.Line(it) } + PathCommand.Close
    }

    private sealed class Token {
        data class Command(
            val c: Char,
        ) : Token()

        data class Number(
            val v: Double,
        ) : Token()
    }

    private class Tokenizer(
        private val s: String,
    ) {
        private var i = 0
        private var peeked: Token? = null
        private var hasPeeked = false

        fun peek(): Token? {
            if (!hasPeeked) {
                peeked = read()
                hasPeeked = true
            }
            return peeked
        }

        fun next(): Token? {
            val t = peek()
            hasPeeked = false
            return t
        }

        fun number(): Double? {
            val t = peek() as? Token.Number ?: return null
            next()
            return t.v
        }

        fun numbers(n: Int): List<Double>? {
            val out = ArrayList<Double>(n)
            repeat(n) { out += number() ?: return null }
            return out
        }

        @Suppress("LoopWithTooManyJumpStatements", "CyclomaticComplexMethod", "NestedBlockDepth", "ComplexCondition")
        private fun read(): Token? {
            while (true) {
                while (i < s.length && (s[i] == ' ' || s[i] == ',' || s[i] == '\n' || s[i] == '\t' || s[i] == '\r')) i++
                if (i >= s.length) return null
                val c = s[i]
                if (c.isLetter() && c != 'e' && c != 'E') {
                    i++
                    return Token.Command(c)
                }
                val sb = StringBuilder()
                if (c == '-' || c == '+') {
                    sb.append(c)
                    i++
                }
                var seenDot = false
                var seenExp = false
                while (i < s.length) {
                    val ch = s[i]
                    if (ch.isDigit()) {
                        sb.append(ch)
                    } else if (ch == '.' && !seenDot && !seenExp) {
                        seenDot = true
                        sb.append(ch)
                    } else if ((ch == 'e' || ch == 'E') && !seenExp) {
                        seenExp = true
                        sb.append(ch)
                        if (i + 1 < s.length && (s[i + 1] == '-' || s[i + 1] == '+')) {
                            i++
                            sb.append(s[i])
                        }
                    } else {
                        break
                    }
                    i++
                }
                sb.toString().toDoubleOrNull()?.let { return Token.Number(it) }
                if (sb.isEmpty()) i++
            }
        }
    }
}

/** Geometry ported from the web's `utils/shapes.ts`. (Swift `Shapes`.) */
object Shapes {
    /** The outline of a triangle, diamond, star or cloud filling `w`×`h` exactly. */
    fun outline(
        kind: String,
        w: Double,
        h: Double,
    ): List<PathCommand>? {
        val bw = max(1.0, w)
        val bh = max(1.0, h)
        return when (kind) {
            "triangle" -> PathData.polygon(listOf(Point(bw / 2, 0.0), Point(bw, bh), Point(0.0, bh)))
            "diamond" -> PathData.polygon(listOf(Point(bw / 2, 0.0), Point(bw, bh / 2), Point(bw / 2, bh), Point(0.0, bh / 2)))
            "star" -> PathData.polygon(fit(starPoints(), bw, bh))
            "cloud" -> PathData.polygon(fit(cloudPoints(), bw, bh))
            else -> null
        }
    }

    /** The dash pattern for a stroke style, scaled by the stroke width (`dashArray`). */
    fun dash(
        style: String?,
        strokeWidth: Double,
    ): List<Double>? {
        val w = max(1.0, strokeWidth)
        return when (style) {
            "dashed" -> listOf(w * 3, w * 2)
            "dotted" -> listOf(0.0, w * 2)
            "dashdot" -> listOf(w * 4, w * 2, 0.0, w * 2)
            "dotted3" -> listOf(0.0, w * 1.8, 0.0, w * 1.8, 0.0, w * 4.5)
            "long" -> listOf(w * 7, w * 3)
            else -> null
        }
    }

    /** Dot patterns need a round cap or their zero-length dashes vanish (`strokeCap`). */
    fun roundCap(style: String?): Boolean = style == "dotted" || style == "dashdot" || style == "dotted3"

    private fun r1(n: Double) = Math.round(n * 10) / 10.0

    private fun fit(
        points: List<Point>,
        w: Double,
        h: Double,
    ): List<Point> {
        val minX = points.minOf { it.x }
        val maxX = points.maxOf { it.x }
        val minY = points.minOf { it.y }
        val maxY = points.maxOf { it.y }
        val sx = if (maxX - minX == 0.0) 1.0 else maxX - minX
        val sy = if (maxY - minY == 0.0) 1.0 else maxY - minY
        return points.map { Point(r1((it.x - minX) / sx * w), r1((it.y - minY) / sy * h)) }
    }

    private fun starPoints(): List<Point> =
        (0 until 10).map { i ->
            val a = -PI / 2 + i * PI / 5
            val r = if (i % 2 == 0) 1.0 else 0.47
            Point(cos(a) * r, sin(a) * r)
        }

    private fun cloudPoints(): List<Point> {
        val amp = listOf(0.2, 0.26, 0.18, 0.24, 0.28, 0.2, 0.25, 0.22)
        val lobes = amp.size.toDouble()
        val samples = 160
        return (0 until samples).map { i ->
            val t = i.toDouble() / samples * PI * 2
            val phase = t * lobes / 2
            val lobe = floor(t / (PI * 2) * lobes).toInt() % amp.size
            val r = 0.78 + amp[lobe] * sqrt(abs(sin(phase)))
            Point(cos(t) * r * 1.35, sin(t) * r)
        }
    }
}

/** Word wrap from the web's `utils/boxText.ts`. (Swift `TextLayout`.) */
object TextLayout {
    const val BOX_LINE_HEIGHT = 1.25
    const val PLAIN_LINE_HEIGHT = 1.16

    fun padding(box: String?): Double = if (box == "sticky") 16.0 else 10.0

    /** Wrap [text] into lines no wider than [maxWidth]; newlines kept, long words broken (`wrapLines`). */
    @Suppress("LoopWithTooManyJumpStatements")
    fun wrap(
        text: String,
        maxWidth: Double,
        measure: (String) -> Double,
    ): List<String> {
        val width = max(1.0, maxWidth)
        val out = mutableListOf<String>()

        fun breakWord(word: String): List<String> {
            val chunks = mutableListOf<String>()
            var chunk = ""
            for (ch in word) {
                if (chunk.isNotEmpty() && measure(chunk + ch) > width) {
                    chunks += chunk
                    chunk = ""
                }
                chunk += ch
            }
            chunks += chunk
            return chunks
        }

        for (para in text.split("\n")) {
            var line = ""
            for (token in tokens(para)) {
                if (token.all { it.isWhitespace() }) {
                    line += token
                    continue
                }
                if (measure(line + token) <= width) {
                    line += token
                    continue
                }
                if (line.isNotBlank()) out += line.trimEnd()
                line = ""
                if (measure(token) <= width) {
                    line = token
                    continue
                }
                val chunks = breakWord(token)
                out += chunks.dropLast(1)
                line = chunks.last()
            }
            out += line.trimEnd()
        }
        return out
    }

    /** Words and the runs of whitespace between them, in order (`split(/(\s+)/)`). */
    internal fun tokens(s: String): List<String> {
        val out = mutableListOf<String>()
        val current = StringBuilder()
        var inSpace: Boolean? = null
        for (ch in s) {
            val space = ch.isWhitespace()
            if (inSpace != null && inSpace != space) {
                out += current.toString()
                current.clear()
            }
            inSpace = space
            current.append(ch)
        }
        if (current.isNotEmpty()) out += current.toString()
        return out
    }
}

/** A screen: one slide of Present (`app/src/utils/screens.ts`). (Swift `Screen`.) */
data class Screen(
    val id: String,
    val name: String,
    val order: Int?,
    val frame: Rect,
)

object Screens {
    private val ORDER_SUFFIX = Regex("""\s*@(\d+)$""")

    /** The name to show and the explicit order of a screen's label segment. */
    fun parseName(segment: String): Pair<String, Int?> {
        val m = ORDER_SUFFIX.find(segment) ?: return segment to null
        val name = segment.substring(0, m.range.first).trim()
        return if (name.isEmpty()) segment to null else name to m.groupValues[1].toIntOrNull()
    }

    /** Every visible screen in presentation order: numbered first, then reading order (`listScreens`). */
    fun list(elements: List<Element>): List<Screen> {
        val found =
            elements.mapNotNull { el ->
                val (label, meta) = ElementMeta.unpack(el.label)
                if (meta.hidden || el.data !is network.calimero.design.generated.ElementData.Rect) return@mapNotNull null
                val segments = splitLabelPath(label)
                if (segments.size != 2 || segments[0].lowercase() != "screen") return@mapNotNull null
                val (name, order) = parseName(segments[1])
                Screen(
                    el.id,
                    name,
                    order,
                    Rect(el.x.toDouble(), el.y.toDouble(), max(1.0, el.width.toDouble()), max(1.0, el.height.toDouble())),
                )
            }
        val reading = readingOrder(found)
        val rank = reading.withIndex().associate { it.value.id to it.index }
        return reading.sortedWith { a, b ->
            val ao = a.order
            val bo = b.order
            when {
                ao != null && bo != null && ao != bo -> ao.compareTo(bo)
                (ao == null) != (bo == null) -> if (ao != null) -1 else 1
                else -> rank.getValue(a.id).compareTo(rank.getValue(b.id))
            }
        }
    }

    internal fun readingOrder(screens: List<Screen>): List<Screen> {
        val byTop = screens.sortedWith(compareBy({ it.frame.y }, { it.frame.x }))
        val rows = mutableListOf<MutableList<Screen>>()
        for (s in byTop) {
            val first = rows.lastOrNull()?.first()
            if (first != null && s.frame.y < first.frame.y + first.frame.height / 2) rows.last() += s else rows += mutableListOf(s)
        }
        return rows.flatMap { row -> row.sortedWith(compareBy({ it.frame.x }, { it.frame.y })) }
    }

    /** How big to draw a screen in a viewport (`fitScreen`, mode `fit`): scale, and whether it scrolls. */
    fun fit(
        width: Double,
        height: Double,
        viewW: Double,
        viewH: Double,
    ): Pair<Double, Boolean> {
        val w = max(1.0, width)
        val h = max(1.0, height)
        val vw = max(1.0, viewW)
        val vh = max(1.0, viewH)
        val widthScale = vw / w
        val whole = min(widthScale, vh / h)
        val readable = min(widthScale, 1.0)
        val scale = if (whole >= readable / 2) whole else readable
        return scale to (h * scale > vh + 0.5)
    }
}
