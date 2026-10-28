import ForumCore
import ForumGenerated
import SwiftUI

/// Name, handle and age on one line, the timeline way.
struct AuthorLine: View {
    let name: String
    let account: String
    let stamp: UInt64?
    let isSelf: Bool
    var edited = false

    var body: some View {
        HStack(spacing: 4) {
            Text(ForumFormat.displayName(name, account: account))
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .layoutPriority(1)
            if isSelf { Badge(text: "You", strong: false) }
            if !name.trimmingCharacters(in: .whitespaces).isEmpty {
                Text(ForumFormat.handle(account)).font(.system(size: 15)).foregroundStyle(Palette.muted).lineLimit(1)
            }
            if let stamp {
                Text("·").foregroundStyle(Palette.muted)
                Text(ForumFormat.age(stamp)).font(.system(size: 15)).foregroundStyle(Palette.muted)
                    .fixedSize()
                if edited { Text("· edited").font(.system(size: 15)).foregroundStyle(Palette.muted).fixedSize() }
            }
        }
    }
}

/// Up, score, down. Tapping your current vote takes it back.
struct VoteControl: View {
    let score: Int64
    let myVote: Int32
    var size: CGFloat = 17
    let vote: (Int32) -> Void

    var body: some View {
        HStack(spacing: 2) {
            arrow(up: true)
            Text(ForumFormat.compact(score))
                .font(.system(size: 14, weight: myVote == 0 ? .regular : .semibold))
                .monospacedDigit()
                .foregroundStyle(myVote == -1 ? Palette.danger : Palette.inkSoft)
                .frame(minWidth: 18)
                .accessibilityLabel("Score \(score)")
            arrow(up: false)
        }
    }

    private func arrow(up: Bool) -> some View {
        let active = myVote == (up ? 1 : -1)
        return Button {
            Haptics.tap()
            vote(active ? 0 : (up ? 1 : -1))
        } label: {
            Image(systemName: up ? "arrow.up" : "arrow.down")
                .font(.system(size: size - 3, weight: active ? .bold : .medium))
                .foregroundStyle(active ? (up ? Palette.ink : Palette.danger) : Palette.muted)
                .frame(width: size + 13, height: size + 13)
                .background(Circle().fill(active ? (up ? Palette.lime : Palette.dangerSoft) : .clear))
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(up ? "Upvote" : "Downvote")
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

/// An icon and a count, for the action row.
struct ActionCount: View {
    let symbol: String
    let count: String?
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol).font(.system(size: 15))
                if let count { Text(count).font(.system(size: 14)).monospacedDigit() }
            }
            .foregroundStyle(Palette.muted)
            .frame(minHeight: 30)
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(label)
    }
}

/// What can be done to a post or a reply, by whom.
struct ItemMenu: View {
    let isMine: Bool
    let isModerator: Bool
    let noun: String
    let edit: () -> Void
    let delete: () -> Void
    let moderate: () -> Void
    let copyText: String

