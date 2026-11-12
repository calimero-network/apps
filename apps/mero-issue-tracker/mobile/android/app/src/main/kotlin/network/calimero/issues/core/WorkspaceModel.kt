package network.calimero.issues.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonObject
import network.calimero.issues.generated.IssueTrackerClient
import kotlin.coroutines.cancellation.CancellationException

/** One repository: a context in the workspace's root group running the tracker. */
data class Repo(
    val id: String,
    val name: String,
    val url: String,
)

/** Where a read stands. */
sealed interface LoadPhase {
    data object Idle : LoadPhase

    data object Loading : LoadPhase

    data object Loaded : LoadPhase

    data class Failed(
        val message: String,
    ) : LoadPhase
}

/** Everything the workspace screens show. */
data class WorkspaceState(
    val workspaces: List<AppNamespace> = emptyList(),
    val activeWorkspaceId: String? = null,
    val repos: List<Repo> = emptyList(),
    val activeRepoId: String? = null,
    val phase: LoadPhase = LoadPhase.Idle,
    val reposPhase: LoadPhase = LoadPhase.Idle,
    /** A workspace joined from an invitation whose repos have not arrived yet. */
    val syncingWorkspaceId: String? = null,
) {
    val activeWorkspace: AppNamespace? get() = workspaces.firstOrNull { it.id == activeWorkspaceId }
    val activeRepo: Repo? get() = repos.firstOrNull { it.id == activeRepoId }
    val isSyncing: Boolean get() = syncingWorkspaceId != null && syncingWorkspaceId == activeWorkspaceId && repos.isEmpty()
}

/**
 * Workspaces (namespaces) and their repos (contexts), the web app's sidebar: switching, founding a
 * workspace, adding a repo, inviting and joining.
 */
