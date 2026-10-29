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
            case "list_issues":
                return try enc.encode(Array((issues[ctx] ?? [:]).values).sorted { $0.createdAt < $1.createdAt })
            case "get_issue":
                guard let issue = issues[ctx]?[s("issue_id")] else { throw TrackerError.message("issue not found") }
                let thread = (comments[ctx] ?? []).filter { $0.issueId == issue.id }
                return try enc.encode(IssueDetail(issue: issue, comments: thread))
            case "get_repo_info":
                return try enc.encode(RepoInfo(repoUrl: repoURLs[ctx] ?? ""))
            case "set_repo_url":
                repoURLs[ctx] = s("url")
            case "create_issue":
                next += 1
                let id = "issue-17000000000\(next)-abcdef\(next)"
                issues[ctx, default: [:]][id] = IssueView(
                    id: id, title: s("title"), summary: s("summary"), impact: s("impact"), repro: s("repro"),
                    resolutionCriteria: s("resolution_criteria"), status: "Open", priority: s("priority"),
                    assignee: nil, labels: (args["labels"] as? [String] ?? []).sorted(), createdBy: account,
                    createdAt: 1_700_000_000_000 + UInt64(next))
                return try enc.encode(id)
            case "set_status": update(ctx, s("issue_id")) { $0.status = s("status") }
            case "set_priority": update(ctx, s("issue_id")) { $0.priority = s("priority") }
            case "set_assignee": update(ctx, s("issue_id")) { $0.assignee = args["assignee"] as? String }
            case "set_summary": update(ctx, s("issue_id")) { $0.summary = s("summary") }
            case "set_impact": update(ctx, s("issue_id")) { $0.impact = s("impact") }
            case "set_repro": update(ctx, s("issue_id")) { $0.repro = s("repro") }
            case "set_resolution_criteria":
                update(ctx, s("issue_id")) { $0.resolutionCriteria = s("resolution_criteria") }
            case "add_label":
                update(ctx, s("issue_id")) { if !$0.labels.contains(s("label")) { $0.labels = ($0.labels + [s("label")]).sorted() } }
            case "remove_label": update(ctx, s("issue_id")) { $0.labels.removeAll { $0 == s("label") } }
            case "delete_issue":
                guard issues[ctx]?[s("issue_id")]?.createdBy == account else { throw TrackerError.message("only the author") }
                issues[ctx]?[s("issue_id")] = nil
            case "add_comment":
                next += 1
                let id = "comment-\(next)"
                comments[ctx, default: []].append(
                    CommentView(id: id, issueId: s("issue_id"), author: account, body: s("body"), createdAt: UInt64(next)))
                return try enc.encode(id)
            case "edit_comment":
                comments[ctx] = comments[ctx]?.map {
                    var c = $0
                    if c.id == s("comment_id") { c.body = s("new_body"); c.editedAt = 1 }
                    return c
                }
            case "delete_comment": comments[ctx]?.removeAll { $0.id == s("comment_id") }
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
