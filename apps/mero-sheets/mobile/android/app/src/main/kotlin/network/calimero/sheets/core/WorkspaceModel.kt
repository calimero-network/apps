package network.calimero.sheets.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonObject
import network.calimero.sheets.generated.SheetsClient
import kotlin.coroutines.cancellation.CancellationException

/** One spreadsheet: a context bound directly to the workspace's namespace root. */
data class SpreadsheetItem(
    val id: String,
    val name: String,
    /** True when the name is a placeholder, not something anyone typed. */
    val unnamed: Boolean = false,
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
    val spreadsheets: List<SpreadsheetItem> = emptyList(),
    val phase: LoadPhase = LoadPhase.Idle,
    val spreadsheetsPhase: LoadPhase = LoadPhase.Idle,
    /** A workspace joined from an invitation whose spreadsheets have not arrived yet. */
    val syncingWorkspaceId: String? = null,
) {
    val activeWorkspace: AppNamespace? get() = workspaces.firstOrNull { it.id == activeWorkspaceId }
    val isSyncing: Boolean get() = syncingWorkspaceId != null && syncingWorkspaceId == activeWorkspaceId && spreadsheets.isEmpty()

    fun spreadsheet(id: String): SpreadsheetItem? = spreadsheets.firstOrNull { it.id == id }
}

/**
 * Workspaces (namespaces) and their spreadsheets (contexts), the web app's picker
 * (`app/src/lib/workspaces.ts`): switching, founding a workspace, creating a spreadsheet, inviting
 * and joining.
 */
