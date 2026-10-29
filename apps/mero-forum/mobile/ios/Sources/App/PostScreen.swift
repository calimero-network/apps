import ForumCore
import ForumGenerated
import SwiftUI

/// One post, its replies, and a reply box that stays above the keyboard.
struct PostScreen: View {
    @ObservedObject var feed: FeedModel
    @StateObject private var model: ThreadModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @State private var replyError: String?
    @State private var editingPost = false
    @State private var editingComment: CommentView?
    @State private var confirm: Confirm?
    @FocusState private var replying: Bool

    private enum Confirm: Identifiable {
        case deletePost, removePost, deleteComment(CommentView), removeComment(CommentView)
        var id: String {
            switch self {
            case .deletePost: return "dp"
            case .removePost: return "rp"
            case .deleteComment(let c): return "dc" + c.id
            case .removeComment(let c): return "rc" + c.id
            }
        }
    }

    init(feed: FeedModel, postId: String) {
        self.feed = feed
        _model = StateObject(
            wrappedValue: ThreadModel(
                backend: feed.backend, forum: feed.forum, postId: postId, seed: feed.posts.first { $0.id == postId }))
    }

    var body: some View {
        List {
            switch model.phase {
            case .loading:
                SkeletonPost().listRowSeparator(.hidden)
            case .failed(let message):
                ErrorState(message: message) { Task { await model.load() } }.listRowSeparator(.hidden)
            case .loaded:
                if let post = model.post {
                    PostDetail(
                        post: post, isMine: model.isMine(author: post.author), isModerator: feed.isModerator,
                        vote: { value in Task { await model.votePost(value) } },
                        reply: { replying = true },
                        edit: { editingPost = true },
                        delete: { confirm = .deletePost },
                        moderate: { confirm = .removePost }
                    )
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("thread.post")
                    .listRowInsets(EdgeInsets())
                    .listRowSeparatorTint(Palette.hairline)
                    replies(post)
                }
            }
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.surface)
        .refreshable { await model.load() }
        .overlay(alignment: .top) {
            if let notice = model.notice { NoticeBanner(text: notice) { model.dismissNotice() } }
        }
        .safeAreaInset(edge: .bottom) { replyBar }
        .forumNavigation("Post")
        .task { await model.load() }
        .task { await model.watch() }
        .onChange(of: model.post) { post in if let post { feed.update(post) } }
        .onChange(of: model.isGone) { gone in
            if gone {
                feed.forget(model.postId)
                dismiss()
            }
        }
        .sheet(isPresented: $editingPost) {
            ComposeSheet(
                heading: "Edit post", action: "Save", author: feed.displayName, account: feed.account,
                initialTitle: model.post?.title ?? "", initialBody: model.post?.body ?? ""
            ) { title, body in
                try await model.editPost(title: title, body: body)
            }
        }
        .sheet(item: $editingComment) { comment in
            EditTextSheet(heading: "Edit reply", initial: comment.body) { body in
                try await model.editComment(comment, body: body)
            }
        }
        .confirmationDialog(confirmTitle, isPresented: confirmShown, titleVisibility: .visible, presenting: confirm) { which in
            Button(confirmAction(which), role: .destructive) { Task { await run(which) } }
        } message: { which in
            Text(confirmMessage(which))
        }
    }

    @ViewBuilder private func replies(_ post: PostView) -> some View {
        if model.comments.isEmpty {
            VStack(spacing: 6) {
                Text("No replies yet").font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
                Text("Be the first to reply.").font(.system(size: 15)).foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 32)
            .listRowSeparator(.hidden)
        }
        ForEach(model.comments, id: \.id) { comment in
            let mine = model.isMine(author: comment.author)
            ReplyRow(
                comment: comment, replyingTo: post, isMine: mine, isModerator: feed.isModerator,
                vote: { value in Task { await model.voteComment(comment, value: value) } },
                edit: { editingComment = comment },
                delete: { confirm = .deleteComment(comment) },
                moderate: { confirm = .removeComment(comment) }
            )
            .listRowInsets(EdgeInsets())
            .listRowSeparatorTint(Palette.hairline)
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if mine {
                    Button(role: .destructive) { confirm = .deleteComment(comment) } label: { Label("Delete", systemImage: "trash") }
                    Button { editingComment = comment } label: { Label("Edit", systemImage: "pencil") }.tint(Palette.inkSoft)
                } else if feed.isModerator {
                    Button(role: .destructive) { confirm = .removeComment(comment) } label: {
                        Label("Remove", systemImage: "xmark.shield")
                    }
                }
            }
        }
        if model.hasMore {
            Button {
                Task { await model.loadMore() }
            } label: {
                if model.isLoadingMore { ProgressView() } else { Text("Show more replies") }
            }
            .buttonStyle(SecondaryButtonStyle(compact: true))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .listRowSeparator(.hidden)
        }
    }

    private var replyBar: some View {
        VStack(spacing: 6) {
            if let replyError {
                Text(replyError).font(.system(size: 13)).foregroundStyle(Palette.danger).frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .bottom, spacing: 10) {
                Avatar(label: feed.displayName.isEmpty ? "You" : feed.displayName, seed: feed.account, size: 32)
                TextField("Post your reply", text: $draft, axis: .vertical)
                    .font(.system(size: 16))
                    .lineLimit(1...5)
                    .focused($replying)
                    .accessibilityIdentifier("thread.replyField")
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.sunken))
                Button {
                    send()
                } label: {
                    if model.isSending { ProgressView().tint(Palette.ink).frame(minWidth: 44) } else { Text("Reply") }
                }
                .buttonStyle(PrimaryButtonStyle(compact: true))
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isSending)
                .accessibilityIdentifier("thread.send")
            }
            if replying {
                Text(feed.displayName.isEmpty ? "Replying with your account id. Pick a name in About this forum." : "Replying as \(feed.displayName)")
                    .font(.system(size: 12)).foregroundStyle(Palette.muted).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 42)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Palette.surface)
        .overlay(alignment: .top) { Rectangle().fill(Palette.hairline).frame(height: 0.5) }
    }

    private func send() {
        let text = draft
        replyError = nil
        Haptics.tap()
        Task {
            do {
                try await model.reply(text)
                draft = ""
                Haptics.success()
            } catch {
                replyError = ForumErrorText.describe(error)
                Haptics.failure()
            }
        }
    }

    // MARK: Confirmations

    private var confirmShown: Binding<Bool> {
        Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })
    }

    private var confirmTitle: String {
        switch confirm {
        case .deletePost: return "Delete this post?"
        case .removePost: return "Remove this post?"
        case .deleteComment: return "Delete this reply?"
        case .removeComment: return "Remove this reply?"
        case nil: return ""
        }
    }

    private func confirmAction(_ which: Confirm) -> String {
        switch which {
        case .deletePost, .deleteComment: return "Delete"
        case .removePost, .removeComment: return "Remove"
        }
    }

    private func confirmMessage(_ which: Confirm) -> String {
        switch which {
        case .deletePost: return "Its replies go with it."
        case .removePost: return "As a moderator you can remove anyone's post. It's removed for everyone."
        case .deleteComment: return "This can't be undone."
        case .removeComment: return "As a moderator you can remove anyone's reply. It's removed for everyone."
        }
    }

    private func run(_ which: Confirm) async {
        switch which {
        case .deletePost: await model.deletePost()
        case .removePost: await model.moderatePost()
        case .deleteComment(let comment): await model.deleteComment(comment)
        case .removeComment(let comment): await model.moderateComment(comment)
        }
    }
}

