package network.calimero.docs.app

import android.content.SharedPreferences
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import network.calimero.docs.core.BlobLoading
import network.calimero.docs.core.CommentBody
import network.calimero.docs.core.CommentThread
import network.calimero.docs.core.DocBlock
import network.calimero.docs.core.DocComment
import network.calimero.docs.core.DocTarget
import network.calimero.docs.core.DocsFormat
import network.calimero.docs.core.DocumentReader
import network.calimero.docs.core.NoBlobs
import network.calimero.docs.core.docs
import network.calimero.docs.generated.DocDto
import kotlin.coroutines.cancellation.CancellationException

/** Where a list screen is. (Swift `LoadState`.) */
sealed class LoadState {
    object Idle : LoadState()

    object Loading : LoadState()

    object Loaded : LoadState()

    data class Failed(
        val message: String,
    ) : LoadState()
}

/** Runs [block], letting cancellation through and turning anything else into a result. */
private inline fun <T> attempt(block: () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (
        @Suppress("TooGenericExceptionCaught") e: Exception,
    ) {
        Result.failure(e)
    }

/**
 * "You" for this account, a short id for anyone else: the relay has no member-name call, so names
 * the web reads from group metadata are not here. (Swift `personName`.)
 */
fun personName(
    account: String,
    me: String,
): String = if (account.equals(me, ignoreCase = true)) "You" else DocsFormat.shortId(account)

// region Workspaces

/** A workspace: a namespace running Mero Docs. */
data class Workspace(
    val id: String,
    val name: String,
    val memberCount: Int,
)

/** The workspaces this account is in. (Swift `WorkspacesModel`.) */
class WorkspacesModel(
    private val backend: MeroAppBackend,
) {
    private val _workspaces = MutableStateFlow<List<Workspace>>(emptyList())
    val workspaces: StateFlow<List<Workspace>> = _workspaces.asStateFlow()
    private val _state = MutableStateFlow<LoadState>(LoadState.Idle)
    val state: StateFlow<LoadState> = _state.asStateFlow()

    suspend fun load() {
        if (_workspaces.value.isEmpty()) _state.value = LoadState.Loading
        attempt { backend.listNamespaces() }
            .onSuccess { list ->
                _workspaces.value = list.map { Workspace(it.id, name(it), it.memberCount) }.sortedBy { it.name.lowercase() }
                _state.value = LoadState.Loaded
            }.onFailure { _state.value = LoadState.Failed(DocsFormat.errorText(it)) }
    }

    companion object {
        fun name(ns: AppNamespace): String = ns.name?.trim()?.takeIf { it.isNotEmpty() } ?: "Workspace ${DocsFormat.shortId(ns.id)}"
    }
}

// endregion

// region Workspace index

/** A folder: a subgroup of the workspace, nested by core's tree, with one docs context. */
data class Folder(
    /** The subgroup's group id: what a doc link names. */
    val id: String,
    val name: String,
    /** The folder above; null at the top. */
    val parentId: String?,
    /** The folder's docs context; null until one reaches the relay. */
    val contextId: String?,
)

/** One document in the workspace index. */
data class DocRow(
    val folderId: String,
    val contextId: String,
    val folderName: String,
    val doc: DocDto,
) {
    val id: String get() = "$folderId/${doc.id}"
    val title: String get() = doc.title.trim().ifEmpty { "Untitled" }
}

/** A search hit: the doc, and the node's snippet around the match. */
data class SearchResult(
    val row: DocRow,
    /** The node's fragment with `<b>` around matched words; empty for a title match. */
    val snippet: String,
)

/** Why a folder's documents are not listed. */
sealed class FolderIssue {
    /** No docs context has reached the relay yet. */
    object NoContext : FolderIssue()

    /** The account is not in it and could not join. */
    data class NoAccess(
        val message: String,
    ) : FolderIssue()

    data class Failed(
        val message: String,
    ) : FolderIssue()
}

@Serializable
data class RecentDoc(
    val folderId: String,
    val docId: String,
    /** Unix milliseconds. */
    val openedAt: Long,
)

/**
 * The documents this device opened last in a workspace, newest first; on this device only, as the
 * web keeps them in `localStorage`. (Swift `RecentStore`.)
 */
interface RecentStore {
    fun recent(workspaceId: String): List<RecentDoc>

    fun touch(
        workspaceId: String,
        folderId: String,
        docId: String,
        at: Long,
    )
}

/** Recents in shared preferences, one list per workspace, at most [LIMIT]. */
class PrefsRecentStore(
    private val prefs: SharedPreferences,
) : RecentStore {
    private val serializer = ListSerializer(RecentDoc.serializer())

    override fun recent(workspaceId: String): List<RecentDoc> =
        prefs.getString(key(workspaceId), null)?.let { runCatching { Json.decodeFromString(serializer, it) }.getOrNull() }.orEmpty()

    override fun touch(
        workspaceId: String,
        folderId: String,
        docId: String,
        at: Long,
    ) {
        val list = listOf(RecentDoc(folderId, docId, at)) + recent(workspaceId).filterNot { it.folderId == folderId && it.docId == docId }
        prefs.edit().putString(key(workspaceId), Json.encodeToString(serializer, list.take(LIMIT))).apply()
    }

    private fun key(ws: String) = "mero-docs:recent:$ws"

    companion object {
        const val LIMIT = 8
    }
}

/** A workspace's folders and documents, searched and browsed. (Swift `WorkspaceModel`.) */
class WorkspaceModel(
    private val backend: MeroAppBackend,
    val workspace: Workspace,
    private val recents: RecentStore,
) {
    private val _folders = MutableStateFlow<List<Folder>>(emptyList())
    val folders: StateFlow<List<Folder>> = _folders.asStateFlow()
    private val _docs = MutableStateFlow<List<DocRow>>(emptyList())
    val docs: StateFlow<List<DocRow>> = _docs.asStateFlow()
    private val _issues = MutableStateFlow<Map<String, FolderIssue>>(emptyMap())
    val issues: StateFlow<Map<String, FolderIssue>> = _issues.asStateFlow()
    private val _state = MutableStateFlow<LoadState>(LoadState.Idle)
    val state: StateFlow<LoadState> = _state.asStateFlow()
    private val _results = MutableStateFlow<List<SearchResult>>(emptyList())
    val results: StateFlow<List<SearchResult>> = _results.asStateFlow()
    private val _searching = MutableStateFlow(false)
    val searching: StateFlow<Boolean> = _searching.asStateFlow()
    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    val account: String get() = backend.account

    /** Folders at the top, or under [parentId], by name. */
    fun folders(parentId: String?): List<Folder> = _folders.value.filter { it.parentId == parentId }.sortedBy { it.name.lowercase() }

    /** A folder's documents, last changed first. */
    fun docs(folderId: String): List<DocRow> = _docs.value.filter { it.folderId == folderId }.sortedWith(NEWEST_FIRST)

    /** Every document, last changed first. */
    val recentlyUpdated: List<DocRow> get() = _docs.value.sortedWith(NEWEST_FIRST)

    /** What this device opened last here, that is still in the index. */
    val recent: List<DocRow>
        get() =
            recents.recent(workspace.id).mapNotNull { r ->
                _docs.value.firstOrNull { it.folderId == r.folderId && it.doc.id == r.docId }
            }

    fun folder(id: String): Folder? = _folders.value.firstOrNull { it.id == id }

    /** Folders and documents, read again. */
    suspend fun load() {
        if (_docs.value.isEmpty() && _folders.value.isEmpty()) _state.value = LoadState.Loading
        attempt { walk() }
            .onSuccess { tree ->
                _folders.value = tree
                readDocs(tree)
                _state.value = LoadState.Loaded
            }.onFailure { _state.value = LoadState.Failed(DocsFormat.errorText(it)) }
    }

    /** The tree, one level at a time from the workspace's root group; only the root failing fails the load. */
    private suspend fun walk(): List<Folder> =
        coroutineScope {
            val found = mutableListOf<Folder>()
            val seen = mutableSetOf(workspace.id)
            var level: List<Pair<AppSubgroup, String?>> = backend.listSubgroups(workspace.id).map { it to null }
            var depth = 0
            while (level.isNotEmpty() && depth < MAX_DEPTH) {
                val next = mutableListOf<String>()
                for ((sg, parent) in level) {
                    if (!seen.add(sg.groupId)) continue
                    found += Folder(sg.groupId, sg.name?.trim()?.takeIf { it.isNotEmpty() } ?: "Untitled folder", parent, sg.contextIds.firstOrNull())
                    next += sg.groupId
                }
                level =
                    next
                        .map { id -> async { attempt { backend.listSubgroups(id) }.getOrDefault(emptyList()).map { it to id } } }
                        .awaitAll()
                        .flatten()
                        .sortedBy { it.first.groupId }
                depth++
            }
            found
        }

    private suspend fun readDocs(tree: List<Folder>) {
        val outcomes =
            coroutineScope {
                tree.map { folder -> async { folder.id to readFolder(folder) } }.awaitAll()
            }
        val rows = mutableListOf<DocRow>()
        val problems = mutableMapOf<String, FolderIssue>()
        for ((folderId, outcome) in outcomes) {
            outcome
                .onSuccess { rows += it }
                .onFailure {
                    problems[folderId] = (it as? IssueException)?.issue ?: FolderIssue.Failed(DocsFormat.errorText(it))
                    // A folder that fails a re-read keeps what it showed.
                    rows += _docs.value.filter { r -> r.folderId == folderId }
                }
        }
        _docs.value = rows
        _issues.value = problems
    }

    private suspend fun readFolder(folder: Folder): Result<List<DocRow>> {
        val ctx = folder.contextId ?: return Result.failure(IssueException(FolderIssue.NoContext))
        val member = attempt { backend.isMember(ctx) }.getOrNull()
        if (member == false) {
            attempt { backend.joinContext(ctx) }.onFailure {
                return Result.failure(IssueException(FolderIssue.NoAccess(DocsFormat.errorText(it))))
            }
        }
        return attempt { backend.docs(ctx).client.listDocs(false) }
            .map { list -> list.map { DocRow(folder.id, ctx, folder.name, it) } }
    }

    /** Titles that match at once, then every folder's full-text index (`search_docs`). */
    suspend fun search(text: String) {
        val q = text.trim()
        _query.value = q
        if (q.isEmpty()) {
            _results.value = emptyList()
            _searching.value = false
            return
        }
        val titleHits = _docs.value.filter { it.title.contains(q, ignoreCase = true) }.sortedWith(NEWEST_FIRST)
        _results.value = titleHits.map { SearchResult(it, "") }
        _searching.value = true
        val byContext = _docs.value.groupBy { it.contextId }
        val targets = _folders.value.filter { it.contextId != null && _issues.value[it.id] == null }
        val hits =
            coroutineScope {
                targets
                    .map { folder ->
                        async {
                            val ctx = folder.contextId!!
                            val page = attempt { backend.docs(ctx).client.searchDocs(q, false, null, SEARCH_LIMIT) }.getOrNull()
                            page?.hits.orEmpty().filterNot { it.archived }.map { hit ->
                                val row =
                                    byContext[ctx]?.firstOrNull { it.doc.id == hit.id }
                                        ?: DocRow(folder.id, ctx, folder.name, DocDto(hit.id, hit.title, emptyList(), hit.archived, 0u, 0u, "", "", false))
                                Triple(row, hit.snippet, hit.score)
                            }
                        }
                    }.awaitAll()
                    .flatten()
            }
        // A newer query owns the list now.
        if (_query.value != q) return
        val seen = mutableSetOf<String>()
        val merged = mutableListOf<SearchResult>()
        hits.sortedWith(compareByDescending<Triple<DocRow, String, Float>> { it.third }.thenBy { it.first.id }).forEach { (row, snippet, _) ->
            if (seen.add(row.id)) merged += SearchResult(row, snippet)
        }
        titleHits.forEach { if (seen.add(it.id)) merged += SearchResult(it, "") }
        _results.value = merged
        _searching.value = false
    }

    private class IssueException(
        val issue: FolderIssue,
    ) : Exception()

    companion object {
        /** How deep the folder tree is walked. */
        const val MAX_DEPTH = 8
        private const val SEARCH_LIMIT = 20u
        val NEWEST_FIRST: Comparator<DocRow> = compareByDescending<DocRow> { it.doc.updatedAt }.thenBy { it.id }
    }
}

// endregion

// region Document

/** One open document, read-only, with its comments. (Swift `DocumentModel`.) */
@Suppress("LongParameterList")
class DocumentModel(
    private val backend: MeroAppBackend,
    val workspaceId: String,
    val folderId: String,
    val docId: String,
    contextId: String? = null,
    val folderName: String = "",
    title: String? = null,
    private val blobs: BlobLoading = NoBlobs,
    private val recents: RecentStore? = null,
    private val now: () -> Long = System::currentTimeMillis,
) {
    sealed class Phase {
        object Loading : Phase()

        object Ready : Phase()

        data class Failed(
            val message: String,
        ) : Phase()
    }

    /** An image block's picture. */
    sealed class ImageState {
        object Loading : ImageState()

        class Loaded(
            val bytes: ByteArray,
        ) : ImageState()

        /** No peer served it, or not in time; asking again can work. */
        object Unavailable : ImageState()
    }

    private val _phase = MutableStateFlow<Phase>(Phase.Loading)
    val phase: StateFlow<Phase> = _phase.asStateFlow()
    private val _doc =
        MutableStateFlow(title?.let { DocDto(docId, it, emptyList(), false, 0u, 0u, "", "", false) })
    val doc: StateFlow<DocDto?> = _doc.asStateFlow()
    private val _blocks = MutableStateFlow<List<DocBlock>>(emptyList())
    val blocks: StateFlow<List<DocBlock>> = _blocks.asStateFlow()
    private val _threads = MutableStateFlow<List<CommentThread>>(emptyList())
    val threads: StateFlow<List<CommentThread>> = _threads.asStateFlow()
    private val _images = MutableStateFlow<Map<String, ImageState>>(emptyMap())
    val images: StateFlow<Map<String, ImageState>> = _images.asStateFlow()
    private val _contextId = MutableStateFlow(contextId)
    val contextId: StateFlow<String?> = _contextId.asStateFlow()

    private val pending = mutableListOf<DocComment>()
    private var refreshing = false
    private var dirty = false

    val account: String get() = backend.account
    val title: String get() =
        _doc.value
            ?.title
            ?.trim()
            ?.ifEmpty { null } ?: "Untitled"
    val commentCount: Int get() = _threads.value.sumOf { 1 + it.replies.size }
    val countsByBlock: Map<String, Int> get() = CommentBody.countsByBlock(_threads.value)
    val wordCount: Int get() = DocumentReader.wordCount(_blocks.value)
    val shareLink: String get() = DocsFormat.docLink(DocTarget(workspaceId, folderId, docId))

    fun blockLink(blockId: String) = DocsFormat.docLink(DocTarget(workspaceId, folderId, docId, blockId))

    fun block(id: String): DocBlock? = _blocks.value.firstOrNull { it.id == id }

    /** Find the folder's context when a link did not carry it, join it if needed, then read everything. */
    suspend fun open() {
        _phase.value = Phase.Loading
        val ctx =
            attempt { resolveContext() }.getOrElse {
                _phase.value = Phase.Failed(DocsFormat.errorText(it))
                return
            }
        if (attempt { backend.isMember(ctx) }.getOrNull() == false) {
            attempt { backend.joinContext(ctx) }.onFailure {
                _phase.value = Phase.Failed("You don't have access to this folder. ${DocsFormat.errorText(it)}")
                return
            }
        }
        attempt { read(ctx) }
            .onSuccess {
                _phase.value = Phase.Ready
                recents?.touch(workspaceId, folderId, docId, now())
            }.onFailure { _phase.value = Phase.Failed(DocsFormat.errorText(it)) }
    }

    /** Re-read, coalescing bursts of events into one read at a time. */
    suspend fun refresh() {
        val ctx = _contextId.value ?: return open()
        if (refreshing) {
            dirty = true
            return
        }
        refreshing = true
        try {
            do {
                dirty = false
                attempt { read(ctx) }
                    .onSuccess { if (_phase.value != Phase.Ready) _phase.value = Phase.Ready }
                    .onFailure { if (_blocks.value.isEmpty() && _phase.value != Phase.Ready) _phase.value = Phase.Failed(DocsFormat.errorText(it)) }
            } while (dirty)
        } finally {
            refreshing = false
        }
    }

    /** Follow the document until cancelled: the relay's events when it streams them, polling otherwise. */
    suspend fun live() {
        val ctx = _contextId.value ?: return
        if (backend.canSubscribe) {
            try {
                backend.events(ctx).collect { refresh() }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught", "SwallowedException") e: Exception,
            ) {
                // The stream ended; poll from here.
            }
        }
        while (currentCoroutineContext().isActive) {
            delay(POLL_INTERVAL_MS)
            refresh()
        }
    }

    /** Comment on the document, or on one block of it. */
    suspend fun addComment(
        text: String,
        blockId: String? = null,
    ) = send(text, blockId, null)

    /** Answer a comment. */
    suspend fun reply(
        commentId: String,
        text: String,
    ) = send(text, null, commentId)

    /** The picture of an image block, read once and kept. */
    suspend fun loadImage(
        blobId: String,
        retry: Boolean = false,
    ) {
        val ctx = _contextId.value ?: return
        val state = _images.value[blobId]
        if (state != null && !(retry && state == ImageState.Unavailable)) return
        _images.value = _images.value + (blobId to ImageState.Loading)
        val next = attempt { blobs.blob(blobId, ctx) }.fold({ ImageState.Loaded(it) }, { ImageState.Unavailable })
        _images.value = _images.value + (blobId to next)
    }

    private suspend fun resolveContext(): String {
        _contextId.value?.let { return it }
        val ctx = backend.listContexts(folderId).firstOrNull() ?: throw FolderNotReadyException()
        _contextId.value = ctx
        return ctx
    }

    private suspend fun read(ctx: String) {
        val api = backend.docs(ctx)
        val (info, rows) =
            coroutineScope {
                val info = async { api.client.getDoc(docId) }
                val rows = async { api.readDocument(docId) }
                info.await() to rows.await()
            }
        _doc.value = info
        val next = DocumentReader.blocks(rows)
        if (next != _blocks.value) _blocks.value = next
        readComments(ctx)
    }

    private suspend fun readComments(ctx: String) {
        val read = attempt { backend.docs(ctx).client.listComments(docId) }.getOrNull()
        var list = read?.map { DocComment.of(it) } ?: _threads.value.flatMap { listOf(it.root) + it.replies }
        if (read != null) {
            val ids = list.map { it.id }.toSet()
            pending.removeAll { it.id in ids }
        }
        list = list + pending.filter { p -> list.none { it.id == p.id } }
        _threads.value = CommentBody.threads(list)
    }

    private suspend fun send(
        text: String,
        blockId: String?,
        replyTo: String?,
    ) {
        val words = text.trim()
        val ctx = _contextId.value
        if (words.isEmpty() || ctx == null) return
        val id = backend.docs(ctx).client.addComment(docId, CommentBody.encode(words, blockId, replyTo))
        // Shown at once; kept until a read has it.
        pending += DocComment(id, backend.account, (now() * NANOS_PER_MILLI).toULong(), words, if (replyTo == null) blockId else null, replyTo)
        readComments(ctx)
    }

    companion object {
        /** How often to re-read when the relay cannot stream events. */
        const val POLL_INTERVAL_MS = 5_000L
        private const val NANOS_PER_MILLI = 1_000_000L
    }
}

/** A folder with no docs context on the relay yet. (Swift `DocsError.folderNotReady`.) */
class FolderNotReadyException : Exception("This folder hasn't reached your relay yet. Try again in a moment.")

// endregion