class WorkspaceModel(
    val backend: MeroAppBackend,
    private val applicationId: String?,
    private val store: TrackerStore,
) {
    private val _state = MutableStateFlow(WorkspaceState())
    val state: StateFlow<WorkspaceState> = _state.asStateFlow()

    val account: String get() = backend.account
    val hasRelay: Boolean get() = backend.hasRelay

    /** The contract in a repo. */
    fun client(repoId: String): IssueTrackerClient = issueTrackerClient(backend.contract, repoId)

    // ---- loading ---------------------------------------------------------------------------------

    /** List workspaces and open the remembered one (or the first), then its repos. */
    suspend fun load() {
        if (_state.value.workspaces.isEmpty()) update { copy(phase = LoadPhase.Loading) }
        val list =
            try {
                backend.listNamespaces().sortedBy { displayName(it).lowercase() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                update { copy(phase = LoadPhase.Failed(TrackerFormat.errorText(e))) }
                return
            }
        val current = _state.value.activeWorkspaceId
        val remembered = store.activeWorkspace
        val next =
            list.firstOrNull { it.id == current }?.id
                ?: list.firstOrNull { it.id == remembered }?.id
                ?: list.firstOrNull()?.id
        update {
            if (next != current) {
                copy(workspaces = list, phase = LoadPhase.Loaded, activeWorkspaceId = next, repos = emptyList(), activeRepoId = null)
            } else {
                copy(workspaces = list, phase = LoadPhase.Loaded)
            }
        }
        if (next != null) store.activeWorkspace = next
        loadRepos()
    }

    /** Switch to another workspace. */
    suspend fun selectWorkspace(id: String) {
        if (id == _state.value.activeWorkspaceId) return
        store.activeWorkspace = id
        update { copy(activeWorkspaceId = id, repos = emptyList(), activeRepoId = null) }
        loadRepos()
    }

    /** The active workspace's repos, named from this device's memory, else their URL. */
    suspend fun loadRepos() {
        val ns =
            _state.value.activeWorkspaceId ?: run {
                update { copy(repos = emptyList(), reposPhase = LoadPhase.Loaded) }
                return
            }
        if (_state.value.repos.isEmpty()) update { copy(reposPhase = LoadPhase.Loading) }
        val repos =
            try {
                val ids = backend.listContexts(ns)
                val urls =
                    coroutineScope {
                        ids
                            .map { id ->
                                async {
                                    id to
                                        try {
                                            client(id).getRepoInfo().repoUrl
                                        } catch (e: CancellationException) {
                                            throw e
                                        } catch (_: Exception) {
                                            ""
                                        }
                                }
                            }.awaitAll()
                            .toMap()
                    }
                ids
                    .map { id ->
                        val url = urls[id].orEmpty()
                        Repo(id, store.repoName(id) ?: TrackerFormat.repoNameFromUrl(url) ?: "Repo ${id.take(6)}", url)
                    }.sortedBy { it.name.lowercase() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                update { copy(reposPhase = LoadPhase.Failed(TrackerFormat.errorText(e))) }
                return
            }
        if (ns != _state.value.activeWorkspaceId) return
        val remembered = store.activeRepo(ns)
        update {
            val active =
                repos.firstOrNull { it.id == activeRepoId }?.id
                    ?: repos.firstOrNull { it.id == remembered }?.id
                    ?: repos.firstOrNull()?.id
            copy(
                repos = repos,
                reposPhase = LoadPhase.Loaded,
                activeRepoId = active,
                syncingWorkspaceId = if (repos.isNotEmpty() && syncingWorkspaceId == ns) null else syncingWorkspaceId,
            )
        }
    }

    /** Open a repo. */
    fun selectRepo(id: String) {
        update { copy(activeRepoId = id) }
        _state.value.activeWorkspaceId?.let { store.setActiveRepo(it, id) }
    }

    /**
     * Make sure the account may call the contract in a repo (joined members of the workspace are; a
     * context in an open group is joined). Best-effort.
     */
    suspend fun ensureMember(repoId: String) {
        try {
            if (!backend.isMember(repoId)) backend.joinContext(repoId)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The contract call says what is wrong, if anything is.
        }
    }

    // ---- writes ----------------------------------------------------------------------------------

    /**
     * Found a workspace and open it. Returns a hosting notice when the cloud would not host it (an
     * invitation from it will not reach anyone yet).
     */
    suspend fun createWorkspace(name: String): String? {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) throw TrackerException("Give the workspace a name.")
        val founded = backend.foundNamespace(trimmed)
        store.activeWorkspace = founded.namespaceId
        update { copy(activeWorkspaceId = founded.namespaceId, repos = emptyList(), activeRepoId = null) }
        load()
        if (_state.value.workspaces.none { it.id == founded.namespaceId }) {
            update {
                copy(
                    workspaces = workspaces + AppNamespace(founded.namespaceId, trimmed, applicationId.orEmpty()),
                    activeWorkspaceId = founded.namespaceId,
                )
            }
        }
        return if (founded.haEnabled) null else (founded.haError ?: "the cloud is not hosting it")
    }

    /** Add a repo to the active workspace: a context, then its GitHub URL in shared state. */
    @Suppress("ThrowsCount")
    suspend fun addRepo(
        name: String,
        url: String,
    ) {
        val trimmedName = name.trim()
        val trimmedUrl = url.trim()
        if (trimmedName.isEmpty()) throw TrackerException("Repo name is required")
        val ns = _state.value.activeWorkspace ?: throw TrackerException("Open a workspace first.")
        val appId = ns.applicationId.ifEmpty { applicationId.orEmpty() }
        if (appId.isEmpty()) throw TrackerException("The app's id is not known yet. Try again in a moment.")
        val contextId = backend.createContext(ns.id, appId, trimmedName, JsonObject(emptyMap()))
        store.setRepoName(contextId, trimmedName)
        if (trimmedUrl.isNotEmpty()) client(contextId).setRepoUrl(trimmedUrl)
        store.setActiveRepo(ns.id, contextId)
        update { copy(activeRepoId = contextId) }
        loadRepos()
        update {
            val list = if (repos.none { it.id == contextId }) repos + Repo(contextId, trimmedName, trimmedUrl) else repos
            copy(repos = list, activeRepoId = contextId)
        }
    }

    /** Change the active repo's GitHub URL (shared with every member). */
    suspend fun setRepoUrl(url: String) {
        val repo = _state.value.activeRepo ?: return
        val trimmed = url.trim()
        client(repo.id).setRepoUrl(trimmed)
        update { copy(repos = repos.map { if (it.id == repo.id) it.copy(url = trimmed) else it }) }
    }

    /** Mint an invitation link to the active workspace. */
    suspend fun inviteLink(): String {
        val ns = _state.value.activeWorkspace ?: throw TrackerException("Open a workspace first.")
        val signed = backend.createInvitation(ns.id)
        return TrackerInvitation(signed, displayName(ns)).link()
    }

    /**
     * Redeem an invitation and remember its workspace as the open one. The caller then reconnects the
     * session (`MeroAppSession.didJoinNamespace()`).
     */
    suspend fun join(invitation: TrackerInvitation) {
        val id = invitation.namespaceId
        if (id.isEmpty()) throw TrackerException("That invitation does not name a workspace.")
        backend.joinNamespace(id, invitation.invitation)
        store.activeWorkspace = id
        update { copy(syncingWorkspaceId = id, activeWorkspaceId = id, repos = emptyList(), activeRepoId = null) }
        load()
    }

    /** Mark a workspace as just joined, so an empty repo list reads as "syncing". */
    fun markSyncing(id: String?) = update { copy(syncingWorkspaceId = id) }

    private inline fun update(change: WorkspaceState.() -> WorkspaceState) {
        _state.value = _state.value.change()
    }

    companion object {
        /** A workspace's name as people see it. */
        fun displayName(ns: AppNamespace): String = ns.name?.trim()?.ifEmpty { null } ?: "Workspace ${ns.id.take(8)}"
    }
}
