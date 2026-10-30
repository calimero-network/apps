import Foundation
import MeroKit

/// What the new-poll sheet collects. (Kotlin `PollDraft`; the web's `CreatePoll`.)
public struct PollDraft: Equatable, Sendable {
    public enum Mode: Equatable, Sendable { case single, multi }

    public var title = ""
    public var details = ""
    public var options: [String] = ["", ""]
    public var mode: Mode = .single
    public var maxChoices = 2
    public var trustees: Set<String>
    /// `nil`: the default, a majority of however many trustees are picked.
    public var thresholdPick: Int?
    public var everyone = true
    public var voters: Set<String>
    /// Milliseconds since the epoch, shown to voters; the creator still closes the poll.
    public var closesAt: UInt64?

    public init(me: String, roster: [Member]) {
        trustees = [me]
        voters = Set(roster.map(\.account))
    }

    public var filled: [String] { options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty } }

    public var maxC: Int { Swift.min(Swift.max(1, maxChoices), Swift.max(filled.count, 1)) }

    public var threshold: Int {
        let n = trustees.count
        return Swift.min(Swift.max(1, thresholdPick ?? n / 2 + 1), Swift.max(n, 1))
    }

    public var hasDuplicates: Bool { Set(filled).count != filled.count }

    public var isValid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && filled.count >= 2 && !hasDuplicates
            && !trustees.isEmpty && (everyone || !voters.isEmpty)
    }

    /// The warning (or note) under the trustee picker, as the web shows it.
    public func trusteeNote(me: String) -> (text: String, warning: Bool)? {
        let n = trustees.count
        if n == 1 && trustees.contains(me) {
            return (
                "With yourself as the only trustee, you alone could decrypt individual ballots. Fine for a quick poll — add trustees for a secret one.",
                true
            )
        }
        if threshold == 1 && n > 1 { return ("A threshold of 1 lets any single trustee decrypt individual ballots.", true) }
        if threshold == n && n > 1 { return ("All \(n) must take part to count: most private, least available.", false) }
        return nil
    }
}

/// One voting group: who you are, who else is here, its polls; naming
/// yourself, creating a poll, inviting people. (Kotlin `GroupModel`; the web's `VotePanel`.)
@MainActor
public final class GroupModel: ObservableObject {
    @Published public private(set) var me: String?
    @Published public private(set) var roster: [Member] = []
    @Published public private(set) var polls: [PollSummary] = []
    @Published public private(set) var phase: LoadPhase = .loading
    /// A failed action, for a banner.
    @Published public var notice: String?

    public let backend: any MeroAppBackend
    public let group: GroupRef
    public let client: VoteClient

    public init(backend: any MeroAppBackend, group: GroupRef) {
        self.backend = backend
        self.group = group
        self.client = VoteClient.make(contract: backend.contract, contextId: group.contextId)
    }

    // MARK: Reading

    public func refresh() async {
        if me == nil && polls.isEmpty { phase = .loading }
        do {
            async let who = client.whoami()
            async let members = client.roster()
            async let list = client.listPolls()
            let (w, r, p) = try await (who, members, list)
            me = w.account
            roster = r
            polls = p.sorted { $0.createdAt > $1.createdAt }
            phase = .loaded
        } catch {
            if me == nil { phase = .failed(VoteErrorText.describe(error)) } else { notice = VoteErrorText.describe(error) }
        }
    }

    /// Re-read whenever the group changes: live events, or a poll when the node cannot stream.
    public func watch() async {
        await VoteWatch.run(backend: backend, contextId: group.contextId) { [weak self] in await self?.refresh() }
    }

    public var myName: String? {
        guard let me else { return nil }
        return roster.first { $0.account == me }?.name.nilIfEmpty
    }

    /// The roster name, else the short account id.
    public func label(_ account: String) -> String {
        roster.first { $0.account == account }?.name.nilIfEmpty ?? VoteFormat.short(account)
    }

    public func count(_ phases: Phase...) -> Int { polls.filter { phases.contains($0.phase) }.count }

    /// Everyone a poll can name as a trustee or voter: the roster, and you even before you join it.
    public var people: [Member] {
        guard let me else { return roster }
        if roster.contains(where: { $0.account == me }) { return roster }
        return [Member(account: me, name: "You")] + roster
    }

    // MARK: Writing

    /// Join the roster (or rename yourself): how others can name you as a voter or trustee.
    public func setName(_ name: String) async throws {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw VoteModelError.message("Type a name first.") }
        guard trimmed.count <= VoteConstants.maxName else {
            throw VoteModelError.message("A name is at most \(VoteConstants.maxName) characters.")
        }
        do {
            try await client.setName(name: trimmed)
        } catch {
            throw VoteModelError.message(VoteErrorText.describe(error))
        }
        await refresh()
    }

    /// Create a poll. Everything in it is frozen: its hash is the poll id.
    @discardableResult
    public func createPoll(_ draft: PollDraft) async throws -> String {
        guard draft.isValid else {
            throw VoteModelError.message(
                draft.hasDuplicates ? "Two options say the same thing." : "Add a question, two options and a trustee.")
        }
        do {
            let id = try await client.createPoll(
                title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
                description: draft.details.trimmingCharacters(in: .whitespacesAndNewlines),
                options: draft.filled,
                minChoices: draft.mode == .single ? 1 : 0,
                maxChoices: UInt32(draft.mode == .single ? 1 : draft.maxC),
                trustees: Array(draft.trustees).sorted(),
                threshold: UInt32(draft.threshold),
                voters: draft.everyone ? [] : Array(draft.voters).sorted(),
                closesAt: draft.closesAt)
            await refresh()
            return id
        } catch {
            throw VoteModelError.message(VoteErrorText.describe(error))
        }
    }

    /// An invitation link to this voting group (it grants its workspace).
    public func inviteLink() async throws -> String {
        do {
            let signed = try await backend.createInvitation(namespaceId: group.namespaceId)
            return try VoteInvitation(invitation: signed, contextId: group.contextId).link()
        } catch {
            throw VoteModelError.message(VoteErrorText.describe(error))
        }
    }
}

/// Live events for one context, else a ten-second poll. Runs until cancelled.
enum VoteWatch {
    static func run(backend: any MeroAppBackend, contextId: String, refresh: @escaping () async -> Void) async {
        if backend.canSubscribe {
            do {
                for try await _ in backend.events(contextId: contextId) { await refresh() }
            } catch {}
            if Task.isCancelled { return }
        }
        while !Task.isCancelled {
            try? await Task.sleep(for: VoteConstants.pollInterval)
            if Task.isCancelled { return }
            await refresh()
        }
    }
}
