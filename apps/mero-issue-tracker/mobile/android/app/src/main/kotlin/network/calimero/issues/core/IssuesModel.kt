package network.calimero.issues.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.issues.generated.IssueTrackerClient
import network.calimero.issues.generated.IssueView
import kotlin.coroutines.cancellation.CancellationException

/** The list's filters: the web app's Status / Priority / Assignee / Label chips. */
data class IssueFilters(
    val status: String = "",
    val priority: String = "",
    val assignee: String = "",
    val label: String = "",
) {
    val activeCount: Int get() = listOf(status, priority, assignee, label).count { it.isNotEmpty() }
    val isActive: Boolean get() = activeCount > 0

    fun matches(issue: IssueView): Boolean {
        if (status.isNotEmpty() && issue.status != status) return false
        if (priority.isNotEmpty() && issue.priority != priority) return false
        val who = assignee.trim()
        if (who.isNotEmpty() && !issue.assignee.orEmpty().equals(who, ignoreCase = true)) return false
        val tag = label.trim()
        return tag.isEmpty() || issue.labels.any { it.equals(tag, ignoreCase = true) }
    }
}

/** What the New issue sheet collects. All four sections are required, as on the web. */
data class IssueDraft(
    val title: String = "",
    val summary: String = "",
    val impact: String = "",
    val repro: String = "",
    val resolution: String = "",
    val priority: String = Tracker.DEFAULT_PRIORITY,
    val labels: String = "",
) {
    val isValid: Boolean get() = listOf(title, summary, impact, repro, resolution).all { it.isNotBlank() }
}

/** One status group of the list. */
data class StatusSection(
    val status: String,
    val issues: List<IssueView>,
)

/** Everything the list and the board show. */
data class IssuesState(
    val issues: List<IssueView> = emptyList(),
    val phase: LoadPhase = LoadPhase.Idle,
    /** A failure to show over content that is still there. */
    val notice: String? = null,
    val filters: IssueFilters = IssueFilters(),
    val query: String = "",
) {
    /** Filtered and searched, newest first. */
    val visible: List<IssueView> get() = issues.filter { filters.matches(it) && TrackerFormat.matches(it, query) }

    /** The list: non-empty status groups in board order. */
    val sections: List<StatusSection>
        get() {
            val shown = visible
            return Tracker.statuses.mapNotNull { status ->
                shown.filter { it.status == status }.takeIf { it.isNotEmpty() }?.let { StatusSection(status, it) }
            }
        }

    /** One board column (search applies, filters do not: the board shows every status). */
    fun column(status: String): List<IssueView> = issues.filter { it.status == status && TrackerFormat.matches(it, query) }

    /** Labels and assignees in use, for the filter suggestions. */
    val knownLabels: List<String> get() = issues.flatMap { it.labels }.toSortedSet().toList()
    val knownAssignees: List<String>
        get() = issues.mapNotNull { it.assignee?.trim()?.ifEmpty { null } }.toSortedSet().toList()
}

/**
 * A repo's issues: the list (grouped by status, filtered, searched) and the board (one column per
 * status, moved with "Move to…").
 */
class IssuesModel(
    private val client: IssueTrackerClient,
    val repoId: String,
) {
    private val _state = MutableStateFlow(IssuesState())
    val state: StateFlow<IssuesState> = _state.asStateFlow()

    /** Read every issue. The first read shows a spinner; later ones keep the list. */
    suspend fun load() {
        val s = _state.value
        if (s.issues.isEmpty() && s.phase != LoadPhase.Loaded) update { copy(phase = LoadPhase.Loading) }
        try {
            val list = client.listIssues().sortedByDescending { it.createdAt }
            update { copy(issues = list, phase = LoadPhase.Loaded, notice = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val text = TrackerFormat.errorText(e)
            update { if (issues.isEmpty()) copy(phase = LoadPhase.Failed(text)) else copy(notice = text) }
        }
    }

    /** Move an issue to another column. Shown at once; put back if the write fails. */
    suspend fun move(
        issueId: String,
        status: String,
    ) {
        val before = _state.value.issues.firstOrNull { it.id == issueId } ?: return
        if (before.status == status) return
        update { copy(issues = issues.map { if (it.id == issueId) it.copy(status = status) else it }) }
        try {
            client.setStatus(issueId, status)
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            update { copy(issues = issues.map { if (it.id == issueId) before else it }, notice = TrackerFormat.errorText(e)) }
        }
    }

    /** File an issue; returns its id. */
    suspend fun create(draft: IssueDraft): String {
        if (!draft.isValid) throw TrackerException("All four sections are required.")
        val id =
            client.createIssue(
                draft.title.trim(),
                draft.summary.trim(),
                draft.impact.trim(),
                draft.repro.trim(),
                draft.resolution.trim(),
                draft.priority,
                TrackerFormat.parseLabels(draft.labels),
            )
        load()
        return id
    }

    fun setFilters(filters: IssueFilters) = update { copy(filters = filters) }

    fun setQuery(query: String) = update { copy(query = query) }

    fun clearFilters() = update { copy(filters = IssueFilters()) }

    fun dismissNotice() = update { copy(notice = null) }

    private inline fun update(change: IssuesState.() -> IssuesState) {
        _state.value = _state.value.change()
    }
}
