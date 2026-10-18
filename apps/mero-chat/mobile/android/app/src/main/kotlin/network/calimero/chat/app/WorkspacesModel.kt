package network.calimero.chat.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import network.calimero.chat.data.ChatInvitation
import network.calimero.chat.data.ChatInvites
import network.calimero.chat.data.ChatRepository
import network.calimero.chat.data.ChatValidation
import network.calimero.chat.data.Workspace
import network.calimero.chat.data.describeChatError
import java.util.concurrent.CopyOnWriteArrayList

/** An invitation link minted for sharing. */
data class SharedInvite(
    val workspaceName: String,
    val link: String,
)

data class WorkspacesState(
    val loading: Boolean = false,
    /** Loaded at least once (an empty list then means "none", not "not asked yet"). */
    val loaded: Boolean = false,
    val workspaces: List<Workspace> = emptyList(),
    /** What is being done right now, for a progress line ("Creating …"). */
    val busy: String? = null,
    val error: String? = null,
    val notice: String? = null,
    /** An invitation waiting to be confirmed (opened from a link, or pasted). */
    val pendingInvite: ChatInvitation? = null,
    /** The last invitation minted, for the share sheet. */
    val invite: SharedInvite? = null,
)

/** The workspaces list: load, create, join from an invitation, invite. */
class WorkspacesModel(
    private val repo: ChatRepository,
    private val scope: CoroutineScope,
    private val profile: ProfileStore,
) {
    private val _state = MutableStateFlow(WorkspacesState())
    val state: StateFlow<WorkspacesState> = _state.asStateFlow()
    private val justCreated = CopyOnWriteArrayList<Workspace>()

    fun refresh(): Job =
        scope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val listed = repo.workspaces()
                // A workspace founded a moment ago may not be in the relay's listing yet: keep
                // showing it until it is.
                justCreated.removeIf { created -> listed.any { it.id == created.id } }
                val list = (listed + justCreated).sortedBy { it.name.lowercase() }
                _state.update { it.copy(loading = false, loaded = true, workspaces = list) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, loaded = true, error = describeChatError(e)) }
            }
        }

    fun create(name: String): Job =
        scope.launch {
            val problem = ChatValidation.workspaceNameError(name) ?: nameProblem()
            if (problem != null) {
                _state.update { it.copy(error = problem) }
                return@launch
            }
            step("Creating \"${name.trim()}\"") {
                val founded = repo.createWorkspace(name, profile.displayName.value)
                val created = Workspace(founded.namespaceId, name.trim())
                justCreated += created
                _state.update {
                    it.copy(
                        workspaces = (it.workspaces.filterNot { w -> w.id == created.id } + created).sortedBy { w -> w.name.lowercase() },
                        notice = founded.warning ?: "Created \"${created.name}\". Invite people from its channel list.",
                    )
                }
                refresh().join()
            }
        }

    /** Read a pasted or opened invitation and hold it for confirmation. False when it is not one. */
    fun offerInvite(input: String): Boolean {
        val invite = ChatInvites.parse(input)
        if (invite == null) {
            _state.update { it.copy(error = "That doesn't look like a Mero Chat invitation link.") }
            return false
        }
        _state.update { it.copy(pendingInvite = invite, error = null) }
        return true
    }

    fun dismissPendingInvite() = _state.update { it.copy(pendingInvite = null) }

    /** Redeem the pending invitation as the account. */
    fun acceptPendingInvite(): Job =
        scope.launch {
            val invite = _state.value.pendingInvite ?: return@launch
            nameProblem()?.let { problem ->
                _state.update { it.copy(error = problem) }
                return@launch
            }
            _state.update { it.copy(pendingInvite = null) }
            val label = invite.workspaceName ?: "the workspace"
            step("Joining $label") {
                val joined = repo.joinWorkspace(invite)
                _state.update {
                    it.copy(
                        notice =
                            if (joined.published) {
                                "Joined $label. Its channels appear once your relay has synced them."
                            } else {
                                "Your relay accepted the join; it will show up shortly."
                            },
                    )
                }
                refresh().join()
            }
        }

    fun invite(workspace: Workspace): Job =
        scope.launch {
            step("Creating an invitation") {
                val link = repo.invitationLink(workspace)
                _state.update { it.copy(invite = SharedInvite(workspace.name, link)) }
            }
        }

    fun dismissInvite() = _state.update { it.copy(invite = null) }

    fun clearMessages() = _state.update { it.copy(error = null, notice = null) }

    /** Forget everything (sign-out). */
    fun reset() {
        justCreated.clear()
        _state.value = WorkspacesState()
    }

    private fun nameProblem(): String? =
        ChatValidation.usernameError(profile.displayName.value)?.let { "Set your name first (top right): others see it next to your messages." }

    private suspend fun step(
        what: String,
        body: suspend () -> Unit,
    ) {
        _state.update { it.copy(busy = "$what…", error = null, notice = null) }
        try {
            body()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(error = describeChatError(e)) }
        } finally {
            _state.update { it.copy(busy = null) }
        }
    }
}
