package network.calimero.design.core

import com.calimero.mero.app.BoundContextContract
import com.calimero.mero.app.MeroAppBackend
import network.calimero.design.generated.ContextContractCalling
import network.calimero.design.generated.DesignClient
import java.io.IOException
import java.net.URI
import java.net.URLDecoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/**
 * The generated client declares its own `ContextContractCalling` (JSON strings in and out), with
 * the same two calls as the SDK's [BoundContextContract]; this hands one to the other.
 */
private class BoundTransport(
    private val bound: BoundContextContract,
) : ContextContractCalling {
    override suspend fun query(
        method: String,
        argsJson: String,
    ): String = bound.query(method, argsJson)

    override suspend fun execute(
        method: String,
        argsJson: String,
    ): String = bound.execute(method, argsJson)
}

/** The generated client over this backend's contract, bound to [contextId]. */
fun MeroAppBackend.designClient(contextId: String): DesignClient = DesignClient(BoundTransport(contract.bound(contextId)))

/**
 * Image bytes stored as blobs on the board's context. `MeroAppBackend` has no blob call yet, so the
 * app reads them through the signed-in client's admin surface (`getBlob(blobId, contextId)`).
 */
fun interface BlobLoading {
    suspend fun blob(
        id: String,
        contextId: String,
    ): ByteArray
}

/** No blobs: images are drawn as placeholders. */
val NoBlobs = BlobLoading { _, _ -> throw IOException("no blob store") }

/** Pan and zoom: a canvas point `p` is drawn at `p * scale + offset`. (Swift `Viewport`.) */
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

    /** The canvas point under the view point. */
    fun canvasPoint(
        vx: Double,
        vy: Double,
    ) = Point((vx - offsetX) / scale, (vy - offsetY) / scale)

    /** The view point a canvas point is drawn at. */
    fun viewPoint(p: Point) = Point(p.x * scale + offsetX, p.y * scale + offsetY)

    companion object {
        const val MIN_SCALE = 0.05
        const val MAX_SCALE = 8.0

        fun clampScale(s: Double) = min(MAX_SCALE, max(MIN_SCALE, s))

        /** The whole of [content] centred in the view with [padding], never enlarged past 100%. */
        fun fit(
            content: Rect?,
            viewW: Double,
            viewH: Double,
            padding: Double = 24.0,
        ): Viewport {
            if (content == null || viewW <= 0 || viewH <= 0) return Viewport(1.0, viewW / 2, viewH / 2)
            val availW = max(1.0, viewW - padding * 2)
            val availH = max(1.0, viewH - padding * 2)
            val scale = clampScale(min(1.0, min(availW / content.width, availH / content.height)))
            return Viewport(scale, viewW / 2 - content.center.x * scale, viewH / 2 - content.center.y * scale)
        }
    }
}

/** Copy, links and formatting shared by every screen. (Swift `DesignFormat`.) */
object DesignFormat {
    /** The app's registry package and deep-link slug (`APP_SLUG` in the web app). */
    const val PACKAGE_NAME = "com.calimero.mero-design"

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

    /** "now", "5m", "3h", "2d", or a date, from unix milliseconds. */
    fun relativeTime(
        ms: ULong,
        now: Long = System.currentTimeMillis(),
    ): String {
        val seconds = max(0L, (now - ms.toLong()) / 1000)
        return when {
            seconds < 60 -> "now"
            seconds < 3600 -> "${seconds / 60}m"
            seconds < 86_400 -> "${seconds / 3600}h"
            seconds < 7 * 86_400 -> "${seconds / 86_400}d"
            else -> SimpleDateFormat("d MMM yyyy", Locale.US).format(Date(ms.toLong()))
        }
    }

    /** The link to a board (`https://links.calimero.network/<package>/board?…`, as `createLink` builds). */
    fun boardLink(
        teamId: String,
        contextId: String,
    ) = "https://links.calimero.network/$PACKAGE_NAME/board?team=$teamId&board=$contextId"

    /** The team and board a board link names, from its https or `calimero://` form; null otherwise. */
    fun parseBoardLink(raw: String): Pair<String, String>? {
        val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
        val path = (uri.rawPath ?: "").split('/').filter { it.isNotEmpty() }
        val segments = if (uri.scheme == "calimero") listOf(uri.host ?: "") + path else path
        if (segments.size < 2 || segments[segments.size - 2] != PACKAGE_NAME || segments.last() != "board") return null
        val query =
            (uri.rawQuery ?: "").split('&').filter { '=' in it }.associate {
                it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), "UTF-8")
            }
        val team = query["team"]?.takeIf { it.isNotEmpty() } ?: return null
        val board = query["board"]?.takeIf { it.isNotEmpty() } ?: return null
        return team to board
    }

    /** Words a person can act on, from an error. */
    fun errorText(error: Throwable): String {
        val text = error.message ?: error.toString()
        return when {
            "view-only" in text -> "You have view-only access to this board. Ask an admin for edit access to comment."
            error::class.simpleName == "NoRelayException" || "no relay" in text.lowercase() ->
                "Your account has no relay yet. Join a team from an invitation link, or try again shortly."
            error is java.net.UnknownHostException || error is java.net.ConnectException ->
                "You're offline. Check your connection and try again."
            else -> text
        }
    }
}
