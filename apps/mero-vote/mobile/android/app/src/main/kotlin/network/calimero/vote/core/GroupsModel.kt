package network.calimero.vote.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonObject
import network.calimero.vote.generated.Phase

/** One voting group on the home screen, with what its polls look like. */
data class GroupRow(
    val ref: GroupRef,
    /** Null until its polls have been read (or when they could not be). */
    val polls: Int?,
    val open: Int,
    /** The newest poll's question, as the row's title. */
    val latest: String?,
)

/** A workspace (namespace) and the voting groups (contexts) directly in it. */
data class WorkspaceSection(
    val namespace: AppNamespace,
    val groups: List<GroupRow>,
) {
    val name: String get() = GroupsModel.nameOf(namespace)
}

/**
 * The home screen: every workspace this account is in and the voting groups in each; creating
 * either. (Swift `GroupsModel`; the web's `ContextPicker`.)
 */
class GroupsModel(
    val backend: MeroAppBackend,
    val applicationId: String,
) {
    private val _sections = MutableStateFlow<List<WorkspaceSection>>(emptyList())
    val sections: StateFlow<List<WorkspaceSection>> = _sections.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _isCreating = MutableStateFlow(false)
    val isCreating: StateFlow<Boolean> = _isCreating.asStateFlow()

    val hasRelay: Boolean get() = backend.hasRelay

    suspend fun load() {
        if (_sections.value.isEmpty()) _phase.value = LoadPhase.Loading
        attempt {
            backend.listNamespaces().map { ns ->
                val contexts = attempt { backend.listContexts(ns.id) }.getOrDefault(emptyList())
                WorkspaceSection(ns, contexts.map { summary(GroupRef(ns.id, nameOf(ns), it)) })
            }
        }.onSuccess { next ->
            _sections.value = next.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            _phase.value = LoadPhase.Loaded
        }.onFailure {
            _phase.value = if (_sections.value.isEmpty()) LoadPhase.Failed(VoteErrorText.describe(it)) else LoadPhase.Loaded
        }
    }

    private suspend fun summary(ref: GroupRef): GroupRow {
        val polls = attempt { voteClient(backend.contract, ref.contextId).listPolls() }.getOrNull() ?: return GroupRow(ref, null, 0, null)
        return GroupRow(ref, polls.size, polls.count { it.phase == Phase.Voting }, polls.maxByOrNull { it.createdAt }?.title)
    }

    /** A new workspace with its first voting group in it: the web's one-click "Create namespace + context". */
    suspend fun createWorkspace(name: String): GroupRef {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) throw VoteModelException("Give the workspace a name.")
        _isCreating.value = true
        try {
            val founded = worded { backend.foundNamespace(trimmed) }
            var app = applicationId
            if (app.isEmpty()) {
                app =
                    attempt { backend.listNamespaces() }
                        .getOrNull()
                        ?.firstOrNull { it.id == founded.namespaceId }
                        ?.applicationId
                        .orEmpty()
            }
            val contextId = createContext(founded.namespaceId, trimmed, app)
            load()
            return GroupRef(founded.namespaceId, trimmed, contextId)
        } finally {
            _isCreating.value = false
        }
    }

    /** Another voting group in a workspace you are already in. */
    suspend fun createGroup(section: WorkspaceSection): GroupRef {
        _isCreating.value = true
        try {
            val app = applicationId.ifEmpty { section.namespace.applicationId }
            val contextId = createContext(section.namespace.id, section.name, app)
            load()
            return GroupRef(section.namespace.id, section.name, contextId)
        } finally {
            _isCreating.value = false
        }
    }

    /**
     * Directly in the namespace, not in a subgroup: the web does the same, so a context's group IS
     * its namespace and one invitation covers both.
     */
    private suspend fun createContext(
        namespaceId: String,
        name: String,
        applicationId: String,
    ): String {
        if (applicationId.isEmpty()) throw VoteModelException("Still connecting to Calimero. Try again in a moment.")
        return worded { backend.createContext(namespaceId, applicationId, name, JsonObject(emptyMap())) }
    }

    companion object {
        fun nameOf(space: AppNamespace): String = space.name?.nullIfBlank() ?: "Workspace ${space.id.take(6)}"
    }
}
