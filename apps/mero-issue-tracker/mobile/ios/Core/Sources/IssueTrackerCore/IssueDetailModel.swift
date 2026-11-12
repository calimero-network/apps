import Foundation

/// The Edit sheet's four sections.
public struct SectionsDraft: Equatable, Sendable {
    public var summary: String
    public var impact: String
    public var repro: String
    public var resolution: String

    public init(summary: String, impact: String, repro: String, resolution: String) {
        self.summary = summary
        self.impact = impact
        self.repro = repro
        self.resolution = resolution
    }

    public init(_ issue: IssueView) {
        self.init(summary: issue.summary, impact: issue.impact, repro: issue.repro, resolution: issue.resolutionCriteria)
    }

    public var isValid: Bool {
        [summary, impact, repro, resolution].allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
}

/// One issue: its four sections, properties, comment thread, and every write on it.
@MainActor
public final class IssueDetailModel: ObservableObject {
    @Published public private(set) var issue: IssueView?
    @Published public private(set) var comments: [CommentView] = []
    @Published public private(set) var phase: LoadPhase = .idle
    @Published public var notice: String?
    @Published public private(set) var isWorking = false
    /// Set once the issue is deleted (here, or by its author elsewhere).
    @Published public private(set) var isGone = false

    public let issueId: String
    private let client: IssueTrackerClient
    private let account: String

    public init(client: IssueTrackerClient, issueId: String, account: String, seed: IssueView? = nil) {
        self.client = client
        self.issueId = issueId
        self.account = account.lowercased()
        self.issue = seed
    }

    /// Only an issue's author may delete it (the contract enforces it too).
    public var isCreator: Bool { issue.map { $0.createdBy.lowercased() == account } ?? false }

    /// Only a comment's author may edit or delete it.
    public func isMine(_ comment: CommentView) -> Bool { comment.author.lowercased() == account }

    public func load() async {
        if issue == nil { phase = .loading }
        do {
            let detail = try await client.getIssue(issueId: issueId)
            issue = detail.issue
            comments = detail.comments.sorted { $0.createdAt < $1.createdAt }
            phase = .loaded
        } catch {
            let text = TrackerFormat.errorText(error)
            if text.localizedCaseInsensitiveContains("not found") || text.localizedCaseInsensitiveContains("no such") {
                isGone = issue != nil || phase == .loading
                phase = .failed("Issue not found. It may have been deleted, or it has not reached this device yet.")
            } else if issue == nil {
                phase = .failed(text)
            } else {
                notice = text
            }
        }
    }

    public func setStatus(_ status: String) async {
        guard status != issue?.status else { return }
        await perform { try await $0.setStatus(issueId: self.issueId, status: status) }
    }

    public func setPriority(_ priority: String) async {
        guard priority != issue?.priority else { return }
        await perform { try await $0.setPriority(issueId: self.issueId, priority: priority) }
    }

    /// Free text, as on the web; empty unassigns.
    public func setAssignee(_ assignee: String) async {
        let next = assignee.trimmingCharacters(in: .whitespacesAndNewlines)
        guard next != (issue?.assignee ?? "") else { return }
        await perform { try await $0.setAssignee(issueId: self.issueId, assignee: next.isEmpty ? nil : next) }
    }

    @discardableResult
    public func addLabel(_ label: String) async -> Bool {
        let l = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !l.isEmpty else { return false }
        return await perform { try await $0.addLabel(issueId: self.issueId, label: l) }
    }

    public func removeLabel(_ label: String) async {
        await perform { try await $0.removeLabel(issueId: self.issueId, label: label) }
    }

    @discardableResult
    public func addComment(_ body: String) async -> Bool {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return false }
        return await perform { _ = try await $0.addComment(issueId: self.issueId, body: text) }
    }

    @discardableResult
    public func editComment(_ commentId: String, body: String) async -> Bool {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return false }
        guard comments.first(where: { $0.id == commentId })?.body != text else { return true }
        return await perform { try await $0.editComment(commentId: commentId, newBody: text) }
    }

    public func deleteComment(_ commentId: String) async {
        await perform { try await $0.deleteComment(commentId: commentId) }
    }

    /// Save the sections that changed (`set_summary`, `set_impact`, `set_repro`, `set_resolution_criteria`).
    @discardableResult
    public func saveSections(_ draft: SectionsDraft) async -> Bool {
        guard let issue else { return false }
        guard draft.isValid else {
            notice = "All four sections are required."
            return false
        }
        func t(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
        let id = issueId
        return await perform { client in
            if t(draft.summary) != issue.summary { try await client.setSummary(issueId: id, summary: t(draft.summary)) }
            if t(draft.impact) != issue.impact { try await client.setImpact(issueId: id, impact: t(draft.impact)) }
            if t(draft.repro) != issue.repro { try await client.setRepro(issueId: id, repro: t(draft.repro)) }
            if t(draft.resolution) != issue.resolutionCriteria {
                try await client.setResolutionCriteria(issueId: id, resolutionCriteria: t(draft.resolution))
            }
        }
    }

    /// Delete the issue (author only). True when it is gone.
    @discardableResult
    public func delete() async -> Bool {
        isWorking = true
        defer { isWorking = false }
        do {
            try await client.deleteIssue(issueId: issueId)
            isGone = true
            return true
        } catch {
            notice = TrackerFormat.errorText(error)
            return false
        }
    }

    public func fixPrompt(repoURL: String?) -> String? {
        issue.map { TrackerFormat.fixPrompt($0, repoURL: repoURL) }
    }

    @discardableResult
    private func perform(_ write: @escaping (IssueTrackerClient) async throws -> Void) async -> Bool {
        isWorking = true
        defer { isWorking = false }
        do {
            try await write(client)
            await load()
            return true
        } catch {
            notice = TrackerFormat.errorText(error)
            return false
        }
    }
}
