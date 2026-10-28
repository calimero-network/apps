package network.calimero.crm.app

import android.content.SharedPreferences
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import network.calimero.crm.core.CrmException
import network.calimero.crm.core.CrmInvitation
import network.calimero.crm.core.ErrorText
import network.calimero.crm.core.Money
import network.calimero.crm.core.crmClient

/** One pipeline: a context directly in its workspace's namespace, as the web app's `addPipeline` creates them. */
@Serializable
data class PipelineRef(
    val namespaceId: String,
    val contextId: String,
    val name: String,
    val workspaceName: String,
)

/** A workspace (a namespace running Mero CRM) and its pipelines. */
data class Workspace(
    val id: String,
    val name: String,
    val memberCount: Int,
    val pipelines: List<PipelineRef>,
) {
    val title: String get() = name.ifEmpty { "Unnamed workspace" }
}

/** Small string storage, so the device-local pipeline names are testable. */
interface KeyValueStore {
    fun get(key: String): String?

    fun put(
        key: String,
        value: String,
    )
}

class MemoryStore : KeyValueStore {
    private val values = HashMap<String, String>()

    override fun get(key: String): String? = values[key]

    override fun put(
        key: String,
        value: String,
    ) {
        values[key] = value
    }
}

class PreferencesStore(
    private val prefs: SharedPreferences,
) : KeyValueStore {
    override fun get(key: String): String? = prefs.getString(key, null)

    override fun put(
        key: String,
        value: String,
    ) {
        prefs.edit().putString(key, value).apply()
    }
}

/**
 * A pipeline's name is a label the creating node keeps (`createContext(name)`) plus a
 * context-metadata record the web writes and reads through the node admin API. The app backend reads
 * neither, so the names this device gave its pipelines (and the workspace names invitations carried)
 * are kept here.
 */
class LocalNames(
    private val store: KeyValueStore,
) {
    fun pipeline(contextId: String): String? = value("crm.pipeline.$contextId")

    fun setPipeline(
        contextId: String,
        name: String,
    ) = store.put("crm.pipeline.$contextId", name)

    fun workspace(namespaceId: String): String? = value("crm.workspace.$namespaceId")

    fun setWorkspace(
        namespaceId: String,
        name: String,
    ) = store.put("crm.workspace.$namespaceId", name)

    private fun value(key: String): String? = store.get(key)?.trim()?.ifEmpty { null }
}

