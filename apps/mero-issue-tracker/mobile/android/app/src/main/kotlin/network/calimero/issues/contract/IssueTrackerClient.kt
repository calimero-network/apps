package network.calimero.issues.contract

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

// The tracker contract's component ABI (`logic/res/abi.json`, `calimero:app@0.5.0`), typed for the
// screens. Written by hand: abi-codegen has no target for a component ABI yet. Keep in step with
// the web client (`app/src/tracker.ts`) and the Swift one (`ios/.../Contract/IssueTrackerClient.swift`);
// `ContractWireTest` pins the method list and the argument names.
//
// On the wire:
// - method, argument and field names are camelCase (`createIssue`, `issueId`);
// - 64-bit integers (`createdAt`, `editedAt`, a status `count`) are decimal strings; they are read
//   from a string or a number and sent as strings;
// - a refusal is `422 APP_ERROR { code, fields }` (the SDK's `AppError`), with the codes
//   `NotFound { id }`, `Invalid { message }` and `Forbidden { message }`.

/**
 * Carries one call to an app instance and returns the method's JSON result. [query] runs a view and
 * [execute] runs a call; both take the arguments as a JSON object.
 */
interface ContextContractCalling {
    suspend fun query(
        method: String,
        argsJson: String,
    ): String

    suspend fun execute(
        method: String,
        argsJson: String,
    ): String
}

/** Typed calls to the tracker contract in one repository (app instance). */
@Suppress("TooManyFunctions")
class IssueTrackerClient(
    private val transport: ContextContractCalling,
) {
    // ---- views -----------------------------------------------------------------------------

    /** The repository's URL (`""` when unset). */
    suspend fun getRepoInfo(): RepoInfo = view("getRepoInfo", args(), RepoInfo.serializer())

    /** Issues oldest first, at most the first 1,000 matches; null is no filter. */
    suspend fun listIssues(
        status: String? = null,
        assignee: String? = null,
        label: String? = null,
    ): List<IssueView> =
        view(
            "listIssues",
            args("status" to text(status), "assignee" to text(assignee), "label" to text(label)),
            ListSerializer(IssueView.serializer()),
        )

    /** One issue and its thread. `AppError` `NotFound` for an unknown issue. */
    suspend fun getIssue(issueId: String): IssueDetail = view("getIssue", args("issueId" to text(issueId)), IssueDetail.serializer())

    /** Issues per status, in column order: Open, In progress, Blocked, Done. */
    suspend fun getStatusCounts(): List<StatusCount> = view("getStatusCounts", args(), ListSerializer(StatusCount.serializer()))

    // ---- calls -----------------------------------------------------------------------------

    suspend fun setRepoUrl(url: String) = call("setRepoUrl", args("url" to text(url)))

    /** File an issue; answers its id. New issues start in status `Open`. */
    @Suppress("LongParameterList")
    suspend fun createIssue(
        title: String,
        summary: String,
        impact: String,
        repro: String,
        resolutionCriteria: String,
        priority: String,
        labels: List<String>? = null,
    ): String =
        callForId(
            "createIssue",
            args(
                "title" to text(title),
                "summary" to text(summary),
                "impact" to text(impact),
                "repro" to text(repro),
                "resolutionCriteria" to text(resolutionCriteria),
                "priority" to text(priority),
                "labels" to JsonArray(labels.orEmpty().map(::JsonPrimitive)),
            ),
        )

    suspend fun setStatus(
        issueId: String,
        status: String,
    ) = call("setStatus", args("issueId" to text(issueId), "status" to text(status)))

    suspend fun setSummary(
        issueId: String,
        summary: String,
    ) = call("setSummary", args("issueId" to text(issueId), "summary" to text(summary)))

    suspend fun setImpact(
        issueId: String,
        impact: String,
    ) = call("setImpact", args("issueId" to text(issueId), "impact" to text(impact)))

    suspend fun setRepro(
        issueId: String,
        repro: String,
    ) = call("setRepro", args("issueId" to text(issueId), "repro" to text(repro)))

    suspend fun setResolutionCriteria(
        issueId: String,
        resolutionCriteria: String,
    ) = call("setResolutionCriteria", args("issueId" to text(issueId), "resolutionCriteria" to text(resolutionCriteria)))

    suspend fun setPriority(
        issueId: String,
        priority: String,
    ) = call("setPriority", args("issueId" to text(issueId), "priority" to text(priority)))

    /** Null clears the assignee (sent as an explicit `null`). */
    suspend fun setAssignee(
        issueId: String,
        assignee: String? = null,
    ) = call("setAssignee", args("issueId" to text(issueId), "assignee" to text(assignee)))

    suspend fun addLabel(
        issueId: String,
        label: String,
    ) = call("addLabel", args("issueId" to text(issueId), "label" to text(label)))

    suspend fun removeLabel(
        issueId: String,
        label: String,
    ) = call("removeLabel", args("issueId" to text(issueId), "label" to text(label)))

    /** Post a comment; answers its id. */
    suspend fun addComment(
        issueId: String,
        body: String,
    ): String = callForId("addComment", args("issueId" to text(issueId), "body" to text(body)))

    /** `AppError` `Forbidden` for anyone but the author. */
    suspend fun editComment(
        commentId: String,
        newBody: String,
    ) = call("editComment", args("commentId" to text(commentId), "newBody" to text(newBody)))

    suspend fun deleteComment(commentId: String) = call("deleteComment", args("commentId" to text(commentId)))

    /** Delete an issue with its labels and whole thread. `AppError` `Forbidden` for anyone but its creator. */
    suspend fun deleteIssue(issueId: String) = call("deleteIssue", args("issueId" to text(issueId)))

    // ---- transport -------------------------------------------------------------------------

    private suspend fun <T> view(
        method: String,
        args: JsonObject,
        answer: KSerializer<T>,
    ): T = json.decodeFromString(answer, transport.query(method, args.toString()))

    private suspend fun call(
        method: String,
        args: JsonObject,
    ) {
        transport.execute(method, args.toString())
    }

    private suspend fun callForId(
        method: String,
        args: JsonObject,
    ): String = json.decodeFromString(String.serializer(), transport.execute(method, args.toString()))

    companion object {
        /** The contract's calls (writes), by their ABI names. */
        val CALLS =
            listOf(
                "setRepoUrl", "createIssue", "setStatus", "setSummary", "setImpact", "setRepro", "setResolutionCriteria",
                "setPriority", "setAssignee", "addLabel", "removeLabel", "addComment", "editComment", "deleteComment",
                "deleteIssue",
            )

        /** The contract's views (reads), by their ABI names. */
        val VIEWS = listOf("getRepoInfo", "listIssues", "getIssue", "getStatusCounts")

        val json = Json { ignoreUnknownKeys = true }

        private fun args(vararg fields: Pair<String, JsonElement>) = JsonObject(mapOf(*fields))

        private fun text(value: String?): JsonElement = value?.let(::JsonPrimitive) ?: JsonNull
    }
}

