package network.calimero.docs.core

import com.calimero.mero.AppError
import com.calimero.mero.CalimeroError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.api.models.Org
import com.calimero.mero.api.models.Team
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.app.CalimeroAppBackend
import com.calimero.mero.app.ContextContractCalling
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.app.SignedOutException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.docs.app.Folder
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
 * One folder's docs instance: the typed client, plus the lenient body read ([readDocument]).
 * (Swift `DocsAPI`.)
 */
class DocsApi(
    transport: ContextContractCalling,
) {
    val client = DocsClient(transport)

    /**
     * The document's body as blocks, in order.
     *
     * `getDocument` is decoded leniently: each block's text is its spans, in order, each with its
     * marks as strings (`"true"` for a boolean mark, as the web's `canonicalAttrs` reads them). A
     * mark the node writes as a JSON boolean, or a span without `attributes`, is read the same way.
     */
    suspend fun readDocument(docId: String): List<WireBlock> {
        return client.getDocument(docId).map { WireBlock.from(it) }
    }
}

/** The docs contract of the folder's app instance [appId]. */
fun MeroAppBackend.docs(appId: String): DocsApi = DocsApi(contract.bound(appId))

/**
 * A workspace's folders, read as the web reads them (`lib/coreFolders.ts`). (Swift `DocsDirectory`.)
 *
 * On Calimero 1.0 ([CalimeroAppBackend]) a workspace is an organization and a folder one of its
 * teams: the team's name, its `parent`, and the folder's docs instance, whose id the team metadata
 * keeps as `docsApp`. One `GET /orgs/{org}` answers all of it, with only the teams the caller
 * reaches. Any other backend (tests) is walked through `listSubgroups`, each folder's first app
 * instance being its docs instance.
 */
class DocsDirectory(
    private val backend: MeroAppBackend,
) {
    /** Every folder of [workspaceId] this account sees. */
    suspend fun folders(workspaceId: String): List<Folder> {
        val cloud = backend as? CalimeroAppBackend ?: return walk(workspaceId)
        return folders(cloud.client.orgs.get(org = workspaceId))
    }

    /** The docs instance of one folder, when a link did not carry it. */
    suspend fun docsApp(
        workspaceId: String,
        folderId: String,
    ): String? {
        val cloud = backend as? CalimeroAppBackend ?: return backend.listContexts(folderId).firstOrNull()
        val org = cloud.client.orgs.get(org = workspaceId)
        return org.teams[folderId]?.let(::docsApp)
    }

    private suspend fun walk(workspaceId: String): List<Folder> =
        coroutineScope {
            val found = mutableListOf<Folder>()
            val seen = mutableSetOf(workspaceId)
            var level: List<Pair<AppSubgroup, String?>> = backend.listSubgroups(workspaceId).map { it to null }
            var depth = 0
            while (level.isNotEmpty() && depth < MAX_DEPTH) {
                val next = mutableListOf<String>()
                for ((sg, parent) in level) {
                    if (!seen.add(sg.groupId)) continue
                    found += Folder(sg.groupId, sg.name?.trim()?.takeIf { it.isNotEmpty() } ?: UNTITLED, parent, sg.contextIds.firstOrNull())
                    next += sg.groupId
                }
                level =
                    next
                        .map { id -> async { runCatching { backend.listSubgroups(id) }.getOrDefault(emptyList()).map { it to id } } }
                        .awaitAll()
                        .flatten()
                        .sortedBy { it.first.groupId }
                depth++
            }
            found
        }

    companion object {
        /** Where a folder's docs instance id is kept in its team's metadata. */
        const val DOCS_APP_KEY = "docsApp"

        /** How deep a walked folder tree goes. */
        const val MAX_DEPTH = 8
        private const val UNTITLED = "Untitled folder"

        /** The folders of one org snapshot (`orgs.get`): a team whose parent the caller cannot see sits at the top. */
        fun folders(org: Org): List<Folder> =
            org.teams.values
                .map { team ->
                    val parent = team.parent?.takeIf { org.teams.containsKey(it) }
                    Folder(team.teamId, team.name.trim().ifEmpty { UNTITLED }, parent, docsApp(team))
                }.sortedBy { it.id }

        fun docsApp(team: Team): String? =
            ((team.metadata as? JsonObject)?.get(DOCS_APP_KEY) as? JsonPrimitive)
                ?.takeIf { it.isString }
                ?.content
                ?.takeIf { it.isNotEmpty() }
    }
}

/**
 * Image bytes stored as blobs on the folder's docs app instance, read through
 * `MeroAppBackend.getBlob` (`/apps/{app}/blobs` on Calimero 1.0).
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
    /** The workspace (organization) id. */
    val workspaceId: String,
    /** The folder's team id. */
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

    /**
     * Words a person can act on, from an error: Calimero 1.0's typed refusals, and the contract's
     * own (`APP_ERROR` with `NotFound`, `Invalid` or `Forbidden`, as `src/calimero/errors.ts` tells
     * them apart). (Swift `DocsFormat.errorText`.)
     */
    @Suppress("CyclomaticComplexMethod")
    fun errorText(error: Throwable): String =
        when (error) {
            is AppError -> appErrorText(error.appCode, (error.fields["message"] as? JsonPrimitive)?.content.orEmpty())
            is ConfirmCancelled, is PasskeyCancelled -> "The passkey prompt was cancelled. Nothing changed."
            is LoginRequired, is SignedOutException -> "Your session ended. Sign in again."
            is WrongNode -> "This node doesn't serve your account. Sign in again to reach another node of your cluster."
            is UnavailableError ->
                if (error.reason == "network") {
                    "Can't reach your cluster. Check your connection and try again."
                } else {
                    "Your cluster is busy. Try again in a moment."
                }
            is ReleaseDeadlineError -> {
                val release = if (error.release.isEmpty()) "a node release" else "release ${error.release}"
                "New work is paused until $release is approved. Open Approvals in your account."
            }
            is ConsentStale -> "That approval is out of date. Open Approvals and review it again."
            is NotFound -> "This isn't here any more, or you no longer have access to it."
            // The node refuses a read-only member's write with 403 (`isReadOnlyWrite`).
            is CalimeroError ->
                if (error.status == HTTP_FORBIDDEN) {
                    "You can read this folder but not comment in it. Ask a workspace admin for edit access."
                } else {
                    error.nodeMessage.ifEmpty { error.code }
                }
            is java.net.UnknownHostException, is java.net.ConnectException ->
                "You're offline. Check your connection and try again."
            else -> error.message ?: error.toString()
        }

    /** The contract's refusal (`#[app::error]`) in words. */
    fun appErrorText(
        code: String,
        message: String,
    ): String =
        when (code) {
            "NotFound" -> "This document or comment is gone. Pull to refresh."
            "Forbidden" -> "You can't do that in this folder."
            "Invalid" -> if (message.isEmpty()) "That wasn't accepted. Check it and try again." else "That wasn't accepted: $message"
            else -> message.ifEmpty { code }
        }

    private const val HTTP_FORBIDDEN = 403

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    private fun dec(s: String): String? = runCatching { URLDecoder.decode(s.replace("+", "%2B"), "UTF-8") }.getOrNull()
}
