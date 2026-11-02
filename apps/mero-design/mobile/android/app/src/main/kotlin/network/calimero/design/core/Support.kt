package network.calimero.design.core

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.NotLeader
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.app.ContextContract
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.SignedOutException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
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
 * The generated client (from v1's ABI) still types every element, member, comment and cursor: the
 * component contract answers those shapes unchanged. Only the request differs, so this is the ONE
 * place v1's wire is mapped onto the component's (the web app's `src/api/meroDesign.ts`; Swift
 * `ComponentTransport`):
 *
 * - method and argument names are camelCase (`add_comment` -> `addComment`, `comment_id` -> `commentId`);
 * - 64-bit integer ARGUMENTS travel as decimal strings (`timestamp`, `updatedAt`, `createdAt`, and
 *   `x`/`y` of `addComment`, `updateElement`, `updateCursor`);
 * - `get_elements` answers at most 1,000 elements, so it is read page by page through
 *   `getElementsPage` and handed back whole, as v1 answered it.
 */
class ComponentTransport(
    private val contract: ContextContract,
    private val appId: String,
) : ContextContractCalling {
    override suspend fun query(
        method: String,
        argsJson: String,
    ): String {
        if (method == "get_elements") return allElements()
        val (name, args) = wire(method, argsJson)
        return (contract.query(appId, name, args) ?: JsonNull).toString()
    }

    override suspend fun execute(
        method: String,
        argsJson: String,
    ): String {
        val (name, args) = wire(method, argsJson)
        return (contract.execute(appId, name, args) ?: JsonNull).toString()
    }

    /** Every element in paint order, read a page at a time. */
    private suspend fun allElements(): String {
        val items = mutableListOf<JsonElement>()
        var cursor: String? = null
        do {
            val args =
                buildJsonObject {
                    put("cursor", cursor)
                    put("limit", ELEMENT_PAGE)
                }
            val page = contract.query(appId, "getElementsPage", args) as? JsonObject
            (page?.get("items") as? JsonArray)?.let { items.addAll(it) }
            cursor = (page?.get("nextCursor") as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.takeIf { it.isNotEmpty() }
        } while (cursor != null)
        return JsonArray(items).toString()
    }

    companion object {
        /** Elements per `getElementsPage` read (the contract's largest page). */
        const val ELEMENT_PAGE = 1_000

        /** Arguments that are 64-bit integers on every method that takes them. */
        private val INT64_ARGS = setOf("timestamp", "updated_at", "created_at")

        /** Methods whose `x` / `y` are 64-bit (`i64`) too. */
        private val INT64_POINTS = setOf("add_comment", "update_element", "update_cursor")

        /** Optional arguments the generated client may leave out: the contract is sent `null`. */
        private val OPTIONAL_ARGS =
            mapOf("join" to listOf("avatar"), "update_board" to listOf("name", "description"), "get_elements_page" to listOf("cursor"))

        private val json = Json { ignoreUnknownKeys = true }

        /** The component's method name and arguments for a v1 call. */
        fun wire(
            method: String,
            argsJson: String,
        ): Pair<String, JsonObject> {
            val decoded = if (argsJson.isBlank()) JsonObject(emptyMap()) else json.parseToJsonElement(argsJson) as? JsonObject
            val out = mutableMapOf<String, JsonElement>()
            decoded?.forEach { (key, value) ->
                val int64 = key in INT64_ARGS || (method in INT64_POINTS && (key == "x" || key == "y"))
                out[camel(key)] = if (int64) decimal(value) else value
            }
            OPTIONAL_ARGS[method].orEmpty().forEach { out.putIfAbsent(camel(it), JsonNull) }
            return camel(method) to JsonObject(out)
        }

        /** `add_comment` -> `addComment`. */
        fun camel(snake: String): String {
            val parts = snake.split('_').filter { it.isNotEmpty() }
            if (parts.isEmpty()) return snake
            return parts.first() + parts.drop(1).joinToString("") { it.replaceFirstChar { c -> c.uppercase() } }
        }

        /** A 64-bit integer as the contract takes it: a decimal string (`null` stays `null`). */
        private fun decimal(value: JsonElement): JsonElement {
            val primitive = value as? JsonPrimitive ?: return value
            if (primitive.isString) return value
            return primitive.longOrNull?.let { JsonPrimitive(it.toString()) }
                ?: primitive.contentOrNull?.toDoubleOrNull()?.let { JsonPrimitive(it.toLong().toString()) }
                ?: value
        }
    }
}

/** The generated client over this backend's contract, bound to the board's app instance. */
fun MeroAppBackend.designClient(contextId: String): DesignClient = DesignClient(ComponentTransport(contract, contextId))

/** Image bytes stored as blobs on the board's app instance (`GET /apps/{app}/blobs/{id}`). */
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
    @Suppress("CyclomaticComplexMethod")
    fun errorText(error: Throwable): String =
        when (error) {
            is AppError -> appText(error)
            is ConfirmCancelled, is PasskeyCancelled -> "The passkey prompt was cancelled."
            is LoginRequired -> "Your session ended. Sign in again."
            is SignedOutException -> "You're signed out. Sign in again to see your boards."
            is ReleaseDeadlineError -> "A newer node release needs approval before anything can change. Review it on the Teams screen."
            is ConsentStale -> "That approval request is out of date. Try again."
            is NotFound -> "This isn't available to you (yet)."
            is WrongNode, is NotLeader -> "Your cluster is busy right now. Try again shortly."
            is UnavailableError -> "Your cluster is unavailable right now (${error.reason}). Try again shortly."
            is java.net.UnknownHostException, is java.net.ConnectException, is IOException ->
                "You're offline. Check your connection and try again."
            else -> error.message ?: error.toString()
        }

    /** The contract's refusals: `Forbidden {message}` / `Invalid {message}`. */
    private fun appText(error: AppError): String {
        val message = (error.fields["message"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        val lowered = message.lowercase()
        return when {
            "view-only" in lowered || "editor" in lowered -> "You have view-only access to this board. Ask an admin for edit access to comment."
            message.isNotEmpty() -> message.replaceFirstChar { it.uppercase() }
            error.appCode == "Forbidden" -> "You don't have access to do that on this board."
            else -> "That isn't allowed on this board."
        }
    }
}
