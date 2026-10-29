import Foundation
import MeroKit

/// A one-line message after an action: "Deal saved", or what went wrong.
public struct Notice: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public let text: String
    public let isError: Bool

    public init(_ text: String, isError: Bool = false) {
        self.text = text
        self.isError = isError
    }
}

/// One pipeline (one context), held whole: stages, every deal, people,
/// activities, automations and settings are read together, and every screen
/// derives from that one snapshot (the web app's `useCrm`). A live event from
/// the context re-reads it; every write re-reads it after.
@MainActor
public final class PipelineModel: ObservableObject {
    public static let defaultSettings = Settings(currency: "USD", rottingDays: 14)

    @Published public private(set) var stages: [StageView] = []
    @Published public private(set) var deals: [DealView] = []
    @Published public private(set) var contacts: [ContactView] = []
    @Published public private(set) var activities: [ActivityView] = []
    @Published public private(set) var automations: [AutomationView] = []
    @Published public private(set) var settings = PipelineModel.defaultSettings
    @Published public private(set) var hasLoaded = false
    @Published public private(set) var isLoading = false
    /// The context's state has not replicated here yet: "syncing", not an error.
    @Published public private(set) var warmingUp = false
    @Published public var error: String?
    /// Bumped after every successful read: a cheap "something changed" signal.
    @Published public private(set) var version = 0
    @Published public var notice: Notice?

    public let pipeline: PipelineRef
    public let backend: any MeroAppBackend
    public let client: CrmClient
    /// The signed-in account, 64 hex.
    public let me: String
    public var now: () -> Date = Date.init
    public var calendar: Calendar = .current
    /// How long a burst of events is coalesced into one read.
    public var coalesce: Duration = .milliseconds(250)
    public var warmupRetry: Duration = .milliseconds(1500)
    /// When the relay cannot stream events, how often to re-read.
    public var pollInterval: Duration = .seconds(20)

    private var pending = false
    private var joinChecked = false
    private var reloadTask: Task<Void, Never>?

    public init(pipeline: PipelineRef, backend: any MeroAppBackend) {
        self.pipeline = pipeline
        self.backend = backend
        self.client = CrmClient(backend: backend, contextId: pipeline.contextId)
        self.me = Account.canonical(backend.account) ?? backend.account.lowercased()
    }

    public var currency: String { settings.currency }
    public var rottingDays: Int { Int(settings.rottingDays) }

    // MARK: Reading

    /// Read the whole pipeline. Reads never overlap; a change during a read costs one more read.
    public func load() async {
        if isLoading {
            pending = true
            return
        }
        isLoading = true
        await joinIfNeeded()
        do {
            async let st = client.listStages()
            async let ds = client.listDeals()
            async let cs = client.listContacts()
            async let ac = client.listActivities()
            async let au = client.listAutomations()
            async let se = client.getSettings()
            let (s, d, c, a, u, t) = try await (st, ds, cs, ac, au, se)
            stages = s.sorted { $0.position < $1.position }
            deals = d
            contacts = c.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            activities = a
            automations = u
            settings = t
            hasLoaded = true
            warmingUp = false
            error = nil
            version += 1
        } catch {
            if ErrorText.isWarmingUp(error) {
                warmingUp = true
                self.error = nil
            } else {
                warmingUp = false
                self.error = ErrorText.describe(error)
            }
        }
        isLoading = false
        if pending {
            pending = false
            await load()
        }
    }

    /// A pipeline in an open workspace is joined on first open (the web's
    /// `joinContext(activePipeline)`); best effort, the read says the rest.
    private func joinIfNeeded() async {
        guard !joinChecked else { return }
        joinChecked = true
        if let member = try? await backend.isMember(contextId: pipeline.contextId), !member {
            try? await backend.joinContext(contextId: pipeline.contextId)
        }
    }

