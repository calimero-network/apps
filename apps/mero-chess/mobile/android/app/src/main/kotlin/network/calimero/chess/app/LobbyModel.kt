package network.calimero.chess.app

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
import network.calimero.chess.generated.TableView

/** A table to open: its context and the namespace ("club") it lives in. */
data class TableRef(
    val contextId: String,
    val namespaceId: String?,
)

/** What the lobby row says about a table, from one `table()` read. */
data class TableSummary(
    val title: String,
    val players: String,
    val state: String,
    val myTurn: Boolean,
    val finished: Boolean,
) {
    companion object {
        fun of(raw: TableView): TableSummary {
            val view = raw.named
            val white = if (view.white.member.isEmpty()) "Open seat" else view.white.name
            val black = if (view.black.member.isEmpty()) "Open seat" else view.black.name
            val state =
                when (view.status) {
                    "finished" -> "Finished · ${ChessText.score(view.result)}"
                    "awaitingPlayers" -> "Waiting for players"
                    else ->
                        when {
                            view.myTurn -> "Your move"
                            view.myColor.isEmpty() -> "In progress · move ${view.moves.size / 2 + 1}"
                            else -> "Their move"
                        }
                }
            return TableSummary(
                title = view.title.ifEmpty { ChessConstants.DEFAULT_TITLE },
                players = "$white vs $black",
                state = state,
                myTurn = view.myTurn,
                finished = view.status == "finished",
            )
        }
    }
}

/** One row of the lobby. */
data class TableEntry(
    val ref: TableRef,
    val clubName: String?,
    val summary: TableSummary? = null,
) {
    val id: String get() = ref.contextId
}

data class LobbyState(
    val tables: List<TableEntry> = emptyList(),
    val clubs: List<AppNamespace> = emptyList(),
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
)

/**
 * The lobby: every table in every club this account belongs to, and making and joining tables.
 * (Swift `LobbyModel`.)
 *
 * A table is one context, created directly in its namespace (not a subgroup), exactly as the web
 * app's `ContextPicker` does, so the namespace invitation the table mints is the one that admits to it.
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
            _state.update { it.copy(tables = emptyList(), clubs = emptyList(), loaded = true) }
            return
        }
        _state.update { it.copy(loading = true) }
        try {
            val namespaces = backend.listNamespaces()
            val known = _state.value.tables.associate { it.id to it.summary }
            val entries =
                namespaces.flatMap { namespace ->
                    backend.listContexts(namespace.id).map { contextId ->
                        TableEntry(TableRef(contextId, namespace.id), namespace.name, known[contextId])
                    }
                }
            _state.update { it.copy(clubs = namespaces, tables = entries, error = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            _state.update { it.copy(error = ChessText.error(e), loading = false, loaded = true) }
            return
        }
        loadSummaries()
        _state.update { it.copy(loading = false, loaded = true) }
    }

    /** Each row's title, players and whose move it is. Best-effort: a table still syncing keeps a plain row. */
    private suspend fun loadSummaries() {
        val refs = _state.value.tables.map { it.ref }
        val summaries =
            coroutineScope {
                refs
                    .map { ref ->
                        async {
                            ref.contextId to runCatching { TableSummary.of(chessClient(backend, ref.contextId).table(nowMillis())) }.getOrNull()
                        }
                    }.awaitAll()
                    .toMap()
            }
        _state.update { state -> state.copy(tables = state.tables.map { entry -> summaries[entry.id]?.let { entry.copy(summary = it) } ?: entry }) }
    }

    /** A new table: in [clubId], or in a new club named after the table when null. */
    suspend fun create(
        title: String,
        clubId: String?,
    ): TableRef {
        if (!backend.hasRelay) throw ChessException(ChessException.Kind.NO_RELAY)
        val applicationId = applicationId?.takeIf { it.isNotEmpty() } ?: throw ChessException(ChessException.Kind.NO_APPLICATION)
        val name = title.trim().take(64).ifEmpty { ChessConstants.DEFAULT_TITLE }
        val namespaceId = clubId ?: backend.foundNamespace(name).namespaceId
        val initArgs =
            buildJsonObject {
                put("title", name)
                put("now", nowMillis().toLong())
            }
        val contextId = backend.createContext(namespaceId, applicationId, name, initArgs)
        val ref = TableRef(contextId, namespaceId)
        val clubName =
            _state.value.clubs
                .firstOrNull { it.id == namespaceId }
                ?.name ?: name
        _state.update { it.copy(tables = listOf(TableEntry(ref, clubName)) + it.tables) }
        return ref
    }

    /**
     * Redeem an invitation: join its namespace, which admits to every table directly in it.
     * [didJoin] runs after (the session reconnects to the admitting relay there when the account had
     * none). The table may take a moment to sync; the table screen polls until it reads.
     */
    suspend fun join(
        invitation: ChessInvitation,
        didJoin: suspend () -> Unit,
    ): TableRef {
        backend.joinNamespace(invitation.namespaceId, invitation.invitation)
        didJoin()
        return TableRef(invitation.contextId, invitation.namespaceId)
    }

    /** A link that admits someone to [ref]'s club and opens that table. */
    suspend fun inviteLink(ref: TableRef): String {
        val namespaceId = ref.namespaceId ?: throw ChessException(ChessException.Kind.NO_NAMESPACE)
        return ChessInvitation(backend.createInvitation(namespaceId), namespaceId, ref.contextId).link()
    }

    fun dismissError() {
        _state.update { it.copy(error = null) }
    }
}