/** A u64 the contract sends as a decimal string; a JSON number is read too. Sent as a string. */
object U64AsString : KSerializer<ULong> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("U64AsString", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: ULong,
    ) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): ULong {
        val text =
            if (decoder is JsonDecoder) {
                (decoder.decodeJsonElement() as? JsonPrimitive)?.contentOrNull
            } else {
                decoder.decodeString()
            }
        return text?.toULongOrNull() ?: throw SerializationException("not a u64: $text")
    }
}

/** One issue as `listIssues` and `getIssue` answer it. */
@Serializable
data class IssueView(
    val id: String,
    val title: String,
    val summary: String,
    val impact: String,
    val repro: String,
    val resolutionCriteria: String,
    /** One of Open, In progress, Blocked, Done. */
    val status: String,
    /** `low`, `medium`, `high` or `urgent`. */
    val priority: String,
    /** Free text; null when unassigned. */
    val assignee: String? = null,
    val labels: List<String> = emptyList(),
    /** The filer's account id: only they may delete it. */
    val createdBy: String,
    /** Unix milliseconds. */
    @Serializable(with = U64AsString::class) val createdAt: ULong,
)

/** One comment in an issue's thread. */
@Serializable
data class CommentView(
    val id: String,
    val issueId: String,
    /** The writer's account id: only they may edit or delete it. */
    val author: String,
    val body: String,
    /** Unix milliseconds. */
    @Serializable(with = U64AsString::class) val createdAt: ULong,
    /** Unix milliseconds of the last edit; null if never edited. */
    @Serializable(with = U64AsString::class) val editedAt: ULong? = null,
)

/** `getIssue`'s answer: the issue and its comments, oldest first (at most 1,000). */
@Serializable
data class IssueDetail(
    val issue: IssueView,
    val comments: List<CommentView>,
)

/** `getRepoInfo`'s answer. */
@Serializable
data class RepoInfo(
    val repoUrl: String,
)

/** One column's count in `getStatusCounts`. */
@Serializable
data class StatusCount(
    /** One of Open, In progress, Blocked, Done. */
    val status: String,
    @Serializable(with = U64AsString::class) val count: ULong,
)
