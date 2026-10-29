package network.calimero.issues.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.issues.generated.CommentView
import network.calimero.issues.generated.IssueTrackerClient
import network.calimero.issues.generated.IssueView
import kotlin.coroutines.cancellation.CancellationException

/** The Edit sheet's four sections. */
data class SectionsDraft(
    val summary: String,
    val impact: String,
    val repro: String,
    val resolution: String,
) {
    constructor(issue: IssueView) : this(issue.summary, issue.impact, issue.repro, issue.resolutionCriteria)

    val isValid: Boolean get() = listOf(summary, impact, repro, resolution).all { it.isNotBlank() }
}

/** Everything the issue screen shows. */
data class IssueDetailState(
    val issue: IssueView? = null,
    val comments: List<CommentView> = emptyList(),
    val phase: LoadPhase = LoadPhase.Idle,
    val notice: String? = null,
    val isWorking: Boolean = false,
    /** Set once the issue is deleted (here, or by its author elsewhere). */
    val isGone: Boolean = false,
)

/** One issue: its four sections, properties, comment thread, and every write on it. */
class IssueDetailModel(
    private val client: IssueTrackerClient,
    val issueId: String,
    account: String,
    seed: IssueView? = null,
) {
    private val account = account.lowercase()
    private val _state = MutableStateFlow(IssueDetailState(issue = seed))
    val state: StateFlow<IssueDetailState> = _state.asStateFlow()

    /** Only an issue's author may delete it (the contract enforces it too). */
    val isCreator: Boolean get() =
        _state.value.issue
            ?.createdBy
            ?.lowercase() == account

    /** Only a comment's author may edit or delete it. */
    fun isMine(comment: CommentView): Boolean = comment.author.lowercase() == account

    suspend fun load() {
        if (_state.value.issue == null) update { copy(phase = LoadPhase.Loading) }
        try {
            val detail = client.getIssue(issueId)
            update { copy(issue = detail.issue, comments = detail.comments.sortedBy { it.createdAt }, phase = LoadPhase.Loaded) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val text = TrackerFormat.errorText(e)
            update {
                when {
                    text.contains("not found", ignoreCase = true) || text.contains("no such", ignoreCase = true) ->
                        copy(
                            isGone = issue != null || phase == LoadPhase.Loading,
                            phase = LoadPhase.Failed("Issue not found. It may have been deleted, or it has not reached this device yet."),
                        )
                    issue == null -> copy(phase = LoadPhase.Failed(text))
                    else -> copy(notice = text)
                }
            }
        }
    }

    suspend fun setStatus(status: String) {
        if (status == _state.value.issue?.status) return
        perform { it.setStatus(issueId, status) }
    }

    suspend fun setPriority(priority: String) {
        if (priority == _state.value.issue?.priority) return
        perform { it.setPriority(issueId, priority) }
    }

    /** Free text, as on the web; empty unassigns. */
    suspend fun setAssignee(assignee: String) {
        val next = assignee.trim()
        if (next ==
            _state.value.issue
                ?.assignee
                .orEmpty()
        ) {
            return
        }
        perform { it.setAssignee(issueId, next.ifEmpty { null }) }
    }

    suspend fun addLabel(label: String): Boolean {
        val l = label.trim()
        if (l.isEmpty()) return false
        return perform { it.addLabel(issueId, l) }
    }

    suspend fun removeLabel(label: String) {
        perform { it.removeLabel(issueId, label) }
    }

    suspend fun addComment(body: String): Boolean {
        val text = body.trim()
        if (text.isEmpty()) return false
        return perform { it.addComment(issueId, text) }
    }

    suspend fun editComment(
        commentId: String,
        body: String,
    ): Boolean {
        val text = body.trim()
        if (text.isEmpty()) return false
        if (_state.value.comments
                .firstOrNull { it.id == commentId }
                ?.body == text
        ) {
            return true
        }
        return perform { it.editComment(commentId, text) }
    }

    suspend fun deleteComment(commentId: String) {
        perform { it.deleteComment(commentId) }
    }

    /** Save the sections that changed (`set_summary`, `set_impact`, `set_repro`, `set_resolution_criteria`). */
    suspend fun saveSections(draft: SectionsDraft): Boolean {
        val issue = _state.value.issue ?: return false
        if (!draft.isValid) {
            update { copy(notice = "All four sections are required.") }
            return false
        }
        return perform { c ->
            if (draft.summary.trim() != issue.summary) c.setSummary(issueId, draft.summary.trim())
            if (draft.impact.trim() != issue.impact) c.setImpact(issueId, draft.impact.trim())
            if (draft.repro.trim() != issue.repro) c.setRepro(issueId, draft.repro.trim())
            if (draft.resolution.trim() != issue.resolutionCriteria) c.setResolutionCriteria(issueId, draft.resolution.trim())
        }
    }

    /** Delete the issue (author only). True when it is gone. */
    suspend fun delete(): Boolean {
        update { copy(isWorking = true) }
        return try {
            client.deleteIssue(issueId)
            update { copy(isGone = true, isWorking = false) }
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            update { copy(notice = TrackerFormat.errorText(e), isWorking = false) }
            false
        }
    }

    fun fixPrompt(repoUrl: String?): String? = _state.value.issue?.let { TrackerFormat.fixPrompt(it, repoUrl) }

    fun dismissNotice() = update { copy(notice = null) }

    private suspend fun perform(write: suspend (IssueTrackerClient) -> Unit): Boolean {
        update { copy(isWorking = true) }
        return try {
            write(client)
            load()
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            update { copy(notice = TrackerFormat.errorText(e)) }
            false
        } finally {
            update { copy(isWorking = false) }
        }
    }

    private inline fun update(change: IssueDetailState.() -> IssueDetailState) {
        _state.value = _state.value.change()
    }
}
