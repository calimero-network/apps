package network.calimero.design.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import network.calimero.design.core.MeasureFactory
import network.calimero.design.core.PathCommand
import network.calimero.design.core.PathData
import network.calimero.design.core.Rgba
import network.calimero.design.core.SceneNode
import network.calimero.design.core.Stroke
import network.calimero.design.core.TextStyle
import kotlin.math.roundToInt

/** Decoded board images by blob id, so a redraw never decodes twice. */
class ImageCache {
    private val images = mutableMapOf<String, Bitmap>()

    fun image(
        blobId: String,
        data: Map<String, ByteArray>,
    ): Bitmap? {
        images[blobId]?.let { return it }
        val bytes = data[blobId] ?: return null
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        images[blobId] = bmp
        return bmp
    }
}

/** Text metrics for the scene builder: the same paints the renderer draws with. */
object Fonts {
    fun typeface(style: TextStyle): Typeface {
        val family =
            when (style.design) {
                TextStyle.Design.SERIF -> Typeface.SERIF
                TextStyle.Design.MONO -> Typeface.MONOSPACE
                TextStyle.Design.SANS -> Typeface.SANS_SERIF
            }
        val weight =
            when {
                style.bold && style.italic -> Typeface.BOLD_ITALIC
                style.bold -> Typeface.BOLD
                style.italic -> Typeface.ITALIC
                else -> Typeface.NORMAL
            }
        return Typeface.create(family, weight)
    }

    fun paint(style: TextStyle): Paint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = typeface(style)
            textSize = style.size.toFloat()
        }

    val measure: MeasureFactory = { style ->
        val p = paint(style)
        val m: (String) -> Double = { text -> p.measureText(text).toDouble() }
        m
    }
}

/**
 * Draws scene nodes read-only onto an android.graphics canvas, in canvas pixels. The caller sets
 * the canvas transform (pan, zoom, or a slide's fit). iOS's `SceneRenderer.swift` draws the same
 * nodes the same way.
 */
object SceneRenderer {
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    @Suppress("CyclomaticComplexMethod", "LongMethod", "NestedBlockDepth")
    fun draw(
        canvas: Canvas,
        nodes: List<SceneNode>,
        images: Map<String, ByteArray>,
        cache: ImageCache,
    ) {
        for (node in nodes) {
            canvas.save()
            canvas.translate(node.x.toFloat(), node.y.toFloat())
            if (node.rotation != 0.0) canvas.rotate(node.rotation.toFloat())
            val layer = node.opacity < 1.0
            if (layer) canvas.saveLayerAlpha(null, (node.opacity * 255).roundToInt())
            val shadow = node.shadow

            fun withShadow(p: Paint): Paint {
                if (shadow != null) {
                    p.setShadowLayer((shadow.blur / 2).toFloat().coerceAtLeast(0.01f), shadow.dx.toFloat(), shadow.dy.toFloat(), shadow.color.argb())
                } else {
                    p.clearShadowLayer()
                }
                return p
            }
            val box = RectF(0f, 0f, node.width.toFloat(), node.height.toFloat())
            when (val s = node.shape) {
                is SceneNode.Shape.Rect -> {
                    val path = Path()
                    if (s.cornerRadius > 0) {
                        path.addRoundRect(box, s.cornerRadius.toFloat(), s.cornerRadius.toFloat(), Path.Direction.CW)
                    } else {
                        path.addRect(box, Path.Direction.CW)
                    }
                    paint(canvas, path, s.fill, s.stroke, ::withShadow)
                }
                is SceneNode.Shape.Ellipse -> {
                    val path = Path().apply { addOval(RectF(0f, 0f, node.width.toFloat(), node.width.toFloat()), Path.Direction.CW) }
                    paint(canvas, path, s.fill, s.stroke, ::withShadow)
                }
                is SceneNode.Shape.Path -> paint(canvas, path(s.commands), s.fill, s.stroke, ::withShadow)
                is SceneNode.Shape.Line -> {
                    val p =
                        Path().apply {
                            moveTo(s.from.x.toFloat(), s.from.y.toFloat())
                            lineTo(s.to.x.toFloat(), s.to.y.toFloat())
                        }
                    canvas.drawPath(p, withShadow(stroke(s.stroke)))
                    s.arrowHead?.let { head ->
                        fillPaint.color = s.stroke.color.argb()
                        canvas.drawPath(path(PathData.polygon(head)), withShadow(fillPaint))
                    }
                }
                is SceneNode.Shape.Text -> {
                    if (s.clip) canvas.clipRect(box)
                    val p = Fonts.paint(s.style)
                    p.color = s.color.argb()
                    p.textAlign =
                        when (s.style.align) {
                            TextStyle.Align.CENTER -> Paint.Align.CENTER
                            TextStyle.Align.RIGHT -> Paint.Align.RIGHT
                            TextStyle.Align.LEFT -> Paint.Align.LEFT
                        }
                    if (shadow != null) withShadow(p)
                    val ascent = -p.fontMetrics.ascent
                    for (line in s.lines) {
                        if (line.text.isNotEmpty()) canvas.drawText(line.text, line.x.toFloat(), (line.y + ascent).toFloat(), p)
                    }
                }
                is SceneNode.Shape.Image -> {
                    val bmp = if (s.svg) null else cache.image(s.blobId, images)
                    if (bmp != null) {
                        canvas.drawBitmap(bmp, null, box, bitmapPaint)
                    } else {
                        fillPaint.clearShadowLayer()
                        fillPaint.color = Rgba.PLACEHOLDER_FILL.argb()
                        canvas.drawRect(box, fillPaint)
                        strokePaint.clearShadowLayer()
                        strokePaint.pathEffect = null
                        strokePaint.strokeWidth = 1f
                        strokePaint.color = Rgba.PLACEHOLDER_STROKE.argb()
                        canvas.drawRect(box, strokePaint)
                    }
                }
            }
            if (layer) canvas.restore()
            canvas.restore()
        }
        fillPaint.clearShadowLayer()
        strokePaint.clearShadowLayer()
    }

