package network.calimero.pixart.app

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
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
import kotlinx.coroutines.withContext
import network.calimero.pixart.core.BlobStore
import network.calimero.pixart.core.LayerRow
import network.calimero.pixart.core.LayerStack
import network.calimero.pixart.core.LayerTree
import network.calimero.pixart.core.PixartFormat
import network.calimero.pixart.core.PixartInvitation
import network.calimero.pixart.core.Raster
import network.calimero.pixart.core.Rasterizer
import network.calimero.pixart.core.pixartClient
import network.calimero.pixart.generated.DocumentInfo
import network.calimero.pixart.generated.Layer
import network.calimero.pixart.generated.Member
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.max
import kotlin.math.min

/** Where a list screen is. (Swift `LoadState`.) */
sealed interface LoadState {
    data object Idle : LoadState

    data object Loading : LoadState

    data object Loaded : LoadState

    data class Failed(
        val message: String,
    ) : LoadState
}

/** Runs [block], letting cancellation through and turning anything else into a result. */
internal inline fun <T> attempt(block: () -> T): Result<T> =
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

/** A team: a namespace running Mero PixArt. */
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
            }.onFailure { _state.value = LoadState.Failed(PixartFormat.errorText(it)) }
    }

    companion object {
        fun name(ns: AppNamespace): String = ns.name?.trim()?.takeIf { it.isNotEmpty() } ?: "Team ${PixartFormat.shortId(ns.id)}"
    }
}

// endregion

// region Projects

/** A project: a subgroup of the team with one context running the artwork. */
data class ProjectSummary(
    val contextId: String,
    val groupId: String,
    val name: String,
    val description: String,
    /** From the project's own `get_document`, once it answers. */
    val width: UInt? = null,
    val height: UInt? = null,
    val layerCount: Int? = null,
)

/** A team's projects, with a small composite of each. (Swift `ProjectsModel`.) */
class ProjectsModel(
    private val backend: MeroAppBackend,
    val teamId: String,
    private val blobs: BlobStore,
    private val rasterizer: Rasterizer,
    private val compute: CoroutineDispatcher = Dispatchers.Default,
) {
    private val _projects = MutableStateFlow<List<ProjectSummary>>(emptyList())
    val projects: StateFlow<List<ProjectSummary>> = _projects.asStateFlow()
    private val _state = MutableStateFlow<LoadState>(LoadState.Idle)
    val state: StateFlow<LoadState> = _state.asStateFlow()

    /** Thumbnails by context id. */
    private val _thumbnails = MutableStateFlow<Map<String, Raster>>(emptyMap())
    val thumbnails: StateFlow<Map<String, Raster>> = _thumbnails.asStateFlow()
    private val thumbing = HashSet<String>()

    suspend fun load() {
        if (_projects.value.isEmpty()) _state.value = LoadState.Loading
        val subgroups =
            attempt { backend.listSubgroups(teamId) }.getOrElse {
                _state.value = LoadState.Failed(PixartFormat.errorText(it))
                return
            }
        val known = _projects.value.associateBy { it.contextId }
        _projects.value =
            subgroups.mapNotNull { sg ->
                val ctx = sg.contextIds.firstOrNull() ?: return@mapNotNull null
                known[ctx] ?: ProjectSummary(
                    ctx,
                    sg.groupId,
                    sg.name?.trim()?.takeIf { it.isNotEmpty() } ?: "Project ${PixartFormat.shortId(ctx)}",
                    "",
                )
            }
        _state.value = LoadState.Loaded
        enrich()
    }

    /** The document's own name and size win over the listing's. A project this account cannot read yet keeps its listing. */
    private suspend fun enrich() {
        val docs: Map<String, DocumentInfo> =
            coroutineScope {
                _projects.value
                    .map { p -> async { p.contextId to attempt { backend.pixartClient(p.contextId).getDocument() }.getOrNull() } }
                    .awaitAll()
            }.mapNotNull { (id, doc) -> doc?.let { id to it } }.toMap()
        _projects.update { list ->
            list.map { p ->
                val doc = docs[p.contextId] ?: return@map p
                p.copy(
                    name = doc.name.trim().ifEmpty { p.name },
                    description = doc.description,
                    width = doc.width,
                    height = doc.height,
                    layerCount = doc.layerCount.toInt(),
                )
            }
        }
    }

    /** Draw a project's thumbnail once (a card asks when it appears). */
    @Suppress("ReturnCount")
    suspend fun loadThumbnail(contextId: String) {
        if (_thumbnails.value.containsKey(contextId) || contextId in thumbing) return
        val p = _projects.value.firstOrNull { it.contextId == contextId } ?: return
        val w = p.width ?: return
        val h = p.height ?: return
        if (w == 0u || h == 0u) return
        thumbing += contextId
        try {
            val client = backend.pixartClient(contextId)
            val layers = attempt { client.getLayers() }.getOrNull() ?: return
            val doc = attempt { client.getDocument() }.getOrNull() ?: return
            val ops = LayerStack.drawOps(layers)
            val images = blobs.bitmaps(LayerStack.blobIds(ops), contextId)
            val scale = min(1.0, THUMB_SIDE / max(w, h).toDouble())
            val thumb =
                withContext(compute) {
                    rasterizer.composite(doc.width.toInt(), doc.height.toInt(), doc.background, ops, images, scale)
                } ?: return
            _thumbnails.update { it + (contextId to thumb) }
        } finally {
            thumbing -= contextId
        }
    }

    /** A link that invites someone to this team, in the web's format. */
    suspend fun inviteLink(teamName: String): String {
        val signed = backend.createInvitation(teamId)
        return PixartInvitation(signed, teamName.trim().ifEmpty { null }).link()
    }

    companion object {
        /** The longest side of a thumbnail, in pixels. */
        const val THUMB_SIDE = 360.0
    }
}

