import SwiftUI
import UpdatesCore

/// One update or question: the post, its KPIs and asks, reactions, and the
/// replies with a keyboard-safe reply bar.
struct PostScreen: View {
    @ObservedObject var audience: AudienceModel
    @StateObject private var model: PostModel
    @Environment(\.compose) private var compose
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false
    @State private var draft = ""
    @State private var replyTo: CommentView?
    @State private var editing: CommentView?
    @State private var sending = false
    @State private var sendError: String?
    @State private var deleteComment: CommentView?
    @FocusState private var focused: Bool

    init(postId: String, audience: AudienceModel) {
        self.audience = audience
        _model = StateObject(wrappedValue: PostModel(postId: postId, audience: audience))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let post = model.post {
                    header(post.card)
                    if !post.card.summary.isEmpty { tldr(post.card.summary) }
                    if !post.metrics.isEmpty { kpis(post.metrics) }
                    ForEach(Array(post.sections.enumerated()), id: \.offset) { _, section in
                        VStack(alignment: .leading, spacing: 6) {
                            if !section.title.isEmpty {
                                Text(section.title).font(Typeface.display(19)).foregroundStyle(Palette.ink)
                            }
                            Text(section.body).font(.body).foregroundStyle(Palette.ink).textSelection(.enabled)
                        }
                    }
                    if !post.asks.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Label("How you can help", systemImage: "hand.raised").font(.headline)
                                .foregroundStyle(Palette.ink)
                            ForEach(post.asks) { AskCardView(ask: $0, audience: audience) }
                        }
                    }
                    reactions
                    replies
                } else if let error = model.error {
                    Card { ErrorLine(message: error) }
                } else {
                    SkeletonCard(height: 40)
                    SkeletonCard(height: 220)
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationTitle(model.isQuestion ? "Q&A" : "Update")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { tools } }
        .safeAreaInset(edge: .bottom) { if model.post != nil { replyBar } }
        .refreshable { await model.load() }
        .task(id: audience.version) { await model.load() }
        .confirmationDialog("Delete for everyone?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task {
                    if await model.delete() {
                        Haptics.success()
                        dismiss()
                    }
                }
            }
        }
        .confirmationDialog(
            "Delete this reply?",
            isPresented: Binding(get: { deleteComment != nil }, set: { if !$0 { deleteComment = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let comment = deleteComment { Task { await model.delete(comment) } }
            }
        }
    }

    // MARK: - Header

    @ViewBuilder private func header(_ card: PostCard) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                if model.isQuestion {
                    Badge(
                        title: card.status == "answered" ? "Answered" : "Open question",
                        tone: card.status == "answered" ? .good : .warn)
                }
                if let category = audience.category(card.categoryId) { CategoryChip(category: category) }
            }
            Text(card.title).font(Typeface.display(28)).foregroundStyle(Palette.ink)
            HStack(spacing: 10) {
                Avatar(account: card.author, name: card.authorName, team: card.authorIsTeam, size: 34)
                VStack(alignment: .leading, spacing: 1) {
                    Text(People.label(card.authorName, card.author)).font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.ink)
                    Text(Format.formatDate(card.createdAt) + (card.editedAt > card.createdAt + 1000 ? " · edited" : ""))
                        .font(.footnote).foregroundStyle(Palette.ink2)
                }
                Spacer()
                if audience.isTeam && !model.isQuestion {
                    Label("\(card.readCount) read", systemImage: "eye").font(.footnote.weight(.medium))
                        .foregroundStyle(Palette.ink2)
                        .accessibilityHint("Members who opened it, including the team")
                }
            }
        }
    }

    private func tldr(_ summary: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("TL;DR").font(.caption.weight(.bold)).tracking(0.6).foregroundStyle(Palette.ink)
            Text(summary).font(.body).foregroundStyle(Palette.ink).textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Palette.limeSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func kpis(_ metrics: [Metric]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(Array(metrics.enumerated()), id: \.offset) { _, metric in
                KpiTile(metric: metric, previous: model.previous(metric)?.value)
            }
        }
    }

    // MARK: - Reactions

    private var reactions: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.usedReactions) { r in
                    Button {
                        Haptics.tap()
                        Task { await model.toggle(r.emoji) }
                    } label: {
                        HStack(spacing: 4) {
                            Text(r.emoji)
                            Text("\(r.count)").font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 34)
                        .background(r.mine ? Palette.lime : Palette.sunken, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(r.emoji) \(r.count)\(r.mine ? ", yours" : "")")
                }
                Menu {
                    ForEach(Catalog.reactions, id: \.self) { emoji in
                        Button {
                            Haptics.tap()
                            Task { await model.toggle(emoji) }
                        } label: {
                            Text(model.mine(emoji) ? "\(emoji)  Remove" : emoji)
                        }
                    }
                } label: {
                    Image(systemName: "face.smiling")
                        .font(.body.weight(.medium))
                        .foregroundStyle(Palette.ink)
                        .frame(width: 44, height: 34)
                        .background(Palette.sunken, in: Capsule())
                }
                .accessibilityLabel("Add a reaction")
            }
        }
    }

    // MARK: - Replies

    private var replies: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(
                model.comments.isEmpty
                    ? "Replies" : "\(model.comments.count) repl\(model.comments.count == 1 ? "y" : "ies")",
                systemImage: "bubble.left"
            )
            .font(.headline).foregroundStyle(Palette.ink)
            if model.comments.isEmpty {
                Text("No replies yet. Be the first.").font(.subheadline).foregroundStyle(Palette.ink3)
            }
            ForEach(model.topLevel) { comment in
                VStack(alignment: .leading, spacing: 10) {
                    commentItem(comment, parent: comment)
                    ForEach(model.replies(to: comment.id)) { reply in
                        commentItem(reply, parent: comment).padding(.leading, 36)
                    }
                }
                .padding(12)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
            }
        }
    }

    private func commentItem(_ comment: CommentView, parent: CommentView) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Avatar(account: comment.author, name: comment.authorName, team: comment.authorIsTeam, size: 28)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(People.label(comment.authorName, comment.author)).font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.ink)
                    if comment.authorIsTeam { Badge(title: "Team") }
                    Text(Format.timeAgo(comment.createdAt) + (comment.editedAt > comment.createdAt + 1000 ? " · edited" : ""))
                        .font(.caption).foregroundStyle(Palette.ink3)
                }
                Text(comment.body).font(.subheadline).foregroundStyle(Palette.ink).textSelection(.enabled)
                HStack(spacing: 16) {
                    LinkButton(title: "Reply") {
                        editing = nil
                        replyTo = parent
                        focused = true
                    }
                    if model.canEdit(comment) {
                        LinkButton(title: "Edit") {
                            replyTo = nil
                            editing = comment
                            draft = comment.body
                            focused = true
                        }
                    }
                    if model.canDelete(comment) {
                        LinkButton(title: "Delete", tint: Palette.danger) { deleteComment = comment }
                    }
                }
                .padding(.top, 2)
            }
        }
    }

    private var replyBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let target = replyTo ?? editing {
                HStack {
                    Text(editing != nil ? "Editing your reply" : "Replying to \(People.label(target.authorName, target.author))")
                        .font(.caption.weight(.medium)).foregroundStyle(Palette.ink2)
                    Spacer()
                    Button {
                        replyTo = nil
                        if editing != nil { draft = "" }
                        editing = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.ink3)
                    }
                    .accessibilityLabel("Cancel")
                }
            }
            if let sendError { ErrorLine(message: sendError) }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(replyTo != nil ? "Write a reply…" : model.replyPlaceholder, text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                Button(action: send) {
                    Group {
                        if sending { ProgressView().tint(Palette.ink) } else { Image(systemName: "arrow.up") }
                    }
                    .font(.body.weight(.bold))
                    .foregroundStyle(Palette.ink)
                    .frame(width: 40, height: 40)
                    .background(
                        Palette.lime.opacity(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.45 : 1),
                        in: Circle())
                }
                .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel(editing != nil ? "Save" : "Send")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func send() {
        let body = draft
        sending = true
        sendError = nil
        Task {
            defer { sending = false }
            do {
                if let editing {
                    try await model.edit(editing, body: body)
                } else {
                    try await model.reply(body, to: replyTo?.id)
                }
                draft = ""
                replyTo = nil
                editing = nil
                focused = false
                Haptics.success()
            } catch {
                sendError = ErrorText.describe(error)
                Haptics.error()
            }
        }
    }

    // MARK: - Tools

    @ViewBuilder private var tools: some View {
        if model.canEdit || model.canDelete || (audience.isTeam && model.isQuestion) {
            Menu {
                if model.canEdit {
                    Button { compose(.edit(model.postId)) } label: { Label("Edit", systemImage: "pencil") }
                }
                if audience.isTeam && model.isQuestion {
                    Button { Task { await model.toggleAnswered() } } label: {
                        if model.post?.card.status == "answered" {
                            Label("Re-open", systemImage: "arrow.uturn.backward.circle")
                        } else {
                            Label("Mark answered", systemImage: "checkmark.circle")
                        }
                    }
                }
                if model.canDelete {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("Post actions")
        }
    }
}

/// A KPI with its change since the previous report of the same metric.
struct KpiTile: View {
    let name: String
    let value: String
    let unit: String
    let previous: String?

    init(metric: Metric, previous: String?) {
        self.name = metric.name
        self.value = metric.value
        self.unit = metric.unit
        self.previous = previous
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(name.uppercased()).font(.caption2.weight(.semibold)).tracking(0.5).foregroundStyle(Palette.ink2)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(Typeface.display(22)).foregroundStyle(Palette.ink).lineLimit(1)
                    .minimumScaleFactor(0.6)
                if !unit.isEmpty { Text(unit).font(.caption).foregroundStyle(Palette.ink2) }
            }
            if let previous, let delta = Metrics.delta(previous, value) {
                HStack(spacing: 6) {
                    DeltaLabel(delta: delta)
                    Text("vs \(previous)").font(.caption).foregroundStyle(Palette.ink3).lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, lineWidth: 0.5))
    }
}
