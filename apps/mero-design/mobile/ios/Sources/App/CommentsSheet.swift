import DesignCore
import SwiftUI

/// The board's comments, oldest first; tap one for its thread. A new comment
/// is pinned where the board view is centred.
struct CommentsSheet: View {
    @ObservedObject var model: BoardModel
    let newCommentAt: DesignCore.Point
    @State private var path: [String]

    init(model: BoardModel, newCommentAt: DesignCore.Point, openThread: String?) {
        self.model = model
        self.newCommentAt = newCommentAt
        _path = State(initialValue: openThread.map { [$0] } ?? [])
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if model.comments.isEmpty {
                    EmptyState(
                        icon: "bubble.left.and.bubble.right", title: "No comments yet",
                        message: model.canComment
                            ? "Comments are pinned to the middle of what you're looking at."
                            : "Comments people leave on this board show up here."
                    )
                    .plainRow()
                } else {
                    ForEach(Array(model.comments.enumerated()), id: \.element.id) { index, comment in
                        NavigationLink(value: comment.id) {
                            CommentRow(model: model, number: index + 1, author: comment.author, content: comment.content, createdAt: comment.createdAt, replies: comment.replies.count)
                        }
                        .cardRow()
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .navigationTitle("Comments")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { id in
                ThreadView(model: model, commentId: id)
            }
            .safeAreaInset(edge: .bottom) {
                CommentComposer(model: model, placeholder: "Add a comment") { text, name in
                    try await model.addComment(text, at: newCommentAt, joinAs: name)
                }
            }
        }
    }
}

private struct CommentRow: View {
    @ObservedObject var model: BoardModel
    let number: Int?
    let author: String
    let content: String
    let createdAt: UInt64
    let replies: Int

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Avatar(id: author, name: model.name(for: author), size: 32)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(model.name(for: author)).font(Theme.body(15, .semibold)).foregroundStyle(Theme.ink)
                    Text(DesignFormat.relativeTime(createdAt)).font(Theme.body(13)).foregroundStyle(Theme.faint)
                    Spacer(minLength: 0)
                    if let number {
                        Text("#\(number)").font(Theme.body(12, .semibold)).foregroundStyle(Theme.muted).monospacedDigit()
                    }
                }
                Text(content).font(Theme.body(15)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                if replies > 0 {
                    Label(replies == 1 ? "1 reply" : "\(replies) replies", systemImage: "arrowshape.turn.up.left")
                        .font(Theme.body(13, .medium))
                        .foregroundStyle(Theme.muted)
                        .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// One comment and its replies, with a reply composer.
private struct ThreadView: View {
    @ObservedObject var model: BoardModel
    let commentId: String

    var body: some View {
        let comment = model.comments.first { $0.id == commentId }
        List {
            if let comment {
                CommentRow(model: model, number: nil, author: comment.author, content: comment.content, createdAt: comment.createdAt, replies: 0)
                    .cardRow()
                if !comment.replies.isEmpty {
                    Section {
                        ForEach(comment.replies, id: \.id) { reply in
                            CommentRow(model: model, number: nil, author: reply.author, content: reply.content, createdAt: reply.createdAt, replies: 0)
                                .cardRow()
                        }
                    } header: {
                        SectionLabel(comment.replies.count == 1 ? "1 reply" : "\(comment.replies.count) replies")
                    }
                }
            } else {
                EmptyState(icon: "bubble.left", title: "Comment removed", message: "Someone deleted this comment.").plainRow()
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle("Thread")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if comment != nil {
                CommentComposer(model: model, placeholder: "Reply") { text, name in
                    try await model.reply(to: commentId, text, joinAs: name)
                }
            }
        }
    }
}

/// A text field and a send button. Viewers get a note instead; someone not
/// on the board's roster yet is asked their name before the first post.
struct CommentComposer: View {
    @ObservedObject var model: BoardModel
    let placeholder: String
    let send: (String, String?) async throws -> Void
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @State private var askName = false
    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let error {
                Text(error).font(Theme.body(13)).foregroundStyle(Theme.danger)
            }
            if model.role == nil {
                EmptyView()
            } else if !model.canComment {
                Label("View-only access. Ask a board admin for edit access to comment.", systemImage: "lock")
                    .font(Theme.body(14))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
            } else {
                HStack(alignment: .bottom, spacing: 8) {
                    TextField(placeholder, text: $text, axis: .vertical)
                        .lineLimit(1...5)
                        .font(Theme.body(16))
                        .focused($focused)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Theme.lineStrong, lineWidth: Theme.hairline))
                    Button {
                        if model.myName == nil {
                            askName = true
                        } else {
                            post(as: nil)
                        }
                    } label: {
                        Group {
                            if sending { ProgressView().tint(Theme.ink) } else { Image(systemName: "arrow.up").font(.system(size: 17, weight: .bold)) }
                        }
                        .foregroundStyle(Theme.ink)
                        .frame(width: 42, height: 42)
                        .background(Theme.lime.opacity(canSend ? 1 : 0.45), in: Circle())
                    }
                    .disabled(!canSend)
                    .accessibilityLabel("Send")
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
        .alert("Your name on this board", isPresented: $askName) {
            TextField("Name", text: $name)
            Button("Cancel", role: .cancel) {}
            Button("Post") { post(as: name) }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        } message: {
            Text("Others see this next to your comments.")
        }
    }

    private var canSend: Bool { !sending && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func post(as joinAs: String?) {
        let body = text
        sending = true
        error = nil
        Task {
            do {
                try await send(body, joinAs)
                text = ""
                Haptics.success()
            } catch {
                self.error = DesignFormat.errorText(error)
                Haptics.error()
            }
            sending = false
        }
    }
}
