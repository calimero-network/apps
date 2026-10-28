package network.calimero.pixart.core

import network.calimero.pixart.generated.Adjustments
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** A colour with components in 0…1. (Swift `RGBA`.) */
data class Rgba(
    val r: Double,
    val g: Double,
    val b: Double,
    val a: Double = 1.0,
) {
    /** As a packed `0xAARRGGBB`. */
    fun argb(): Int {
        fun c(v: Double) = (v.coerceIn(0.0, 1.0) * 255).roundToInt()
        return (c(a) shl 24) or (c(r) shl 16) or (c(g) shl 8) or c(b)
    }

    companion object {
        /** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`, `transparent`, `white`, `black`; null otherwise. */
        @Suppress("ReturnCount")
        fun parse(raw: String): Rgba? {
            val s = raw.trim().lowercase()
            when (s) {
                "transparent" -> return Rgba(0.0, 0.0, 0.0, 0.0)
                "white" -> return Rgba(1.0, 1.0, 1.0)
                "black" -> return Rgba(0.0, 0.0, 0.0)
            }
            if (s.startsWith("#")) {
                var hex = s.drop(1)
                if (hex.length == 3 || hex.length == 4) hex = hex.map { "$it$it" }.joinToString("")
                if (hex.length != 6 && hex.length != 8) return null
                val v = hex.toLongOrNull(16) ?: return null

                fun at(shift: Int) = ((v shr shift) and 0xFF) / 255.0
                return if (hex.length == 6) Rgba(at(16), at(8), at(0)) else Rgba(at(24), at(16), at(8), at(0))
            }
            if (s.startsWith("rgb") && '(' in s && ')' in s) {
                val parts =
                    s
                        .substringAfter('(')
                        .substringBeforeLast(')')
                        .split(',', ' ', '/')
                        .mapNotNull { it.replace("%", "").toDoubleOrNull() }
                if (parts.size < 3) return null
                return Rgba(parts[0] / 255, parts[1] / 255, parts[2] / 255, if (parts.size > 3) parts[3].coerceIn(0.0, 1.0) else 1.0)
            }
            return null
        }
    }
}

/** The 16 blend modes the editor offers (`BlendMode` in the web's types). */
enum class BlendMode(
    val wire: String,
) {
    NORMAL("normal"),
    MULTIPLY("multiply"),
    SCREEN("screen"),
    OVERLAY("overlay"),
    DARKEN("darken"),
    LIGHTEN("lighten"),
    COLOR_DODGE("color-dodge"),
    COLOR_BURN("color-burn"),
    HARD_LIGHT("hard-light"),
    SOFT_LIGHT("soft-light"),
    DIFFERENCE("difference"),
    EXCLUSION("exclusion"),
    HUE("hue"),
    SATURATION("saturation"),
    COLOR("color"),
    LUMINOSITY("luminosity"),
    ;

    /** "Color dodge", for the layer list. */
    val label: String get() = wire.replace('-', ' ').replaceFirstChar { it.uppercase() }

    companion object {
        /** An unknown mode draws as normal, like the web's `blendOp`. */
        fun of(wire: String) = entries.firstOrNull { it.wire == wire } ?: NORMAL
    }
}

/**
 * The non-destructive adjustments, as the web turns them into a canvas `filter` (`adjustmentsToFilter`):
 * brightness and exposure multiply, contrast, saturate, hue-rotate, blur, invert, in that order. Curves
 * are baked into the pixels by the editor, never applied at composite time. (Swift `ColorFilter`.)
 */
