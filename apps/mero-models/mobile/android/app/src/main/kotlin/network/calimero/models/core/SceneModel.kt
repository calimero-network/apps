package network.calimero.models.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import network.calimero.models.generated.Environment
import network.calimero.models.generated.LockView
import network.calimero.models.generated.MemberView
import network.calimero.models.generated.MeshRef
import network.calimero.models.generated.SceneInfo
import network.calimero.models.generated.SceneObject
import network.calimero.models.generated.TextureRef
import java.util.concurrent.ConcurrentHashMap

/** One row of the outliner: an object at its depth in the hierarchy. */
data class OutlineRow(
    val obj: SceneObject,
    val depth: Int,
    /** The live check-out on it, if any. */
    val lock: LockView?,
) {
    val id: String get() = obj.id
}

/** A live check-out, ready to show. */
data class CheckOut(
    val assetId: String,
    /** The object's or texture's name, or a short id when it is gone. */
    val assetName: String,
    /** The kind for an object (`cube`, `mesh`…), `texture` for a texture. */
    val assetKind: String,
    val holder: String,
    val holderName: String,
    val mine: Boolean,
    val since: Long,
    val expiresAt: Long,
)

/** What the viewport draws: the scene exactly as the contract returns it, in the web app's field names. */
@Serializable
data class ViewerScene(
    val environment: Environment,
    val objects: List<SceneObject>,
    val meshes: List<MeshRef>,
    val textures: List<TextureRef>,
)

/**
 * One open scene, read-only: objects, check-outs, members, and the bytes the viewport asks for.
 * (Swift `SceneModel`.)
 */
