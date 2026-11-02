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
 * The lobbies (Calimero orgs running Battleships) this account is in, and founding a new one.
 * (Swift `LobbiesModel`; the web app's `LobbySelect` + `useNamespaceBootstrap`.)
 */
class LobbiesModel(
    val backend: BattleshipsBackend,
    /** The app's package: what a lobby's instance is created from. */
    private val applicationId: String?,
) {
    private val _lobbies = MutableStateFlow<List<AppNamespace>>(emptyList())
    val lobbies: StateFlow<List<AppNamespace>> = _lobbies.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()

    suspend fun load() {
        if (_lobbies.value.isEmpty()) _phase.value = LoadPhase.Loading
        try {
            _lobbies.value = backend.listNamespaces().sortedBy { Names.lobby(it).lowercase() }
            _phase.value = LoadPhase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (_lobbies.value.isEmpty()) _phase.value = LoadPhase.Failed(ErrorText.describe(e))
        }
    }

    /**
     * Found a lobby: an organization for the package, then the app instance in it (the web app's
     * `createLobby`). Every match is played inside that one instance.
     */
    suspend fun create(raw: String): AppNamespace {
        val name = raw.trim()
        if (name.isEmpty()) throw BattleshipsException("Give the lobby a name.")
        if (!backend.hasRelay) throw BattleshipsException("Sign in to create a lobby.")
        val founded = backend.foundNamespace(name)
        backend.createContext(founded.namespaceId, applicationId.orEmpty(), name, JsonObject(emptyMap()))
        val lobby = AppNamespace(founded.namespaceId, name, applicationId ?: Battleships.PACKAGE_NAME, 1)
        if (_lobbies.value.none { it.id == lobby.id }) _lobbies.value = listOf(lobby) + _lobbies.value
        _phase.value = LoadPhase.Loaded
        return lobby
    }
}

/**
 * Creating a match, from the lobby and from a finished match's rematch: `createMatch` in the
 * lobby's instance starts it (no context per match on 1.0). (The web app's `createMatch`.)
 */
object MatchMaker {
    suspend fun create(
        backend: BattleshipsBackend,
        namespace: AppNamespace,
        appId: String,
        opponent: String,
    ): MatchRef {
        val key = opponent.trim()
        if (!LobbyInvitation.isKey(key)) throw BattleshipsException("That is not a valid player.")
        val matchId = BattleshipsContract(backend.contract, appId).createMatch(key)
        return MatchRef(namespace.id, appId, matchId, key)
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
    private val _appId = MutableStateFlow<String?>(null)
    val appId: StateFlow<String?> = _appId.asStateFlow()
    private val _matches = MutableStateFlow<List<MatchSummary>>(emptyList())
    val matches: StateFlow<List<MatchSummary>> = _matches.asStateFlow()
    private val _players = MutableStateFlow<List<PlayerEntry>>(emptyList())
    val players: StateFlow<List<PlayerEntry>> = _players.asStateFlow()
    private val _stats = MutableStateFlow<PlayerStatsView?>(null)
    val stats: StateFlow<PlayerStatsView?> = _stats.asStateFlow()
    private val _history = MutableStateFlow<List<MatchRecord>>(emptyList())
    val history: StateFlow<List<MatchRecord>> = _history.asStateFlow()
    private val _names = MutableStateFlow<Map<String, String>>(emptyMap())

    /** Display names members set in the lobby's organization, by account. */
    val names: StateFlow<Map<String, String>> = _names.asStateFlow()
    private val _me = MutableStateFlow(backend.account)
    val me: StateFlow<String> = _me.asStateFlow()
    private val _challenging = MutableStateFlow<String?>(null)
    val challenging: StateFlow<String?> = _challenging.asStateFlow()
    val notice = MutableStateFlow<String?>(null)
    private var registered = false

    val name: String get() = Names.lobby(namespace)

    /** Players who opened this lobby, other than you: who you can challenge. */
    fun opponents(players: List<PlayerEntry> = _players.value): List<PlayerEntry> =
        players.filter {
            !it.player.equals(_me.value, ignoreCase = true) && !it.account.equals(backend.account, ignoreCase = true)
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
        val app = _appId.value ?: return null
        return MatchRef(namespace.id, app, match.matchId, opponent(match))
    }

    /** "You", their name in the lobby, or a short handle. */
    fun displayName(key: String): String = Names.player(key, _me.value, _names.value)

    /** Find the lobby's app instance, record who you play as, read it all. */
    @Suppress("NestedBlockDepth")
    suspend fun load() {
        if (_appId.value == null) {
            _phase.value = LoadPhase.Loading
            for (attemptIndex in 0 until syncAttempts) {
                if (attemptIndex > 0) delay(syncDelayMs)
                try {
                    val found = backend.listContexts(namespace.id).firstOrNull()
                    if (found != null) {
                        _appId.value = found
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
            if (_appId.value == null) {
                _phase.value = LoadPhase.Failed("This lobby isn't ready yet. Pull to refresh in a moment.")
                return
            }
        }
        val app = _appId.value
        if (!registered && app != null) {
            val key = attempt { BattleshipsContract(backend.contract, app).registerPlayer() }
            if (key != null && LobbyInvitation.isKey(key)) {
                _me.value = key
                registered = true
            }
        }
        refresh()
    }

    /** Re-read the lobby's matches, players, your record and the history. */
    suspend fun refresh() {
        val app = _appId.value ?: return
        val lobby = BattleshipsContract(backend.contract, app)
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
        attempt { backend.listMembers(namespace.id) }?.let { members ->
            _names.value = members.mapNotNull { m -> m.name?.let { m.identity to it } }.toMap()
        }
    }

    /** Challenge [opponent]: a new match, and where to open it. */
    suspend fun challenge(opponent: String): MatchRef? {
        val app =
            _appId.value ?: run {
                notice.value = "The lobby is still syncing. Try again in a moment."
                return null
            }
        _challenging.value = opponent
        return try {
            val ref = MatchMaker.create(backend, namespace, app, opponent)
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

    /** A link that brings someone into this lobby's organization (a passkey step-up). */
    suspend fun invitationLink(): String {
        val signed = backend.createInvitation(namespace.id)
        return LobbyInvitation(signed, name, _me.value).link()
    }

    /**
     * Keep the lobby fresh while it is on screen: the instance's event stream, and a poll either
     * way (someone joining the organization emits no event in the instance).
     */
    suspend fun live() {
        val app = _appId.value ?: return
        coroutineScope {
            if (backend.canSubscribe) {
                launch { attempt { backend.events(app).collect { refresh() } } }
            }
            launch {
                while (true) {
                    delay(Battleships.POLL_INTERVAL_MS * 2)
                    refresh()
                }
            }
        }
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

    /** Join (`POST /invites/{token}/redeem`). [backend] is read again after [didJoin]. */
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
