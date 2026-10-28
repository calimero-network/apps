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

/** A world to open: its context, the namespace it is the only world of, and its open subgroup. */
data class WorldRef(
    val contextId: String,
    val namespaceId: String,
    val groupId: String?,
    val name: String,
)

/** One row of the world list. */
data class WorldEntry(
    val ref: WorldRef,
    /** Players online now, once read (`get_players`). */
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
 * The web app's model (`app/src/net/admin.ts` `createWorld`): every world is its OWN namespace,
 * named after the world, with one open subgroup and the world's context in it. Invitations are
 * namespace invitations, so one link admits to exactly one world, and the open subgroup lets the
 * invitee join the context by inheritance.
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

    /** The worlds in one namespace: the context of each subgroup, else any in its root (a curb-style namespace). */
    private suspend fun refs(namespace: AppNamespace): List<WorldRef> {
        val out =
            backend.listSubgroups(namespace.id).flatMap { subgroup ->
                val name = subgroup.name ?: namespace.name ?: BlocksConstants.DEFAULT_WORLD_NAME
                subgroup.contextIds.map { WorldRef(it, namespace.id, subgroup.groupId, name) }
            }
        if (out.isNotEmpty()) return out
        return backend.listContexts(namespace.id).map {
            WorldRef(it, namespace.id, null, namespace.name ?: BlocksConstants.DEFAULT_WORLD_NAME)
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
                            val client = BlocksClient(backend.contract.bound(ref.contextId))
                            ref.contextId to runCatching { client.getPlayers(nowSeconds()).count { it.online } }.getOrNull()
                        }
                    }.awaitAll()
            }.toMap()
        _state.update { s -> s.copy(worlds = s.worlds.map { e -> counts[e.id]?.let { e.copy(online = it) } ?: e }) }
    }

    /** A new world: its own namespace, an open subgroup, and the context with the contract's `init` arguments. */
    suspend fun create(
        rawName: String,
        seed: ULong?,
    ): WorldRef {
        if (!backend.hasRelay) throw BlocksException(BlocksException.Kind.NO_RELAY)
        val appId = applicationId?.takeIf { it.isNotEmpty() } ?: throw BlocksException(BlocksException.Kind.NO_APPLICATION)
        val name = BlocksText.worldName(rawName)
        val chosen = seed ?: BlocksConstants.SEED_RANGE.random()
        val founded = backend.foundNamespace(name)
        val groupId = backend.createSubgroup(founded.namespaceId, name, isPublic = true)
        val contextId =
            backend.createContext(
                groupId,
                appId,
                name,
                buildJsonObject {
                    put("name", name)
                    put("seed", chosen.toLong())
                    put("now", nowSeconds().toLong())
                },
            )
        val ref = WorldRef(contextId, founded.namespaceId, groupId, name)
        _state.update { s ->
            s.copy(
                worlds = listOf(WorldEntry(ref, 0)) + s.worlds,
                notice =
                    if (founded.haEnabled) {
                        s.notice
                    } else {
                        "The cloud is not hosting this world yet${founded.haError?.let { " ($it)" }.orEmpty()}. " +
                            "You can play, but friends may not be able to join while you are offline."
                    },
            )
        }
        return ref
    }

    /**
     * Redeem an invitation: join the world's namespace. [didJoin] runs after (the session reconnects
     * to the admitting relay there when the account had none). The world's context is joined when it
     * is opened ([GameModel.prepare]).
     */
    suspend fun join(
        invitation: BlocksInvitation,
        didJoin: suspend () -> Unit,
    ): WorldRef {
        val namespaceId = invitation.namespaceId
        backend.joinNamespace(namespaceId, invitation.invitation)
        didJoin()
        val name = invitation.name ?: BlocksConstants.DEFAULT_WORLD_NAME
        invitation.contextId?.let { return WorldRef(it, namespaceId, invitation.groupId, name) }
        // A link without a pinned world: the namespace's first.
        return refs(AppNamespace(namespaceId, invitation.name, applicationId.orEmpty())).firstOrNull()
            ?: throw BlocksException(BlocksException.Kind.NO_WORLD_IN_INVITATION)
    }

    /** A link that admits someone to [ref]'s world. */
    suspend fun inviteLink(ref: WorldRef): String {
        val signed = backend.createInvitation(ref.namespaceId)
        return BlocksInvitation(signed, ref.name, ref.contextId, ref.groupId).link()
    }

    /** Leave a world: leave its namespace, which is that world alone. */
    suspend fun leave(ref: WorldRef) {
        backend.leaveNamespace(ref.namespaceId)
        _state.update { s -> s.copy(worlds = s.worlds.filterNot { it.id == ref.contextId }) }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun dismissNotice() = _state.update { it.copy(notice = null) }
}
