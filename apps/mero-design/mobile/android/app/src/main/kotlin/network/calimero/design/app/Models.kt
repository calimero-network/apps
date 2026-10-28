package network.calimero.design.app

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import network.calimero.design.core.BlobLoading
import network.calimero.design.core.BoardScene
import network.calimero.design.core.DesignFormat
import network.calimero.design.core.MeasureFactory
import network.calimero.design.core.NoBlobs
import network.calimero.design.core.Point
import network.calimero.design.core.designClient
import network.calimero.design.core.estimateMeasure
import network.calimero.design.generated.BoardInfo
import network.calimero.design.generated.Comment
import network.calimero.design.generated.CommentReply
import network.calimero.design.generated.CursorState
import network.calimero.design.generated.Element
import network.calimero.design.generated.ElementData
import network.calimero.design.generated.Member
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.roundToLong

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

// region Teams

/** A team: a namespace running Mero Design. */
data class Team(
    val id: String,
    val name: String,
    val memberCount: Int,
)

/** The teams this account is in. (Swift `TeamsModel`.) */
class TeamsModel(
    private val backend: MeroAppBackend,
) {
    private val _teams = MutableStateFlow<List<Team>>(emptyList())
    val teams: StateFlow<List<Team>> = _teams.asStateFlow()
    private val _state = MutableStateFlow<LoadState>(LoadState.Idle)
    val state: StateFlow<LoadState> = _state.asStateFlow()

    suspend fun load() {
        if (_teams.value.isEmpty()) _state.value = LoadState.Loading
        attempt { backend.listNamespaces() }
            .onSuccess { list ->
                _teams.value = list.map { Team(it.id, name(it), it.memberCount) }.sortedBy { it.name.lowercase() }
                _state.value = LoadState.Loaded
            }.onFailure { _state.value = LoadState.Failed(DesignFormat.errorText(it)) }
    }

    companion object {
        fun name(ns: AppNamespace): String = ns.name?.trim()?.takeIf { it.isNotEmpty() } ?: "Team ${DesignFormat.shortId(ns.id)}"
    }
}

// endregion

// region Boards

/** A board: a subgroup of the team with one context in it. */
data class BoardSummary(
    val contextId: String,
    val groupId: String,
    val name: String,
    val description: String,
    /** From the board's own `get_board`, once it answers. */
    val elementCount: Int?,
)

/** A team's boards. (Swift `BoardsModel`.) */
class BoardsModel(
    private val backend: MeroAppBackend,
    val teamId: String,
) {
    private val _boards = MutableStateFlow<List<BoardSummary>>(emptyList())
    val boards: StateFlow<List<BoardSummary>> = _boards.asStateFlow()
    private val _state = MutableStateFlow<LoadState>(LoadState.Idle)
    val state: StateFlow<LoadState> = _state.asStateFlow()

    suspend fun load() {
        if (_boards.value.isEmpty()) _state.value = LoadState.Loading
        val subgroups =
            attempt { backend.listSubgroups(teamId) }.getOrElse {
                _state.value = LoadState.Failed(DesignFormat.errorText(it))
                return
            }
        val known = _boards.value.associateBy { it.contextId }
        _boards.value =
            subgroups.mapNotNull { sg ->
                val ctx = sg.contextIds.firstOrNull() ?: return@mapNotNull null
                val name = sg.name?.trim().orEmpty()
                val prev = known[ctx]
                BoardSummary(
                    ctx,
                    sg.groupId,
                    prev?.name ?: name.ifEmpty { "Board ${DesignFormat.shortId(ctx)}" },
                    prev?.description ?: "",
                    prev?.elementCount,
                )
            }
        _state.value = LoadState.Loaded
        enrich()
    }

    /** The board's own name, description and size: the replicated name wins over the listing's. */
    private suspend fun enrich() {
        val infos: Map<String, BoardInfo> =
            coroutineScope {
                _boards.value
                    .map { b ->
                        async { b.contextId to attempt { backend.designClient(b.contextId).getBoard() }.getOrNull() }
                    }.awaitAll()
            }.mapNotNull { (id, info) -> info?.let { id to it } }.toMap()
        _boards.update { list ->
            list.map { b ->
                val info = infos[b.contextId] ?: return@map b
                b.copy(
                    name = info.name.trim().ifEmpty { b.name },
                    description = info.description,
                    elementCount = info.elementCount.toInt(),
                )
            }
        }
    }
}

// endregion

// region Board

/** Someone else looking at the board right now. */
data class Viewer(
    val account: String,
    val name: String,
    val point: Point,
)

