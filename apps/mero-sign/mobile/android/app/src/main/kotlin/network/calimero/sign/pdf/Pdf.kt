package network.calimero.sign.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import com.tom_roush.pdfbox.util.Matrix
import network.calimero.sign.core.PdfStamping
import network.calimero.sign.core.SignatureInk
import network.calimero.sign.core.SignaturePlacement
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * [PdfStamping] with PdfBox-Android: the signature PNG is drawn into the page's content stream at
 * the placement, upright whatever the page's `/Rotate`, and every other object in the file is
 * kept — what the web does with `pdf-lib`'s `drawImage`. (iOS: `PDFStamper`, Core Graphics.)
 */
class PdfBoxStamper(
    context: Context,
) : PdfStamping {
    init {
        PDFBoxResourceLoader.init(context.applicationContext)
    }

    override fun stamp(
        pdf: ByteArray,
        signaturePng: ByteArray,
        placement: SignaturePlacement,
    ): ByteArray =
        PDDocument.load(pdf).use { document ->
            require(placement.pageIndex in 0 until document.numberOfPages) { "That page isn't in the document." }
            val page = document.getPage(placement.pageIndex)
            val bitmap = BitmapFactory.decodeByteArray(signaturePng, 0, signaturePng.size) ?: error("Your signature image couldn't be read.")
            val image = LosslessFactory.createFromImage(document, bitmap)
            val crop = page.cropBox
            val m = SignaturePlacement.imageMatrix(placement.rect, crop.lowerLeftX, crop.lowerLeftY, crop.width, crop.height, page.rotation)
            PDPageContentStream(document, page, PDPageContentStream.AppendMode.APPEND, true, true).use { stream ->
                stream.drawImage(image, Matrix(m[0], m[1], m[2], m[3], m[4], m[5]))
            }
            ByteArrayOutputStream().also { document.save(it) }.toByteArray()
        }
}

/** A PDF's pages through `android.graphics.pdf.PdfRenderer`: sizes in points, and bitmaps. */
class PdfPages private constructor(
    private val file: File,
    private val descriptor: ParcelFileDescriptor,
    private val renderer: PdfRenderer,
) : AutoCloseable {
    /** Each page's size as shown, in points. */
    val sizes: List<Pair<Float, Float>> =
        (0 until renderer.pageCount).map { i -> renderer.openPage(i).use { it.width.toFloat() to it.height.toFloat() } }

    val count: Int get() = sizes.size

    /** Page [index] rendered [widthPx] wide, on white. */
    @Synchronized
    fun render(
        index: Int,
        widthPx: Int,
    ): Bitmap =
        renderer.openPage(index).use { page ->
            val height = (widthPx * page.height.toFloat() / page.width).toInt().coerceAtLeast(1)
            val bitmap = Bitmap.createBitmap(widthPx.coerceAtLeast(1), height, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            bitmap
        }

    override fun close() {
        renderer.close()
        descriptor.close()
        file.delete()
    }

    companion object {
        fun open(
            context: Context,
            pdf: ByteArray,
        ): PdfPages {
            val file = File.createTempFile("sign-", ".pdf", context.cacheDir)
            file.writeBytes(pdf)
            val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            return PdfPages(file, descriptor, PdfRenderer(descriptor))
        }
    }
}

/** The ink drawn with Android graphics: on screen, and as the PNG the library stores. */
object InkRenderer {
    private val paint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }

    /** Draw into a canvas whose units are the pad's (scaled by [scale]). */
    fun draw(
        canvas: Canvas,
        ink: SignatureInk,
        scale: Float = 1f,
    ) {
        for (stroke in ink.strokes) {
            for (s in SignatureInk.segments(stroke)) {
                if (s.isDot) {
                    canvas.drawCircle(s.fromX * scale, s.fromY * scale, s.width * scale / 2, dot)
                    continue
                }
                paint.strokeWidth = s.width * scale
                val path =
                    Path().apply {
                        moveTo(s.fromX * scale, s.fromY * scale)
                        quadTo(s.controlX * scale, s.controlY * scale, s.toX * scale, s.toY * scale)
                    }
                canvas.drawPath(path, paint)
            }
        }
    }

    /**
     * The signature as the web stores it: a PNG of the whole pad, opaque white with black ink, at
     * [scale] pixels per pad unit (the device density, like the web's device-pixel ratio).
     */
    fun png(
        ink: SignatureInk,
        widthDp: Float,
        heightDp: Float,
        scale: Float,
    ): ByteArray? {
        if (ink.isEmpty || widthDp <= 0 || heightDp <= 0) return null
        val bitmap = Bitmap.createBitmap((widthDp * scale).toInt(), (heightDp * scale).toInt(), Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.WHITE)
        draw(Canvas(bitmap), ink, scale)
        return ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }
}
