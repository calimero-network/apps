import Foundation
import MeroKit

/// One open audience: who you are in it, its overview and categories, every
/// write, and a ``version`` that moves whenever its state may have changed (a
/// write from here, a contract event, or the poll). Every tab re-reads when it
/// moves — the web's `AudienceShell` revision.
@MainActor
public final class AudienceModel: ObservableObject {
    public let audience: AudienceSummary
    public let contextId: String
    public let client: UpdatesClient
    public let backend: any MeroAppBackend

    @Published public private(set) var me: MeView?
    @Published public private(set) var overview: Overview?
    @Published public private(set) var categories: [CategoryView] = []
    @Published public private(set) var version = 0
    @Published public private(set) var error: String?
    @Published public private(set) var hasLoaded = false

    /// How often to re-read with a live stream up, and without one.
    public var pollWithStream: Duration = .seconds(30)
    public var pollWithoutStream: Duration = .seconds(8)

    private var nudge: Task<Void, Never>?

    public init(audience: AudienceSummary, contextId: String, backend: any MeroAppBackend) {
        self.audience = audience
        self.contextId = contextId
        self.backend = backend
        self.client = UpdatesClient(backend: backend, contextId: contextId)
    }

    public var isTeam: Bool { me?.isTeam ?? false }
    public var isAdmin: Bool { me?.isAdmin ?? false }
    /// "Admin", "Team" or "Investor".
    public var roleLabel: String? {
        guard let me else { return nil }
        return me.isTeam ? (me.isAdmin ? "Admin" : "Team") : "Investor"
    }

    public var companyTitle: String {
        if let name = overview?.companyName, !name.isEmpty { return name }
        return audience.companyName.isEmpty ? "Your company" : audience.companyName
    }

    /// Whether to ask "who are you?": the contract knows you and you have no name.
    public var needsProfile: Bool { me.map { $0.name.trimmingCharacters(in: .whitespaces).isEmpty } ?? false }

    public func category(_ id: String) -> CategoryView? {
        id.isEmpty ? nil : categories.first { $0.id == id }
    }

    /// Re-read who you are, the overview and the categories.
    public func load() async {
        do {
            async let me = client.getMe()
            async let overview = client.getOverview()
            async let categories = client.listCategories()
            let (m, o, c) = try await (me, overview, categories)
            self.me = m
            self.overview = o
            self.categories = c
            error = nil
            hasLoaded = true
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Something may have changed: every tab re-reads.
    public func bump() { version += 1 }

    /// Run one write, then re-read everything.
    @discardableResult
    public func act<T>(_ write: (UpdatesClient) async throws -> T) async throws -> T {
        defer {
            bump()
            Task { await self.load() }
        }
        return try await write(client)
    }

    // MARK: - You

    public func setProfile(name: String, firm: String) async throws {
        try await act { try await $0.setProfile(name: name.trimmed, firm: firm.trimmed) }
    }

    /// Mute or unmute one category; muted ones stop counting as unread.
    public func toggleMuted(_ category: CategoryView) async throws {
        let muted = categories.filter(\.muted).map(\.id)
        let next = category.muted ? muted.filter { $0 != category.id } : muted + [category.id]
        try await act { try await $0.setMutedCategories(categoryIds: next) }
    }

    // MARK: - Posts

    public func react(postId: String, emoji: String, on: Bool) async throws {
        try await act { try await $0.react(postId: postId, emoji: emoji, on: on) }
    }

    public func deletePost(_ postId: String) async throws {
        try await act { try await $0.deletePost(postId: postId) }
    }

    public func setQuestionStatus(postId: String, answered: Bool) async throws {
        try await act { try await $0.setQuestionStatus(postId: postId, status: answered ? "answered" : "open") }
    }

    public func askQuestion(title: String, body: String) async throws -> String {
        try await act { try await $0.askQuestion(title: title.trimmed, body: body.trimmed, categoryId: nil) }
    }

    // MARK: - Replies

    public func addComment(postId: String, parentId: String?, body: String) async throws {
        try await act { _ = try await $0.addComment(postId: postId, parentId: parentId, body: body.trimmed) }
    }

    public func editComment(_ commentId: String, body: String) async throws {
        try await act { try await $0.editComment(commentId: commentId, body: body.trimmed) }
    }

    public func deleteComment(_ commentId: String) async throws {
        try await act { try await $0.deleteComment(commentId: commentId) }
    }

    // MARK: - Asks and offers

    public func offerHelp(askId: String, note: String) async throws {
        try await act { try await $0.offerHelp(askId: askId, note: note.trimmed) }
    }

    public func withdrawOffer(askId: String) async throws {
        try await act { try await $0.withdrawOffer(askId: askId) }
    }

    /// "accepted", "declined", or "offered" to undo.
    public func setOfferStatus(askId: String, account: String, status: String) async throws {
        try await act { try await $0.setOfferStatus(askId: askId, account: account, status: status) }
    }

    public func setAskStatus(askId: String, resolved: Bool) async throws {
        try await act { try await $0.setAskStatus(askId: askId, status: resolved ? "resolved" : "open") }
    }

    // MARK: - Team

    public func setTeammate(_ account: String, on: Bool) async throws {
        try await act { client in
            if on { try await client.addTeammate(account: account) } else { try await client.removeTeammate(account: account) }
        }
    }

    public func deleteDraft(_ draftId: String) async throws {
        try await act { try await $0.deleteDraft(draftId: draftId) }
    }

    /// A link that joins this audience's company and lands in this audience.
    public func invitation() async throws -> UpdatesInvitation {
        let signed = try await backend.createInvitation(namespaceId: audience.companyId)
        return UpdatesInvitation(
            invitation: signed, kind: .audience, namespaceId: audience.companyId, companyName: companyTitle,
            audienceId: audience.audienceId, contextId: contextId, audienceName: audience.name)
    }

    // MARK: - Live

    /// Follow the audience while it is open: the node's event stream when it
    /// has one, coalesced (a publish emits several events), and a poll either
    /// way, since a dropped stream would otherwise leave the feed stale with
    /// nothing saying so. Runs until cancelled.
    public func follow() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.listen() }
            group.addTask { await self.poll() }
        }
    }

    private func listen() async {
        guard backend.canSubscribe else { return }
        do {
            for try await _ in backend.events(contextId: contextId) {
                nudge?.cancel()
                nudge = Task { [weak self] in
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled, let self else { return }
                    self.bump()
                    await self.load()
                }
            }
        } catch {
            // The poll carries on.
        }
    }

    private func poll() async {
        while !Task.isCancelled {
            let interval = backend.canSubscribe ? pollWithStream : pollWithoutStream
            try? await Task.sleep(for: interval)
            guard !Task.isCancelled else { return }
            bump()
            await load()
        }
    }
}
