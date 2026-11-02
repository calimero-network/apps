package network.calimero.merraria.app

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject

/** A world to open: its app instance, and where it lives. */
data class WorldRef(
    val contextId: String,
    val namespaceId: String,
    /** The team the world is in (null for a world directly in its organization, as new ones are). */
    val groupId: String?,
    val name: String,
)

/** One row of the world list. */
data class WorldEntry(
    val ref: WorldRef,
    val players: Int,
) {
    val id: String get() = ref.contextId
}

data class WorldsState(
    val worlds: List<WorldEntry> = emptyList(),
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
)

/**
 * The worlds: every world this account is in, and creating, joining and inviting to them.
 * (Swift `WorldsModel`.)
 *
 * As on the web (`app/src/net/worlds.ts`), a world is an app instance in an organization of its own,
 * named after it: one organization per world keeps an invitation's scope to exactly one world.
 * Worlds an earlier build put in an open team of their organization are still listed and opened.
 */
class WorldsModel(
    private val backend: MeroAppBackend,
    private val applicationId: String?,
) {
    private val _state = MutableStateFlow(WorldsState())
    val state: StateFlow<WorldsState> = _state.asStateFlow()

    val hasRelay: Boolean get() = backend.hasRelay

    suspend fun load() {
        if (!backend.hasRelay) {
            _state.update { it.copy(worlds = emptyList(), loaded = true) }
            return
        }
        _state.update { it.copy(loading = true) }
        try {
            val entries = backend.listNamespaces().flatMap { worldsIn(it) }
            _state.update { it.copy(worlds = entries, error = null, loading = false, loaded = true) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(error = MerrariaText.error(e), loading = false, loaded = true) }
        }
    }

    /** The worlds in one organization: its teams' app instances, then any directly in it. */
    private suspend fun worldsIn(namespace: AppNamespace): List<WorldEntry> {
        val name = namespace.name?.trim()?.takeIf { it.isNotEmpty() }
        val seen = mutableSetOf<String>()
        val entries = mutableListOf<WorldEntry>()
        for (subgroup in backend.listSubgroups(namespace.id)) {
            val title = name ?: subgroup.name?.takeIf { it.isNotEmpty() } ?: MerrariaConstants.DEFAULT_WORLD_NAME
            subgroup.contextIds.filter { seen.add(it) }.forEach { contextId ->
                entries += WorldEntry(WorldRef(contextId, namespace.id, subgroup.groupId, title), namespace.memberCount)
            }
        }
        backend.listContexts(namespace.id).filter { seen.add(it) }.forEach { contextId ->
            entries += WorldEntry(WorldRef(contextId, namespace.id, null, name ?: MerrariaConstants.DEFAULT_WORLD_NAME), namespace.memberCount)
        }
        return entries
    }

    /**
     * A new world, as the web app makes one: its organization, the app instance in it (the
     * contract's `init()` takes nothing), then `createWorld(name, seed, now)`, which only the
     * creator may run.
     */
    suspend fun create(
        name: String,
        seed: UInt,
    ): WorldRef {
        if (!backend.hasRelay) throw MerrariaException(MerrariaException.Kind.SIGNED_OUT)
        if (applicationId.isNullOrEmpty()) throw MerrariaException(MerrariaException.Kind.NO_APPLICATION)
        val title = name.trim().ifEmpty { MerrariaConstants.DEFAULT_WORLD_NAME }.take(MerrariaConstants.MAX_WORLD_NAME)
        val namespaceId = backend.foundNamespace(title).namespaceId
        val contextId = backend.createContext(namespaceId, applicationId, title, JsonObject(emptyMap()))
        backend.merraria(contextId).createWorld(title, seed, nowSeconds())
        val ref = WorldRef(contextId, namespaceId, null, title)
        _state.update { it.copy(worlds = listOf(WorldEntry(ref, 1)) + it.worlds) }
        return ref
    }

    /**
     * Redeem an invitation: redeem its token (joining the organization), then enter the world.
     * [didJoin] runs in between (the session re-reads what the account sees).
     */
    suspend fun join(
        invitation: WorldInvitation,
        didJoin: suspend () -> Unit,
    ): WorldRef {
        val namespaceId = invitation.namespaceId
        backend.joinNamespace(namespaceId, invitation.invitation)
        didJoin()
        var contextId = invitation.contextId
        var groupId = invitation.groupId
        if (contextId == null) {
            val first = backend.listSubgroups(namespaceId).firstOrNull { it.contextIds.isNotEmpty() }
            if (first != null) {
                contextId = first.contextIds.first()
                groupId = first.groupId
            } else {
                contextId = backend.listContexts(namespaceId).firstOrNull()
            }
        }
        if (contextId == null) throw MerrariaException(MerrariaException.Kind.NO_WORLD)
        ensureMember(contextId)
        return WorldRef(contextId, namespaceId, groupId, invitation.worldName ?: MerrariaConstants.DEFAULT_WORLD_NAME)
    }

    /** Make sure this account reaches the world's app instance (an invited player inherits it through the organization). */
    suspend fun ensureMember(contextId: String) {
        if (backend.isMember(contextId)) return
        backend.joinContext(contextId)
    }

    /** A link that admits someone to [ref]'s organization and opens that world. */
    suspend fun inviteLink(ref: WorldRef): String = inviteLink(backend, ref)

    fun dismissError() = _state.update { it.copy(error = null) }

    companion object {
        suspend fun inviteLink(
            backend: MeroAppBackend,
            ref: WorldRef,
        ): String {
            val minted = backend.createInvitation(ref.namespaceId)
            return WorldInvitation.of(minted, ref.name, ref.contextId, ref.groupId).link()
        }
    }
}
