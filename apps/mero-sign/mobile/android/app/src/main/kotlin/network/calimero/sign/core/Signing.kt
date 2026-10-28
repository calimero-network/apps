package network.calimero.sign.core

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** A rectangle in points, from the top-left. */
data class Box(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
) {
    val right: Float get() = x + width
    val bottom: Float get() = y + height
}

/**
 * Where a signature goes: a page (0-based) and a rectangle on it in PDF points, measured from the
 * page's TOP-LEFT as the page is shown (rotation applied). (Swift `SignaturePlacement`.)
 */
data class SignaturePlacement(
    val pageIndex: Int,
    val rect: Box,
) {
    /** The same rectangle kept on a page of [pageWidth] × [pageHeight]. */
    fun clamped(
        pageWidth: Float,
        pageHeight: Float,
        minWidth: Float = 40f,
    ): SignaturePlacement {
        val aspect = if (rect.height > 0) rect.width / rect.height else 3f
        var width = min(max(rect.width, minWidth), pageWidth)
        var height = width / aspect
        if (height > pageHeight) {
            height = pageHeight
            width = height * aspect
        }
        val x = min(max(rect.x, 0f), pageWidth - width)
        val y = min(max(rect.y, 0f), pageHeight - height)
        return copy(rect = Box(x, y, width, height))
    }

    companion object {
        /** A third of the page wide, lower right, where a signature line usually is. */
        fun initial(
            pageIndex: Int,
            pageWidth: Float,
            pageHeight: Float,
            imageAspect: Float,
        ): SignaturePlacement {
            val aspect = if (imageAspect > 0) imageAspect else 3f
            val width = min(pageWidth * 0.34f, 220f)
            val height = width / aspect
            val x = pageWidth - width - pageWidth * 0.08f
            val y = pageHeight - height - pageHeight * 0.1f
            return SignaturePlacement(pageIndex, Box(x, y, width, height))
        }

        /**
         * The PDF image matrix `[a b c d e f]` that draws an image into [rect] (shown space) on a
         * page whose crop box is at ([llx], [lly]) sized [w] × [h] with `/Rotate` [rotation], so the
         * image lands upright where it was placed on screen. The image's unit square maps to:
         * `(s, t) → (a·s + c·t + e, b·s + d·t + f)`.
         */
        fun imageMatrix(
            rect: Box,
            llx: Float,
            lly: Float,
            w: Float,
            h: Float,
            rotation: Int,
        ): FloatArray {
            // Shown point (dx, dy), top-left origin → user space: u = A·d + t0.
            val r = ((rotation % 360) + 360) % 360
            val (a, t0) =
                when (r) {
                    90 -> floatArrayOf(0f, 1f, 1f, 0f) to (llx to lly)
                    180 -> floatArrayOf(-1f, 0f, 0f, 1f) to (llx + w to lly)
                    270 -> floatArrayOf(0f, -1f, -1f, 0f) to (llx + w to lly + h)
                    else -> floatArrayOf(1f, 0f, 0f, -1f) to (llx to lly + h)
                }

            // A = [[a0 a1] [a2 a3]] applied to a column vector.
            fun apply(
                x: Float,
                y: Float,
            ) = (a[0] * x + a[1] * y) to (a[2] * x + a[3] * y)
            val (sx, sy) = apply(rect.width, 0f)
            val (tx, ty) = apply(0f, -rect.height)
            val (ox, oy) = apply(rect.x, rect.y + rect.height)
            return floatArrayOf(sx, sy, tx, ty, ox + t0.first, oy + t0.second)
        }
    }
}

/**
 * A drawn signature: strokes of timed points, smoothed into quadratic curves whose width follows
 * the pen's speed, like the web's `signature_pad` (`minWidth: 2`, `maxWidth: 4`, black on white).
 * (Swift `SignatureInk`.)
 */
class SignatureInk {
    data class Point(
        val x: Float,
        val y: Float,
        /** Milliseconds. */
        val time: Long,
    )

    /** One piece of a stroke: a quadratic curve and the width to draw it at. */
    data class Segment(
        val fromX: Float,
        val fromY: Float,
        val controlX: Float,
        val controlY: Float,
        val toX: Float,
        val toY: Float,
        val width: Float,
    ) {
        val isDot: Boolean get() = fromX == toX && fromY == toY && fromX == controlX && fromY == controlY
    }

    private val _strokes = mutableListOf<MutableList<Point>>()
    val strokes: List<List<Point>> get() = _strokes

    val isEmpty: Boolean get() = _strokes.all { it.isEmpty() }

    fun begin(point: Point) {
        _strokes += mutableListOf(point)
    }

    fun add(point: Point) {
        val stroke = _strokes.lastOrNull() ?: return begin(point)
        val last = stroke.lastOrNull()
        if (last != null && hypot(point.x - last.x, point.y - last.y) < MIN_DISTANCE) return
        stroke += point
    }

    fun undo() {
        _strokes.removeLastOrNull()
    }

    fun clear() = _strokes.clear()

    companion object {
        const val MIN_WIDTH = 2f
        const val MAX_WIDTH = 4f
        private const val VELOCITY_WEIGHT = 0.7f
        private const val MIN_DISTANCE = 1.5f

        fun segments(stroke: List<Point>): List<Segment> {
            val first = stroke.firstOrNull() ?: return emptyList()
            if (stroke.size == 1) return listOf(Segment(first.x, first.y, first.x, first.y, first.x, first.y, (MIN_WIDTH + MAX_WIDTH) / 2))
            val widths = widths(stroke)
            val out = mutableListOf<Segment>()
            var sx = first.x
            var sy = first.y
            for (i in 1 until stroke.size) {
                val c = stroke[i]
                val (ex, ey) =
                    if (i == stroke.size - 1) {
                        c.x to c.y
                    } else {
                        val n = stroke[i + 1]
                        (c.x + n.x) / 2 to (c.y + n.y) / 2
                    }
                out += Segment(sx, sy, c.x, c.y, ex, ey, widths[i])
                sx = ex
                sy = ey
            }
            return out
        }

        internal fun widths(stroke: List<Point>): List<Float> {
            val widths = mutableListOf(MAX_WIDTH)
            var velocity = 0f
            var width = (MIN_WIDTH + MAX_WIDTH) / 2
            for (i in 1 until stroke.size) {
                val a = stroke[i - 1]
                val b = stroke[i]
                val ms = max((b.time - a.time).toFloat(), 1f)
                val speed = hypot(b.x - a.x, b.y - a.y) / ms
                velocity = VELOCITY_WEIGHT * speed + (1 - VELOCITY_WEIGHT) * velocity
                val target = max(MAX_WIDTH / (velocity + 1), MIN_WIDTH)
                width = (width + target) / 2
                widths += width
            }
            return widths
        }
    }
}

/** Puts a signature image onto one page of a PDF and returns the new PDF. */
fun interface PdfStamping {
    fun stamp(
        pdf: ByteArray,
        signaturePng: ByteArray,
        placement: SignaturePlacement,
    ): ByteArray
}
