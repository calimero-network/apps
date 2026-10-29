package network.calimero.standup.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonObject
import network.calimero.standup.core.ErrorText
import network.calimero.standup.core.StandupInvitation
import network.calimero.standup.core.standupClient

/** A team the account is in: one context, directly in its namespace (as the web's `ContextPicker` creates them). */
data class TeamSummary(
    val namespaceId: String,
    val contextId: String,
    /** The team's own name (`team_name`), else the namespace's, else "". */
    val name: String,
) {
    val id: String get() = contextId
    val title: String get() = name.ifEmpty { "Unnamed team" }
}

/** The team list: the account's namespaces for this app, the team contexts in each, and starting or joining one. */
class TeamsModel(
    val backend: MeroAppBackend,
    private val applicationId: String?,
) {
    private val _teams = MutableStateFlow<List<TeamSummary>>(emptyList())
    val teams: StateFlow<List<TeamSummary>> = _teams.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()
    val error = MutableStateFlow<String?>(null)
    private val _isWorking = MutableStateFlow(false)
    val isWorking: StateFlow<Boolean> = _isWorking.asStateFlow()

    /** Whether a relay serves the account. Without one only joining works. */
    val hasRelay: Boolean get() = backend.hasRelay

    suspend fun load() {
        if (!backend.hasRelay) {
            _teams.value = emptyList()
            _hasLoaded.value = true
            return
        }
        _isLoading.value = true
        try {
            val found = mutableListOf<TeamSummary>()
            for (ns in backend.listNamespaces()) {
                val contexts = runCatching { backend.listContexts(ns.id) }.getOrDefault(emptyList())
                found += contexts.map { TeamSummary(ns.id, it, ns.name.orEmpty()) }
            }
            _teams.value = withNames(found)
            error.value = null
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        } finally {
            _isLoading.value = false
            _hasLoaded.value = true
        }
    }

    /** Each team's own name, read from its context in parallel. Best effort. */
    private suspend fun withNames(teams: List<TeamSummary>): List<TeamSummary> =
        coroutineScope {
            teams
                .map { team ->
                    async {
                        val name = runCatching { standupClient(backend, team.contextId).teamName() }.getOrNull()
                        if (name.isNullOrEmpty()) team else team.copy(name = name)
                    }
                }.awaitAll()
                .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title })
        }

    /** Start a team: found a namespace, create the team's context directly in it, and name it. */
    suspend fun create(name: String): TeamSummary? {
        val trimmed = name.trim()
        val label = trimmed.ifEmpty { "Standup" }
        _isWorking.value = true
        return try {
            val founded = backend.foundNamespace(label)
            val app = applicationIdFor(founded.namespaceId)
            val contextId = backend.createContext(founded.namespaceId, app, label, JsonObject(emptyMap()))
            // Best effort, like the web: an unnamed team still works and anyone in it can name it later.
            if (trimmed.isNotEmpty()) runCatching { standupClient(backend, contextId).setTeamName(trimmed) }
            val team = TeamSummary(founded.namespaceId, contextId, trimmed)
            _teams.value = (_teams.value + team).sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title })
            error.value = null
            team
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _isWorking.value = false
        }
    }

    /** The application a new team's context runs: the session's, else the founded namespace's. */
    private suspend fun applicationIdFor(namespaceId: String): String {
        if (!applicationId.isNullOrEmpty()) return applicationId
        return backend
            .listNamespaces()
            .firstOrNull { it.id == namespaceId }
            ?.applicationId
            ?.ifEmpty { null }
            ?: throw StandupException.NoApplication()
    }

    /** Redeem an invitation. Returns the team it names; its updates arrive as the namespace syncs. */
    suspend fun join(invitation: StandupInvitation): TeamSummary? {
        _isWorking.value = true
        return try {
            backend.joinNamespace(invitation.namespaceId, invitation.invitation)
            val team = TeamSummary(invitation.namespaceId, invitation.contextId, "")
            if (_teams.value.none { it.contextId == team.contextId }) _teams.value = _teams.value + team
            error.value = null
            team
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _isWorking.value = false
        }
    }
}

sealed class StandupException(
    message: String,
) : Exception(message) {
    class NoApplication : StandupException("Mero Standup is not installed for your account yet. Try again in a moment.")

    class NotAnInvitation : StandupException("That is not a Mero Standup invitation link.")
}
