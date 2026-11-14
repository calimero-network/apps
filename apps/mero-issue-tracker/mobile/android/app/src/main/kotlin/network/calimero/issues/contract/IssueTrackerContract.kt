package network.calimero.issues.contract

import kotlinx.serialization.json.Json
import network.calimero.issues.generated.IssueTrackerClient

// The tracker contract's component ABI (`logic/res/abi.json`). The calls are [IssueTrackerClient],
// generated from it by core's `meroctl app codegen` (`scripts/mobile-codegen.sh` at the repo
// root), and so are the answer types; this file keeps the method lists `ContractWireTest` pins, in
// step with the web client (`app/src/tracker.ts`) and the Swift `Contract/IssueTrackerContract.swift`.
//
// On the wire:
// - method, argument and field names are camelCase (`createIssue`, `issueId`);
// - 64-bit integers (`createdAt`, `editedAt`, a status `count`) are decimal strings; the generated
//   types read them from a string or a number and send strings;
// - a refusal is `422 APP_ERROR { code, fields }` (the SDK's `AppError`), with the codes
//   `NotFound { id }`, `Invalid { message }` and `Forbidden { message }`.

/** What the app keeps of the contract beside the generated [IssueTrackerClient]. */
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
}

// The answer types are the generated client's ([IssueTrackerClient], from the ABI).

/**
 * One issue as `listIssues` and `getIssue` answer it: `status` is one of Open, In progress, Blocked,
 * Done; `priority` `low`, `medium`, `high` or `urgent`; `assignee` free text, null when unassigned;
 * `createdBy` the filer's account id (only they may delete it); `createdAt` unix milliseconds.
 */
typealias IssueView = IssueTrackerClient.IssueView

/**
 * One comment in an issue's thread: `author` is the writer's account id (only they may edit or
 * delete it); `editedAt` is null if never edited.
 */
typealias CommentView = IssueTrackerClient.Comment

/** `getIssue`'s answer: the issue and its comments, oldest first (at most 1,000). */
typealias IssueDetail = IssueTrackerClient.IssueDetail

/** `getRepoInfo`'s answer. */
typealias RepoInfo = IssueTrackerClient.RepoInfo

/** One column's count in `getStatusCounts`. */
typealias StatusCount = IssueTrackerClient.StatusCount
