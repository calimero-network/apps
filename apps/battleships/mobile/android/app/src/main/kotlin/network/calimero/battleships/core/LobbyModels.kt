package network.calimero.battleships.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.battleships.generated.lobby.MatchRecord
import network.calimero.battleships.generated.lobby.MatchStatus
import network.calimero.battleships.generated.lobby.MatchSummary
import network.calimero.battleships.generated.lobby.PlayerEntry
import network.calimero.battleships.generated.lobby.PlayerStatsView

/** Runs [block], rethrowing cancellation and turning every other failure into null. */
internal suspend fun <T> attempt(block: suspend () -> T): T? =
    try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

/**
 * The lobbies (namespaces running Battleships) this account is in, and founding a new one.
 * (Swift `LobbiesModel`; the web app's `LobbySelect` + `useNamespaceBootstrap`.)
 */
class LobbiesModel(
    val backend: BattleshipsBackend,
    /** The session's application id, when known: what a lobby context is created with. */
    private val applicationId: String?,
) {
    private val _lobbies = MutableStateFlow<List<AppNamespace>>(emptyList())
    val lobbies: StateFlow<List<AppNamespace>> = _lobbies.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()

    suspend fun load() {
        if (_lobbies.value.isEmpty()) _phase.value = LoadPhase.Loading
        try {
            _lobbies.value = backend.app.listNamespaces().sortedBy { Names.lobby(it).lowercase() }
            _phase.value = LoadPhase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (_lobbies.value.isEmpty()) _phase.value = LoadPhase.Failed(ErrorText.describe(e))
        }
    }

    /**
     * Found a lobby: a namespace running the bundle, with the lobby service's context in its root
     * group (the web app's `createNamespaceWithLobby`). Match contexts are created beside it.
     */
    @Suppress("ThrowsCount")
    suspend fun create(raw: String): AppNamespace {
        val name = raw.trim()
        if (name.isEmpty()) throw BattleshipsException("Give the lobby a name.")
        if (!backend.app.hasRelay) throw BattleshipsException("No relay serves your account yet. Join a lobby from an invitation first.")
        val founded = backend.app.foundNamespace(name)
        val listed = attempt { backend.app.listNamespaces() }.orEmpty()
        val appId = listed.firstOrNull { it.id == founded.namespaceId }?.applicationId ?: applicationId.orEmpty()
        if (appId.isEmpty()) throw BattleshipsException("Still connecting. Try again in a moment.")
        backend.createServiceContext(founded.namespaceId, appId, Battleships.LOBBY_SERVICE, "lobby", JsonObject(emptyMap()))
        val lobby = AppNamespace(founded.namespaceId, name, appId, 1)
        if (_lobbies.value.none { it.id == lobby.id }) _lobbies.value = listOf(lobby) + _lobbies.value
        _phase.value = LoadPhase.Loaded
        return lobby
    }
}

/**
 * Creating a match, from the lobby and from a finished match's rematch: allocate it in the lobby,
 * create the game context beside the lobby's (the namespace root group, so the game's `xcall`
 * reaches the lobby), then record the context in the lobby. (The web app's `createMatch`.)
 */
object MatchMaker {
    @Suppress("ThrowsCount")
    suspend fun create(
        backend: BattleshipsBackend,
        namespace: AppNamespace,
        lobbyContextId: String,
        opponent: String,
    ): MatchRef {
        val key = opponent.trim().lowercase()
        if (!LobbyInvitation.isKey(key)) throw BattleshipsException("That is not a valid player key.")
        // A lobby opened straight from an invitation does not know its application yet.
        val applicationId =
            namespace.applicationId.ifEmpty {
                backend.app
                    .listNamespaces()
                    .firstOrNull { it.id == namespace.id }
                    ?.applicationId
                    .orEmpty()
            }
        if (applicationId.isEmpty()) throw BattleshipsException("The lobby is still syncing. Try again in a moment.")
        val lobby = lobbyClient(backend.app.contract, lobbyContextId)
        val matchId = lobby.createMatch(key)
        val created =
            lobby.getMatches().firstOrNull { it.matchId == matchId }
                ?: throw BattleshipsException("That match no longer exists in this lobby.")
        val initArgs =
            JsonObject(
                mapOf(
                    "player1" to JsonPrimitive(created.player1),
                    "player2" to JsonPrimitive(created.player2),
                    "player2_account" to JsonPrimitive(created.player2Account),
                    "lobby_context_id" to JsonPrimitive(lobbyContextId),
                    "match_id" to JsonPrimitive(matchId),
                ),
            )
        val contextId = backend.createServiceContext(namespace.id, applicationId, Battleships.GAME_SERVICE, "match", initArgs)
        lobby.setMatchContextId(matchId, contextId)
        return MatchRef(namespace.id, lobbyContextId, matchId, contextId, key)
    }
}

