package network.calimero.standup.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import network.calimero.standup.core.ErrorText
import network.calimero.standup.core.People
import network.calimero.standup.core.StandupInvitation
import network.calimero.standup.core.standupClient
import network.calimero.standup.generated.MemberView
import network.calimero.standup.generated.StandupClient

/**
 * One open team: who you are in it, its name, the people the contract knows, and a [version] that
 * moves whenever its state may have changed (a write from here, a teammate's sync event, or the
 * poll). Every tab re-reads when it moves (the web's `useTeam`).
 */
class TeamModel(
    val team: TeamSummary,
    val backend: MeroAppBackend,
    val client: StandupClient = standupClient(backend, team.contextId),
) {
    private val _me = MutableStateFlow<String?>(null)

    /** The calling account, as the contract's views render it. */
    val me: StateFlow<String?> = _me.asStateFlow()
    private val _myName = MutableStateFlow("")

    /** Your name on this team, "" when unset. */
    val myName: StateFlow<String> = _myName.asStateFlow()
    private val _teamName = MutableStateFlow(team.name)
    val teamName: StateFlow<String> = _teamName.asStateFlow()
    private val _members = MutableStateFlow<List<MemberView>>(emptyList())
    val members: StateFlow<List<MemberView>> = _members.asStateFlow()
    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version.asStateFlow()

    /** The last identity read failed: shown while a just-joined team syncs. */
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()

    /** How often to re-read with a live stream up, and without one (ms). */
    var pollWithStreamMs = 30_000L
    var pollWithoutStreamMs = 10_000L

    val contextId: String get() = team.contextId
    val namespaceId: String get() = team.namespaceId

    /** The team's title for the top bar. */
    val title: String get() = _teamName.value.ifEmpty { "Unnamed team" }

    /** What to call [account]: "You", their name on this team, or a short id. */
    fun name(
        account: String,
        name: String?,
        you: Boolean = true,
    ): String {
        if (you && account == _me.value) return "You"
        val member = _members.value.firstOrNull { it.account == account }
        if (member != null && member.name.isNotEmpty() && name.isNullOrEmpty()) return member.name
        return People.displayName(account, name)
    }

    /** Whether to ask for a name: the contract knows you and you have none. */
    val needsName: Boolean get() = _hasLoaded.value && _me.value != null && _myName.value.isEmpty()

    /** Re-read who you are, the names and the members. */
    suspend fun load() {
        try {
            val me = _me.value ?: client.whoami()
            coroutineScope {
                val name = async { client.getName(me) }
                val teamName = async { client.teamName() }
                val members = async { client.members() }
                val n = name.await()
                val t = teamName.await()
                val m = members.await()
                _me.value = me
                _myName.value = n
                _teamName.value = t
                _members.value = m
            }
            _error.value = null
            _hasLoaded.value = true
        } catch (e: Exception) {
            _error.value = ErrorText.describe(e)
        }
    }

    /** Something may have changed: every tab re-reads. */
    fun bump() {
        _version.value += 1
    }

    /** Run one write, then re-read everything (the web's `act`). */
    suspend fun <T> act(write: suspend (StandupClient) -> T): T =
        try {
            write(client)
        } finally {
            bump()
        }

    suspend fun renameTeam(name: String) {
        val trimmed = name.trim()
        act { it.setTeamName(trimmed) }
        _teamName.value = trimmed
    }

    suspend fun setMyName(name: String) {
        val trimmed = name.trim()
        act { it.setName(trimmed) }
        _myName.value = trimmed
    }

    /** An invitation link to this team's namespace, in the web app's format. */
    suspend fun inviteLink(): String {
        val signed = backend.createInvitation(namespaceId)
        return StandupInvitation(signed, namespaceId, contextId).link()
    }

    /**
     * Follow the team while the screen is up: the relay's event stream when it has one, coalesced
     * (one post can arrive as several events), and a poll either way, since a dropped stream would
     * otherwise leave the board stale with nothing saying so. Runs until cancelled.
     */
    suspend fun follow() {
        coroutineScope {
            launch { listen() }
            launch { poll() }
        }
    }

    private suspend fun listen() {
        if (!backend.canSubscribe) return
        coroutineScope {
            var nudge: Job? = null
            try {
                backend.events(contextId).collect {
                    nudge?.cancel()
                    nudge =
                        launch {
                            delay(NUDGE_MS)
                            bump()
                        }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) {
                // The poll carries on.
            }
        }
    }

    private suspend fun poll() {
        coroutineScope {
            while (isActive) {
                delay(if (backend.canSubscribe) pollWithStreamMs else pollWithoutStreamMs)
                bump()
            }
        }
    }

    private companion object {
        const val NUDGE_MS = 250L
    }
}
