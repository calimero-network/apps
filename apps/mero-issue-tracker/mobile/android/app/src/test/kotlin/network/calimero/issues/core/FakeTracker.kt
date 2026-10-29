package network.calimero.issues.core

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.encodeToJsonElement
import network.calimero.issues.generated.CommentView
import network.calimero.issues.generated.IssueDetail
import network.calimero.issues.generated.IssueView
import network.calimero.issues.generated.RepoInfo

/** The tracker contract in memory, behind `InMemoryAppBackend`'s recording contract. */
class FakeTracker(
    account: String = "ab".repeat(32),
) {
    val backend = InMemoryAppBackend(account = account)
    private val issues = mutableMapOf<String, MutableMap<String, IssueView>>()
    private val comments = mutableMapOf<String, MutableList<CommentView>>()
    private val repoUrls = mutableMapOf<String, String>()
    private var next = 0

    @Volatile var failWrites: Exception? = null

    init {
        backend.recording.handler = { call -> synchronized(this) { handle(call) } }
    }

    val account: String get() = backend.account

    @Synchronized fun seed(
        issue: IssueView,
        context: String,
    ) {
        issues.getOrPut(context) { mutableMapOf() }[issue.id] = issue
    }

    @Synchronized fun seedComment(
        comment: CommentView,
        context: String,
    ) {
        comments.getOrPut(context) { mutableListOf() } += comment
    }

    @Synchronized fun issue(
        id: String,
        context: String,
    ): IssueView? = issues[context]?.get(id)

    @Synchronized fun repoUrl(context: String): String? = repoUrls[context]

    @Suppress("CyclomaticComplexMethod", "LongMethod", "ReturnCount", "ThrowsCount")
    private fun handle(call: RecordedContractCall): JsonElement? {
        val args = call.args as? JsonObject ?: JsonObject(emptyMap())

        fun s(key: String): String = (args[key] as? JsonPrimitive)?.contentOrNull.orEmpty()

        val ctx = call.contextId
        if (call.path == RecordedContractCall.Path.EXECUTE) failWrites?.let { throw it }
        val board = issues.getOrPut(ctx) { mutableMapOf() }

        fun update(change: (IssueView) -> IssueView) {
            board[s("issue_id")]?.let { board[it.id] = change(it) }
        }
        when (call.method) {
            "list_issues" -> return json.encodeToJsonElement(board.values.sortedBy { it.createdAt })
            "get_issue" -> {
                val issue = board[s("issue_id")] ?: throw TrackerException("issue not found")
                return json.encodeToJsonElement(IssueDetail(issue, comments[ctx].orEmpty().filter { it.issueId == issue.id }))
            }
            "get_repo_info" -> return json.encodeToJsonElement(RepoInfo(repoUrls[ctx].orEmpty()))
            "set_repo_url" -> repoUrls[ctx] = s("url")
            "create_issue" -> {
                next += 1
                val id = "issue-17000000000$next-abcdef$next"
                val labels = (args["labels"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty().sorted()
                board[id] =
                    IssueView(
                        id, s("title"), s("summary"), s("impact"), s("repro"), s("resolution_criteria"), "Open", s("priority"),
                        null, labels, account, (1_700_000_000_000L + next).toULong(),
                    )
                return JsonPrimitive(id)
            }
            "set_status" -> update { it.copy(status = s("status")) }
            "set_priority" -> update { it.copy(priority = s("priority")) }
            "set_assignee" -> update { it.copy(assignee = (args["assignee"] as? JsonPrimitive)?.contentOrNull) }
            "set_summary" -> update { it.copy(summary = s("summary")) }
            "set_impact" -> update { it.copy(impact = s("impact")) }
            "set_repro" -> update { it.copy(repro = s("repro")) }
            "set_resolution_criteria" -> update { it.copy(resolutionCriteria = s("resolution_criteria")) }
            "add_label" -> update { if (s("label") in it.labels) it else it.copy(labels = (it.labels + s("label")).sorted()) }
            "remove_label" -> update { it.copy(labels = it.labels - s("label")) }
            "delete_issue" -> {
                if (board[s("issue_id")]?.createdBy != account) throw TrackerException("only the author")
                board.remove(s("issue_id"))
            }
            "add_comment" -> {
                next += 1
                val id = "comment-$next"
                comments.getOrPut(ctx) { mutableListOf() } += CommentView(id, s("issue_id"), account, s("body"), next.toULong())
                return JsonPrimitive(id)
            }
            "edit_comment" ->
                comments[ctx]?.replaceAll { if (it.id == s("comment_id")) it.copy(body = s("new_body"), editedAt = 1u) else it }
            "delete_comment" -> comments[ctx]?.removeAll { it.id == s("comment_id") }
        }
        return JsonNull
    }

    companion object {
        private val json = Json { encodeDefaults = true }

        @Suppress("LongParameterList")
        fun issue(
            id: String,
            title: String = "Title",
            status: String = "Open",
            priority: String = "high",
            assignee: String? = null,
            labels: List<String> = emptyList(),
            createdBy: String = "ab".repeat(32),
            createdAt: Long = 1_700_000_000_000L,
        ) = IssueView(id, title, "S", "I", "R", "C", status, priority, assignee, labels, createdBy, createdAt.toULong())
    }
}
