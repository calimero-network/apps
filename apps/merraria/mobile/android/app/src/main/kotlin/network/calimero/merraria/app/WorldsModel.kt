package network.calimero.merraria.app

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** A world to open: its context, and where it lives. */
data class WorldRef(
    val contextId: String,
    val namespaceId: String,
    /** The open subgroup the world is in (null for a world directly in its namespace). */
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
 * As on the web (`app/src/net/admin.ts`), a world is its own namespace named after it, an open
 * subgroup inside that, and the context (the world state) in the subgroup. One namespace per world
 * keeps an invitation's scope to exactly one world, and the subgroup being open is what lets an
 * invited player join it.
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

    /** The worlds in one namespace: its subgroups' contexts, then any directly in it. */
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

    /** A new world: its namespace, its open subgroup, and the context, initialised with `{name, seed, now}` (the contract's `init`). */
    suspend fun create(
        name: String,
        seed: ULong,
    ): WorldRef {
        if (!backend.hasRelay) throw MerrariaException(MerrariaException.Kind.NO_RELAY)
        if (applicationId.isNullOrEmpty()) throw MerrariaException(MerrariaException.Kind.NO_APPLICATION)
        val title = name.trim().ifEmpty { MerrariaConstants.DEFAULT_WORLD_NAME }.take(MerrariaConstants.MAX_WORLD_NAME)
        val namespaceId = backend.foundNamespace(title).namespaceId
        val groupId = backend.createSubgroup(namespaceId, title, isPublic = true)
        val initArgs =
            buildJsonObject {
                put("name", JsonPrimitive(title))
                put("seed", JsonPrimitive(seed.toLong()))
                put("now", JsonPrimitive(nowSeconds().toLong()))
            }
        val contextId = backend.createContext(groupId, applicationId, title, initArgs)
        val ref = WorldRef(contextId, namespaceId, groupId, title)
        _state.update { it.copy(worlds = listOf(WorldEntry(ref, 1)) + it.worlds) }
        return ref
    }

    /**
     * Redeem an invitation: join the namespace, then the world (its open subgroup's context).
     * [didJoin] runs in between (the session reconnects to the admitting relay there when the account
     * had none).
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

    /** Join the world's context if this account is not in it yet (an invited player joins it through the open subgroup). */
    suspend fun ensureMember(contextId: String) {
        if (backend.isMember(contextId)) return
        backend.joinContext(contextId)
    }

    /** A link that admits someone to [ref]'s namespace and opens that world. */
    suspend fun inviteLink(ref: WorldRef): String = inviteLink(backend, ref)

    fun dismissError() = _state.update { it.copy(error = null) }

    companion object {
        suspend fun inviteLink(
            backend: MeroAppBackend,
            ref: WorldRef,
        ): String {
            val signed = backend.createInvitation(ref.namespaceId)
            return WorldInvitation(signed, ref.name, ref.contextId, ref.groupId).link()
        }
    }
}
