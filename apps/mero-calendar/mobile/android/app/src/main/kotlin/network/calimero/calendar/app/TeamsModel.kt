package network.calimero.calendar.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import network.calimero.calendar.data.ErrorText
import network.calimero.calendar.data.LocalNames
import network.calimero.calendar.data.TeamInvites

/** A team: a Calimero org running Mero Calendar. */
data class Team(
    val id: String,
    val name: String,
    val applicationId: String,
)

data class TeamsState(
    val loading: Boolean = true,
    val teams: List<Team> = emptyList(),
    val error: String? = null,
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

    /** The name to offer when a team asks for yours. */
    val lastName: String get() = names.lastUsername().orEmpty()

    /**
     * Found a team (names are capped at 64 characters, as core caps them), with [myName] as your
     * name in it: asked here once, used by every calendar in the team.
     */
    suspend fun create(
        name: String,
        myName: String = "",
    ): Created {
        val trimmed = name.trim().take(MAX_NAME)
        require(trimmed.isNotEmpty()) { "Name the team." }
        val founded = backend.foundNamespace(trimmed)
        names.setTeam(founded.namespaceId, trimmed)
        // Best effort: the team exists either way, and a calendar in it asks once when it is missing.
        if (myName.isNotBlank()) runCatching { setMyName(founded.namespaceId, myName) }
        load()
        val team = _state.value.teams.firstOrNull { it.id == founded.namespaceId } ?: Team(founded.namespaceId, trimmed, "")
        return Created(team, founded.haError?.let { "Team created, but invitations will not work yet: $it." })
    }

    /** A shareable invitation link to [team]. */
    suspend fun inviteLink(team: Team): String = TeamInvites.link(backend.createInvitation(team.id), team.name)

    /** Whether [teamId] has no name for you (and could be read): joining asks once. */
    suspend fun needsName(teamId: String): Boolean = backend.myTeamName(teamId) == ""

    /** Your name in [teamId], for every calendar in it. */
    suspend fun setMyName(
        teamId: String,
        name: String,
    ) {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return
        backend.setMemberName(teamId, trimmed)
        names.setLastUsername(trimmed)
    }

    /** The org ids of the listed teams (where approvals are read). */
    val orgs: List<String> get() = _state.value.teams.map { it.id }

    /** Redeem a pasted or opened link. Returns the team's id. */
    suspend fun join(input: String): String {
        val invitation = TeamInvites.parse(input) ?: throw IllegalArgumentException(NOT_AN_INVITATION)
        invitation.teamName?.let { names.setTeam(invitation.namespaceId, it) }
        backend.joinNamespace(invitation.namespaceId, invitation.invitation)
        justJoined += invitation.namespaceId
        return invitation.namespaceId
    }

    companion object {
        const val MAX_NAME = 64
        const val NOT_AN_INVITATION = "That isn't a Mero Calendar invitation link."

        fun teamPlaceholder(id: String) = "Team ${id.take(6)}"
    }
}
