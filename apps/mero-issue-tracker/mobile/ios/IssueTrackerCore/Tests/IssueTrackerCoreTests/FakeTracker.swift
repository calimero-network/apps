import Foundation
import MeroKit
import MeroKitTestSupport

@testable import IssueTrackerCore

/// The tracker contract in memory, behind `InMemoryAppBackend`'s recording
/// contract: enough of `logic/src/lib.rs` for the models' tests.
final class FakeTracker: @unchecked Sendable {
    let backend: InMemoryAppBackend
    private let lock = NSLock()
    private var issues: [String: [String: IssueView]] = [:]
    private var comments: [String: [CommentView]] = [:]
    private var repoURLs: [String: String] = [:]
    private var next = 0
    var failWrites: Error?

    init(account: String = String(repeating: "ab", count: 32)) {
        backend = InMemoryAppBackend(account: account)
        backend.recording.setRawHandler { [unowned self] call in
            try self.handle(call)
        }
    }

    var account: String { backend.account }

    func seed(_ issue: IssueView, in context: String) {
        lock.withLock { issues[context, default: [:]][issue.id] = issue }
    }

    func seedComment(_ comment: CommentView, in context: String) {
        lock.withLock { comments[context, default: []].append(comment) }
    }

    func issue(_ id: String, in context: String) -> IssueView? {
        lock.withLock { issues[context]?[id] }
    }

    func repoURL(_ context: String) -> String? { lock.withLock { repoURLs[context] } }

    static func issue(
        _ id: String, title: String = "Title", status: String = "Open", priority: String = "high",
        assignee: String? = nil, labels: [String] = [], createdBy: String = String(repeating: "ab", count: 32),
        createdAt: UInt64 = 1_700_000_000_000
    ) -> IssueView {
        IssueView(
            id: id, title: title, summary: "S", impact: "I", repro: "R", resolutionCriteria: "C", status: status,
            priority: priority, assignee: assignee, labels: labels, createdBy: createdBy, createdAt: createdAt)
    }

    private func handle(_ call: RecordedContractCall) throws -> Data? {
        let args = (try? JSONSerialization.jsonObject(with: call.argsJSON ?? Data("{}".utf8))) as? [String: Any] ?? [:]
        func s(_ key: String) -> String { args[key] as? String ?? "" }
        let ctx = call.contextId
        if call.path == .execute, let failWrites { throw failWrites }
        return try lock.withLock { () throws -> Data? in
            let enc = JSONEncoder()
            switch call.method {
            case "listIssues":
                return try enc.encode(Array((issues[ctx] ?? [:]).values).sorted { $0.createdAt < $1.createdAt })
            case "getIssue":
                guard let issue = issues[ctx]?[s("issueId")] else { throw TrackerError.message("issue not found") }
                let thread = (comments[ctx] ?? []).filter { $0.issueId == issue.id }
                return try enc.encode(IssueDetail(issue: issue, comments: thread))
            case "getRepoInfo":
                return try enc.encode(RepoInfo(repoUrl: repoURLs[ctx] ?? ""))
            case "setRepoUrl":
                repoURLs[ctx] = s("url")
            case "createIssue":
                next += 1
                let id = "issue-17000000000\(next)-abcdef\(next)"
                issues[ctx, default: [:]][id] = IssueView(
                    id: id, title: s("title"), summary: s("summary"), impact: s("impact"), repro: s("repro"),
                    resolutionCriteria: s("resolutionCriteria"), status: "Open", priority: s("priority"),
                    assignee: nil, labels: (args["labels"] as? [String] ?? []).sorted(), createdBy: account,
                    createdAt: 1_700_000_000_000 + UInt64(next))
                return try enc.encode(id)
            case "setStatus": update(ctx, s("issueId")) { $0.status = s("status") }
            case "setPriority": update(ctx, s("issueId")) { $0.priority = s("priority") }
            case "setAssignee": update(ctx, s("issueId")) { $0.assignee = args["assignee"] as? String }
            case "setSummary": update(ctx, s("issueId")) { $0.summary = s("summary") }
            case "setImpact": update(ctx, s("issueId")) { $0.impact = s("impact") }
            case "setRepro": update(ctx, s("issueId")) { $0.repro = s("repro") }
            case "setResolutionCriteria":
                update(ctx, s("issueId")) { $0.resolutionCriteria = s("resolutionCriteria") }
            case "addLabel":
                update(ctx, s("issueId")) { if !$0.labels.contains(s("label")) { $0.labels = ($0.labels + [s("label")]).sorted() } }
            case "removeLabel": update(ctx, s("issueId")) { $0.labels.removeAll { $0 == s("label") } }
            case "deleteIssue":
                guard issues[ctx]?[s("issueId")]?.createdBy == account else { throw TrackerError.message("only the author") }
                issues[ctx]?[s("issueId")] = nil
            case "addComment":
                next += 1
                let id = "comment-\(next)"
                comments[ctx, default: []].append(
                    CommentView(id: id, issueId: s("issueId"), author: account, body: s("body"), createdAt: UInt64(next)))
                return try enc.encode(id)
            case "editComment":
                comments[ctx] = comments[ctx]?.map {
                    var c = $0
                    if c.id == s("commentId") { c.body = s("newBody"); c.editedAt = 1 }
                    return c
                }
            case "deleteComment": comments[ctx]?.removeAll { $0.id == s("commentId") }
            default: break
            }
            return Data("null".utf8)
        }
    }

    private func update(_ ctx: String, _ id: String, _ change: (inout IssueView) -> Void) {
        guard var issue = issues[ctx]?[id] else { return }
        change(&issue)
        issues[ctx]?[id] = issue
    }
}
