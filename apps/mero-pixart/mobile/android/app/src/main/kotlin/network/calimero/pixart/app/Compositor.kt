package network.calimero.pixart.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Typeface
import android.os.Build
import androidx.annotation.RequiresApi
import network.calimero.pixart.core.Affine
import network.calimero.pixart.core.ArgbImage
import network.calimero.pixart.core.BlendMode
import network.calimero.pixart.core.DrawOp
import network.calimero.pixart.core.LayerSource
import network.calimero.pixart.core.PixelOps
import network.calimero.pixart.core.Raster
import network.calimero.pixart.core.Rasterizer
import network.calimero.pixart.core.Rgba
import network.calimero.pixart.core.Warp
import network.calimero.pixart.generated.TextProps
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

/** A decoded image or a composite. */
class BitmapRaster(
    val bitmap: Bitmap,
) : Raster {
    override val width: Int get() = bitmap.width
    override val height: Int get() = bitmap.height
}

/**
 * The composite, drawn natively with `android.graphics` from the layers the contract stores and their
 * PNG blobs: the port of the web's `composite()` (`utils/compositor.ts`). Each layer is prepared in its
 * own pixels (mask, adjustments, blur), then placed by its matrix or warp mesh with its opacity and blend
 * mode. All 16 blend modes on Android 10+; before that, the five PorterDuff has (the rest draw normal).
 * (iOS: `Renderer.swift`, Core Graphics.)
 */
