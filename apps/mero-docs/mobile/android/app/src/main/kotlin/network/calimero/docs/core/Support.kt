package network.calimero.docs.core

import com.calimero.mero.app.ContextContractCalling
import com.calimero.mero.app.MeroAppBackend
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.put
import network.calimero.docs.generated.DocsClient
import java.io.IOException
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max

/**
 * One folder's docs contract: the generated client, plus the raw transport for the one read the
 * generated decoder cannot take ([readDocument]). (Swift `DocsAPI`.)
 */
class DocsApi(
    private val transport: ContextContractCalling,
) {
    val client = DocsClient(transport)

    /**
     * The document's body as blocks, in order.
     *
     * `get_document` is called through the transport and decoded leniently rather than with the
     * generated `getDocument`: the node writes a span's `"true"` marks back as JSON booleans and
     * leaves `attributes` out of a plain span, which the ABI's `map<string,string>` does not
     * describe, so the generated decoder would refuse every formatted document.
     */
    suspend fun readDocument(docId: String): List<WireBlock> {
        val args = buildJsonObject { put("doc", docId) }.toString()
        val raw = transport.query("get_document", args)
        val element = Json.parseToJsonElement(raw)
        if (element !is JsonArray) return emptyList()
        return element.jsonArray.map { WireBlock.from(it) }
    }
}

/** The docs contract over this backend's contract, bound to [contextId]. */
fun MeroAppBackend.docs(contextId: String): DocsApi = DocsApi(contract.bound(contextId))

/**
 * Image bytes stored as blobs on the folder's docs context. `MeroAppBackend` has no blob call yet,
 * so the app reads them through the signed-in client's admin surface (`getBlob(blobId, contextId)`).
 */
fun interface BlobLoading {
    suspend fun blob(
        id: String,
        contextId: String,
    ): ByteArray
}

/** No blobs: images show as unavailable. */
val NoBlobs = BlobLoading { _, _ -> throw IOException("no blob store") }

/** A document a link names. (Swift `DocTarget`.) */
data class DocTarget(
    /** The workspace (namespace) id. */
    val workspaceId: String,
    /** The folder's group id. */
    val folderId: String,
    val docId: String,
    val blockId: String? = null,
)

/** What a link inside a document points at. (Swift `LinkTarget`.) */
sealed class LinkTarget {
    /** Another Mero Docs document: opened in the app. */
    data class Doc(
        val target: DocTarget,
    ) : LinkTarget()

    /** A workspace member, as a mention writes it: shown, not followed. */
    data class Member(
        val account: String,
    ) : LinkTarget()

    /** Anywhere else: opened in the browser. */
    data class Web(
        val url: String,
    ) : LinkTarget()

    object None : LinkTarget()
}

/** Copy, links and formatting shared by every screen. (Swift `DocsFormat`.) */
@Suppress("TooManyFunctions")
object DocsFormat {
    /** The app's registry package (`PACKAGE_NAME` in the web app). */
    const val PACKAGE_NAME = "com.calimero.mero-drive-docs"

    /** The web app: share links open there, and its links open here. */
    const val WEB_ORIGIN = "https://mero-docs.vercel.app"

    private const val NANOS_PER_MILLI = 1_000_000L
    private const val HEX_ACCOUNT = 64

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

    /** "just now", "5m ago", "3h ago", "2d ago", or a date, from nanoseconds. */
    fun relativeTime(
        nanos: ULong,
        now: Long = System.currentTimeMillis(),
    ): String {
        if (nanos == 0UL) return ""
        val then = (nanos / NANOS_PER_MILLI.toULong()).toLong()
        val seconds = max(0L, (now - then) / 1000)
        return when {
            seconds < 60 -> "just now"
            seconds < 3600 -> "${seconds / 60}m ago"
            seconds < 86_400 -> "${seconds / 3600}h ago"
            seconds < 7 * 86_400 -> "${seconds / 86_400}d ago"
            else -> SimpleDateFormat("d MMM yyyy", Locale.US).format(Date(then))
        }
    }