    private fun paint(
        canvas: Canvas,
        path: Path,
        fill: Rgba?,
        stroke: Stroke?,
        shadow: (Paint) -> Paint,
    ) {
        if (fill != null) {
            fillPaint.color = fill.argb()
            canvas.drawPath(path, shadow(fillPaint))
        }
        if (stroke != null) canvas.drawPath(path, if (fill == null) shadow(stroke(stroke)) else stroke(stroke).apply { clearShadowLayer() })
    }

    private fun stroke(s: Stroke): Paint =
        strokePaint.apply {
            color = s.color.argb()
            strokeWidth = s.width.toFloat()
            strokeCap = if (s.roundCap) Paint.Cap.ROUND else Paint.Cap.BUTT
            strokeJoin = if (s.roundJoin) Paint.Join.ROUND else Paint.Join.MITER
            val dash = s.dash
            // A zero-length dash draws a round dot; Android needs a hair of length for it.
            pathEffect =
                if (dash.isNullOrEmpty()) {
                    null
                } else {
                    DashPathEffect(dash.map { if (it == 0.0) 0.01f else it.toFloat() }.toFloatArray().let { if (it.size % 2 == 1) it + it else it }, 0f)
                }
        }

    fun path(commands: List<PathCommand>): Path {
        val p = Path()
        for (c in commands) {
            when (c) {
                is PathCommand.Move -> p.moveTo(c.p.x.toFloat(), c.p.y.toFloat())
                is PathCommand.Line -> p.lineTo(c.p.x.toFloat(), c.p.y.toFloat())
                is PathCommand.Quad -> p.quadTo(c.control.x.toFloat(), c.control.y.toFloat(), c.to.x.toFloat(), c.to.y.toFloat())
                is PathCommand.Cubic ->
                    p.cubicTo(c.c1.x.toFloat(), c.c1.y.toFloat(), c.c2.x.toFloat(), c.c2.y.toFloat(), c.to.x.toFloat(), c.to.y.toFloat())
                PathCommand.Close -> p.close()
            }
        }
        return p
    }
}