@Suppress("TooManyFunctions")
object Compositor : Rasterizer {
    override fun decode(bytes: ByteArray): Raster? {
        val opts = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)?.let(::BitmapRaster)
    }

    override fun png(raster: Raster): ByteArray? {
        val bmp = (raster as? BitmapRaster)?.bitmap ?: return null
        val out = ByteArrayOutputStream()
        return if (bmp.compress(Bitmap.CompressFormat.PNG, 100, out)) out.toByteArray() else null
    }

    override fun composite(
        width: Int,
        height: Int,
        background: String,
        ops: List<DrawOp>,
        images: Map<String, Raster>,
        scale: Double,
    ): Raster? {
        val w = maxOf(1, (width * scale).roundToInt())
        val h = maxOf(1, (height * scale).roundToInt())
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.scale(scale.toFloat(), scale.toFloat())
        Rgba.parse(background)?.takeIf { it.a > 0 }?.let { bg ->
            canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), Paint().apply { color = bg.argb() })
        }
        for (op in ops) {
            val prepared = prepare(op, images) ?: continue
            val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
            paint.alpha = (op.alpha * 255).roundToInt().coerceIn(0, 255)
            applyBlend(paint, op.blend)
            canvas.save()
            canvas.concat(matrix(op.matrix))
            val warp = op.warp
            if (warp != null && prepared.ox == 0 && prepared.oy == 0) {
                drawWarped(canvas, prepared.bitmap, warp, paint)
            } else {
                canvas.drawBitmap(prepared.bitmap, prepared.ox.toFloat(), prepared.oy.toFloat(), paint)
            }
            canvas.restore()
        }
        return BitmapRaster(out)
    }

    /** [bmp] bent onto the warp's quad, one clipped triangle at a time (the web's `drawWarped`). */
    private fun drawWarped(
        canvas: Canvas,
        bmp: Bitmap,
        warp: Warp,
        paint: Paint,
    ) {
        for (tri in warp.mesh(bmp.width.toDouble(), bmp.height.toDouble())) {
            canvas.save()
            val path =
                Path().apply {
                    moveTo(tri.clip[0].x.toFloat(), tri.clip[0].y.toFloat())
                    lineTo(tri.clip[1].x.toFloat(), tri.clip[1].y.toFloat())
                    lineTo(tri.clip[2].x.toFloat(), tri.clip[2].y.toFloat())
                    close()
                }
            canvas.clipPath(path)
            canvas.concat(matrix(tri.transform))
            canvas.drawBitmap(bmp, 0f, 0f, paint)
            canvas.restore()
        }
    }

    /** A layer's own pixels, ready to place: where its top-left sits in the layer's space (negative when a blur spills). */
    private class Prepared(
        val bitmap: Bitmap,
        val ox: Int,
        val oy: Int,
    )

    private fun prepare(
        op: DrawOp,
        images: Map<String, Raster>,
    ): Prepared? {
        val w = op.width
        val h = op.height
        val base: Bitmap =
            when (val src = op.source) {
                is LayerSource.Raster -> layerCanvas((images[src.blobId] as? BitmapRaster)?.bitmap ?: return null, w, h)
                is LayerSource.Fill -> Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply { eraseColor(src.color.argb()) }
                is LayerSource.Text -> text(src.props, w, h)
            }
        val mask = op.maskBlobId?.let { (images[it] as? BitmapRaster)?.bitmap }
        val filter = op.filter
        if (mask == null && filter == null) return Prepared(base, 0, 0)
        var px = pixels(base, w, h)
        if (mask != null) PixelOps.mask(px, pixels(mask, w, h))
        var pad = 0
        if (filter != null) {
            PixelOps.color(px, filter)
            if (filter.blur > 0) {
                px = PixelOps.blur(px, filter.blur)
                pad = PixelOps.blurPad(filter.blur)
            }
        }
        val out = Bitmap.createBitmap(px.pixels, px.width, px.height, Bitmap.Config.ARGB_8888)
        return Prepared(out, -pad, -pad)
    }

    /** The image at the top-left of a `w`×`h` box, clipped to it (the web's layer canvas). */
    private fun layerCanvas(
        img: Bitmap,
        w: Int,
        h: Int,
    ): Bitmap {
        if (img.width == w && img.height == h) return img
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(out).drawBitmap(img, 0f, 0f, null)
        return out
    }

    /** Straight-alpha pixels of [img] at the top-left of a `w`×`h` box. */
    private fun pixels(
        img: Bitmap,
        w: Int,
        h: Int,
    ): ArgbImage {
        val boxed = layerCanvas(img, w, h)
        val out = ArgbImage(w, h)
        boxed.getPixels(out.pixels, 0, w, 0, 0, w, h)
        return out
    }

    /** The web's `renderTextLayer`: one line per `\n`, 1.2× line height, the top of each line at its row, aligned in the box. */
    private fun text(
        t: TextProps,
        w: Int,
        h: Int,
    ): Bitmap {
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val size = maxOf(1u, t.fontSize).toFloat()
        val paint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                textSize = size
                color = (Rgba.parse(t.color) ?: Rgba(0.0, 0.0, 0.0)).argb()
                typeface = typeface(t.fontFamily, t.bold, t.italic)
                textAlign =
                    when (t.align) {
                        "center" -> Paint.Align.CENTER
                        "right" -> Paint.Align.RIGHT
                        else -> Paint.Align.LEFT
                    }
            }
        val x =
            when (t.align) {
                "center" -> w / 2f
                "right" -> w.toFloat()
                else -> 0f
            }
        val ascent = -paint.fontMetrics.ascent
        t.content.split("\n").forEachIndexed { i, line ->
            canvas.drawText(line, x, i * size * 1.2f + ascent, paint)
        }
        return out
    }

    private fun typeface(
        family: String,
        bold: Boolean,
        italic: Boolean,
    ): Typeface {
        val f = family.lowercase()
        val base =
            when {
                "mono" in f || "courier" in f -> Typeface.MONOSPACE
                ("serif" in f && "sans" !in f) || "georgia" in f || "times" in f -> Typeface.SERIF
                else -> Typeface.SANS_SERIF
            }
        val style =
            when {
                bold && italic -> Typeface.BOLD_ITALIC
                bold -> Typeface.BOLD
                italic -> Typeface.ITALIC
                else -> Typeface.NORMAL
            }
        return Typeface.create(base, style)
    }

    private fun matrix(m: Affine) =
        Matrix().apply {
            setValues(floatArrayOf(m.a.toFloat(), m.c.toFloat(), m.e.toFloat(), m.b.toFloat(), m.d.toFloat(), m.f.toFloat(), 0f, 0f, 1f))
        }

    private fun applyBlend(
        paint: Paint,
        blend: BlendMode,
    ) {
        if (blend == BlendMode.NORMAL) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Blend29.apply(paint, blend)
        } else {
            val mode =
                when (blend) {
                    BlendMode.MULTIPLY -> PorterDuff.Mode.MULTIPLY
                    BlendMode.SCREEN -> PorterDuff.Mode.SCREEN
                    BlendMode.OVERLAY -> PorterDuff.Mode.OVERLAY
                    BlendMode.DARKEN -> PorterDuff.Mode.DARKEN
                    BlendMode.LIGHTEN -> PorterDuff.Mode.LIGHTEN
                    else -> null
                }
            mode?.let { paint.xfermode = PorterDuffXfermode(it) }
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private object Blend29 {
        fun apply(
            paint: Paint,
            blend: BlendMode,
        ) {
            paint.blendMode =
                when (blend) {
                    BlendMode.NORMAL -> android.graphics.BlendMode.SRC_OVER
                    BlendMode.MULTIPLY -> android.graphics.BlendMode.MULTIPLY
                    BlendMode.SCREEN -> android.graphics.BlendMode.SCREEN
                    BlendMode.OVERLAY -> android.graphics.BlendMode.OVERLAY
                    BlendMode.DARKEN -> android.graphics.BlendMode.DARKEN
                    BlendMode.LIGHTEN -> android.graphics.BlendMode.LIGHTEN
                    BlendMode.COLOR_DODGE -> android.graphics.BlendMode.COLOR_DODGE
                    BlendMode.COLOR_BURN -> android.graphics.BlendMode.COLOR_BURN
                    BlendMode.HARD_LIGHT -> android.graphics.BlendMode.HARD_LIGHT
                    BlendMode.SOFT_LIGHT -> android.graphics.BlendMode.SOFT_LIGHT
                    BlendMode.DIFFERENCE -> android.graphics.BlendMode.DIFFERENCE
                    BlendMode.EXCLUSION -> android.graphics.BlendMode.EXCLUSION
                    BlendMode.HUE -> android.graphics.BlendMode.HUE
                    BlendMode.SATURATION -> android.graphics.BlendMode.SATURATION
                    BlendMode.COLOR -> android.graphics.BlendMode.COLOR
                    BlendMode.LUMINOSITY -> android.graphics.BlendMode.LUMINOSITY
                }
        }
    }
}