@Suppress("TooManyFunctions")
class SceneModel(
    private val backend: MeroAppBackend,
    val studioId: String,
    val contextId: String,
    name: String = "",
    private val blobs: BlobLoading = NoBlobs,
    private val now: () -> Long = System::currentTimeMillis,
) {
    sealed class Phase {
        data object Loading : Phase()

        data object Ready : Phase()

        data class Failed(
            val message: String,
        ) : Phase()
    }

    private val client = backend.modelsClient(contextId)
    private val _phase = MutableStateFlow<Phase>(Phase.Loading)
    val phase: StateFlow<Phase> = _phase.asStateFlow()
    private val _name = MutableStateFlow(name)
    val name: StateFlow<String> = _name.asStateFlow()
    private val _info = MutableStateFlow<SceneInfo?>(null)
    val info: StateFlow<SceneInfo?> = _info.asStateFlow()
    private val _objects = MutableStateFlow<List<SceneObject>>(emptyList())
    val objects: StateFlow<List<SceneObject>> = _objects.asStateFlow()
    private val _meshes = MutableStateFlow<List<MeshRef>>(emptyList())
    val meshes: StateFlow<List<MeshRef>> = _meshes.asStateFlow()
    private val _textures = MutableStateFlow<List<TextureRef>>(emptyList())
    val textures: StateFlow<List<TextureRef>> = _textures.asStateFlow()
    private val _locks = MutableStateFlow<List<LockView>>(emptyList())
    val locks: StateFlow<List<LockView>> = _locks.asStateFlow()
    private val _members = MutableStateFlow<List<MemberView>>(emptyList())
    val members: StateFlow<List<MemberView>> = _members.asStateFlow()

    /** What the viewport should draw; moves only when the scene changed. */
    private val _viewerScene = MutableStateFlow<ViewerScene?>(null)
    val viewerScene: StateFlow<ViewerScene?> = _viewerScene.asStateFlow()
    private val _selectedId = MutableStateFlow<String?>(null)
    val selectedId: StateFlow<String?> = _selectedId.asStateFlow()

    private val blobCache = ConcurrentHashMap<String, ByteArray>()
    private val blobLoads = ConcurrentHashMap<String, CompletableDeferred<ByteArray?>>()
    private var refreshing = false
    private var dirty = false

    val account: String get() = backend.account
    val role: String? get() = _info.value?.myRole
    val totalTriangles: Long get() = _meshes.value.sumOf { it.triangleCount.toLong() }

    fun select(id: String?) {
        _selectedId.value = id
    }

    /** Open the scene: join its context when this account is not in it yet, then read everything. */
    suspend fun open() {
        _phase.value = Phase.Loading
        if (attempt { backend.isMember(contextId) }.getOrNull() == false) {
            // A scene in the studio's root follows the studio's membership; a failed join is not
            // fatal, the read below says whether it worked.
            attempt { backend.joinContext(contextId) }
        }
        attempt { load() }
            .onSuccess { _phase.value = Phase.Ready }
            .onFailure { _phase.value = Phase.Failed(ModelsFormat.errorText(it)) }
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
                attempt { load() }
                    .onSuccess { if (_phase.value != Phase.Ready) _phase.value = Phase.Ready }
                    .onFailure { if (_phase.value != Phase.Ready) _phase.value = Phase.Failed(ModelsFormat.errorText(it)) }
            } while (dirty)
        } finally {
            refreshing = false
        }
    }

    /** Follow the scene until cancelled: the relay's events when it streams them, polling otherwise. */
    suspend fun live() {
        if (backend.canSubscribe) {
            attempt { backend.events(contextId).collect { refresh() } }
        }
        while (currentCoroutineContext().isActive) {
            delay(POLL_INTERVAL_MS)
            refresh()
        }
    }

    private suspend fun load() =
        coroutineScope {
            val at = now()
            val scene = async { client.getScene() }
            val objects = async { client.getObjects() }
            val meshes = async { client.listMeshes() }
            val textures = async { client.listTextures() }
            val locks = async { attempt { client.listLocks(at.toULong()) }.getOrNull() }
            val members = async { attempt { client.getMembers() }.getOrNull() }
            val info = scene.await()
            val objs = objects.await()
            val refs = meshes.await()
            val texs = textures.await()
            _info.value = info
            info.name
                .trim()
                .takeIf { it.isNotEmpty() }
                ?.let { _name.value = it }
            _objects.value = objs
            _meshes.value = refs
            _textures.value = texs
            locks.await()?.let { list -> _locks.value = list.filter { it.expiresAt.toLong() > at } }
            members.await()?.let { _members.value = it }
            val next = ViewerScene(info.environment, objs, refs, texs)
            if (next != _viewerScene.value) _viewerScene.value = next
            _selectedId.value?.let { id -> if (objs.none { it.id == id }) _selectedId.value = null }
        }

    /**
     * The hierarchy, depth first, siblings in creation order (the web's outliner). A missing parent
     * or a loop reads as a root, as the contract says.
     */
    fun outline(): List<OutlineRow> {
        val objects = _objects.value
        val byId = objects.associateBy { it.id }

        fun resolvedParent(o: SceneObject): String {
            val seen = mutableSetOf(o.id)
            var at = o.parent
            while (at.isNotEmpty()) {
                val p = byId[at] ?: return ""
                if (!seen.add(at)) return ""
                at = p.parent
            }
            return o.parent
        }
        val children =
            objects
                .groupBy { resolvedParent(it) }
                .mapValues { (_, list) -> list.sortedWith(compareBy<SceneObject> { it.createdAt }.thenBy { it.id }) }
        val lockById = _locks.value.associateBy { it.assetId }
        val rows = mutableListOf<OutlineRow>()

        fun walk(
            parent: String,
            depth: Int,
        ) {
            for (o in children[parent].orEmpty()) {
                rows += OutlineRow(o, depth, lockById[o.id])
                walk(o.id, depth + 1)
            }
        }
        walk("", 0)
        return rows
    }

    /** Live check-outs, newest first. */
    fun checkOuts(): List<CheckOut> =
        _locks.value
            .sortedWith(compareByDescending<LockView> { it.since }.thenByDescending { it.assetId })
            .map { l ->
                val obj = _objects.value.firstOrNull { it.id == l.assetId }
                val texture = _textures.value.firstOrNull { it.id == l.assetId }
                CheckOut(
                    assetId = l.assetId,
                    assetName = obj?.name ?: texture?.name ?: ModelsFormat.shortId(l.assetId),
                    assetKind = obj?.kind ?: if (texture != null) "texture" else "object",
                    holder = l.holder,
                    holderName = if (l.mine) "You" else nameFor(l.holder),
                    mine = l.mine,
                    since = l.since.toLong(),
                    expiresAt = l.expiresAt.toLong(),
                )
            }

    fun selected(): SceneObject? = _selectedId.value?.let { id -> _objects.value.firstOrNull { it.id == id } }

    fun mesh(id: String): MeshRef? = _meshes.value.firstOrNull { it.id == id }

    fun lock(id: String): LockView? = _locks.value.firstOrNull { it.assetId == id }

    /** A member's scene name, else a short form of their id. */
    fun nameFor(member: String): String =
        _members.value
            .firstOrNull { it.id == member }
            ?.let { ModelsFormat.chosenName(it.name) } ?: ModelsFormat.shortId(member)

    /** The viewport's scene as the JSON it reads. */
    fun viewerJson(): String? = _viewerScene.value?.let { json.encodeToString(ViewerScene.serializer(), it) }

    /** A link to this scene: an invitation to its studio that opens it. */
    suspend fun shareLink(): String = ModelsInvitation.mint(backend, studioId, contextId)

    /**
     * A blob's bytes for the viewport, read once and kept (a blob id is the hash of its bytes, so it
     * never changes). Null when it cannot be read.
     */
    suspend fun blob(id: String): ByteArray? {
        blobCache[id]?.let { return it }
        val mine = CompletableDeferred<ByteArray?>()
        val running = blobLoads.putIfAbsent(id, mine)
        if (running != null) return running.await()
        val data = attempt { blobs.blob(id, contextId) }.getOrNull()
        if (data != null) blobCache[id] = data
        blobLoads.remove(id)
        mine.complete(data)
        return data
    }

    companion object {
        /** How often to re-read when the relay cannot stream events (the web's poll). */
        const val POLL_INTERVAL_MS = 5_000L
        private val json = Json { encodeDefaults = true }
    }
}
