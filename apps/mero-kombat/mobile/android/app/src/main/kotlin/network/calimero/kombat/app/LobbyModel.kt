package network.calimero.kombat.app

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
import network.calimero.kombat.generated.ArenaView

/** An arena to open: its context and the namespace it lives in. */
data class ArenaRef(
    val contextId: String,
    val namespaceId: String?,
)

/** What the lobby row says about an arena, from one `arena()` read. (Swift `ArenaSummary`.) */
data class ArenaSummary(
    val title: String,
    val players: String,
    val state: String,
    /** This account holds a corner here. */
    val mine: Boolean,
    /** A fight is under way. */
    val live: Boolean,
    /** Fighters for the row's two badges, p1 then p2 ("" for an open corner). */
    val fighters: List<String>,
    val totalActions: ULong,
) {
    companion object {
        fun of(view: ArenaView): ArenaSummary {
            val winner = KombatText.winner(view.winner, view)
            return ArenaSummary(
                title = view.title.ifEmpty { KombatConstants.DEFAULT_TITLE },
                players = KombatText.players(view),
                state =
                    when (view.status) {
                        "waiting" -> "Waiting for fighters"
                        "finished" -> winner.ifEmpty { "Match over" }
                        else -> "Round ${view.round + 1u}"
                    },
                mine = view.mySeat.isNotEmpty(),
                live = view.status == "fighting",
                fighters =
                    listOf(
                        if (view.p1.member.isEmpty()) "" else view.p1.fighter,
                        if (view.p2.member.isEmpty()) "" else view.p2.fighter,
                    ),
                totalActions = view.totalActions,
            )
        }
    }
}

/** One row of the lobby. */
data class ArenaEntry(
    val ref: ArenaRef,
    val namespaceName: String?,
    val summary: ArenaSummary? = null,
) {
    val id: String get() = ref.contextId
}

data class LobbyState(
    val arenas: List<ArenaEntry> = emptyList(),
    val namespaces: List<AppNamespace> = emptyList(),
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
)

/**
 * The lobby: every arena in every namespace this account belongs to, and making and joining arenas.
 * (Swift `LobbyModel`.)
 *
 * An arena is one context created directly in its namespace, exactly as the web app's
 * `ContextPicker` does, so the namespace invitation an arena mints is the one that admits to it.
 */
class LobbyModel(
    private val backend: MeroAppBackend,
    private val applicationId: String?,
) {
    private val _state = MutableStateFlow(LobbyState())
    val state: StateFlow<LobbyState> = _state.asStateFlow()

    val hasRelay: Boolean get() = backend.hasRelay

    suspend fun load() {
        if (!backend.hasRelay) {
            _state.update { it.copy(arenas = emptyList(), namespaces = emptyList(), loaded = true) }
            return
        }
        _state.update { it.copy(loading = true) }
        try {
            val namespaces = backend.listNamespaces()
            val known = _state.value.arenas.associate { it.id to it.summary }
            val entries =
                namespaces.flatMap { namespace ->
                    backend.listContexts(namespace.id).map { contextId ->
                        ArenaEntry(ArenaRef(contextId, namespace.id), namespace.name, known[contextId])
                    }
                }
            _state.update { it.copy(namespaces = namespaces, arenas = entries, error = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(error = KombatText.error(e), loading = false, loaded = true) }
            return
        }
        loadSummaries()
        _state.update { it.copy(loading = false, loaded = true) }
    }

    /** Each row's title, corners and state. Best-effort: an arena still syncing keeps a plain row. */
    private suspend fun loadSummaries() {
        val refs = _state.value.arenas.map { it.ref }
        val summaries =
            coroutineScope {
                refs
                    .map { ref ->
                        async {
                            ref.contextId to runCatching { ArenaSummary.of(kombatClient(backend, ref.contextId).arena(nowMillis())) }.getOrNull()
                        }
                    }.awaitAll()
                    .toMap()
            }
        _state.update { state -> state.copy(arenas = state.arenas.map { entry -> summaries[entry.id]?.let { entry.copy(summary = it) } ?: entry }) }
    }

    /** A new arena: in [namespaceId], or in a new namespace named after the arena when null. */
    suspend fun create(
        title: String,
        namespaceId: String?,
    ): ArenaRef {
        if (!backend.hasRelay) throw KombatException(KombatException.Kind.NO_RELAY)
        val applicationId = applicationId?.takeIf { it.isNotEmpty() } ?: throw KombatException(KombatException.Kind.NO_APPLICATION)
        val name = title.trim().take(64).ifEmpty { KombatConstants.DEFAULT_TITLE }
        val target = namespaceId ?: backend.foundNamespace(name).namespaceId
        // The contract's `init(title, now)`, as the web app's `arenaInit()` sends it.
        val initArgs =
            buildJsonObject {
                put("title", name)
                put("now", nowMillis().toLong())
            }
        val contextId = backend.createContext(target, applicationId, name, initArgs)
        val ref = ArenaRef(contextId, target)
        val namespaceName =
            _state.value.namespaces
                .firstOrNull { it.id == target }
                ?.name ?: name
        _state.update { it.copy(arenas = listOf(ArenaEntry(ref, namespaceName)) + it.arenas) }
        return ref
    }

    /**
     * Redeem an invitation: join its namespace, which admits to every arena directly in it.
     * [didJoin] runs after (the session reconnects to the admitting relay there when the account had
     * none). The arena may take a moment to sync; the arena screen polls until it reads.
     */
    suspend fun join(
        invitation: KombatInvitation,
        didJoin: suspend () -> Unit,
    ): ArenaRef {
        backend.joinNamespace(invitation.namespaceId, invitation.invitation)
        didJoin()
        return ArenaRef(invitation.contextId, invitation.namespaceId)
    }

    /** A link that admits someone to [ref]'s namespace and opens that arena. */
    suspend fun inviteLink(ref: ArenaRef): String {
        val namespaceId = ref.namespaceId ?: throw KombatException(KombatException.Kind.NO_NAMESPACE)
        return KombatInvitation(backend.createInvitation(namespaceId), namespaceId, ref.contextId).link()
    }

    fun dismissError() {
        _state.update { it.copy(error = null) }
    }
}