// endregion

// region Artwork

/** One project, view-only: the composite, the layer list, export. (Swift `ArtworkModel`.) */
@Suppress("TooManyFunctions", "LongParameterList")
class ArtworkModel(
    private val backend: MeroAppBackend,
    val teamId: String,
    val contextId: String,
    name: String = "",
    private val blobs: BlobStore,
    private val rasterizer: Rasterizer,
    private val compute: CoroutineDispatcher = Dispatchers.Default,
) {
    sealed interface Phase {
        data object Loading : Phase

        data object Ready : Phase

        data class Failed(
            val message: String,
        ) : Phase
    }

    private val client = backend.pixartClient(contextId)
    private val _phase = MutableStateFlow<Phase>(Phase.Loading)
    val phase: StateFlow<Phase> = _phase.asStateFlow()
    private val _document = MutableStateFlow<DocumentInfo?>(null)
    val document: StateFlow<DocumentInfo?> = _document.asStateFlow()
    private val _layers = MutableStateFlow<List<Layer>>(emptyList())
    val layers: StateFlow<List<Layer>> = _layers.asStateFlow()

    /** This phone's own show/hide choices, by layer id. Never written to the contract. */
    private val _overrides = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val overrides: StateFlow<Map<String, Boolean>> = _overrides.asStateFlow()

    /** The composite at view resolution. */
    private val _image = MutableStateFlow<Raster?>(null)
    val image: StateFlow<Raster?> = _image.asStateFlow()
    private val _rendering = MutableStateFlow(false)
    val rendering: StateFlow<Boolean> = _rendering.asStateFlow()

    /** Layers whose pixels could not be read. */
    private val _missing = MutableStateFlow(0)
    val missing: StateFlow<Int> = _missing.asStateFlow()
    private val _members = MutableStateFlow<List<Member>>(emptyList())
    val members: StateFlow<List<Member>> = _members.asStateFlow()
    private val _role = MutableStateFlow<String?>(null)
    val role: StateFlow<String?> = _role.asStateFlow()
    private val _name = MutableStateFlow(name)
    val name: StateFlow<String> = _name.asStateFlow()

    private val images = HashMap<String, Raster>()
    private var renderToken = 0
    private var refreshing = false
    private var dirty = false

    val shareLink: String get() = PixartFormat.projectLink(teamId, contextId)
    val account: String get() = backend.account

    fun rows(
        layers: List<Layer> = _layers.value,
        overrides: Map<String, Boolean> = _overrides.value,
    ): List<LayerRow> = LayerTree.rows(layers, overrides)

    /** Join the project's context when this account is not in it yet (an open subgroup of the team), then read and draw it. */
    suspend fun open() {
        _phase.value = Phase.Loading
        if (attempt { backend.isMember(contextId) }.getOrNull() == false) {
            attempt { backend.joinContext(contextId) }.onFailure {
                _phase.value = Phase.Failed("Couldn't join this project: ${PixartFormat.errorText(it)}")
                return
            }
        }
        attempt { read() }.onFailure {
            _phase.value = Phase.Failed(PixartFormat.errorText(it))
            return
        }
        _phase.value = Phase.Ready
        render()
        readRest()
    }

    /** Re-read, coalescing bursts of events into one read at a time. */
    suspend fun refresh() {
        if (refreshing) {
            dirty = true
            return
        }
        refreshing = true
        try {
            do {
                dirty = false
                attempt { read() }
                    .onSuccess { changed ->
                        if (changed) render()
                        if (_phase.value != Phase.Ready) _phase.value = Phase.Ready
                    }.onFailure { if (_document.value == null) _phase.value = Phase.Failed(PixartFormat.errorText(it)) }
                readRest()
            } while (dirty)
        } finally {
            refreshing = false
        }
    }

    /** Follow the project until cancelled: the relay's events when it streams them, polling otherwise (and after a stream ends). */
    suspend fun live() {
        if (backend.canSubscribe) {
            attempt { backend.events(contextId).collect { refresh() } }
        }
        while (currentCoroutineContext().isActive) {
            delay(POLL_MS)
            refresh()
        }
    }

    /** Show or hide a layer on this phone only. */
    suspend fun toggle(layerId: String) {
        val layer = _layers.value.firstOrNull { it.id == layerId } ?: return
        val next = !LayerStack.visible(layer, _overrides.value)
        _overrides.update { if (next == layer.visible) it - layerId else it + (layerId to next) }
        render()
    }

    /** Back to the document's own visibility. */
    suspend fun resetVisibility() {
        if (_overrides.value.isEmpty()) return
        _overrides.value = emptyMap()
        render()
    }

    /** The composite as PNG at full size (capped), as this phone shows it. */
    suspend fun exportPng(): ByteArray? {
        val doc = _document.value ?: return null
        val ops = LayerStack.drawOps(_layers.value, _overrides.value)
        val snapshot = HashMap(images)
        val scale = min(1.0, EXPORT_SIDE / max(1u, max(doc.width, doc.height)).toDouble())
        return withContext(compute) {
            rasterizer.composite(doc.width.toInt(), doc.height.toInt(), doc.background, ops, snapshot, scale)?.let(rasterizer::png)
        }
    }

    /** A display name for a member id: their roster name, else a short id. */
    fun nameFor(member: String): String =
        _members.value
            .firstOrNull { it.id == member }
            ?.username
            ?.trim()
            ?.takeIf { it.isNotEmpty() } ?: PixartFormat.shortId(member)

    /** Read the document and layers; true when either changed. */
    private suspend fun read(): Boolean {
        val (d, l) =
            coroutineScope {
                val doc = async { client.getDocument() }
                val list = async { client.getLayers() }
                doc.await() to list.await()
            }
        val changed = d != _document.value || l != _layers.value
        _document.value = d
        _layers.value = l
        d.name
            .trim()
            .takeIf { it.isNotEmpty() }
            ?.let { _name.value = it }
        val ids = l.map { it.id }.toSet()
        _overrides.update { o -> o.filterKeys { it in ids } }
        return changed
    }

    private suspend fun readRest() {
        attempt { client.getMembers() }.getOrNull()?.let { _members.value = it }
        attempt { client.myRole() }.getOrNull()?.let { _role.value = it }
    }

    private suspend fun render() {
        val doc = _document.value ?: return
        val token = ++renderToken
        _rendering.value = true
        val ops = LayerStack.drawOps(_layers.value, _overrides.value)
        val need = LayerStack.blobIds(ops).filter { it !in images }
        if (need.isNotEmpty()) images.putAll(blobs.bitmaps(need, contextId))
        _missing.value = LayerStack.blobIds(ops).count { it !in images }
        val snapshot = HashMap(images)
        val scale = min(1.0, VIEW_SIDE / max(1u, max(doc.width, doc.height)).toDouble())
        val out =
            withContext(compute) {
                rasterizer.composite(doc.width.toInt(), doc.height.toInt(), doc.background, ops, snapshot, scale)
            }
        if (token != renderToken) return
        _image.value = out
        _rendering.value = false
    }

    companion object {
        /** The composite shown on screen is at most this many pixels on its longest side. */
        const val VIEW_SIDE = 3072.0

        /** An export is at most this many. */
        const val EXPORT_SIDE = 8192.0

        /** How often to re-read when the relay cannot stream events. */
        const val POLL_MS = 5_000L
    }
}

// endregion