class WorkspaceModel(
    val backend: MeroAppBackend,
    private val applicationId: String?,
    private val store: SheetsStore,
) {
    private val _state = MutableStateFlow(WorkspaceState())
    val state: StateFlow<WorkspaceState> = _state.asStateFlow()

    val account: String get() = backend.account
    val hasRelay: Boolean get() = backend.hasRelay

    /** The contract in a spreadsheet. */
    fun client(contextId: String): SheetsClient = sheetsClient(backend.contract, contextId)

    // ---- loading ---------------------------------------------------------------------------------

    /** List workspaces and open the remembered one (or the first), then its spreadsheets. */
    suspend fun load() {
        if (_state.value.workspaces.isEmpty()) update { copy(phase = LoadPhase.Loading) }
        val list =
            try {
                backend.listNamespaces().sortedBy { displayName(it).lowercase() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                update { copy(phase = LoadPhase.Failed(SheetsFormat.errorText(e))) }
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
                copy(workspaces = list, phase = LoadPhase.Loaded, activeWorkspaceId = next, spreadsheets = emptyList())
            } else {
                copy(workspaces = list, phase = LoadPhase.Loaded)
            }
        }
        if (next != null) store.activeWorkspace = next
        loadSpreadsheets()
    }

    /** Switch to another workspace. */
    suspend fun selectWorkspace(id: String) {
        if (id == _state.value.activeWorkspaceId) return
        store.activeWorkspace = id
        update { copy(activeWorkspaceId = id, spreadsheets = emptyList()) }
        loadSpreadsheets()
    }

    /**
     * The active workspace's spreadsheets, named by their workbook (`get_project`), else the name this
     * device gave, else a placeholder.
     */
    suspend fun loadSpreadsheets() {
        val ns =
            _state.value.activeWorkspaceId ?: run {
                update { copy(spreadsheets = emptyList(), spreadsheetsPhase = LoadPhase.Loaded) }
                return
            }
        if (_state.value.spreadsheets.isEmpty()) update { copy(spreadsheetsPhase = LoadPhase.Loading) }
        val items =
            try {
                val ids = backend.listContexts(ns)
                val names =
                    coroutineScope {
                        ids
                            .map { id ->
                                async {
                                    id to
                                        try {
                                            client(id).getProject().name.trim()
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
                        val name = names[id].orEmpty()
                        when {
                            name.isNotEmpty() -> SpreadsheetItem(id, name)
                            store.spreadsheetName(id) != null -> SpreadsheetItem(id, store.spreadsheetName(id)!!)
                            else -> SpreadsheetItem(id, fallbackName(id), unnamed = true)
                        }
                    }.sortedBy { it.name.lowercase() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                update { copy(spreadsheetsPhase = LoadPhase.Failed(SheetsFormat.errorText(e))) }
                return
            }
        if (ns != _state.value.activeWorkspaceId) return
        update {
            copy(
                spreadsheets = items,
                spreadsheetsPhase = LoadPhase.Loaded,
                syncingWorkspaceId = if (items.isNotEmpty() && syncingWorkspaceId == ns) null else syncingWorkspaceId,
            )
        }
    }

    /**
     * Make sure the account may call the contract in a spreadsheet (members of the workspace are; a
     * context in an open group is joined). Best-effort.
     */
    suspend fun ensureMember(contextId: String) {
        try {
            if (!backend.isMember(contextId)) backend.joinContext(contextId)
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
        if (trimmed.isEmpty()) throw SheetsException("Give the workspace a name.")
        val founded = backend.foundNamespace(trimmed)
        store.activeWorkspace = founded.namespaceId
        update { copy(activeWorkspaceId = founded.namespaceId, spreadsheets = emptyList()) }
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

    /**
     * Create a spreadsheet in the active workspace, as the web does: a context, then
     * `init_project(name)` (the workbook's title, which every member reads) and its first tab. Returns
     * the new spreadsheet's id.
     */
    @Suppress("ThrowsCount")
    suspend fun createSpreadsheet(name: String): String {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) throw SheetsException("Give the spreadsheet a name.")
        val ns = _state.value.activeWorkspace ?: throw SheetsException("Open a workspace first.")
        val appId = ns.applicationId.ifEmpty { applicationId.orEmpty() }
        if (appId.isEmpty()) throw SheetsException("The app's id is not known yet. Try again in a moment.")
        val contextId = backend.createContext(ns.id, appId, trimmed, JsonObject(emptyMap()))
        store.setSpreadsheetName(contextId, trimmed)
        val client = client(contextId)
        client.initProject(trimmed)
        client.createSheet(MeroSheets.FIRST_SHEET_NAME)
        loadSpreadsheets()
        if (_state.value.spreadsheets.none { it.id == contextId }) {
            update { copy(spreadsheets = spreadsheets + SpreadsheetItem(contextId, trimmed)) }
        }
        return contextId
    }

    /** Mint an invitation link to the active workspace; [spreadsheet] (the one open) is opened for whoever joins. */
    suspend fun inviteLink(spreadsheet: SpreadsheetItem? = null): String {
        val ns = _state.value.activeWorkspace ?: throw SheetsException("Open a workspace first.")
        val signed = backend.createInvitation(ns.id)
        return SheetsInvitation(
            signed,
            displayName(ns),
            spreadsheet?.id,
            spreadsheet?.takeIf { !it.unnamed }?.name,
        ).link()
    }

    /**
     * Redeem an invitation and remember its workspace as the open one. The caller then reconnects the
     * session (`MeroAppSession.didJoinNamespace()`).
     */
    suspend fun join(invitation: SheetsInvitation) {
        val id = invitation.namespaceId
        if (id.isEmpty()) throw SheetsException("That invitation does not name a workspace.")
        backend.joinNamespace(id, invitation.invitation)
        store.activeWorkspace = id
        update { copy(syncingWorkspaceId = id, activeWorkspaceId = id, spreadsheets = emptyList()) }
        load()
    }

    /** Mark a workspace as just joined, so an empty list reads as "syncing". */
    fun markSyncing(id: String?) = update { copy(syncingWorkspaceId = id) }

    private inline fun update(change: WorkspaceState.() -> WorkspaceState) {
        _state.value = _state.value.change()
    }

    companion object {
        /** A workspace's name as people see it (`namespaceLabel`). */
        fun displayName(ns: AppNamespace): String = ns.name?.trim()?.ifEmpty { null } ?: "Mero Sheets · ${ns.id.take(6)}"

        /** A spreadsheet whose own name has not resolved yet (`spreadsheetFallbackLabel`). */
        fun fallbackName(contextId: String): String = "Untitled · ${contextId.take(6)}"
    }
}
