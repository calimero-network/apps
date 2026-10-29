import Foundation
import MeroKit

/// One update or question: the post, the KPI series its deltas come from, the
/// replies, and opening it records a read receipt once.
@MainActor
public final class PostModel: ObservableObject {
    @Published public private(set) var post: PostView?
    @Published public private(set) var series: [MetricSeries] = []
    @Published public private(set) var comments: [CommentView] = []
    @Published public var error: String?
    @Published public private(set) var deleted = false

    public let postId: String
    public let audience: AudienceModel
    private var marked = false

    public init(postId: String, audience: AudienceModel) {
        self.postId = postId
        self.audience = audience
    }

    public var isQuestion: Bool { post?.card.kind == "question" }
    public var isMine: Bool { post != nil && post?.card.author == audience.me?.account }
    /// The team edits and deletes any post; a question's author may delete it.
    public var canDelete: Bool { audience.isTeam || (isQuestion && isMine) }
    public var canEdit: Bool { audience.isTeam && !isQuestion }

    public var topLevel: [CommentView] { comments.filter { $0.parentId.isEmpty } }
    public func replies(to id: String) -> [CommentView] { comments.filter { $0.parentId == id } }

    public func canDelete(_ comment: CommentView) -> Bool {
        audience.isTeam || comment.author == audience.me?.account
    }

    public func canEdit(_ comment: CommentView) -> Bool { comment.author == audience.me?.account }

    public func load() async {
        let client = audience.client
        do {
            async let post = client.getPost(postId: postId)
            async let comments = client.listComments(postId: postId)
            let (p, c) = try await (post, comments)
            self.post = p
            self.comments = c
            error = nil
            if !p.metrics.isEmpty { series = (try? await client.listMetrics()) ?? series }
            await markReadOnce(p)
        } catch {
            if post == nil { self.error = ErrorText.describe(error) }
        }
    }

    /// The read receipt: recorded the first time an unread post is shown.
    private func markReadOnce(_ post: PostView) async {
        guard !marked else { return }
        marked = true
        guard !post.card.readByMe else { return }
        try? await audience.client.markRead(postId: postId)
        await audience.load()
    }

    /// Toggle a reaction, shown at once and put right if the write fails.
    public func toggle(_ emoji: String) async {
        guard var current = post else { return }
        let mine = current.card.reactions.first { $0.emoji == emoji }?.mine ?? false
        let on = !mine
        if let index = current.card.reactions.firstIndex(where: { $0.emoji == emoji }) {
            current.card.reactions[index].mine = on
            let count = current.card.reactions[index].count
            current.card.reactions[index].count = on ? count + 1 : (count > 0 ? count - 1 : 0)
        } else if on {
            current.card.reactions.append(ReactionCount(emoji: emoji, count: 1, mine: true))
        }
        post = current
        do {
            try await audience.react(postId: postId, emoji: emoji, on: on)
        } catch {
            self.error = ErrorText.describe(error)
            await load()
        }
    }

    /// The reactions with at least one, in the catalog's order then any other.
    public var usedReactions: [ReactionCount] {
        (post?.card.reactions ?? []).filter { $0.count > 0 }
    }

    public func mine(_ emoji: String) -> Bool {
        post?.card.reactions.first { $0.emoji == emoji }?.mine ?? false
    }

    public func delete() async -> Bool {
        do {
            try await audience.deletePost(postId)
            deleted = true
            return true
        } catch {
            self.error = ErrorText.describe(error)
            return false
        }
    }

    public func toggleAnswered() async {
        guard let card = post?.card else { return }
        do {
            try await audience.setQuestionStatus(postId: postId, answered: card.status != "answered")
            await load()
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Reply at the top level, or under `parentId`.
    public func reply(_ body: String, to parentId: String? = nil) async throws {
        try await audience.addComment(postId: postId, parentId: parentId, body: body)
        await load()
    }

    public func edit(_ comment: CommentView, body: String) async throws {
        try await audience.editComment(comment.id, body: body)
        await load()
    }

    public func delete(_ comment: CommentView) async {
        comments.removeAll { $0.id == comment.id }
        do {
            try await audience.deleteComment(comment.id)
        } catch {
            self.error = ErrorText.describe(error)
        }
        await load()
    }

    /// The KPI's previous report, for "vs $40k" and its delta.
    public func previous(_ metric: Metric) -> MetricPoint? {
        Metrics.previous(of: metric.name, before: postId, in: series)
    }

    /// "Answer the question…", "Reply to the team — …": the reply box's prompt.
    public var replyPlaceholder: String {
        switch (audience.isTeam, isQuestion) {
        case (true, true): return "Answer the question…"
        case (true, false): return "Add a note for your investors…"
        case (false, true): return "Add to the question…"
        case (false, false): return "Reply to the team — questions, congratulations, pushback…"
        }
    }
}
