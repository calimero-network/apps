package network.calimero.issues.contract

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.serializer

// The tracker contract's component ABI (`logic/res/abi.json`). The calls are
// [network.calimero.issues.generated.IssueTrackerClient], generated from it by core's `mero-app-build
// codegen` (`scripts/mobile-codegen.sh` at the repo root); this file keeps the method lists
// `ContractWireTest` pins and the answer types, in step with the web client (`app/src/tracker.ts`)
// and the Swift `Contract/IssueTrackerContract.swift`.
//
// On the wire:
// - method, argument and field names are camelCase (`createIssue`, `issueId`);
// - 64-bit integers (`createdAt`, `editedAt`, a status `count`) are decimal strings; they are read
//   from a string or a number and sent as strings;
// - a refusal is `422 APP_ERROR { code, fields }` (the SDK's `AppError`), with the codes
//   `NotFound { id }`, `Invalid { message }` and `Forbidden { message }`.

/** What the app keeps of the contract beside the generated [network.calimero.issues.generated.IssueTrackerClient]. */
object IssueTrackerContract {
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

    /**
     * An answer of the generated client as the app type [T]. The ABI names `IssueView`,
     * `IssueDetail`, `RepoInfo` and `StatusCount` without their shape until the logic derives
     * `AbiType`, so the client answers their JSON.
     */
    inline fun <reified T> read(answer: JsonElement): T = json.decodeFromJsonElement(serializer<T>(), answer)
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