/** One open board, read-only: the scene, comments, who else is here. (Swift `BoardModel`.) */
@Suppress("TooManyFunctions", "LongParameterList")
class BoardModel(
    private val backend: MeroAppBackend,
    val teamId: String,
    val contextId: String,
    name: String = "",
    private val scope: CoroutineScope,
    private val blobs: BlobLoading = NoBlobs,
    private val measure: MeasureFactory = estimateMeasure,
    private val now: () -> Long = System::currentTimeMillis,
) {
    sealed class Phase {
        object Loading : Phase()

        object Ready : Phase()

        data class Failed(
            val message: String,
        ) : Phase()
    }

    private val client = backend.designClient(contextId)
    private val _phase = MutableStateFlow<Phase>(Phase.Loading)
    val phase: StateFlow<Phase> = _phase.asStateFlow()
    private val _name = MutableStateFlow(name)
    val name: StateFlow<String> = _name.asStateFlow()
    private val _elements = MutableStateFlow<List<Element>>(emptyList())
    val elements: StateFlow<List<Element>> = _elements.asStateFlow()
    private val _scene = MutableStateFlow(BoardScene.EMPTY)
    val scene: StateFlow<BoardScene> = _scene.asStateFlow()

    /** Oldest first, like the web's thread list. */
    private val _comments = MutableStateFlow<List<Comment>>(emptyList())
    val comments: StateFlow<List<Comment>> = _comments.asStateFlow()
    private val _members = MutableStateFlow<List<Member>>(emptyList())
    val members: StateFlow<List<Member>> = _members.asStateFlow()
    private val _viewers = MutableStateFlow<List<Viewer>>(emptyList())
    val viewers: StateFlow<List<Viewer>> = _viewers.asStateFlow()

    /** `admin`, `editor` or `viewer`; null until known. */
    private val _role = MutableStateFlow<String?>(null)
    val role: StateFlow<String?> = _role.asStateFlow()

    /** Image bytes by blob id. */
    private val _images = MutableStateFlow<Map<String, ByteArray>>(emptyMap())
    val images: StateFlow<Map<String, ByteArray>> = _images.asStateFlow()

    private val fetching = mutableSetOf<String>()
    private var refreshing = false
    private var dirty = false

    /** What this phone wrote that a read has not shown yet. */
    private val pendingComments = mutableListOf<Comment>()
    private val pendingReplies = mutableMapOf<String, MutableList<CommentReply>>()

    /** Whether this account may comment: editors and admins (the contract's rule). */
    val canComment: Boolean get() = _role.value == "admin" || _role.value == "editor"

    /** This account's name on the board's roster; null until it has joined it. */
    val myName: String? get() =
        _members.value
            .firstOrNull { it.id == backend.account }
            ?.username
            ?.trim()
            ?.takeIf { it.isNotEmpty() }

    val shareLink: String get() = DesignFormat.boardLink(teamId, contextId)
    val account: String get() = backend.account

    /** Join the board's context when this account is not in it yet, then read everything. */
    suspend fun open() {
        _phase.value = Phase.Loading
        val member = attempt { backend.isMember(contextId) }.getOrNull()
        if (member == false) {
            attempt { backend.joinContext(contextId) }.onFailure {
                _phase.value = Phase.Failed("Couldn't join this board: ${DesignFormat.errorText(it)}")
                return
            }
        }
        attempt { loadElements() }.onFailure {
            _phase.value = Phase.Failed(DesignFormat.errorText(it))
            return
        }
        _phase.value = Phase.Ready
        loadRest()
    }

    /** Re-read the board, coalescing bursts of events into one read at a time. */
    suspend fun refresh() {
        if (refreshing) {
            dirty = true
            return
        }
        refreshing = true
        try {
            do {
                dirty = false
                attempt { loadElements() }
                    .onSuccess { if (_phase.value != Phase.Ready) _phase.value = Phase.Ready }
                    .onFailure { if (_elements.value.isEmpty() && _phase.value != Phase.Ready) _phase.value = Phase.Failed(DesignFormat.errorText(it)) }
                loadRest()
            } while (dirty)
        } finally {
            refreshing = false
        }
    }

    /** Follow the board until cancelled: the relay's events when it streams, polling otherwise. */
    suspend fun live() {
        if (backend.canSubscribe) {
            attempt { backend.events(contextId).collect { refresh() } }
        }
        while (currentCoroutineContext().isActive) {
            delay(POLL_INTERVAL_MS)
            refresh()
        }
    }

    /** A display name for a member id: their roster name, else a short id. */
    fun nameFor(member: String): String {
        if (member == backend.account) myName?.let { return it }
        return _members.value
            .firstOrNull { it.id == member }
            ?.username
            ?.trim()
            ?.takeIf { it.isNotEmpty() } ?: DesignFormat.shortId(member)
    }

    /** Pin a comment at [point]; a first comment puts this account on the roster under [joinAs]. */
    suspend fun addComment(
        text: String,
        point: Point,
        joinAs: String? = null,
    ) {
        val content = text.trim()
        if (content.isEmpty()) return
        joinRosterIfNeeded(joinAs)
        val id = UUID.randomUUID().toString()
        val at = now().toULong()
        val x = point.x.roundToLong()
        val y = point.y.roundToLong()
        client.addComment(id, x, y, content, at)
        pendingComments += Comment(id, x, y, content, backend.account, at, emptyList())
        loadComments()
    }

    /** Answer a comment. */
    suspend fun reply(
        commentId: String,
        text: String,
        joinAs: String? = null,
    ) {
        val content = text.trim()
        if (content.isEmpty()) return
        joinRosterIfNeeded(joinAs)
        val id = UUID.randomUUID().toString()
        val at = now().toULong()
        client.addReply(commentId, id, content, at)
        pendingReplies.getOrPut(commentId) { mutableListOf() } += CommentReply(id, content, backend.account, at)
        loadComments()
    }

    /** Recompute the scene with the platform's text metrics. */
    fun remeasure(measure: MeasureFactory) {
        _scene.value = BoardScene.of(_elements.value, measure)
    }

    private suspend fun loadElements() {
        val els = client.getElements()
        if (els != _elements.value || _scene.value == BoardScene.EMPTY) {
            _elements.value = els
            _scene.value = BoardScene.of(els, measure)
        }
        fetchImages()
    }

    private suspend fun loadRest() {
        coroutineScope {
            val info = async { attempt { client.getBoard() }.getOrNull() }
            val members = async { attempt { client.getMembers() }.getOrNull() }
            val role = async { attempt { client.myRole() }.getOrNull() }
            val cursors = async { attempt { client.getCursors() }.getOrNull() }
            loadComments()
            info
                .await()
                ?.name
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let { _name.value = it }
            members.await()?.let { _members.value = it }
            role.await()?.let { _role.value = it }
            cursors.await()?.let { _viewers.value = activeViewers(it) }
        }
    }

    @Suppress("LoopWithTooManyJumpStatements")
    private suspend fun loadComments() {
        val read = attempt { client.getComments() }.getOrNull()
        val list = (read ?: _comments.value).toMutableList()
        if (read != null) {
            val ids = list.map { it.id }.toSet()
            pendingComments.removeAll { it.id in ids }
        }
        for (c in pendingComments) if (list.none { it.id == c.id }) list += c
        for ((commentId, replies) in pendingReplies) {
            val i = list.indexOfFirst { it.id == commentId }
            if (i < 0) continue
            val have = list[i].replies.map { it.id }.toSet()
            val missing = replies.filter { it.id !in have }
            if (read != null) {
                replies.clear()
                replies += missing
            }
            list[i] = list[i].copy(replies = list[i].replies + missing)
        }
        pendingReplies.entries.removeAll { it.value.isEmpty() }
        _comments.value = list.sortedWith(compareBy({ it.createdAt }, { it.id }))
    }

    internal fun activeViewers(cursors: List<CursorState>): List<Viewer> {
        val nowMs = now().toULong()
        val seen = mutableSetOf<String>()
        return cursors
            .sortedByDescending { it.updatedAt }
            .filter { c -> c.account != backend.account && nowMs >= c.updatedAt && nowMs - c.updatedAt < VIEWER_WINDOW_MS && seen.add(c.account) }
            .map { Viewer(it.account, nameFor(it.account), Point(it.x.toDouble(), it.y.toDouble())) }
    }

    private fun fetchImages() {
        val wanted = _elements.value.mapNotNull { (it.data as? ElementData.Image)?.value?.blobId }.distinct()
        for (blobId in wanted.filter { !_images.value.containsKey(it) && fetching.add(it) }) {
            scope.launch {
                attempt { blobs.blob(blobId, contextId) }
                    .onSuccess { bytes -> _images.update { it + (blobId to bytes) } }
                    .onFailure { fetching.remove(blobId) }
            }
        }
    }

    private suspend fun joinRosterIfNeeded(name: String?) {
        if (myName != null) return
        val username = name?.trim()?.takeIf { it.isNotEmpty() } ?: return
        client.join(username, null, now().toULong())
        attempt { client.getMembers() }.getOrNull()?.let { _members.value = it }
        if (myName == null) {
            _members.update { it + Member(backend.account, username, null, now().toULong(), now().toULong()) }
        }
    }

    companion object {
        /** A pointer counts as here for this long after it last moved (the web's window). */
        const val VIEWER_WINDOW_MS: ULong = 10_000u

        /** How often to re-read when the relay cannot stream events. */
        const val POLL_INTERVAL_MS = 5_000L
    }
}

// endregion
