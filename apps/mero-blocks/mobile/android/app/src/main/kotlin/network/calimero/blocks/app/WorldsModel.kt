package network.calimero.blocks.app

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.blocks.generated.BlocksClient

/**
 * A world to open: its app instance and the organization it is the only world of. `groupId` is kept
 * for links from the earlier 1.0 build (a world's team); new worlds have none.
 */
data class WorldRef(
    val contextId: String,
    val namespaceId: String,
    val groupId: String?,
    val name: String,
)

/** One row of the world list. */
data class WorldEntry(
    val ref: WorldRef,
    /** Players online now, once read (`getPlayers`). */
    val online: Int? = null,
) {
    val id: String get() = ref.contextId
}

data class WorldsState(
    val worlds: List<WorldEntry> = emptyList(),
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
    /** Said once after creating a world the cloud would not host. */
    val notice: String? = null,
)

/**
 * The worlds this account is in, and making, joining, sharing and leaving them. (Swift `WorldsModel`.)
 *
 * The web app's model (`app/src/net/worlds.ts` `createWorld`): every world is its OWN organization,
 * named after the world, with the world's app instance in it. Invitations are org invites, so one
 * link admits to exactly one world, and the org grants its app instance.
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
            val known = _state.value.worlds.associate { it.id to it.online }
            val entries = backend.listNamespaces().flatMap { ns -> refs(ns).map { WorldEntry(it, known[it.contextId]) } }
            _state.update { it.copy(worlds = entries, error = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            _state.update { it.copy(error = BlocksText.error(e), loading = false, loaded = true) }
            return
        }
        loadOnline()
        _state.update { it.copy(loading = false, loaded = true) }
    }

    /** The worlds in one organization: its app instances (the web's), else those in its teams (worlds the earlier 1.0 build made). */
    private suspend fun refs(namespace: AppNamespace): List<WorldRef> {
        val fallback = namespace.name ?: BlocksConstants.DEFAULT_WORLD_NAME
        val out = backend.listContextEntries(namespace.id).map { WorldRef(it.id, namespace.id, null, it.name ?: fallback) }
        if (out.isNotEmpty()) return out
        return backend.listSubgroups(namespace.id).flatMap { subgroup ->
            subgroup.contextIds.map { WorldRef(it, namespace.id, subgroup.groupId, subgroup.name ?: fallback) }
        }
    }

    /** Who is playing in each world. Best-effort: a world that cannot be read yet keeps its row. */
    private suspend fun loadOnline() {
        val refs = _state.value.worlds.map { it.ref }
        val counts =
            coroutineScope {
                refs
                    .map { ref ->
                        async {
                            val client = BlocksClient(backend, ref.contextId)
                            ref.contextId to runCatching { client.allPlayers(nowSeconds()).count { it.online } }.getOrNull()
                        }
                    }.awaitAll()
            }.toMap()
        _state.update { s -> s.copy(worlds = s.worlds.map { e -> counts[e.id]?.let { e.copy(online = it) } ?: e }) }
    }

    /**
     * A new world: its own organization and the app instance in it, with the contract's `init`
     * arguments (`name`, `seed`, `now`; u64 as decimal strings), as the web's `createWorld`.
     */
    suspend fun create(
        rawName: String,
        seed: ULong?,
    ): WorldRef {
        if (!backend.hasRelay) throw BlocksException(BlocksException.Kind.NO_RELAY)
        val appId = applicationId?.takeIf { it.isNotEmpty() } ?: throw BlocksException(BlocksException.Kind.NO_APPLICATION)
        val name = BlocksText.worldName(rawName)
        val chosen = seed ?: BlocksConstants.SEED_RANGE.random()
        val founded = backend.foundNamespace(name)
        val contextId =
            backend.createContext(
                founded.namespaceId,
                appId,
                name,
                buildJsonObject {
                    put("name", name)
                    put("seed", (chosen % 4_294_967_296uL).toString())
                    put("now", nowSeconds().toString())
                },
            )
        val ref = WorldRef(contextId, founded.namespaceId, null, name)
        _state.update { s -> s.copy(worlds = listOf(WorldEntry(ref, 0)) + s.worlds) }
        return ref
    }

    /**
     * Redeem an invitation: redeem its token, joining the world's organization. [didJoin] runs after
     * (the session re-reads what the account sees). The world's app instance is entered when it is
     * opened ([GameModel.prepare]).
     */
    suspend fun join(
        invitation: BlocksInvitation,
        didJoin: suspend () -> Unit,
    ): WorldRef {
        val joined = backend.joinNamespace(invitation.namespaceId, invitation.invitation)
        // The node names the organization the token opened (a web link carries none).
        val namespaceId = joined.namespaceId.ifEmpty { invitation.namespaceId }
        didJoin()
        val name = invitation.name ?: BlocksConstants.DEFAULT_WORLD_NAME
        invitation.contextId?.let { return WorldRef(it, namespaceId, invitation.groupId, name) }
        // A link without a pinned world: the namespace's first.
        return refs(AppNamespace(namespaceId, invitation.name, applicationId.orEmpty())).firstOrNull()
            ?: throw BlocksException(BlocksException.Kind.NO_WORLD_IN_INVITATION)
    }

    /** A link that admits someone to [ref]'s world. Minting it asks for the passkey (the node's step-up). */
    suspend fun inviteLink(ref: WorldRef): String {
        val minted = backend.createInvitation(ref.namespaceId)
        return BlocksInvitation(minted, ref.name, ref.contextId, ref.groupId).link()
    }

    /** Leave a world: leave its organization, which is that world alone. */
    suspend fun leave(ref: WorldRef) {
        backend.leaveNamespace(ref.namespaceId)
        _state.update { s -> s.copy(worlds = s.worlds.filterNot { it.id == ref.contextId }) }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun dismissNotice() = _state.update { it.copy(notice = null) }
}