    var body: some View {
        Menu {
            if isMine {
                Button(action: edit) { Label("Edit", systemImage: "pencil") }
                Button(role: .destructive, action: delete) { Label("Delete", systemImage: "trash") }
            } else if isModerator {
                Button(role: .destructive, action: moderate) {
                    Label("Remove \(noun) as moderator", systemImage: "xmark.shield")
                }
            }
            Button {
                UIPasteboard.general.string = copyText
            } label: {
                Label("Copy text", systemImage: "doc.on.doc")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Palette.muted)
                .frame(width: 30, height: 26)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("More")
    }
}

/// A timeline row: avatar, who and when, the post, and its actions.
struct PostRow: View {
    let post: PostView
    let isMine: Bool
    let isModerator: Bool
    let vote: (Int32) -> Void
    let reply: () -> Void
    let edit: () -> Void
    let delete: () -> Void
    let moderate: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Avatar(label: ForumFormat.displayName(post.authorName, account: post.author), seed: post.author, size: 44)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .center, spacing: 0) {
                    AuthorLine(name: post.authorName, account: post.author, stamp: post.createdAt, isSelf: isMine)
                    Spacer(minLength: 6)
                    ItemMenu(
                        isMine: isMine, isModerator: isModerator, noun: "post", edit: edit, delete: delete,
                        moderate: moderate, copyText: "\(post.title)\n\n\(post.body)")
                }
                Text(post.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if !post.body.isEmpty {
                    Text(post.body)
                        .font(.system(size: 15))
                        .foregroundStyle(Palette.inkSoft)
                        .lineLimit(6)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                    ActionCount(
                        symbol: "bubble.left", count: post.commentCount > 0 ? ForumFormat.compact(Int64(post.commentCount)) : nil,
                        label: ForumFormat.count(Int(post.commentCount), "reply", "replies"), action: reply)
                    Spacer()
                    VoteControl(score: post.score, myVote: post.myVote, vote: vote)
                    Spacer()
                    ShareLink(item: "\(post.title)\n\n\(post.body)") {
                        Image(systemName: "square.and.arrow.up").font(.system(size: 15)).foregroundStyle(Palette.muted)
                            .frame(minHeight: 30)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Share")
                }
                .padding(.top, 4)
                .padding(.trailing, 8)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

/// Write or edit a post: a title and some text, under your name.
struct ComposeSheet: View {
    let heading: String
    let action: String
    let author: String
    let account: String
    var initialTitle = ""
    var initialBody = ""
    let submit: (String, String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    private enum Field { case title, body }

    private var canPost: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && title.count <= ForumConstants.maxTitle && text.count <= ForumConstants.maxBody
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(title: heading, action: action, canAct: canPost, busy: busy, cancel: { dismiss() }, act: run)
            ScrollView {
                HStack(alignment: .top, spacing: 12) {
                    Avatar(label: author.isEmpty ? "You" : author, seed: account, size: 40)
                    VStack(alignment: .leading, spacing: 10) {
                        TextField("Title", text: $title, axis: .vertical)
                            .font(Typeface.display(20))
                            .lineLimit(1...4)
                            .focused($focus, equals: .title)
                            .submitLabel(.next)
                        TextField("What do you want to talk about?", text: $text, axis: .vertical)
                            .font(.system(size: 17))
                            .lineLimit(6...)
                            .focused($focus, equals: .body)
                        if let error {
                            Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger)
                        }
                    }
                }
                .padding(16)
            }
            HStack(spacing: 8) {
                Image(systemName: author.isEmpty ? "person.crop.circle.badge.questionmark" : "person.crop.circle")
                Text(author.isEmpty ? "You haven't picked a name. This will be signed with your account id." : "Posting as \(author)")
                    .lineLimit(2)
                Spacer()
                if title.count > ForumConstants.maxTitle - 40 {
                    Text("\(ForumConstants.maxTitle - title.count)")
                        .foregroundStyle(title.count > ForumConstants.maxTitle ? Palette.danger : Palette.muted)
                }
            }
            .font(.system(size: 13))
            .foregroundStyle(Palette.muted)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .overlay(alignment: .top) { Rectangle().fill(Palette.hairline).frame(height: 0.5) }
        }
        .background(Palette.surface)
        .onAppear {
            title = initialTitle
            text = initialBody
            focus = .title
        }
        .interactiveDismissDisabled(busy || (!title.isEmpty && title != initialTitle))
    }

    private func run() {
        guard canPost, !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                try await submit(title, text)
                Haptics.success()
                dismiss()
            } catch {
                self.error = ForumErrorText.describe(error)
                Haptics.failure()
            }
            busy = false
        }
    }
}

/// Edit one block of text: a reply.
struct EditTextSheet: View {
    let heading: String
    let initial: String
    let submit: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: heading, action: "Save", canAct: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                busy: busy, cancel: { dismiss() }, act: run)
            VStack(alignment: .leading, spacing: 10) {
                TextField("Your reply", text: $text, axis: .vertical)
                    .font(.system(size: 17))
                    .lineLimit(4...)
                    .focused($focused)
                if let error { Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger) }
            }
            .padding(16)
            Spacer()
        }
        .background(Palette.surface)
        .presentationDetents([.medium, .large])
        .onAppear {
            text = initial
            focused = true
        }
    }

    private func run() {
        busy = true
        Task {
            do {
                try await submit(text)
                Haptics.success()
                dismiss()
            } catch {
                self.error = ForumErrorText.describe(error)
            }
            busy = false
        }
    }
}