    /** The web's link to a document (`docUrl` in `lib/routes.ts`), with `#b=<block>` for one block. */
    fun docLink(t: DocTarget): String {
        val base = "$WEB_ORIGIN/app/${enc(t.workspaceId)}/f/${enc(t.folderId)}/d/${enc(t.docId)}"
        return t.blockId?.let { "$base#b=${enc(it)}" } ?: base
    }

    /** The document a web link names (`parseAppPath`): any origin, optional version prefix. */
    @Suppress("ReturnCount")
    fun parseDocLink(raw: String): DocTarget? {
        val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
        val parts = (uri.rawPath ?: "").split('/').filter { it.isNotEmpty() }
        val app = parts.indexOf("app")
        if (app < 0 || parts.size < app + 6) return null
        val p = parts.drop(app)
        if (p[2] != "f" || p[4] != "d") return null
        val ws = dec(p[1]) ?: return null
        val folder = dec(p[3]) ?: return null
        val doc = dec(p[5]) ?: return null
        if (ws.isEmpty() || folder.isEmpty() || doc.isEmpty()) return null
        val block =
            (uri.rawFragment ?: "")
                .split('&')
                .lastOrNull { it.startsWith("b=") }
                ?.let { dec(it.removePrefix("b=")) }
                ?.takeIf { it.isNotEmpty() }
        return DocTarget(ws, folder, doc, block)
    }

    /** What tapping a link in a document does. */
    fun linkTarget(href: String): LinkTarget {
        parseDocLink(href)?.let { return LinkTarget.Doc(it) }
        val uri = runCatching { URI(href) }.getOrNull()
        val parts = (uri?.rawPath ?: href).split('/').filter { it.isNotEmpty() }
        val app = parts.indexOf("app")
        if (app >= 0 && parts.size == app + 4 && parts[app + 2] == "m") {
            val account = parts[app + 3]
            if (account.length == HEX_ACCOUNT && account.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) {
                return LinkTarget.Member(account.lowercase())
            }
        }
        val scheme = uri?.scheme?.lowercase()
        return if (scheme in setOf("http", "https", "mailto")) LinkTarget.Web(href) else LinkTarget.None
    }

    /** A search snippet as plain and bold pieces: the node wraps matched words in `<b>`. */
    fun snippetPieces(snippet: String): List<Pair<String, Boolean>> {
        val out = mutableListOf<Pair<String, Boolean>>()
        var bold = false
        var at = 0
        for (tag in TAG.findAll(snippet)) {
            if (tag.range.first > at) out += decodeEntities(snippet.substring(at, tag.range.first)) to bold
            when (tag.groupValues[1].lowercase()) {
                "b" -> bold = true
                "/b" -> bold = false
            }
            at = tag.range.last + 1
        }
        if (at < snippet.length) out += decodeEntities(snippet.substring(at)) to bold
        return out.filter { it.first.isNotEmpty() }
    }

    private val TAG = Regex("<([^>]*)>")

    private fun decodeEntities(s: String) =
        s
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&amp;", "&")

    /** Words a person can act on, from an error. */
    fun errorText(error: Throwable): String {
        val text = error.message ?: error.toString()
        val lower = text.lowercase()
        return when {
            "forbidden" in lower || "read-only" in lower || "readonly" in lower || "not allowed" in lower ->
                "You can read this folder but not comment in it. Ask a workspace admin for edit access."
            error::class.simpleName == "NoRelayException" || "no relay" in lower ->
                "Your account has no relay yet. Join a workspace from an invitation on the web, or try again shortly."
            error is java.net.UnknownHostException || error is java.net.ConnectException ->
                "You're offline. Check your connection and try again."
            else -> text
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    private fun dec(s: String): String? = runCatching { URLDecoder.decode(s.replace("+", "%2B"), "UTF-8") }.getOrNull()
}
