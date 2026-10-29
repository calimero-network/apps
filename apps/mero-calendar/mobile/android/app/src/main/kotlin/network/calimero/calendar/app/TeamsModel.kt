package network.calimero.calendar.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import network.calimero.calendar.data.ErrorText
import network.calimero.calendar.data.LocalNames
import network.calimero.calendar.data.TeamInvites

/** A team: a namespace running Mero Calendar. */
data class Team(
    val id: String,
    val name: String,
    val applicationId: String,
)

data class TeamsState(
    val loading: Boolean = true,
    val teams: List<Team> = emptyList(),
    val error: String? = null,
    /** No relay serves the account yet: only joining works. */
    val noRelay: Boolean = false,
)

/** The teams list (the web app's `TeamsPage`): list, create, invite, join. */
class TeamsModel(
    private val backend: MeroAppBackend,
    private val names: LocalNames,
) {
    private val _state = MutableStateFlow(TeamsState())
    val state: StateFlow<TeamsState> = _state.asStateFlow()

    /** Teams joined in this run: opening their calendars waits longer for them to sync. */
    val justJoined = mutableSetOf<String>()

    suspend fun load() {
        if (!backend.hasRelay) {
            _state.value = TeamsState(loading = false, noRelay = true)
            return
        }
        _state.update { it.copy(loading = it.teams.isEmpty(), error = null) }
        try {
            val teams =
                backend.listNamespaces().map { ns ->
                    Team(ns.id, ns.name?.trim()?.ifEmpty { null } ?: names.team(ns.id) ?: teamPlaceholder(ns.id), ns.applicationId)
                }
            _state.value = TeamsState(loading = false, teams = teams)
        } catch (e: Exception) {
            _state.update { it.copy(loading = false, error = ErrorText.of(e, "load your teams")) }
        }
    }

    /** What founding a team came to: the team, and a warning when the cloud would not host it. */
    data class Created(
        val team: Team,
        val warning: String?,
    )

    /** Found a team (names are capped at 64 characters, as core caps them). */
    suspend fun create(name: String): Created {
        val trimmed = name.trim().take(MAX_NAME)
        require(trimmed.isNotEmpty()) { "Name the team." }
        val founded = backend.foundNamespace(trimmed)
        names.setTeam(founded.namespaceId, trimmed)
        load()
        val team = _state.value.teams.firstOrNull { it.id == founded.namespaceId } ?: Team(founded.namespaceId, trimmed, "")
        return Created(team, founded.haError?.let { "Team created, but invitations will not work yet: $it." })
    }

    /** A shareable invitation link to [team]. */
    suspend fun inviteLink(team: Team): String = TeamInvites.link(backend.createInvitation(team.id), team.name)

    /** Redeem a pasted or opened link. Returns the team's id. */
    suspend fun join(input: String): String {
        val invitation = TeamInvites.parse(input) ?: throw IllegalArgumentException(NOT_AN_INVITATION)
        backend.joinNamespace(invitation.namespaceId, invitation.invitation)
        invitation.teamName?.let { names.setTeam(invitation.namespaceId, it) }
        justJoined += invitation.namespaceId
        return invitation.namespaceId
    }

    companion object {
        const val MAX_NAME = 64
        const val NOT_AN_INVITATION = "That isn't a Mero Calendar invitation link."

        fun teamPlaceholder(id: String) = "Team ${id.take(6)}"
    }
}
