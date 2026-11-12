import Foundation
import MeroKit

// The tracker contract's component ABI (`logic/res/abi.json`). The calls are `IssueTrackerClient`,
// generated from it into `Generated/` by core's `mero-app-build codegen` (`scripts/mobile-codegen.sh`
// at the repo root), and so are the answer types; this file keeps the method lists
// `ContractWireTests` pins, in step with the web client (`app/src/tracker.ts`) and the Kotlin
// `contract/IssueTrackerContract.kt`.
//
// On the wire:
// - method, argument and field names are camelCase (`createIssue`, `issueId`);
// - 64-bit integers (`createdAt`, `editedAt`, a status `count`) are decimal
//   strings; the generated types decode them from a string or a number and send strings;
// - a refusal is `422 APP_ERROR { code, fields }` (MeroKit's `AppError`), with
//   the codes `NotFound { id }`, `Invalid { message }` and `Forbidden { message }`.

extension IssueTrackerClient {
    /// The contract's calls (writes), by their ABI names.
    public static let calls = [
        "setRepoUrl", "createIssue", "setStatus", "setSummary", "setImpact", "setRepro", "setResolutionCriteria",
        "setPriority", "setAssignee", "addLabel", "removeLabel", "addComment", "editComment", "deleteComment",
        "deleteIssue",
    ]
    /// The contract's views (reads), by their ABI names.
    public static let views = ["getRepoInfo", "listIssues", "getIssue", "getStatusCounts"]
}

// MARK: - Answers

// The answer types are the generated client's (`Generated/IssueTrackerClient.swift`, from the ABI).

/// One issue as `listIssues` and `getIssue` answer it: `status` is one of Open, In progress,
/// Blocked, Done; `priority` `low`, `medium`, `high` or `urgent`; `createdBy` the filer's account
/// id (only they may delete it); `createdAt` unix milliseconds.
public typealias IssueView = IssueTrackerClient.IssueView
/// One comment in an issue's thread: `author` is the writer's account id (only they may edit or
/// delete it); `editedAt` is `nil` if never edited.
public typealias CommentView = IssueTrackerClient.Comment
/// `getIssue`'s answer: the issue and its comments, oldest first (at most 1,000).
public typealias IssueDetail = IssueTrackerClient.IssueDetail
/// `getRepoInfo`'s answer.
public typealias RepoInfo = IssueTrackerClient.RepoInfo
/// One column's count in `getStatusCounts`.
public typealias StatusCount = IssueTrackerClient.StatusCount
