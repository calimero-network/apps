import DocsCore
import SwiftUI

/// A document's comment threads, or one block's, with a composer that
/// comments on the document, on the block, or replies.
struct CommentsSheet: View {
    @ObservedObject var model: DocumentModel
    @State private var focus: CommentFocus
    @State private var replyTo: DocComment?
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @FocusState private var composing: Bool
    @Environment(\.dismiss) private var dismiss

    init(model: DocumentModel, initialFocus: CommentFocus) {
        self.model = model
        _focus = State(initialValue: initialFocus)
    }

    private var blockId: String? {
        if case .block(let id) = focus { return id }
        return nil
    }

    private var threads: [CommentThread] {
        guard let blockId else { return model.threads }
        return model.threads.filter { $0.root.blockId == blockId }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let blockId {
                        BlockQuote(text: model.block(blockId)?.plainText ?? "", large: true)
                        if model.threads.count > threads.count {
                            Button {
                                focus = .all
                            } label: {
                                Label("Show all comments", systemImage: "list.bullet")
                                    .font(Theme.body(14, .medium))
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Theme.ink2)
                        }
                    }
                    if threads.isEmpty {
                        EmptyState(
                            icon: "text.bubble",
                            title: "No comments yet",
                            message: blockId == nil
                                ? "Start the conversation on this document."
                                : "Be the first to comment on this block.")
                    }
                    ForEach(threads) { thread in
                        ThreadCard(
                            thread: thread, model: model, showQuote: blockId == nil,
                            onReply: { comment in
                                replyTo = comment
                                composing = true
                            },
                            onOpenBlock: { focus = .block($0) })
                    }
                }
                .padding(16)
            }
            .background(Theme.ground)
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle(blockId == nil ? "Comments" : "Comments on block")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("sheet.done")
                }
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let replyTo {
                HStack(spacing: 6) {
                    Image(systemName: "arrowshape.turn.up.left").font(.system(size: 12))
                    Text("Replying to \(personName(replyTo.author, me: model.account))").font(Theme.body(13, .medium))
                    Spacer()
                    Button {
                        self.replyTo = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.faint)
                    }
                    .accessibilityLabel("Cancel reply")
                }
                .foregroundStyle(Theme.ink2)
            }
            if let error {
                Text(error).font(Theme.body(13)).foregroundStyle(Theme.danger)
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField(placeholder, text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .font(Theme.body(16))
                    .focused($composing)
                    .accessibilityIdentifier("comments.field")
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Theme.lineStrong, lineWidth: Theme.hairline))
                Button(action: send) {
                    Group {
                        if sending {
                            ProgressView().tint(Theme.ink)
                        } else {
                            Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold))
                        }
                    }
                    .foregroundStyle(Theme.ink)
                    .frame(width: 40, height: 40)
                    .background(Theme.lime.opacity(canSend ? 1 : 0.45), in: Circle())
                }
                .disabled(!canSend)
                .accessibilityLabel("Send")
                .accessibilityIdentifier("comments.send")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(.bar)
    }

    private var placeholder: String {
        if replyTo != nil { return "Write a reply" }
        return blockId == nil ? "Comment on this document" : "Comment on this block"
    }

    private var canSend: Bool { !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() {
        let text = draft
        let target = replyTo
        let block = blockId
        sending = true
        error = nil
        Task {
            do {
                if let target {
                    try await model.reply(to: target.id, text)
                } else {
                    try await model.addComment(text, blockId: block)
                }
                draft = ""
                replyTo = nil
                Haptics.success()
            } catch {
                self.error = DocsFormat.errorText(error)
                Haptics.error()
            }
            sending = false
        }
    }
}

/// The block a thread is about, quoted.
private struct BlockQuote: View {
    let text: String
    var large = false

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 1.5).fill(Theme.lime).frame(width: 3)
            Text(text.isEmpty ? "A block that is no longer in the document" : text)
                .font(Theme.body(large ? 15 : 13))
                .foregroundStyle(text.isEmpty ? Theme.faint : Theme.ink2)
                .lineLimit(large ? 6 : 2)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct ThreadCard: View {
    let thread: CommentThread
    @ObservedObject var model: DocumentModel
    let showQuote: Bool
    let onReply: (DocComment) -> Void
    let onOpenBlock: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if showQuote, let block = thread.root.blockId {
                Button {
                    onOpenBlock(block)
                } label: {
                    BlockQuote(text: model.block(block)?.plainText ?? "")
                }
                .buttonStyle(.plain)
            }
            CommentView(comment: thread.root, me: model.account)
            ForEach(thread.replies) { reply in
                CommentView(comment: reply, me: model.account).padding(.leading, 40)
            }
            Button {
                Haptics.tap()
                onReply(thread.replies.last ?? thread.root)
            } label: {
                Label("Reply", systemImage: "arrowshape.turn.up.left")
                    .font(Theme.body(14, .medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.ink2)
            .padding(.leading, 40)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }
}

private struct CommentView: View {
    let comment: DocComment
    let me: String

    var body: some View {
        let name = personName(comment.author, me: me)
        HStack(alignment: .top, spacing: 10) {
            Avatar(id: comment.author, name: name == "You" ? "You" : comment.author, size: 30)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(name).font(Theme.body(14, .semibold)).foregroundStyle(Theme.ink)
                    Text(DocsFormat.relativeTime(nanos: comment.createdAt)).font(Theme.body(12)).foregroundStyle(Theme.faint)
                }
                Text(comment.text)
                    .font(Theme.body(15))
                    .foregroundStyle(Theme.ink2)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