/// The opened post, large: who, the post, when, its numbers and its actions.
struct PostDetail: View {
    let post: PostView
    let isMine: Bool
    let isModerator: Bool
    let vote: (Int32) -> Void
    let reply: () -> Void
    let edit: () -> Void
    let delete: () -> Void
    let moderate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Avatar(label: ForumFormat.displayName(post.authorName, account: post.author), seed: post.author, size: 48)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(ForumFormat.displayName(post.authorName, account: post.author))
                            .font(.system(size: 16, weight: .bold)).foregroundStyle(Palette.ink).lineLimit(1)
                        if isMine { Badge(text: "You", strong: false) }
                    }
                    Text(ForumFormat.handle(post.author)).font(.system(size: 15)).foregroundStyle(Palette.muted)
                }
                Spacer()
                ItemMenu(
                    isMine: isMine, isModerator: isModerator, noun: "post", edit: edit, delete: delete, moderate: moderate,
                    copyText: "\(post.title)\n\n\(post.body)")
            }
            Text(post.title).font(Typeface.display(23)).foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(post.body).font(.system(size: 17)).foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            HStack(spacing: 4) {
                Text(ForumFormat.fullStamp(post.createdAt))
                if post.editedAt > post.createdAt { Text("· Edited") }
            }
            .font(.system(size: 15)).foregroundStyle(Palette.muted)
            Rectangle().fill(Palette.hairline).frame(height: 0.5)
            HStack(spacing: 18) {
                stat(Int64(post.commentCount), post.commentCount == 1 ? "Reply" : "Replies")
                stat(post.score, "Score")
            }
            Rectangle().fill(Palette.hairline).frame(height: 0.5)
            HStack {
                ActionCount(symbol: "bubble.left", count: nil, label: "Reply", action: reply)
                Spacer()
                VoteControl(score: post.score, myVote: post.myVote, size: 19, vote: vote)
                Spacer()
                ShareLink(item: "\(post.title)\n\n\(post.body)") {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 16)).foregroundStyle(Palette.muted)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Share")
            }
            .padding(.horizontal, 8)
        }
        .padding(16)
    }

    private func stat(_ value: Int64, _ label: String) -> some View {
        HStack(spacing: 4) {
            Text(ForumFormat.compact(value)).font(.system(size: 15, weight: .bold)).foregroundStyle(Palette.ink)
            Text(label).font(.system(size: 15)).foregroundStyle(Palette.muted)
        }
    }
}

/// A reply in the thread: who, to whom, the text, and its vote.
struct ReplyRow: View {
    let comment: CommentView
    let replyingTo: PostView
    let isMine: Bool
    let isModerator: Bool
    let vote: (Int32) -> Void
    let edit: () -> Void
    let delete: () -> Void
    let moderate: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Avatar(label: ForumFormat.displayName(comment.authorName, account: comment.author), seed: comment.author, size: 40)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 0) {
                    AuthorLine(
                        name: comment.authorName, account: comment.author, stamp: comment.createdAt, isSelf: isMine,
                        edited: comment.editedAt > comment.createdAt)
                    Spacer(minLength: 6)
                    ItemMenu(
                        isMine: isMine, isModerator: isModerator, noun: "reply", edit: edit, delete: delete,
                        moderate: moderate, copyText: comment.body)
                }
                (Text("Replying to ").foregroundColor(Palette.muted)
                    + Text(ForumFormat.handle(replyingTo.author)).foregroundColor(Palette.inkSoft))
                    .font(.system(size: 14))
                Text(comment.body)
                    .font(.system(size: 15))
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                HStack {
                    Spacer()
                    VoteControl(score: comment.score, myVote: comment.myVote, size: 15, vote: vote)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
