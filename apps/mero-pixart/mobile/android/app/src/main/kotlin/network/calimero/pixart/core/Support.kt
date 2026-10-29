package network.calimero.pixart.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import network.calimero.pixart.generated.PixartClient
import java.io.IOException
import java.net.URI
import java.net.URLDecoder
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.max
import kotlin.math.min

/** The generated client over this backend's contract, bound to [contextId]. */
fun MeroAppBackend.pixartClient(contextId: String): PixartClient = PixartClient(contract.bound(contextId))

/**
 * Bytes stored as blobs on a project's context. `MeroAppBackend` has no blob call yet, so the app reads
 * them through the signed-in client's admin surface (`getBlob(blobId, contextId)`).
 */
fun interface BlobLoading {
    suspend fun blob(
        id: String,
        contextId: String,
    ): ByteArray
}

/** No blobs: rasters are left out. */
val NoBlobs = BlobLoading { _, _ -> throw IOException("no blob store") }

/** A decoded image or a composite: on the phone an `android.graphics.Bitmap`, in tests a fake. */
interface Raster {
    val width: Int
    val height: Int
}

/**
 * Turns blobs into images and draw ops into one image. The app's is [network.calimero.pixart.app.Compositor]
 * (`android.graphics`); the JVM tests use a fake, since `android.graphics` does not run there.
 */
interface Rasterizer {
    fun decode(bytes: ByteArray): Raster?

    @Suppress("LongParameterList")
    fun composite(
        width: Int,
        height: Int,
        background: String,
        ops: List<DrawOp>,
        images: Map<String, Raster>,
        scale: Double = 1.0,
    ): Raster?

    fun png(raster: Raster): ByteArray?
}

/**
 * Decoded blobs by id, shared by the gallery thumbnails and the artwork, so a layer is downloaded once.
 * A blob id names its bytes, so entries never go stale. (Swift `BlobStore`.)
 */
class BlobStore(
    private val loader: BlobLoading,
    private val rasterizer: Rasterizer,
    private val limit: Int = 96,
) {
    private val mutex = Mutex()
    private val cache = LinkedHashMap<String, Raster>()

    /** Several at once, four in flight; the ones that cannot be read or decoded are left out. */
    suspend fun bitmaps(
        ids: List<String>,
        contextId: String,
    ): Map<String, Raster> {
        val out = HashMap<String, Raster>()
        val pending = ArrayList<String>()
        mutex.withLock {
            for (id in ids) cache[id]?.let { out[id] = it } ?: pending.add(id)
        }
        for (batch in pending.chunked(4)) {
            val got =
                coroutineScope {
                    batch.map { id -> async { id to load(id, contextId) } }.awaitAll()
                }
            mutex.withLock {
                for ((id, raster) in got) {
                    if (raster == null) continue
                    cache[id] = raster
                    out[id] = raster
                }
                while (cache.size > limit) cache.remove(cache.keys.first())
            }
        }
        return out
    }

    private suspend fun load(
        id: String,
        contextId: String,
    ): Raster? =
        try {
            rasterizer.decode(loader.blob(id, contextId))
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            null
        }
}

/** Pan and zoom of the artwork view: a document point `p` is drawn at `p * scale + offset`. (Swift `Viewport`.) */
data class Viewport(
    val scale: Double = 1.0,
    val offsetX: Double = 0.0,
    val offsetY: Double = 0.0,
) {
    /** Zoomed by [factor] about the view point ([ax], [ay]), which stays put. */
    fun zoomed(
        factor: Double,
        ax: Double,
        ay: Double,
    ): Viewport {
        val next = clampScale(scale * factor)
        val k = next / scale
        return Viewport(next, ax - (ax - offsetX) * k, ay - (ay - offsetY) * k)
    }

    fun panned(
        dx: Double,
        dy: Double,
    ) = Viewport(scale, offsetX + dx, offsetY + dy)

    companion object {
        const val MIN_SCALE = 0.02
        const val MAX_SCALE = 16.0

        fun clampScale(s: Double) = min(MAX_SCALE, max(MIN_SCALE, s))

        /** A `w`×`h` document centred in the view with [padding] around it. */
        fun fit(
            w: Double,
            h: Double,
            viewW: Double,
            viewH: Double,
            padding: Double = 20.0,
        ): Viewport {
            if (w <= 0 || h <= 0 || viewW <= 0 || viewH <= 0) return Viewport()
            val scale = clampScale(min(max(1.0, viewW - padding * 2) / w, max(1.0, viewH - padding * 2) / h))
            return Viewport(scale, (viewW - w * scale) / 2, (viewH - h * scale) / 2)
        }
    }
}

/** Copy, links and formatting shared by every screen. (Swift `PixartFormat`.) */
object PixartFormat {
    /** The app's registry package, deep-link slug and invitation path (`APP_SLUG` in the web app). */
    const val PACKAGE_NAME = "com.calimero.mero-pixart"

    /** `ab12…ef90`: an id short enough to show. */
    fun shortId(id: String): String = if (id.length <= 12) id else "${id.take(4)}…${id.takeLast(4)}"

    /** Initials for an avatar: the first letters of the first two words. */
    fun initials(name: String): String {
        val out =
            name
                .split(' ', '_', '-', '.')
                .filter { it.isNotEmpty() }
                .take(2)
                .map { it.first() }
                .joinToString("")
                .uppercase()
        return out.ifEmpty { "?" }
    }

    /** "1920 × 1080". */
    fun size(
        w: UInt,
        h: UInt,
    ) = "$w × $h"

    fun count(
        n: Int,
        one: String,
        many: String,
    ) = if (n == 1) "1 $one" else "$n $many"

    /** The link to a project (`https://links.calimero.network/<package>/project?…`, as `createLink` builds). */
    fun projectLink(
        teamId: String,
        contextId: String,
    ) = "https://links.calimero.network/$PACKAGE_NAME/project?team=$teamId&project=$contextId"

    /** The team and project a project link names, from its https or `calimero://` form; null otherwise. */
    fun parseProjectLink(raw: String): Pair<String, String>? {
        val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
        val path = (uri.rawPath ?: "").split('/').filter { it.isNotEmpty() }
        val segments = if (uri.scheme == "calimero") listOf(uri.host ?: "") + path else path
        if (segments.size < 2 || segments[segments.size - 2] != PACKAGE_NAME || segments.last() != "project") return null
        val query =
            (uri.rawQuery ?: "").split('&').filter { '=' in it }.associate {
                it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), "UTF-8")
            }
        val team = query["team"]?.takeIf { it.isNotEmpty() } ?: return null
        val project = query["project"]?.takeIf { it.isNotEmpty() } ?: return null
        return team to project
    }

    /** A file name for an export: the project's name, made safe. */
    fun fileName(name: String): String {
        val cleaned = name.map { if (it.isLetterOrDigit() || it == ' ' || it == '-' || it == '_') it else '-' }.joinToString("").trim()
        return cleaned.ifEmpty { "artwork" } + ".png"
    }

    /** Words a person can act on, from an error. */
    fun errorText(error: Throwable): String {
        val text = error.message ?: error.toString()
        return when {
            error::class.simpleName == "NoRelayException" || "no relay" in text.lowercase() ->
                "Your account has no relay yet. Join a team from an invitation link, or try again shortly."
            error is java.net.UnknownHostException || error is java.net.ConnectException ->
                "You're offline. Check your connection and try again."
            else -> text
        }
    }
}
