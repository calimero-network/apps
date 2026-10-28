import Foundation
import ForumGenerated
import MeroKit

/// One post and its replies: read, reply, vote, edit, delete, moderate.
/// (Kotlin `ThreadModel`; the web app's `PostPage`.)
@MainActor
public final class ThreadModel: ObservableObject {
    @Published public private(set) var post: PostView?
    @Published public private(set) var comments: [CommentView] = []
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public private(set) var hasMore = false
    @Published public private(set) var isLoadingMore = false
    @Published public private(set) var isSending = false
    /// The post is gone (deleted or removed): the screen should close.
    @Published public private(set) var isGone = false
    @Published public var notice: String?

    public let client: ForumClient
    public let backend: any MeroAppBackend
    public let forum: ForumRef
    public let postId: String
    public let account: String
    private var cursor: String?

    public init(backend: any MeroAppBackend, forum: ForumRef, postId: String, seed: PostView? = nil) {
        self.backend = backend
        self.forum = forum
        self.postId = postId
        self.account = backend.account
        self.post = seed
        self.client = ForumClient.make(contract: backend.contract, contextId: forum.contextId)
        if seed != nil { phase = .loaded }
    }

    public func isMine(author: String) -> Bool { author.caseInsensitiveCompare(account) == .orderedSame }

    // MARK: Reading

    /// The post and the first page of replies, again.
    public func load() async {
        if post == nil { phase = .loading }
        do {
            async let fetchedPost = client.getPost(postId: postId)
            async let firstPage = client.listComments(postId: postId, cursor: nil, limit: ForumConstants.pageSize)
            let (loadedPost, page) = try await (fetchedPost, firstPage)
            post = loadedPost
            comments = page.items
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
            phase = .loaded
        } catch {
            let text = ForumErrorText.describe(error)
            if text.localizedCaseInsensitiveContains("no such post") || text.localizedCaseInsensitiveContains("not found") {
                isGone = true
            }
            if post == nil { phase = .failed(text) } else { notice = text }
        }
    }

    /// The next page of replies, oldest first.
    public func loadMore() async {
        guard hasMore, !isLoadingMore, let cursor else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await client.listComments(postId: postId, cursor: cursor, limit: ForumConstants.pageSize)
            let seen = Set(comments.map(\.id))
            comments += page.items.filter { !seen.contains($0.id) }
            self.cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        } catch {
            notice = ForumErrorText.describe(error)
        }
    }

    /// Re-read on every change in the forum (or every poll), until cancelled.
    public func watch() async {
        if backend.canSubscribe {
            do {
                for try await _ in backend.events(contextId: forum.contextId) { await load() }
            } catch {}
            if Task.isCancelled { return }
        }
        while !Task.isCancelled {
            try? await Task.sleep(for: ForumConstants.pollInterval)
            if Task.isCancelled { return }
            await load()
        }
    }

    // MARK: The post

    public func votePost(_ value: Int32) async {
        guard var current = post else { return }
        let before = current
        current.score = current.score - Int64(current.myVote) + Int64(value)
        current.myVote = value
        post = current
        do {
            try await client.vote(postId: postId, value: value)
        } catch {
            post = before
            notice = ForumErrorText.describe(error)
        }
    }

    public func editPost(title: String, body: String) async throws {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, !body.isEmpty else { throw ForumModelError.message("Add a title and some text.") }
        do {
            try await client.editPost(postId: postId, title: title, body: body)
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
        post?.title = title
        post?.body = body
    }

    /// Delete your own post. `true` once it is gone.
    @discardableResult
    public func deletePost() async -> Bool {
        await removePost { try await self.client.deletePost(postId: self.postId) }
    }

    /// Remove the post as a moderator. `true` once it is gone.
    @discardableResult
    public func moderatePost() async -> Bool {
        await removePost { try await self.client.moderatePost(postId: self.postId) }
    }

    private func removePost(_ call: () async throws -> Void) async -> Bool {
        do {
            try await call()
            isGone = true
            return true
        } catch {
            notice = ForumErrorText.describe(error)
            return false
        }
    }

    // MARK: Replies

    /// Reply to the post.
    public func reply(_ text: String) async throws {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        isSending = true
        defer { isSending = false }
        do {
            try await client.createComment(postId: postId, body: body)
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
        post?.commentCount += 1
        await load()
        // A thread reads forwards: a long one keeps the new reply past page one.
        while hasMore, !Task.isCancelled {
            let before = comments.count
            await loadMore()
            if comments.count == before { break }
        }
    }

    public func voteComment(_ comment: CommentView, value: Int32) async {
        let before = comments
        replace(comment.id) { $0.score = $0.score - Int64($0.myVote) + Int64(value); $0.myVote = value }
        do {
            try await client.voteComment(commentId: comment.id, value: value)
        } catch {
            comments = before
            notice = ForumErrorText.describe(error)
        }
    }

    public func editComment(_ comment: CommentView, body: String) async throws {
        let body = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { throw ForumModelError.message("A reply needs some text.") }
        do {
            try await client.editComment(commentId: comment.id, body: body)
        } catch {
            throw ForumModelError.message(ForumErrorText.describe(error))
        }
        replace(comment.id) { $0.body = body }
    }

    public func deleteComment(_ comment: CommentView) async {
        await removeComment(comment) { try await self.client.deleteComment(commentId: comment.id) }
    }

    public func moderateComment(_ comment: CommentView) async {
        await removeComment(comment) { try await self.client.moderateComment(commentId: comment.id) }
    }

    private func removeComment(_ comment: CommentView, _ call: () async throws -> Void) async {
        let before = (comments, post)
        comments.removeAll { $0.id == comment.id }
        if let count = post?.commentCount, count > 0 { post?.commentCount = count - 1 }
        do {
            try await call()
        } catch {
            (comments, post) = before
            notice = ForumErrorText.describe(error)
        }
    }

    public func dismissNotice() { notice = nil }

    private func replace(_ id: String, _ change: (inout CommentView) -> Void) {
        guard let index = comments.firstIndex(where: { $0.id == id }) else { return }
        change(&comments[index])
    }
}
