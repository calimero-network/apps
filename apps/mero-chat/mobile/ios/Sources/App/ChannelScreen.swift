import MeroKit
import SwiftUI
import UIKit

/// One channel: history (newest at the bottom, older on demand), the
/// composer, and per-message actions.
struct ChannelScreen: View {
    @ObservedObject var session: SessionModel
    @StateObject private var model: ChannelModel
    @State private var draft = ""
    @State private var editing: ChatMessage?
    @State private var settingName = false

    static let quickReactions = ["👍", "❤️", "😂", "🎉", "👀"]

    init(session: SessionModel, backend: DelegatedChatBackend, channel: ChannelEntry) {
        self.session = session
        _model = StateObject(wrappedValue: ChannelModel(channel: channel, backend: backend))
    }

    var body: some View {
        VStack(spacing: 0) {
            if let error = model.errorText {
                ErrorStrip(text: error) { model.errorText = nil }
            }
            if !model.isLoading, model.myProfileName == nil {
                Button {
                    settingName = true
                } label: {
                    Label("Set your name in this channel", systemImage: "person.badge.plus")
                        .font(.footnote)
                        .frame(maxWidth: .infinity)
                        .padding(8)
                }
                .background(Color.accentColor.opacity(0.1))
            }
            messageList
            Divider()
            composer
        }
        .navigationTitle(model.channel.kind == .dm ? model.channel.name : "#\(model.channel.name)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                LiveIndicator(status: model.liveStatus)
            }
        }
        .task {
            await model.loadInitial()
            model.startLive()
            await model.ensureProfile(session.displayName)
        }
        .onDisappear { model.stopLive() }
        .sheet(item: $editing) { message in
            NameSheet(title: "Edit message", placeholder: "Message", action: "Save", initial: message.text) { text in
                await model.edit(message, to: text)
                return true
            }
        }
        .sheet(isPresented: $settingName) {
            NameSheet(
                title: "Your name here", placeholder: "Name", action: "Save", initial: session.displayName,
                footer: "A channel keeps the first name you register in it."
            ) { name in
                await model.setProfileName(name)
            }
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            List {
                if model.hasOlder {
                    HStack {
                        Spacer()
                        if model.isLoadingOlder {
                            ProgressView()
                        } else {
                            Button("Load older messages") { Task { await model.loadOlder() } }
                                .font(.footnote)
                        }
                        Spacer()
                    }
                    .listRowSeparator(.hidden)
                }
                if model.messages.isEmpty, !model.isLoading {
                    EmptyStateView(
                        title: "No messages yet", message: "Say hello.", systemImage: "bubble.left")
                        .listRowSeparator(.hidden)
                }
                ForEach(model.messages) { message in
                    MessageRow(
                        message: message, author: model.displayName(of: message.sender),
                        isMine: model.isMine(message), me: model.me,
                        onReact: { emoji in Task { await model.toggleReaction(emoji, on: message) } }
                    )
                    .id(message.id)
                    .listRowSeparator(.hidden)
                    .contextMenu { menu(for: message) }
                }
            }
            .listStyle(.plain)
            .overlay {
                if model.isLoading && model.messages.isEmpty { ProgressView() }
            }
            .refreshable { await model.refreshNewest() }
            .onChange(of: model.messages.last?.id) { last in
                guard let last else { return }
                withAnimation { proxy.scrollTo(last, anchor: .bottom) }
            }
        }
    }

    @ViewBuilder private func menu(for message: ChatMessage) -> some View {
        if !message.deleted {
            ForEach(Self.quickReactions, id: \.self) { emoji in
                Button(emoji) { Task { await model.toggleReaction(emoji, on: message) } }
            }
            Button {
                UIPasteboard.general.string = message.text
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }
        }
        if model.isMine(message), !message.deleted {
            Button {
                editing = message
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            Button(role: .destructive) {
                Task { await model.delete(message) }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("composerField")
            Button {
                let text = draft
                Task {
                    if await model.send(text) { draft = "" }
                }
            } label: {
                if model.isSending {
                    ProgressView()
                } else {
                    Image(systemName: "paperplane.fill")
                }
            }
            .disabled(model.isSending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("sendButton")
        }
        .padding(8)
    }
}

private struct ErrorStrip: View {
    let text: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(text).font(.footnote)
            Spacer()
            Button(action: onDismiss) { Image(systemName: "xmark") }
        }
        .padding(8)
        .foregroundStyle(.white)
        .background(Color.red.opacity(0.85))
        .accessibilityIdentifier("channelError")
    }
}

private struct LiveIndicator: View {
    let status: ChannelModel.LiveStatus

    var body: some View {
        switch status {
        case .streaming:
            Image(systemName: "dot.radiowaves.left.and.right")
                .foregroundStyle(.green)
                .accessibilityLabel("Live")
        case .polling:
            Image(systemName: "arrow.triangle.2.circlepath")
                .foregroundStyle(.orange)
                .accessibilityLabel("Refreshing periodically")
        case .off:
            EmptyView()
        }
    }
}

/// One message: author, time, text (or "deleted"), edited mark, reactions.
struct MessageRow: View {
    let message: ChatMessage
    let author: String
    let isMine: Bool
    let me: String
    let onReact: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(isMine ? "\(author) (you)" : author)
                    .font(.subheadline.bold())
                Text(Self.time(message.timestamp))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if message.editedOn != nil, !message.deleted {
                    Text("edited").font(.caption2).foregroundStyle(.secondary)
                }
            }
            if message.deleted {
                Text("Message deleted").italic().foregroundStyle(.secondary)
            } else {
                Text(message.text).textSelection(.enabled)
                let attachments = message.files.count + message.images.count
                if attachments > 0 {
                    Label("\(attachments) attachment(s), open them on the web app", systemImage: "paperclip")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if !message.reactions.isEmpty {
                HStack(spacing: 6) {
                    ForEach(message.reactions.keys.sorted(), id: \.self) { emoji in
                        let reactors = message.reactions[emoji] ?? []
                        Button {
                            onReact(emoji)
                        } label: {
                            Text("\(emoji) \(reactors.count)")
                                .font(.caption)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(
                                    Capsule().fill(
                                        reactors.contains(me) ? Color.accentColor.opacity(0.25) : Color.gray.opacity(0.15))
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    static func time(_ seconds: UInt64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(seconds))
        let formatter = DateFormatter()
        formatter.doesRelativeDateFormatting = true
        formatter.dateStyle = Calendar.current.isDateInToday(date) ? .none : .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