data class ColorFilter(
    val brightness: Double?,
    val contrast: Double?,
    val saturate: Double?,
    val hue: Double?,
    val blur: Double,
    val invert: Boolean,
) {
    val isNeutral: Boolean get() = brightness == null && contrast == null && saturate == null && hue == null && blur <= 0 && !invert

    /** Whether anything but the blur is set. */
    val changesColor: Boolean get() = brightness != null || contrast != null || saturate != null || hue != null || invert

    /** One straight-alpha colour through the colour steps (each clamped, as the CSS filter functions are). */
    fun apply(
        r0: Double,
        g0: Double,
        b0: Double,
    ): Triple<Double, Double, Double> {
        var r = r0
        var g = g0
        var b = b0
        brightness?.let { k ->
            r = cl(r * k)
            g = cl(g * k)
            b = cl(b * k)
        }
        contrast?.let { k ->
            val o = 0.5 - 0.5 * k
            r = cl(r * k + o)
            g = cl(g * k + o)
            b = cl(b * k + o)
        }
        saturate?.let { s ->
            val m =
                doubleArrayOf(
                    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
                    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
                    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
                )
            val (x, y, z) = mul(m, r, g, b)
            r = x
            g = y
            b = z
        }
        hue?.let { deg ->
            val cs = cos(deg * Math.PI / 180)
            val sn = sin(deg * Math.PI / 180)
            val m =
                doubleArrayOf(
                    0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
                    0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283,
                    0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072,
                )
            val (x, y, z) = mul(m, r, g, b)
            r = x
            g = y
            b = z
        }
        if (invert) {
            r = 1 - r
            g = 1 - g
            b = 1 - b
        }
        return Triple(r, g, b)
    }

    companion object {
        private fun cl(v: Double) = v.coerceIn(0.0, 1.0)

        private fun mul(
            m: DoubleArray,
            r: Double,
            g: Double,
            b: Double,
        ) = Triple(
            cl(m[0] * r + m[1] * g + m[2] * b),
            cl(m[3] * r + m[4] * g + m[5] * b),
            cl(m[6] * r + m[7] * g + m[8] * b),
        )

        /** Null when the adjustments change nothing. */
        fun from(adj: Adjustments): ColorFilter? {
            fun clamp(v: Double) = v.coerceIn(0.0, 4.0)
            val b = 1 + adj.brightness / 100.0 + adj.exposure / 100.0
            val c = 1 + adj.contrast / 100.0
            val s = 1 + adj.saturation / 100.0
            val f =
                ColorFilter(
                    brightness = if (abs(b - 1) > 0.001) clamp(b) else null,
                    contrast = if (abs(c - 1) > 0.001) clamp(c) else null,
                    saturate = if (abs(s - 1) > 0.001) clamp(s) else null,
                    hue = if (adj.hue != 0) adj.hue.toDouble() else null,
                    blur = adj.blur.toDouble(),
                    invert = adj.invert,
                )
            return if (f.isNeutral) null else f
        }
    }
}

/** Straight-alpha pixels as packed `0xAARRGGBB`, row by row (what `Bitmap.getPixels` gives). */
class ArgbImage(
    val width: Int,
    val height: Int,
    val pixels: IntArray = IntArray(width * height),
) {
    operator fun get(
        x: Int,
        y: Int,
    ): Int = pixels[y * width + x]
}

/** The per-pixel steps of preparing a layer: mask, colour, blur. (Swift `PixelOps`.) */
object PixelOps {
    /** Alpha times the mask's luminance (`maskToAlpha` + `destination-in`); outside the mask, hidden. */
    fun mask(
        img: ArgbImage,
        mask: ArgbImage,
    ) {
        for (y in 0 until img.height) {
            for (x in 0 until img.width) {
                val i = y * img.width + x
                var lum = 0.0
                if (x < mask.width && y < mask.height) {
                    val m = mask.pixels[y * mask.width + x]
                    lum = 0.299 * ((m shr 16) and 0xFF) + 0.587 * ((m shr 8) and 0xFF) + 0.114 * (m and 0xFF)
                }
                val p = img.pixels[i]
                val a = (((p ushr 24) and 0xFF) * lum / 255).roundToInt().coerceIn(0, 255)
                img.pixels[i] = (a shl 24) or (p and 0xFFFFFF)
            }
        }
    }