/** The workspace list: the account's namespaces for this app, the pipelines in each, and founding, joining and inviting. */
class WorkspacesModel(
    val backend: MeroAppBackend,
    private val applicationId: String?,
    private val names: LocalNames,
) {
    private val _workspaces = MutableStateFlow<List<Workspace>>(emptyList())
    val workspaces: StateFlow<List<Workspace>> = _workspaces.asStateFlow()
    private val _hasLoaded = MutableStateFlow(false)
    val hasLoaded: StateFlow<Boolean> = _hasLoaded.asStateFlow()
    val error = MutableStateFlow<String?>(null)
    private val _isWorking = MutableStateFlow(false)
    val isWorking: StateFlow<Boolean> = _isWorking.asStateFlow()

    /** Whether a relay serves the account. Without one only joining works. */
    val hasRelay: Boolean get() = backend.hasRelay

    suspend fun load() {
        if (!backend.hasRelay) {
            _workspaces.value = emptyList()
            _hasLoaded.value = true
            return
        }
        try {
            val found =
                backend.listNamespaces().map { ns ->
                    val contexts =
                        try {
                            backend.listContexts(ns.id)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            emptyList()
                        }
                    val name = ns.name?.ifEmpty { null } ?: names.workspace(ns.id).orEmpty()
                    Workspace(ns.id, name, ns.memberCount, pipelines(ns.id, name, contexts))
                }
            _workspaces.value = found.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title })
            error.value = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        } finally {
            _hasLoaded.value = true
        }
    }

    private fun pipelines(
        namespaceId: String,
        workspaceName: String,
        contexts: List<String>,
    ): List<PipelineRef> =
        contexts.mapIndexed { index, id ->
            val fallback = if (contexts.size == 1) "Pipeline" else "Pipeline ${index + 1}"
            PipelineRef(namespaceId, id, names.pipeline(id) ?: fallback, workspaceName)
        }

    /** Found a workspace with its first pipeline. Returns the pipeline, or null with [error] set. */
    suspend fun createWorkspace(
        name: String,
        pipelineName: String,
        currency: String,
    ): PipelineRef? {
        val workspace = name.trim()
        if (!Money.isValidCode(currency)) {
            error.value = CrmException.InvalidCurrency().message
            return null
        }
        return working {
            val founded = backend.foundNamespace(workspace)
            names.setWorkspace(founded.namespaceId, workspace)
            val pipeline = createPipeline(founded.namespaceId, workspace, pipelineName, currency)
            _workspaces.value =
                (_workspaces.value + Workspace(founded.namespaceId, workspace, 1, listOf(pipeline)))
                    .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title })
            pipeline
        }
    }

    /** Add a pipeline to a workspace. Returns it, or null with [error] set. */
    suspend fun addPipeline(
        workspace: Workspace,
        name: String,
        currency: String,
    ): PipelineRef? {
        if (!Money.isValidCode(currency)) {
            error.value = CrmException.InvalidCurrency().message
            return null
        }
        return working {
            val pipeline = createPipeline(workspace.id, workspace.name, name, currency)
            _workspaces.value = _workspaces.value.map { if (it.id == workspace.id) it.copy(pipelines = it.pipelines + pipeline) else it }
            pipeline
        }
    }

    private suspend fun createPipeline(
        namespaceId: String,
        workspaceName: String,
        name: String,
        currency: String,
    ): PipelineRef {
        val label = name.trim().ifEmpty { "Sales" }
        val app = applicationIdFor(namespaceId)
        val contextId = backend.createContext(namespaceId, app, label, JsonObject(emptyMap()))
        names.setPipeline(contextId, label)
        val code = currency.trim().uppercase()
        // Like the web: a new pipeline starts in USD, and a failed switch stays USD until changed in Settings.
        if (code != "USD") {
            try {
                crmClient(backend, contextId).setCurrency(code)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Best effort.
            }
        }
        return PipelineRef(namespaceId, contextId, label, workspaceName)
    }

    /** The application a new pipeline runs: the session's, else the one its namespace was founded with. */
    private suspend fun applicationIdFor(namespaceId: String): String {
        if (!applicationId.isNullOrEmpty()) return applicationId
        return backend
            .listNamespaces()
            .firstOrNull { it.id == namespaceId }
            ?.applicationId
            ?.ifEmpty { null } ?: throw CrmException.NoApplication()
    }

    /** Redeem an invitation and reload. Returns the joined workspace's id, or null with [error] set. */
    suspend fun join(invitation: CrmInvitation): String? {
        working {
            backend.joinNamespace(invitation.namespaceId, invitation.invitation)
            invitation.workspaceName?.let { names.setWorkspace(invitation.namespaceId, it) }
        } ?: return null
        load()
        if (_workspaces.value.none { it.id == invitation.namespaceId }) {
            _workspaces.value = _workspaces.value + Workspace(invitation.namespaceId, invitation.workspaceName.orEmpty(), 0, emptyList())
        }
        return invitation.namespaceId
    }

    /** Mint an invitation link to a workspace. */
    suspend fun inviteLink(workspace: Workspace): String? =
        working {
            val signed = backend.createInvitation(workspace.id)
            CrmInvitation(signed, workspace.name).link()
        }

    fun workspace(id: String): Workspace? = _workspaces.value.firstOrNull { it.id == id }

    private suspend fun <T> working(body: suspend () -> T): T? {
        _isWorking.value = true
        return try {
            val result = body()
            error.value = null
            result
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            null
        } finally {
            _isWorking.value = false
        }
    }
}
