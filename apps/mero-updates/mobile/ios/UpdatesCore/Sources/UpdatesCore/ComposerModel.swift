import Foundation
import MeroKit

/// Write an update. Opened four ways (a template, "reuse the last one", a
/// draft, or editing a published update), all landing in one
/// ``ComposerState``. Edits to a new update autosave as a draft in the
/// contract's private storage, which never replicates to investors.
@MainActor
public final class ComposerModel: ObservableObject {
    @Published public private(set) var state: ComposerState?
    @Published public private(set) var draftId: String?
    @Published public private(set) var savedAt: UInt64?
    @Published public private(set) var series: [MetricSeries] = []
    @Published public private(set) var contributions: [ContributionView] = []
    @Published public private(set) var isPublishing = false
    @Published public var error: String?

    public let audience: AudienceModel
    public let start: ComposerStart
    /// Idle time before an edit is saved as a draft.
    public var autosaveDelay: Duration = .milliseconds(1500)
    public var now: () -> Date = Date.init

    private var saveTask: Task<Void, Never>?

    public init(audience: AudienceModel, start: ComposerStart) {
        self.audience = audience
        self.start = start
        if case .draft(let id) = start { draftId = id }
    }

    public var editId: String? {
        if case .edit(let id) = start { return id }
        return nil
    }

    public var isEditing: Bool { editId != nil }

    public var blocker: String? { state?.publishBlocker ?? "Loading…" }

    /// "Thank N contributors": offers accepted since the last update.
    public var thanks: ComposerState.SectionDraft? { Composer.thanksSection(contributions) }
    public var hasThanks: Bool { state?.sections.contains { $0.kind == "thanks" } ?? false }

    /// Load what the composer starts from.
    public func load() async {
        guard state == nil else { return }
        let client = audience.client
        series = (try? await client.listMetrics()) ?? []
        let since = audience.overview?.lastUpdateAt ?? 0
        contributions = (try? await client.listContributions(since: since)) ?? []
        do {
            let initial: ComposerState
            switch start {
            case .edit(let id):
                initial = Composer.fromPost(try await client.getPost(postId: id))
            case .draft(let id):
                let drafts = try await client.listDrafts()
                let draft = drafts.first { $0.id == id }
                initial = draft.flatMap { ComposerState.parse($0.payload) } ?? fresh(.of(nil))
                savedAt = draft?.updatedAt
            case .reuseLatest:
                let page = try await client.listPosts(kind: "update", categoryId: nil, cursor: nil, limit: 1)
                if let latest = page.items.first {
                    initial = Composer.fromPrevious(try await client.getPost(postId: latest.id), now: now())
                } else {
                    initial = fresh(.of(nil))
                }
            case .template(let id):
                initial = fresh(.of(id))
            }
            state = initial
            error = nil
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    private func fresh(_ template: UpdateTemplate) -> ComposerState {
        Composer.fromTemplate(template, metrics: series, now: now())
    }

    /// Change the draft; a new update autosaves after a pause.
    public func update(_ change: (inout ComposerState) -> Void) {
        guard var next = state else { return }
        change(&next)
        guard next != state else { return }
        state = next
        scheduleSave()
    }

    private func scheduleSave() {
        guard !isEditing else { return }
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            guard let delay = self?.autosaveDelay else { return }
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await self?.saveDraft()
        }
    }

    /// Save now (the autosave, and leaving the composer). Failure is quiet:
    /// the next edit retries, and publishing never depends on a draft.
    public func saveDraft() async {
        guard !isEditing, let state else { return }
        do {
            let id = try await audience.client.saveDraft(draftId: draftId, title: state.title, payload: state.payload())
            draftId = id
            savedAt = Format.ms(now())
        } catch {
            // Quiet on purpose.
        }
    }

    /// Flush a pending autosave when the composer closes.
    public func flush() async {
        guard saveTask != nil else { return }
        saveTask?.cancel()
        saveTask = nil
        await saveDraft()
    }

    /// Publish (or save the edit). Returns the post's id.
    public func publish() async -> String? {
        guard let state, state.publishBlocker == nil, !isPublishing else { return nil }
        saveTask?.cancel()
        saveTask = nil
        isPublishing = true
        defer { isPublishing = false }
        do {
            let input = state.toInput()
            let id: String
            if let editId {
                try await audience.act { try await $0.editUpdate(postId: editId, input: input) }
                id = editId
            } else {
                id = try await audience.act { try await $0.publishUpdate(input: input) }
                if let draftId { try? await audience.client.deleteDraft(draftId: draftId) }
                draftId = nil
            }
            error = nil
            return id
        } catch {
            self.error = ErrorText.describe(error)
            return nil
        }
    }

    // MARK: - Editing helpers

    public func lastValue(of name: String) -> String? { Metrics.last(of: name, in: series) }

    /// KPIs reported before that are not in this update yet: one tap adds each.
    public var knownMetrics: [MetricSeries] {
        let present = Set((state?.metrics ?? []).map { $0.name.lowercased() })
        return series.filter { !present.contains($0.name.lowercased()) }
    }

    /// The sections the "Add section" row offers.
    public var sectionSuggestions: [UpdateTemplate.SectionShape] {
        let kinds = Set((state?.sections ?? []).map(\.kind))
        return UpdateTemplate.suggestions.filter { $0.title.isEmpty || !kinds.contains($0.kind) }
    }

    public func addSection(_ shape: UpdateTemplate.SectionShape) {
        update { $0.sections.append(.init(kind: shape.kind, title: shape.title, body: "")) }
    }

    public func moveSectionUp(_ index: Int) {
        update { s in
            guard index > 0, index < s.sections.count else { return }
            s.sections.swapAt(index - 1, index)
        }
    }

    public func removeSection(_ index: Int) {
        update { s in if s.sections.indices.contains(index) { s.sections.remove(at: index) } }
    }

    public func insertThanks() {
        guard let thanks, !hasThanks else { return }
        update { $0.sections.append(thanks) }
    }

    public func addMetric(name: String = "", unit: String = "") {
        update { $0.metrics.append(.init(name: name, value: "", unit: unit)) }
    }

    public func removeMetric(_ index: Int) {
        update { s in if s.metrics.indices.contains(index) { s.metrics.remove(at: index) } }
    }

    public var canAddAsk: Bool { (state?.asks.count ?? 0) < Limits.maxAsks }

    public func addAsk() {
        guard canAddAsk else { return }
        update { $0.asks.append(.init(id: nil, kind: "intro", title: "", detail: "")) }
    }

    public func removeAsk(_ index: Int) {
        update { s in if s.asks.indices.contains(index) { s.asks.remove(at: index) } }
    }

    /// "Draft saved · 2m ago", or what drafts are, before the first save.
    public func draftStatus(now: Date = Date()) -> String? {
        guard !isEditing else { return nil }
        if let savedAt { return "Draft saved · \(Format.timeAgo(savedAt, now: now))" }
        return "Drafts stay private until you publish"
    }
}