    /** The filter's colour steps on every visible pixel. */
    fun color(
        img: ArgbImage,
        f: ColorFilter,
    ) {
        if (!f.changesColor) return
        val cache = HashMap<Int, Int>()
        for (i in img.pixels.indices) {
            val p = img.pixels[i]
            if ((p ushr 24) == 0) continue
            val key = p and 0xFFFFFF
            val rgb =
                cache.getOrPut(key) {
                    val (r, g, b) = f.apply(((p shr 16) and 0xFF) / 255.0, ((p shr 8) and 0xFF) / 255.0, (p and 0xFF) / 255.0)
                    ((r * 255).roundToInt() shl 16) or ((g * 255).roundToInt() shl 8) or (b * 255).roundToInt()
                }
            img.pixels[i] = (p and 0xFF000000.toInt()) or rgb
        }
    }

    /** How far a blur of [radius] spills past the layer box (three sigma, as the web pads). */
    fun blurPad(radius: Double): Int = if (radius > 0) ceil(radius * 3).toInt() else 0

    /**
     * A gaussian blur (sigma = [radius], the CSS `blur()`), approximated by three box passes over
     * premultiplied pixels. The result is padded by [blurPad] on every side.
     */
    fun blur(
        img: ArgbImage,
        radius: Double,
    ): ArgbImage {
        val pad = blurPad(radius)
        if (pad <= 0) return img
        val w = img.width + pad * 2
        val h = img.height + pad * 2
        val ch = Array(4) { DoubleArray(w * h) }
        for (y in 0 until img.height) {
            for (x in 0 until img.width) {
                val p = img.pixels[y * img.width + x]
                val a = ((p ushr 24) and 0xFF) / 255.0
                val o = (y + pad) * w + x + pad
                ch[0][o] = ((p shr 16) and 0xFF) * a
                ch[1][o] = ((p shr 8) and 0xFF) * a
                ch[2][o] = (p and 0xFF) * a
                ch[3][o] = a * 255
            }
        }
        for (size in boxSizes(radius)) {
            val r = (size - 1) / 2
            for (c in 0 until 4) {
                ch[c] = boxPass(ch[c], w, h, r, horizontal = true)
                ch[c] = boxPass(ch[c], w, h, r, horizontal = false)
            }
        }
        val out = ArgbImage(w, h)
        for (o in 0 until w * h) {
            val a = ch[3][o]
            if (a <= 0.5) continue
            val k = 255 / a

            fun c(v: Double) = (v * k).roundToInt().coerceIn(0, 255)
            out.pixels[o] = (a.roundToInt().coerceIn(0, 255) shl 24) or (c(ch[0][o]) shl 16) or (c(ch[1][o]) shl 8) or c(ch[2][o])
        }
        return out
    }

    /** Box widths whose three passes approximate a gaussian of [sigma]. */
    fun boxSizes(sigma: Double): List<Int> {
        val ideal = sqrt(12 * sigma * sigma / 3 + 1)
        var wl = floor(ideal).toInt()
        if (wl % 2 == 0) wl -= 1
        val wu = wl + 2
        val mIdeal = (12 * sigma * sigma - 3.0 * wl * wl - 12.0 * wl - 9) / (-4.0 * wl - 4)
        val m = mIdeal.roundToInt()
        return (0 until 3).map { if (it < m) max(1, wl) else max(1, wu) }
    }

    private fun boxPass(
        src: DoubleArray,
        w: Int,
        h: Int,
        r: Int,
        horizontal: Boolean,
    ): DoubleArray {
        if (r <= 0) return src
        val dst = DoubleArray(src.size)
        val lines = if (horizontal) h else w
        val len = if (horizontal) w else h
        val norm = 1.0 / (2 * r + 1)
        for (line in 0 until lines) {
            fun at(k: Int) = if (horizontal) line * w + k else k * w + line
            var acc = 0.0
            for (k in max(0, -r)..min(len - 1, r)) acc += src[at(k)]
            for (k in 0 until len) {
                dst[at(k)] = acc * norm
                val add = k + r + 1
                val drop = k - r
                if (add < len) acc += src[at(add)]
                if (drop >= 0) acc -= src[at(drop)]
            }
        }
        return dst
    }
}
