import Foundation
import ForumGenerated
import MeroKit

/// One forum's timeline, and everything done to it: post, vote, edit, delete,
/// moderate, the moderator list and the name you post under.
/// (Kotlin `FeedModel`; the web app's `FeedPage` + `lib/forum.ts`.)
@MainActor
public final class FeedModel: ObservableObject {
    @Published public private(set) var posts: [PostView] = []
    @Published public private(set) var sort: FeedSort = .new
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var hasMore = true
    @Published public private(set) var isLoadingMore = false
    @Published public private(set) var moderators: [String] = []
    @Published public private(set) var displayName: String
    /// A failed action, for a banner. Cleared by ``dismissNotice()``.
    @Published public var notice: String?

    public let client: ForumClient
    public let backend: any MeroAppBackend
    public let forum: ForumRef
    public let account: String
    private let names: any NameStore
    private var cursor: String?
    private var generation = 0

    public init(backend: any MeroAppBackend, forum: ForumRef, names: any NameStore) {
        self.backend = backend
        self.forum = forum
        self.account = backend.account
        self.names = names
        self.displayName = names.name
        self.client = ForumClient.make(contract: backend.contract, contextId: forum.contextId)
    }

    /// The caller is one of this forum's moderators.
    public var isModerator: Bool { moderators.contains { $0.caseInsensitiveCompare(account) == .orderedSame } }

    public func isMine(_ post: PostView) -> Bool { post.author.caseInsensitiveCompare(account) == .orderedSame }

    // MARK: Reading

    /// The first page again, replacing what is shown.
    public func refresh() async {
        generation += 1
        let mine = generation
        if posts.isEmpty { phase = .loading }
        do {
            let page = try await client.listPosts(sort: sort.rawValue, cursor: nil, limit: ForumConstants.pageSize)
            guard mine == generation else { return }
            posts = page.items
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
            phase = .loaded
        } catch {
            guard mine == generation else { return }
            if posts.isEmpty { phase = .failed(ForumErrorText.describe(error)) } else { notice = ForumErrorText.describe(error) }
        }
    }

    /// The next page, appended (keyset paging: a new post above cannot shift it).
    public func loadMore() async {
        guard hasMore, !isLoadingMore, phase == .loaded, let cursor else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let mine = generation
        do {
            let page = try await client.listPosts(sort: sort.rawValue, cursor: cursor, limit: ForumConstants.pageSize)
            guard mine == generation else { return }
            let seen = Set(posts.map(\.id))
            posts += page.items.filter { !seen.contains($0.id) }
            self.cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        } catch {
            notice = ForumErrorText.describe(error)
        }
    }

    /// Switch between Latest and Top: a cursor from one order means nothing in the other.
    public func setSort(_ next: FeedSort) async {
        guard next != sort else { return }
        sort = next
        posts = []
        cursor = nil
        hasMore = true
        await refresh()
    }

    /// Everything a forum screen needs on open: the feed, the moderators, and
    /// your name pushed to this forum's contract.
    public func start() async {
        async let feed: Void = refresh()
        async let mods: Void = loadModerators()
        async let name: Void = syncName()
        _ = await (feed, mods, name)
    }

    public func loadModerators() async {
        if let list = try? await client.moderators() { moderators = list }
    }

    /// Re-read whenever the forum changes: live events from the node, or a
    /// poll when it cannot stream. Runs until the task is cancelled.
    public func watch() async {
        if backend.canSubscribe {
            do {
                for try await _ in backend.events(contextId: forum.contextId) {
                    await refresh()
                }
            } catch {}
            if Task.isCancelled { return }
        }
        while !Task.isCancelled {
            try? await Task.sleep(for: ForumConstants.pollInterval)
            if Task.isCancelled { return }
            await refresh()
        }
    }

    // MARK: Writing

    /// Start a discussion. Both a title and some text, as on the web.
    public func createPost(title: String, body: String) async throws {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, !body.isEmpty else { throw ForumModelError.message("Add a title and some text.") }
        do {
            try await client.createPost(title: title, body: body)
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
        if sort != .new { sort = .new }
        await refresh()
    }

    public func editPost(_ post: PostView, title: String, body: String) async throws {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, !body.isEmpty else { throw ForumModelError.message("Add a title and some text.") }
        do {
            try await client.editPost(postId: post.id, title: title, body: body)
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
        replace(post.id) { $0.title = title; $0.body = body }
    }

    /// Up, down, or take it back (`value` 1, -1, 0). Shown at once, undone if it fails.
    public func vote(_ post: PostView, value: Int32) async {
        let before = posts
        replace(post.id) { $0.score = $0.score - Int64($0.myVote) + Int64(value); $0.myVote = value }
        do {
            try await client.vote(postId: post.id, value: value)
        } catch {
            posts = before
            notice = ForumErrorText.describe(error)
        }
    }

    /// Delete your own post (its comments go with it).
    public func delete(_ post: PostView) async {
        await remove(post) { try await self.client.deletePost(postId: post.id) }
    }

    /// Remove someone's post as a moderator.
    public func moderate(_ post: PostView) async {
        await remove(post) { try await self.client.moderatePost(postId: post.id) }
    }

    private func remove(_ post: PostView, _ call: () async throws -> Void) async {
        let before = posts
        posts.removeAll { $0.id == post.id }
        do {
            try await call()
        } catch {
            posts = before
            notice = ForumErrorText.describe(error)
        }
    }

    /// A post changed elsewhere (its page): mirror it here.
    public func update(_ post: PostView) { replace(post.id) { $0 = post } }

    /// A post went away elsewhere (its page).
    public func forget(_ postId: String) { posts.removeAll { $0.id == postId } }

    // MARK: Moderators

    public func addModerator(_ account: String) async throws {
        let id = account.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard ForumFormat.isAccountId(id) else { throw ForumModelError.message("That isn't an account id (64 hex characters).") }
        guard !moderators.contains(where: { $0.caseInsensitiveCompare(id) == .orderedSame }) else { return }
        try await setModerators(moderators + [id])
    }

    public func removeModerator(_ account: String) async throws {
        try await setModerators(moderators.filter { $0.caseInsensitiveCompare(account) != .orderedSame })
    }

    private func setModerators(_ list: [String]) async throws {
        guard !list.isEmpty else { throw ForumModelError.message("A forum needs at least one moderator.") }
        do {
            try await client.setModerators(accounts: list)
            moderators = list
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
    }

    // MARK: Your name

    /// Push the name kept on this device to this forum, or adopt the one the
    /// forum has when the device has none.
    public func syncName() async {
        let local = names.name
        if local.isEmpty {
            if let remote = try? await client.getNickname(account: account), let name = remote.nilIfEmpty {
                names.name = name
                displayName = name
            }
            return
        }
        let remote = try? await client.getNickname(account: account)
        if remote != local { try? await client.setNickname(name: local) }
    }

    /// Change the name you post under, here and on this device.
    public func rename(_ next: String) async throws {
        let trimmed = next.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count <= 64 else { throw ForumModelError.message("Keep your name under 64 characters.") }
        do {
            try await client.setNickname(name: trimmed)
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
        names.name = trimmed
        displayName = trimmed
        for index in posts.indices where isMine(posts[index]) { posts[index].authorName = trimmed }
    }

    public func dismissNotice() { notice = nil }

    private func replace(_ id: String, _ change: (inout PostView) -> Void) {
        guard let index = posts.firstIndex(where: { $0.id == id }) else { return }
        change(&posts[index])
    }
}