/**
 * One lobby: its matches, the players you can challenge, your record and its history, and
 * inviting people in. (Swift `LobbyModel`; the web app's `useBattleshipsLobby` + `LobbyView`.)
 */
@Suppress("TooManyFunctions")
class LobbyModel(
    val backend: BattleshipsBackend,
    val namespace: AppNamespace,
    private val syncAttempts: Int = 8,
    private val syncDelayMs: Long = 2_000,
) {
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _lobbyContextId = MutableStateFlow<String?>(null)
    val lobbyContextId: StateFlow<String?> = _lobbyContextId.asStateFlow()
    private val _matches = MutableStateFlow<List<MatchSummary>>(emptyList())
    val matches: StateFlow<List<MatchSummary>> = _matches.asStateFlow()
    private val _players = MutableStateFlow<List<PlayerEntry>>(emptyList())
    val players: StateFlow<List<PlayerEntry>> = _players.asStateFlow()
    private val _stats = MutableStateFlow<PlayerStatsView?>(null)
    val stats: StateFlow<PlayerStatsView?> = _stats.asStateFlow()
    private val _history = MutableStateFlow<List<MatchRecord>>(emptyList())
    val history: StateFlow<List<MatchRecord>> = _history.asStateFlow()
    private val _me = MutableStateFlow(backend.app.account.lowercase())
    val me: StateFlow<String> = _me.asStateFlow()
    private val _challenging = MutableStateFlow<String?>(null)
    val challenging: StateFlow<String?> = _challenging.asStateFlow()
    val notice = MutableStateFlow<String?>(null)
    private var registered = false

    val name: String get() = Names.lobby(namespace)

    /** Players who opened this lobby, other than you: who you can challenge. */
    fun opponents(players: List<PlayerEntry> = _players.value): List<PlayerEntry> =
        players.filter {
            !it.player.equals(_me.value, ignoreCase = true) && !it.account.equals(backend.app.account, ignoreCase = true)
        }

    /** Your matches, the ones still going first, newest first within each. */
    fun myMatches(matches: List<MatchSummary> = _matches.value): List<MatchSummary> =
        matches.filter { isMine(it) }.sortedWith(
            compareBy<MatchSummary> { if (it.status == MatchStatus.Finished) 1 else 0 }.thenByDescending { it.createdMs },
        )

    /** Newest first. */
    fun sortedHistory(history: List<MatchRecord> = _history.value): List<MatchRecord> = history.sortedByDescending { it.finishedMs }

    fun isMine(match: MatchSummary): Boolean = match.player1.equals(_me.value, true) || match.player2.equals(_me.value, true)

    fun opponent(match: MatchSummary): String = if (match.player1.equals(_me.value, true)) match.player2 else match.player1

    fun ref(match: MatchSummary): MatchRef? {
        val lobby = _lobbyContextId.value ?: return null
        val contextId = match.contextId?.takeIf { it.isNotEmpty() } ?: return null
        return MatchRef(namespace.id, lobby, match.matchId, contextId, opponent(match))
    }

    /** Find the lobby context, make sure this account is in it, record who you play as, read it all. */
    @Suppress("NestedBlockDepth")
    suspend fun load() {
        if (_lobbyContextId.value == null) {
            _phase.value = LoadPhase.Loading
            for (attemptIndex in 0 until syncAttempts) {
                if (attemptIndex > 0) delay(syncDelayMs)
                try {
                    val found = resolveLobbyContext()
                    if (found != null) {
                        _lobbyContextId.value = found
                        break
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (attemptIndex == syncAttempts - 1) {
                        _phase.value = LoadPhase.Failed(ErrorText.describe(e))
                        return
                    }
                }
            }
            val found = _lobbyContextId.value
            if (found == null) {
                _phase.value = LoadPhase.Failed("This lobby hasn't synced to your relay yet. Pull to refresh in a moment.")
                return
            }
            if (attempt { backend.app.isMember(found) } != true) attempt { backend.app.joinContext(found) }
        }
        val lobbyContext = _lobbyContextId.value
        if (!registered && lobbyContext != null) {
            val key = attempt { lobbyClient(backend.app.contract, lobbyContext).registerPlayer() }
            if (key != null && LobbyInvitation.isKey(key)) {
                _me.value = key.lowercase()
                registered = true
            }
        }
        refresh()
    }

    /** Re-read the lobby's matches, players, your record and the history. */
    suspend fun refresh() {
        val lobbyContext = _lobbyContextId.value ?: return
        val lobby = lobbyClient(backend.app.contract, lobbyContext)
        try {
            _matches.value = lobby.getMatches()
            _phase.value = LoadPhase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (_phase.value != LoadPhase.Loaded) _phase.value = LoadPhase.Failed(ErrorText.describe(e))
            return
        }
        attempt { lobby.getPlayers() }?.let { _players.value = it }
        attempt { lobby.getPlayerStats(_me.value) }?.let { _stats.value = it }
        attempt { lobby.getHistory() }?.let { _history.value = it }
    }

    /** Challenge [opponent]: a new match, its game context, and where to open it. */
    suspend fun challenge(opponent: String): MatchRef? {
        val lobbyContext =
            _lobbyContextId.value ?: run {
                notice.value = "The lobby is still syncing. Try again in a moment."
                return null
            }
        _challenging.value = opponent
        return try {
            val ref = MatchMaker.create(backend, namespace, lobbyContext, opponent)
            refresh()
            ref
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            notice.value = ErrorText.describe(e, "Couldn't create the match. Try again.")
            null
        } finally {
            _challenging.value = null
        }
    }

    /** A link that brings someone into this lobby (and every match context in it). */
    suspend fun invitationLink(): String {
        val signed = backend.app.createInvitation(namespace.id)
        return LobbyInvitation(signed, name, _me.value).link()
    }

    /**
     * Keep the lobby fresh while it is on screen: the relay's events when it streams, and a poll
     * either way (someone joining emits no event the lobby context sees).
     */
    suspend fun live() {
        val lobbyContext = _lobbyContextId.value ?: return
        coroutineScope {
            if (backend.app.canSubscribe) {
                launch { attempt { backend.app.events(lobbyContext).collect { refresh() } } }
            }
            launch {
                while (true) {
                    delay(Battleships.POLL_INTERVAL_MS * 2)
                    refresh()
                }
            }
        }
    }

    /**
     * The context in the namespace's root group that runs the lobby service. Match contexts sit in
     * the same group, so "the first one" is wrong as soon as a match exists (the web app's note in
     * `useBattleshipsLobby`). A relay that does not say falls back to the first.
     */
    private suspend fun resolveLobbyContext(): String? {
        val ids = backend.app.listContexts(namespace.id)
        if (ids.isEmpty()) return null
        var anyNamed = false
        for (id in ids) {
            val service = attempt { backend.serviceName(id) } ?: continue
            if (service == Battleships.LOBBY_SERVICE) return id
            anyNamed = true
        }
        return if (anyNamed) null else ids.first()
    }
}

/**
 * Redeeming an invitation link: confirm, join the lobby's namespace, then open it.
 * (Swift `InvitationModel`; the web app's `InvitationPrompt` + `redeemLobby`.)
 */
class InvitationModel {
    sealed interface Stage {
        data object Idle : Stage

        data class Confirm(
            val title: String,
        ) : Stage

        data class Joining(
            val title: String,
        ) : Stage

        data class Joined(
            val namespaceId: String,
            val title: String,
        ) : Stage

        data class Failed(
            val message: String,
        ) : Stage
    }

    private val _stage = MutableStateFlow<Stage>(Stage.Idle)
    val stage: StateFlow<Stage> = _stage.asStateFlow()
    var invitation: LobbyInvitation? = null
        private set

    fun open(raw: String): Boolean {
        val parsed = LobbyInvitation.parse(raw)
        if (parsed == null) {
            invitation = null
            _stage.value = Stage.Failed("This isn't a Battleships invitation. Check the link and try again.")
            return false
        }
        invitation = parsed
        _stage.value = Stage.Confirm(parsed.title)
        return true
    }

    /** Join. [backend] is read again after [didJoin], which may hand the session the admitting relay. */
    suspend fun accept(
        backend: () -> MeroAppBackend?,
        didJoin: suspend () -> Unit,
    ) {
        val invite = invitation
        val current = backend()
        if (invite == null || current == null) {
            _stage.value = Stage.Failed("Sign in to join.")
            return
        }
        _stage.value = Stage.Joining(invite.title)
        try {
            current.joinNamespace(invite.namespaceId, invite.invitation)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val text = e.toString().lowercase()
            if (!("already a member" in text || "already member" in text || "already joined" in text)) {
                _stage.value = Stage.Failed(ErrorText.describe(e, "Couldn't join this lobby. Try again."))
                return
            }
        }
        didJoin()
        _stage.value = Stage.Joined(invite.namespaceId, invite.title)
    }

    fun reset() {
        invitation = null
        _stage.value = Stage.Idle
    }
}
