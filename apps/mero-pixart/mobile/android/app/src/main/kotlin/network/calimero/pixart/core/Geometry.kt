package network.calimero.pixart.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import network.calimero.pixart.generated.Layer
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.tan

/** A point in document or layer pixels. */
data class Point(
    val x: Double,
    val y: Double,
)

/**
 * A 2D affine matrix in canvas `setTransform` field order: a point maps to `(a·x + c·y + e, b·x + d·y + f)`.
 * (Swift `Affine`; web `utils/transform.ts`.)
 */
data class Affine(
    val a: Double,
    val b: Double,
    val c: Double,
    val d: Double,
    val e: Double,
    val f: Double,
) {
    /** This then [n]: this is applied to the point first. */
    fun then(n: Affine) =
        Affine(
            a * n.a + b * n.c,
            a * n.b + b * n.d,
            c * n.a + d * n.c,
            c * n.b + d * n.d,
            e * n.a + f * n.c + n.e,
            e * n.b + f * n.d + n.f,
        )

    fun apply(p: Point) = Point(a * p.x + c * p.y + e, b * p.x + d * p.y + f)

    val inverted: Affine?
        get() {
            val det = a * d - b * c
            if (det == 0.0 || !det.isFinite()) return null
            return Affine(d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det)
        }

    companion object {
        val IDENTITY = Affine(1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    }
}

/**
 * Where a layer's pixels land in the document: the web's one definition (`layerMatrix`), in the same
 * order: centre, mirror, shear, scale, rotate, then place at the box centre. (Swift `LayerGeometry`.)
 */
object LayerGeometry {
    fun scale(layer: Layer): Pair<Double, Double> =
        (if (layer.scaleX == 0) 100 else layer.scaleX) / 100.0 to (if (layer.scaleY == 0) 100 else layer.scaleY) / 100.0

    fun matrix(layer: Layer): Affine {
        val (sx, sy) = scale(layer)

        fun rad(v: Int) = max(-80.0, min(80.0, v.toDouble())) * Math.PI / 180
        val tx = tan(rad(layer.skewX))
        val ty = tan(rad(layer.skewY))
        val w = layer.width.toDouble()
        val h = layer.height.toDouble()
        val cx = layer.x + w * abs(sx) / 2
        val cy = layer.y + h * abs(sy) / 2
        val r = layer.rotation * Math.PI / 180
        val mx = if (layer.flipH) -1.0 else 1.0
        val my = if (layer.flipV) -1.0 else 1.0
        return Affine(1.0, 0.0, 0.0, 1.0, -w / 2, -h / 2)
            .then(Affine(mx, 0.0, 0.0, my, 0.0, 0.0))
            .then(Affine(1.0, ty, tx, 1.0, 0.0, 0.0))
            .then(Affine(abs(sx), 0.0, 0.0, abs(sy), 0.0, 0.0))
            .then(Affine(cos(r), sin(r), -sin(r), cos(r), 0.0, 0.0))
            .then(Affine(1.0, 0.0, 0.0, 1.0, cx, cy))
    }
}

/** A corner-pin warp: each corner's offset in the layer's own pixels. (Swift `Warp`.) */
data class Warp(
    val tl: Point,
    val tr: Point,
    val br: Point,
    val bl: Point,
) {
    /** The bilinear point at (u, v) in the warped quad over a `width`×`height` box. */
    fun point(
        width: Double,
        height: Double,
        u: Double,
        v: Double,
    ): Point {
        val p0 = Point(tl.x, tl.y)
        val p1 = Point(width + tr.x, tr.y)
        val p2 = Point(width + br.x, height + br.y)
        val p3 = Point(bl.x, height + bl.y)
        val top = Point(p0.x + (p1.x - p0.x) * u, p0.y + (p1.y - p0.y) * u)
        val bottom = Point(p3.x + (p2.x - p3.x) * u, p3.y + (p2.y - p3.y) * u)
        return Point(top.x + (bottom.x - top.x) * v, top.y + (bottom.y - top.y) * v)
    }

    /** The quad as triangles, each with the affine map from its source triangle onto its destination. */
    fun mesh(
        width: Double,
        height: Double,
        steps: Int = STEPS,
    ): List<WarpTriangle> {
        val out = ArrayList<WarpTriangle>(steps * steps * 2)
        val n = steps.toDouble()
        for (i in 0 until steps) {
            for (j in 0 until steps) {
                val u0 = i / n
                val u1 = (i + 1) / n
                val v0 = j / n
                val v1 = (j + 1) / n
                val s =
                    listOf(
                        Point(u0 * width, v0 * height),
                        Point(u1 * width, v0 * height),
                        Point(u1 * width, v1 * height),
                        Point(u0 * width, v1 * height),
                    )
                val d =
                    listOf(
                        point(width, height, u0, v0),
                        point(width, height, u1, v0),
                        point(width, height, u1, v1),
                        point(width, height, u0, v1),
                    )
                for ((a, b, c) in listOf(Triple(0, 1, 2), Triple(0, 2, 3))) {
                    val m = WarpTriangle.map(listOf(s[a], s[b], s[c]), listOf(d[a], d[b], d[c])) ?: continue
                    out += WarpTriangle(WarpTriangle.grow(listOf(d[a], d[b], d[c]), 0.5), m)
                }
            }
        }
        return out
    }

    companion object {
        /** How finely the quad is cut per axis (the web's `WARP_STEPS`). */
        const val STEPS = 12
        private val json = Json { ignoreUnknownKeys = true }

        /** `{"tl":[dx,dy],…}`; null for empty, garbage or all-zero (the web's `parseWarp`). */
        fun parse(raw: String): Warp? {
            if (raw.isEmpty()) return null
            val obj = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return null

            fun corner(key: String): Point {
                val arr = obj[key] as? JsonArray ?: return Point(0.0, 0.0)
                if (arr.size < 2) return Point(0.0, 0.0)

                fun num(i: Int) = ((arr[i] as? JsonPrimitive)?.doubleOrNull ?: 0.0).takeIf { it.isFinite() } ?: 0.0
                return Point(num(0), num(1))
            }
            val w = Warp(corner("tl"), corner("tr"), corner("br"), corner("bl"))
            val zero = Point(0.0, 0.0)
            return if (w.tl == zero && w.tr == zero && w.br == zero && w.bl == zero) null else w
        }
    }
}

/** One cell of a warp mesh: clip to [clip] (grown a hair to hide seams) and draw the source under [transform]. */
data class WarpTriangle(
    val clip: List<Point>,
    val transform: Affine,
) {
    companion object {
        /** The affine map taking triangle [s] onto triangle [d]. */
        fun map(
            s: List<Point>,
            d: List<Point>,
        ): Affine? {
            val (x1, y1) = s[0]
            val (x2, y2) = s[1]
            val (x3, y3) = s[2]
            val det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)
            if (det == 0.0 || !det.isFinite()) return null
            val (u1, v1) = d[0]
            val (u2, v2) = d[1]
            val (u3, v3) = d[2]
            val a = ((u2 - u1) * (y3 - y1) - (u3 - u1) * (y2 - y1)) / det
            val c = ((u3 - u1) * (x2 - x1) - (u2 - u1) * (x3 - x1)) / det
            val b = ((v2 - v1) * (y3 - y1) - (v3 - v1) * (y2 - y1)) / det
            val dd = ((v3 - v1) * (x2 - x1) - (v2 - v1) * (x3 - x1)) / det
            return Affine(a, b, c, dd, u1 - a * x1 - c * y1, v1 - b * x1 - dd * y1)
        }

        fun grow(
            t: List<Point>,
            amount: Double,
        ): List<Point> {
            val cx = (t[0].x + t[1].x + t[2].x) / 3
            val cy = (t[0].y + t[1].y + t[2].y) / 3
            return t.map { p ->
                val dx = p.x - cx
                val dy = p.y - cy
                val len = max(hypot(dx, dy), 1e-9)
                Point(p.x + dx / len * amount, p.y + dy / len * amount)
            }
        }
    }
}
