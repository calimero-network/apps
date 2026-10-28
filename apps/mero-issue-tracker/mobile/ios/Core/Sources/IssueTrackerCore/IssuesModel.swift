import Foundation

/// The list's filters: the web app's Status / Priority / Assignee / Label chips.
public struct IssueFilters: Equatable, Sendable {
    public var status = ""
    public var priority = ""
    public var assignee = ""
    public var label = ""

    public init(status: String = "", priority: String = "", assignee: String = "", label: String = "") {
        self.status = status
        self.priority = priority
        self.assignee = assignee
        self.label = label
    }

    public var activeCount: Int { [status, priority, assignee, label].filter { !$0.isEmpty }.count }
    public var isActive: Bool { activeCount > 0 }

    public func matches(_ issue: IssueView) -> Bool {
        if !status.isEmpty, issue.status != status { return false }
        if !priority.isEmpty, issue.priority != priority { return false }
        let who = assignee.trimmingCharacters(in: .whitespaces)
        if !who.isEmpty, (issue.assignee ?? "").caseInsensitiveCompare(who) != .orderedSame { return false }
        let tag = label.trimmingCharacters(in: .whitespaces)
        if !tag.isEmpty, !issue.labels.contains(where: { $0.caseInsensitiveCompare(tag) == .orderedSame }) { return false }
        return true
    }
}

/// What the New issue sheet collects. All four sections are required, as on the web.
public struct IssueDraft: Equatable, Sendable {
    public var title = ""
    public var summary = ""
    public var impact = ""
    public var repro = ""
    public var resolution = ""
    public var priority = Tracker.defaultPriority
    public var labels = ""

    public init() {}

    public var isValid: Bool {
        [title, summary, impact, repro, resolution].allSatisfy {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
}

/// One status group of the list.
public struct StatusSection: Identifiable, Equatable, Sendable {
    public let status: String
    public let issues: [IssueView]
    public var id: String { status }
}

/// A repo's issues: the list (grouped by status, filtered, searched) and the
/// board (one column per status, moved with "Move to…").
@MainActor
public final class IssuesModel: ObservableObject {
    @Published public private(set) var issues: [IssueView] = []
    @Published public private(set) var phase: LoadPhase = .idle
    /// A failure to show over content that is still there.
    @Published public var notice: String?
    @Published public var filters = IssueFilters()
    @Published public var query = ""

    public let repoId: String
    private let client: IssueTrackerClient

    public init(client: IssueTrackerClient, repoId: String) {
        self.client = client
        self.repoId = repoId
    }

    /// Filtered and searched, newest first.
    public var visible: [IssueView] {
        issues.filter { filters.matches($0) && TrackerFormat.matches($0, query: query) }
    }

    /// The list: non-empty status groups in board order.
    public var sections: [StatusSection] {
        let shown = visible
        return Tracker.statuses.compactMap { status in
            let rows = shown.filter { $0.status == status }
            return rows.isEmpty ? nil : StatusSection(status: status, issues: rows)
        }
    }

    /// One board column (search applies, filters do not: the board shows every status).
    public func column(_ status: String) -> [IssueView] {
        issues.filter { $0.status == status && TrackerFormat.matches($0, query: query) }
    }

    /// Labels and assignees in use, for the filter suggestions.
    public var knownLabels: [String] { Array(Set(issues.flatMap(\.labels))).sorted() }
    public var knownAssignees: [String] {
        Array(Set(issues.compactMap { $0.assignee?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })).sorted()
    }

    /// Read every issue. The first read shows a spinner; later ones keep the list.
    public func load() async {
        if issues.isEmpty, phase != .loaded { phase = .loading }
        do {
            let list = try await client.listIssues()
            issues = list.sorted { $0.createdAt > $1.createdAt }
            phase = .loaded
            notice = nil
        } catch {
            let text = TrackerFormat.errorText(error)
            if issues.isEmpty { phase = .failed(text) } else { notice = text }
        }
    }

    /// Move an issue to another column. Shown at once; put back if the write fails.
    public func move(_ issueId: String, to status: String) async {
        guard let index = issues.firstIndex(where: { $0.id == issueId }), issues[index].status != status else { return }
        let before = issues[index]
        issues[index].status = status
        do {
            try await client.setStatus(issueId: issueId, status: status)
            await load()
        } catch {
            if let i = issues.firstIndex(where: { $0.id == issueId }) { issues[i] = before }
            notice = TrackerFormat.errorText(error)
        }
    }

    /// File an issue; returns its id.
    @discardableResult
    public func create(_ draft: IssueDraft) async throws -> String {
        guard draft.isValid else { throw TrackerError.message("All four sections are required.") }
        func t(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
        let id = try await client.createIssue(
            title: t(draft.title), summary: t(draft.summary), impact: t(draft.impact), repro: t(draft.repro),
            resolutionCriteria: t(draft.resolution), priority: draft.priority,
            labels: TrackerFormat.parseLabels(draft.labels))
        await load()
        return id
    }

    public func clearFilters() {
        filters = IssueFilters()
    }
}