    /// Load, then keep the snapshot live until cancelled: re-read on the
    /// context's events (or on a timer when the relay cannot stream), and retry
    /// while the context is still syncing.
    public func run() async {
        await load()
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.follow() }
            group.addTask { await self.retryWhileWarming() }
        }
    }

    private func follow() async {
        if backend.canSubscribe {
            do {
                for try await _ in backend.events(contextId: pipeline.contextId) { scheduleReload() }
            } catch {}
        }
        while !Task.isCancelled {
            try? await Task.sleep(for: pollInterval)
            if Task.isCancelled { return }
            await load()
        }
    }

    private func retryWhileWarming() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: warmupRetry)
            if Task.isCancelled { return }
            if warmingUp { await load() }
        }
    }

    /// Coalesce a burst of events (a join replicates in one) into one read.
    public func scheduleReload() {
        guard reloadTask == nil else { return }
        let delay = coalesce
        reloadTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard let self else { return }
            self.reloadTask = nil
            await self.load()
        }
    }

    /// One deal with its person, activities and notes.
    public func detail(_ dealId: String) async throws -> DealDetail {
        try await client.getDeal(dealId: dealId)
    }

    // MARK: People and ownership

    /// Whether `id` is the signed-in account, in either spelling.
    public func isMe(_ id: String?) -> Bool { Account.same(id, me) }

    /// The label for a stored owner: "You", a short account, or a name an older deal stored.
    public func ownerLabel(_ owner: String?) -> String {
        guard let owner, !owner.isEmpty else { return "Unassigned" }
        if isMe(owner) { return "You" }
        if Account.canonical(owner) != nil { return Account.short(owner) }
        return owner
    }

    /// The label for an author or creator.
    public func personLabel(_ id: String) -> String {
        isMe(id) ? "You" : (Account.canonical(id) != nil ? Account.short(id) : id)
    }

    /// Who a deal can be given to: you, then everyone already owning a deal here.
    public var ownerOptions: [String] {
        var seen: Set<String> = [me]
        var out = [me]
        for d in deals {
            guard let o = d.owner, !o.isEmpty else { continue }
            let key = Account.canonical(o) ?? o
            if seen.insert(key).inserted { out.append(o) }
        }
        return out
    }

    public func stage(_ id: String) -> StageView? { stages.first { $0.id == id } }
    public func contact(_ id: String?) -> ContactView? { id.flatMap { id in contacts.first { $0.id == id } } }
    public func deal(_ id: String) -> DealView? { deals.first { $0.id == id } }

    public func health(_ deal: DealView) -> DealHealth {
        Assistant.health(deal, rottingDays: rottingDays, now: now(), calendar)
    }

    public var openDeals: [DealView] { deals.filter { $0.status == "open" } }

    public func openDeals(in stageId: String) -> [DealView] {
        openDeals.filter { $0.stageId == stageId }.sorted { $0.createdAt > $1.createdAt }
    }

    public func stats() -> PipelineStats { Insights.stats(deals: deals, stages: stages, now: now(), calendar) }
    public func companies() -> [Company] { Insights.companies(contacts: contacts, deals: deals) }

    // MARK: Writing

    /// Run a write, re-read, and report. Returns the write's result, or nil after reporting the failure.
    @discardableResult
    public func act<T>(_ success: String? = nil, _ body: (CrmClient) async throws -> T) async -> T? {
        do {
            let result = try await body(client)
            await load()
            if let success { notice = Notice(success) }
            return result
        } catch {
            notice = Notice(ErrorText.describe(error), isError: true)
            return nil
        }
    }

    /// Create a deal (and its new person, when the draft makes one). Returns the deal's id.
    public func createDeal(_ draft: DealDraft) async -> String? {
        guard let value = draft.parsedValue else {
            notice = Notice(CrmError.invalidValue.errorDescription ?? "", isError: true)
            return nil
        }
        let calendar = calendar
        return await act("Deal added") { c in
            var contactId = draft.contactId
            if draft.creatingContact {
                contactId = try await c.createContact(
                    name: draft.newContactName.trimmingCharacters(in: .whitespacesAndNewlines),
                    email: draft.newContactEmail.trimmingCharacters(in: .whitespacesAndNewlines), phone: "",
                    organization: draft.organization.trimmingCharacters(in: .whitespacesAndNewlines), jobTitle: "")
            }
            return try await c.createDeal(
                title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines), value: value,
                organization: draft.organization.trimmingCharacters(in: .whitespacesAndNewlines), contactId: contactId,
                stageId: draft.stageId, owner: draft.owner, expectedClose: draft.closeMs(calendar),
                source: draft.source.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    @discardableResult
    public func updateDeal(_ id: String, _ draft: DealDraft) async -> Bool {
        guard let value = draft.parsedValue else {
            notice = Notice(CrmError.invalidValue.errorDescription ?? "", isError: true)
            return false
        }
        let calendar = calendar
        return await act("Deal saved") { c in
            try await c.updateDeal(
                dealId: id, title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines), value: value,
                organization: draft.organization.trimmingCharacters(in: .whitespacesAndNewlines),
                contactId: draft.contactId, owner: draft.owner, expectedClose: draft.closeMs(calendar),
                source: draft.source.trimmingCharacters(in: .whitespacesAndNewlines))
        } != nil
    }

    @discardableResult
    public func move(_ deal: DealView, to stageId: String) async -> Bool {
        guard stageId != deal.stageId else { return true }
        let name = stage(stageId)?.name ?? "the stage"
        return await act("Moved to \(name)") { try await $0.moveDeal(dealId: deal.id, stageId: stageId) } != nil
    }

    @discardableResult
    public func markWon(_ deal: DealView) async -> Bool {
        await act("Won “\(deal.title)” — \(Money.format(deal.value, currency: currency))") {
            try await $0.markWon(dealId: deal.id)
        } != nil
    }

    @discardableResult
    public func markLost(_ deal: DealView, reason: String) async -> Bool {
        await act("Marked as lost") {
            try await $0.markLost(dealId: deal.id, reason: reason.trimmingCharacters(in: .whitespacesAndNewlines))
        } != nil
    }

    @discardableResult
    public func reopen(_ deal: DealView) async -> Bool {
        await act("Deal reopened") { try await $0.reopenDeal(dealId: deal.id) } != nil
    }

    @discardableResult
    public func deleteDeal(_ deal: DealView) async -> Bool {
        await act("Deal deleted") { try await $0.deleteDeal(dealId: deal.id) } != nil
    }

    /// Schedule an activity. Owner: the deal's, else you (as the web does).
    @discardableResult
    public func schedule(_ draft: ActivityDraft) async -> Bool {
        let deal = draft.dealId.flatMap(deal)
        let owner = (deal?.owner ?? "").isEmpty ? me : deal?.owner
        let subject = draft.subject.trimmingCharacters(in: .whitespacesAndNewlines)
        let due = Days.ms(draft.due)
        return await act("Scheduled: \(subject)") { c in
            try await c.addActivity(
                dealId: draft.dealId, contactId: deal?.contactId, kind: draft.kind.rawValue, subject: subject,
                dueAt: due, owner: owner, note: draft.note)
        } != nil
    }

    /// One tap on a suggested next step: scheduled `dueInDays` from today at 10:00.
    @discardableResult
    public func schedule(_ suggestion: SuggestedActivity, on deal: DealView) async -> Bool {
        var draft = ActivityDraft(due: Days.dueIn(suggestion.dueInDays, now: now(), calendar), dealId: deal.id)
        draft.kind = suggestion.kind
        draft.subject = suggestion.subject
        return await schedule(draft)
    }

    @discardableResult
    public func setDone(_ activity: ActivityView, _ done: Bool) async -> Bool {
        await act(done ? "Done: \(activity.subject)" : nil) {
            try await $0.setActivityDone(activityId: activity.id, done: done)
        } != nil
    }

    /// Snooze to tomorrow at 10:00.
    @discardableResult
    public func snooze(_ activity: ActivityView) async -> Bool {
        let due = Days.ms(Days.dueIn(1, now: now(), calendar))
        return await act("Moved to tomorrow") { try await $0.rescheduleActivity(activityId: activity.id, dueAt: due) } != nil
    }

    @discardableResult
    public func deleteActivity(_ activity: ActivityView) async -> Bool {
        await act("Activity deleted") { try await $0.deleteActivity(activityId: activity.id) } != nil
    }

    @discardableResult
    public func addNote(dealId: String, body: String) async -> Bool {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return false }
        return await act("Note added") { try await $0.addNote(dealId: dealId, body: text) } != nil
    }

    @discardableResult
    public func deleteNote(_ note: NoteView) async -> Bool {
        await act("Note deleted") { try await $0.deleteNote(noteId: note.id) } != nil
    }

    public func createContact(_ draft: ContactDraft) async -> String? {
        await act("Added \(draft.trimmed(draft.name))") { c in
            try await c.createContact(
                name: draft.trimmed(draft.name), email: draft.trimmed(draft.email), phone: draft.trimmed(draft.phone),
                organization: draft.trimmed(draft.organization), jobTitle: draft.trimmed(draft.jobTitle))
        }
    }

    @discardableResult
    public func updateContact(_ id: String, _ draft: ContactDraft) async -> Bool {
        await act("Saved") { c in
            try await c.updateContact(
                contactId: id, name: draft.trimmed(draft.name), email: draft.trimmed(draft.email),
                phone: draft.trimmed(draft.phone), organization: draft.trimmed(draft.organization),
                jobTitle: draft.trimmed(draft.jobTitle))
        } != nil
    }

    @discardableResult
    public func deleteContact(_ contact: ContactView) async -> Bool {
        await act("Deleted \(contact.name)") { try await $0.deleteContact(contactId: contact.id) } != nil
    }

    // MARK: Pipeline setup

    @discardableResult
    public func addStage(name: String, probability: Int) async -> Bool {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return await act("Added \(n)") { try await $0.addStage(name: n, probability: UInt32(clamping: probability)) } != nil
    }

    @discardableResult
    public func updateStage(_ stage: StageView, name: String, probability: Int) async -> Bool {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return await act("Stage saved") {
            try await $0.updateStage(stageId: stage.id, name: n, probability: UInt32(clamping: probability))
        } != nil
    }

    @discardableResult
    public func deleteStage(_ stage: StageView) async -> Bool {
        await act("Stage deleted") { try await $0.deleteStage(stageId: stage.id) } != nil
    }

    /// Move a stage one place up (-1) or down (+1).
    @discardableResult
    public func moveStage(_ stage: StageView, by offset: Int) async -> Bool {
        var ids = stages.map(\.id)
        guard let i = ids.firstIndex(of: stage.id), ids.indices.contains(i + offset) else { return false }
        ids.swapAt(i, i + offset)
        return await act { try await $0.reorderStages(stageIds: ids) } != nil
    }

    @discardableResult
    public func setCurrency(_ code: String) async -> Bool {
        guard Money.isValidCode(code) else {
            notice = Notice(CrmError.invalidCurrency.errorDescription ?? "", isError: true)
            return false
        }
        let c = code.trimmingCharacters(in: .whitespaces).uppercased()
        return await act("Currency set to \(c)") { try await $0.setCurrency(currency: c) } != nil
    }

    @discardableResult
    public func setRottingDays(_ days: Int) async -> Bool {
        await act("Saved") { try await $0.setRottingDays(days: UInt32(clamping: days)) } != nil
    }
}
