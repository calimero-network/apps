import SheetsCore
import SwiftUI

/// One thread: the comment, its replies, resolve or reopen, reply, and edit or
/// delete your own (`app/src/components/CommentsPanel.tsx`).
struct ThreadCard: View {
    @ObservedObject var model: SpreadsheetModel
    let thread: CommentThread
    var location: String?
    var onOpenCell: (() -> Void)?
    @State private var reply = ""
    @State private var replying = false
    @State private var busy = false
    @State private var editing: Comment?
    @State private var editText = ""
    @State private var confirmDelete: Comment?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                if let location {
                    Button {
                        onOpenCell?()
                    } label: {
                        Label(location, systemImage: "tablecells").font(.system(size: 12, weight: .semibold, design: .monospaced))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Theme.sunken, in: Capsule())
                    .disabled(onOpenCell == nil)
                    .accessibilityLabel("Open cell \(location)")
                }
                if thread.root.resolved {
                    Label("Resolved", systemImage: "checkmark.circle.fill").font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.text3)
                }
                Spacer()
                if model.canComment {
                    Button {
                        Theme.haptic(.light)
                        run { try await model.setResolved(thread, !thread.root.resolved) }
                    } label: {
                        Text(thread.root.resolved ? "Reopen" : "Resolve").font(.system(size: 13, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(thread.root.resolved ? Theme.sunken : Theme.lime, in: Capsule())
                    .disabled(busy)
                }
            }
            row(thread.root)
            ForEach(thread.replies, id: \.id) { r in
                row(r).padding(.leading, 30)
            }
            if model.canComment {
                if replying {
                    HStack(alignment: .bottom, spacing: 8) {
                        TextField("Reply…", text: $reply, axis: .vertical)
                            .lineLimit(1...5)
                            .font(.system(size: 15))
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(Theme.ground, in: RoundedRectangle(cornerRadius: 12))
                        Button {
                            Theme.haptic()
                            let text = reply
                            run {
                                try await model.reply(to: thread, text: text)
                                reply = ""
                                replying = false
                            }
                        } label: {
                            Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                                .frame(width: 36, height: 36).background(Theme.lime, in: Circle())
                        }
                        .disabled(busy || reply.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityLabel("Send reply")
                    }
                } else {
                    Button { replying = true } label: {
                        Label("Reply", systemImage: "arrowshape.turn.up.left").font(.system(size: 13, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.text2)
                }
            }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle").font(.system(size: 13)).foregroundStyle(Theme.danger)
            }
        }
        .card(padding: 14)
        .opacity(thread.root.resolved ? 0.75 : 1)
        .alert("Edit comment", isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
            TextField("Comment", text: $editText)
            Button("Save") {
                if let c = editing {
                    let text = editText
                    run { try await model.editComment(c, text: text) }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Delete this comment?", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let c = confirmDelete { run { try await model.deleteComment(c) } }
            }
        } message: {
            Text(confirmDelete?.parent.isEmpty == true ? "Its replies are deleted with it." : "This cannot be undone.")
        }
    }

    private func row(_ c: Comment) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Avatar(seed: model.name(of: c.author), size: 24)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(model.name(of: c.author)).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text(SheetsFormat.ago(ns: c.createdAt)).font(.system(size: 12)).foregroundStyle(Theme.text3)
                    if c.updatedAt > c.createdAt {
                        Text("edited").font(.system(size: 12)).foregroundStyle(Theme.text3)
                    }
                }
                Text(c.text).font(.system(size: 15)).foregroundStyle(Theme.ink).textSelection(.enabled)
            }
            Spacer(minLength: 0)
            if model.isMine(c) {
                Menu {
                    Button { editText = c.text; editing = c } label: { Label("Edit", systemImage: "pencil") }
                    Button(role: .destructive) { confirmDelete = c } label: { Label("Delete", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.text3)
                        .frame(width: 28, height: 28)
                }
                .accessibilityLabel("Comment actions")
            }
        }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            do { try await work() } catch { self.error = SheetsFormat.errorText(error) }
            busy = false
        }
    }
}

/// A composer for a new thread on a cell.
struct NewCommentField: View {
    @ObservedObject var model: SpreadsheetModel
    let pos: GridPos
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Comment on \(pos.label)…", text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .font(.system(size: 15))
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
                Button {
                    Theme.haptic()
                    busy = true
                    error = nil
                    let body = text
                    Task {
                        do {
                            try await model.addComment(body, at: pos)
                            text = ""
                            Theme.success()
                        } catch {
                            self.error = SheetsFormat.errorText(error)
                        }
                        busy = false
                    }
                } label: {
                    Group {
                        if busy { ProgressView().tint(Theme.ink) } else { Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)) }
                    }
                    .foregroundStyle(Theme.ink)
                    .frame(width: 40, height: 40).background(Theme.lime, in: Circle())
                }
                .disabled(busy || text.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityLabel("Post comment")
            }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle").font(.system(size: 13)).foregroundStyle(Theme.danger)
            }
        }
    }
}

/// Every open thread in the workbook, each with a jump to its cell.
struct CommentsSheet: View {
    @ObservedObject var model: SpreadsheetModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                let threads = model.openThreads
                if threads.isEmpty {
                    EmptyState(
                        icon: "bubble.left.and.bubble.right", title: "No open comments",
                        message: "Select a cell and comment on it. Resolved threads stay on their cell.")
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(threads) { thread in
                                ThreadCard(
                                    model: model, thread: thread, location: model.location(of: thread.root),
                                    onOpenCell: {
                                        model.reveal(thread.root)
                                        dismiss()
                                    })
                            }
                        }
                        .padding(Theme.gutter)
                    }
                    .refreshable { await model.load() }
                }
            }
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle("Comments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
