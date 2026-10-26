import MeroKit
import SwiftUI
import UIKit

/// One open channel or DM, as the web app draws it at phone width: the nav
/// bar, the message list, the composer card, and the thread, search and
/// dialog overlays.
struct ChatScreen: View {
    @ObservedObject var session: SessionModel
    let backend: DelegatedChatBackend
    let channel: ChannelEntry
    let workspace: Workspace
    @ObservedObject var workspaces: WorkspacesModel
    let onBack: () -> Void
    let onChangeWorkspace: () -> Void
    let onChannelsChanged: () -> Void

    @StateObject private var model: ChannelModel
    @AppStorage(ThemeChoice.storageKey) private var theme = ThemeChoice.light.rawValue
    @State private var overlay: ChatOverlay?
    @State private var thread: ChatMessage?

    init(
        session: SessionModel, backend: DelegatedChatBackend, channel: ChannelEntry, workspace: Workspace,
        workspaces: WorkspacesModel, onBack: @escaping () -> Void, onChangeWorkspace: @escaping () -> Void,
        onChannelsChanged: @escaping () -> Void
    ) {
        self.session = session
        self.backend = backend
        self.channel = channel
        self.workspace = workspace
        self.workspaces = workspaces
        self.onBack = onBack
        self.onChangeWorkspace = onChangeWorkspace
        self.onChannelsChanged = onChannelsChanged
        _model = StateObject(wrappedValue: ChannelModel(channel: channel, backend: backend))
    }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                navBar
                ConversationView(
                    model: model, session: session, onOpenThread: { thread = $0 },
                    onShowReactions: { overlay = .reactions($0) })
            }
            if let thread {
                ThreadView(session: session, backend: backend, channel: channel, root: thread) {
                    self.thread = nil
                    Task { await model.refreshNewest() }
                }
                .transition(.move(edge: .trailing))
                .zIndex(1)
            }
            if let overlay {
                overlayView(overlay).zIndex(2)
            }
        }
        .animation(.easeOut(duration: 0.2), value: thread?.id)
        .task {
            await model.loadInitial()
            model.startLive()
            await model.ensureProfile(session.displayName)
        }
        .onDisappear { model.stopLive() }
    }

    private var navBar: some View {
        NavBar(onBack: onBack) {
            Button {
                if channel.kind == .channel { overlay = .details }
            } label: {
                HStack(spacing: 6) {
                    if channel.kind == .channel {
                        Image(systemName: channel.isPrivate ? "lock.fill" : "number")
                            .font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.muted)
                    }
                    Text(channel.name).font(Theme.font(16, .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    if channel.kind == .channel {
                        Image(systemName: "gearshape.fill").font(.system(size: 11)).foregroundStyle(Theme.muted)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("channelTitle")
        } trailing: {
            NavIconButton(
                systemImage: "magnifyingglass", label: "Toggle message search", active: overlay == .search,
                tint: Theme.ink2
            ) { overlay = .search }
            if model.myRole.canModerate {
                NavIconButton(systemImage: "plus", label: "Invite members") { overlay = .invite }
            }
            NavIconButton(
                systemImage: theme == ThemeChoice.dark.rawValue ? "sun.max" : "moon",
                label: theme == ThemeChoice.dark.rawValue ? "Use light theme" : "Use dark theme"
            ) {
                theme = (ThemeChoice(rawValue: theme) ?? .light).toggled.rawValue
            }
            NavIconButton(systemImage: "gearshape", label: "Settings") { overlay = .settings }
                .accessibilityIdentifier("settingsButton")
        }
    }

    @ViewBuilder private func overlayView(_ overlay: ChatOverlay) -> some View {
        let close = { self.overlay = nil }
        switch overlay {
        case .search:
            SearchOverlay(
                model: model,
                onOpenThread: { id in
                    close()
                    thread = model.messages.first { $0.id == id }
                }, onClose: close)
        case .invite:
            InviteDialog(workspaces: workspaces, workspace: workspace, onClose: close)
        case .settings:
            SettingsDialog(
                session: session, workspace: workspace, channelRole: model.myRole,
                onChangeWorkspace: onChangeWorkspace, onClose: close)
        case .details:
            ChannelDetailsDialog(model: model, onClose: close)
        case .reactions(let message):
            ReactionsListDialog(message: message, nameOf: { model.displayName(of: $0) }, onClose: close)
        }
    }
}

enum ChatOverlay: Equatable {
    case search
    case invite
    case settings
    case details
    case reactions(ChatMessage)
}

// MARK: - Thread

/// The thread overlay: a solid sheet over the channel with "Thread" and a close button.
struct ThreadView: View {
    @ObservedObject var session: SessionModel
    @StateObject private var model: ChannelModel
    let onClose: () -> Void
    @State private var reactions: ChatMessage?

    init(
        session: SessionModel, backend: DelegatedChatBackend, channel: ChannelEntry, root: ChatMessage,
        onClose: @escaping () -> Void
    ) {
        self.session = session
        self.onClose = onClose
        _model = StateObject(wrappedValue: ChannelModel(channel: channel, backend: backend, thread: root))
    }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                HStack {
                    Text("Thread").font(Theme.font(18, .medium)).foregroundStyle(Theme.ink)
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark.circle").font(.system(size: 22)).foregroundStyle(Theme.muted)
                    }
                    .accessibilityLabel("Close thread")
                    .accessibilityIdentifier("closeThread")
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 16)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 2) }
                ConversationView(
                    model: model, session: session, onOpenThread: { _ in }, onShowReactions: { reactions = $0 })
            }
            .background(Theme.surfaceSolid.ignoresSafeArea())
            if let reactions {
                ReactionsListDialog(
                    message: reactions, nameOf: { model.displayName(of: $0) }, onClose: { self.reactions = nil })
            }
        }
        .task {
            await model.loadInitial()
            model.startLive()
        }
        .onDisappear { model.stopLive() }
    }
}

// MARK: - Conversation

/// The message list and the composer, shared by a channel and a thread.
struct ConversationView: View {
    @ObservedObject var model: ChannelModel
    @ObservedObject var session: SessionModel
    let onOpenThread: (ChatMessage) -> Void
    let onShowReactions: (ChatMessage) -> Void

    @State private var actionsFor: String?
    @State private var moreFor: String?
    @State private var reactingTo: ChatMessage?
    @State private var editing: ChatMessage?
    @State private var settingName = false
    @State private var atBottom = true

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                if let error = model.errorText {
                    Banner(kind: .error, text: error) { model.errorText = nil }
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                        .accessibilityIdentifier("channelError")
                }
                if !model.isLoading, model.myProfileName == nil, model.thread == nil {
                    Button {
                        settingName = true
                    } label: {
                        Label("Set your name in this channel", systemImage: "person.badge.plus")
                            .font(Theme.font(12.5, .semibold))
                            .foregroundStyle(Theme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(8)
                            .background(Theme.accent(8))
                    }
                    .buttonStyle(.plain)
                }
                messageList
                if editing == nil {
                    ComposerView(model: model)
                }
            }
            if actionsFor != nil {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .onTapGesture { dismissActions() }
            }
            if let reactingTo {
                EmojiPickerView(title: "Add reaction") { emoji in
                    Task { await model.toggleReaction(emoji, on: reactingTo) }
                    self.reactingTo = nil
                } onClose: {
                    self.reactingTo = nil
                }
                .frame(maxHeight: .infinity, alignment: .center)
            }
            if let editing {
                EditSheet(model: model, message: editing) { self.editing = nil }
            }
            if settingName {
                DialogFrame(icon: "person.badge.plus", title: "Your name here", onClose: { settingName = false }) {
                    NameForm(initial: session.displayName, footer: "A channel keeps the first name you register in it.") {
                        name in
                        if await model.setProfileName(name) { settingName = false }
                    }
                }
            }
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if model.hasOlder {
                        Group {
                            if model.isLoadingOlder {
                                Text("Loading older messages...").font(Theme.font(12)).foregroundStyle(Theme.muted)
                            } else {
                                Button("Load older messages") { Task { await model.loadOlder() } }
                                    .font(Theme.font(12, .semibold)).foregroundStyle(Theme.accent)
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 30)
                        .onAppear { Task { await model.loadOlder() } }
                    }
                    if model.messages.isEmpty, !model.isLoading {
                        emptyState
                    }
                    ForEach(Array(model.messages.enumerated()), id: \.element.id) { i, message in
                        MessageRow(
                            message: message,
                            startsGroup: ChatFormat.startsGroup(message, after: i > 0 ? model.messages[i - 1] : nil),
                            author: model.displayName(of: message.sender),
                            isMine: model.isMine(message),
                            me: model.me,
                            mentionsMe: mentionsMe(message),
                            inThread: model.thread != nil,
                            canEdit: model.canEdit(message),
                            canDelete: model.canDelete(message),
                            showActions: actionsFor == message.id,
                            showMore: moreFor == message.id,
                            onLongPress: {
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                moreFor = nil
                                actionsFor = message.id
                            },
                            onAction: { handle($0, message) }
                        )
                        .id(message.id)
                    }
                    Color.clear.frame(height: 12).id("bottom")
                        .onAppear { atBottom = true }
                        .onDisappear { atBottom = false }
                }
                .padding(.top, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .overlay {
                if model.isLoading && model.messages.isEmpty { ProgressView().tint(Theme.accent) }
            }
            .overlay(alignment: .bottomTrailing) {
                if !atBottom {
                    Button {
                        withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                    } label: {
                        Image(systemName: "chevron.down.2")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.onInk)
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(Theme.ink))
                    }
                    .padding(20)
                    .accessibilityLabel("Scroll to the newest message")
                }
            }
            .onChange(of: model.messages.last?.id) { _ in
                if atBottom || model.messages.last.map(model.isMine) == true {
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            .onChange(of: model.isLoading) { loading in
                if !loading { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "bubble.left.fill")
                .font(.system(size: 13))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Circle().fill(Theme.ink))
                .shadow(color: Theme.accent(40), radius: 10)
            Text(model.thread == nil ? "No messages yet" : "No replies yet")
                .font(Theme.font(16, .medium)).foregroundStyle(Theme.ink)
            Text(
                model.thread == nil
                    ? "Start the conversation by sending your first message" : "Reply to start the thread"
            )
            .font(Theme.font(13)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }

    private func mentionsMe(_ message: ChatMessage) -> Bool {
        message.mentions.contains(model.me)
            || message.mentionsUsernames.contains { $0 == "everyone" || $0 == "here" }
    }

    private func dismissActions() {
        actionsFor = nil
        moreFor = nil
    }

    private func handle(_ action: MessageAction, _ message: ChatMessage) {
        switch action {
        case .react(let emoji):
            dismissActions()
            Task { await model.toggleReaction(emoji, on: message) }
        case .pickEmoji:
            dismissActions()
            reactingTo = message
        case .thread:
            dismissActions()
            onOpenThread(message)
        case .more:
            moreFor = moreFor == message.id ? nil : message.id
        case .reactions:
            dismissActions()
            onShowReactions(message)
        case .edit:
            dismissActions()
            editing = message
        case .delete:
            dismissActions()
            Task { await model.delete(message) }
        case .copy:
            dismissActions()
            UIPasteboard.general.string = RichText.parse(html: message.text).plainText
        case .openThread:
            onOpenThread(message)
        case .canEdit:
            break
        }
    }
}

enum MessageAction: Equatable {
    case react(String)
    case pickEmoji
    case thread
    case more
    case reactions
    case edit
    case delete
    case copy
    case openThread
    case canEdit
}

// MARK: - Message row

/// `Message/index.tsx`: avatar, name and time on a group's first message,
/// the bubble (top-left squared), "(edited)" and the delivery tick, then
/// reactions and the thread line.
struct MessageRow: View {
    let message: ChatMessage
    let startsGroup: Bool
    let author: String
    let isMine: Bool
    let me: String
    let mentionsMe: Bool
    let inThread: Bool
    let canEdit: Bool
    let canDelete: Bool
    let showActions: Bool
    let showMore: Bool
    let onLongPress: () -> Void
    let onAction: (MessageAction) -> Void

    var body: some View {
        if message.deleted {
            Text("This message has been deleted.")
                .font(Theme.font(14).italic())
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 15)
                .padding(.vertical, 10)
                .accessibilityIdentifier("deletedMessage")
        } else {
            VStack(alignment: .leading, spacing: 0) {
                if startsGroup {
                    HStack(spacing: 8) {
                        AvatarView(name: author, size: 32)
                        Text(author).font(Theme.font(13, .bold)).foregroundStyle(Theme.ink).lineLimit(1)
                        Text(ChatFormat.messageTime(message.timestamp)).font(Theme.font(12)).foregroundStyle(Theme.muted)
                    }
                }
                HStack(alignment: .bottom, spacing: 4) {
                    bubble
                    VStack(alignment: .trailing, spacing: 0) {
                        if message.editedOn != nil {
                            Text("(edited)").font(Theme.font(12)).foregroundStyle(Theme.muted)
                        }
                        if isMine {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(Theme.muted)
                                .overlay(
                                    Image(systemName: "checkmark").font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(Theme.muted).offset(x: 4))
                                .frame(width: 20, height: 20)
                                .accessibilityLabel("Sent")
                        }
                    }
                    .frame(minWidth: 24)
                }
                .padding(.leading, 40)
                .padding(.top, startsGroup ? 4 : 0)
                attachments
                reactions
                if !inThread, message.threadCount > 0 {
                    Button {
                        onAction(.openThread)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "text.bubble").font(.system(size: 15)).foregroundStyle(Theme.ink)
                            Text(ChatFormat.replies(message.threadCount)).font(Theme.font(12)).foregroundStyle(Theme.accent)
                            if message.threadLastTimestamp > 0 {
                                Text(ChatFormat.elapsed(message.threadLastTimestamp))
                                    .font(Theme.font(12)).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(.leading, 42)
                    .padding(.top, 6)
                    .accessibilityIdentifier("threadReplies")
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onLongPressGesture(minimumDuration: 0.4, perform: onLongPress)
            .overlay(alignment: .topTrailing) {
                if showActions { actionBar.offset(y: startsGroup ? 0 : -16) }
            }
            .zIndex(showActions ? 10 : 0)
        }
    }

    private var bubble: some View {
        RichTextView(rich: RichText.parse(html: message.text))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                UnevenRoundedRect(topLeft: 4, others: 18)
                    .fill(Theme.chatCard)
                    .overlay(UnevenRoundedRect(topLeft: 4, others: 18).fill(mentionsMe ? Theme.accent(9) : .clear))
                    .shadow(color: Color.black.opacity(0.05), radius: 1, y: 1)
                    .overlay(
                        UnevenRoundedRect(topLeft: 4, others: 18)
                            .stroke(mentionsMe ? Theme.accent(30) : Theme.line, lineWidth: 1))
            )
            .frame(maxWidth: UIScreen.main.bounds.width - 120, alignment: .leading)
            .accessibilityIdentifier("messageBubble")
    }

    @ViewBuilder private var attachments: some View {
        let all = message.images + message.files
        if !all.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(all.enumerated()), id: \.offset) { _, file in
                    HStack(spacing: 8) {
                        Image(systemName: file.mimeType.hasPrefix("image/") ? "photo.fill" : "doc.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.ink))
                        Text(file.name).font(Theme.font(13, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    }
                    .padding(6)
                    .padding(.trailing, 6)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(Theme.line, lineWidth: 1))
                }
            }
            .padding(.leading, 40)
            .padding(.top, 6)
        }
    }

    @ViewBuilder private var reactions: some View {
        let emojis = message.reactions.filter { !$0.value.isEmpty }.keys.sorted()
        if !emojis.isEmpty {
            FlowLayout(spacing: 4) {
                ForEach(emojis, id: \.self) { emoji in
                    let users = message.reactions[emoji] ?? []
                    let mine = users.contains(me)
                    Button {
                        onAction(.react(emoji))
                    } label: {
                        HStack(spacing: 4) {
                            Text(emoji).font(.system(size: 15))
                            Text("\(users.count)").font(Theme.font(12)).foregroundStyle(mine ? Theme.waitInk : Theme.ink)
                        }
                        .padding(.horizontal, 5)
                        .frame(height: 24)
                        .background(RoundedRectangle(cornerRadius: 8).fill(mine ? Theme.waitBg : Theme.surfaceSolid))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(emoji) \(users.count)\(mine ? ", you reacted" : "")")
                }
            }
            .padding(.leading, 40)
            .padding(.top, 6)
        }
    }

    private var actionBar: some View {
        VStack(alignment: .trailing, spacing: 4) {
            if showMore {
                VStack(alignment: .leading, spacing: 0) {
                    moreItem("Reactions", .reactions)
                    moreItem("Copy text", .copy)
                    if canEdit { moreItem("Edit message", .edit) }
                    if canDelete { moreItem("Delete message", .delete, destructive: true) }
                }
                .frame(width: 226)
                .popCard(radius: 8)
            }
            HStack(spacing: 4) {
                ForEach(["✅", "👍", "😀"], id: \.self) { emoji in
                    barButton { Text(emoji).font(.system(size: 15)) } action: { onAction(.react(emoji)) }
                }
                barButton { Image(systemName: "face.smiling").font(.system(size: 14)) } action: { onAction(.pickEmoji) }
                    .accessibilityLabel("Add reaction")
                if !inThread {
                    barButton { Image(systemName: "text.bubble").font(.system(size: 14)) } action: { onAction(.thread) }
                        .accessibilityLabel("Reply in thread")
                        .accessibilityIdentifier("replyInThread")
                }
                barButton { Image(systemName: "ellipsis").font(.system(size: 14, weight: .semibold)) } action: {
                    onAction(.more)
                }
                .accessibilityLabel("More actions")
                .accessibilityIdentifier("moreActions")
            }
            .padding(.horizontal, 4)
            .frame(height: 34)
            .popCard(radius: 8)
        }
        .padding(.trailing, 16)
        .offset(y: showMore ? -150 : -10)
    }

    private func barButton(@ViewBuilder _ label: () -> some View, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            label().foregroundStyle(Theme.ink2).frame(width: 30, height: 30).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func moreItem(_ title: String, _ action: MessageAction, destructive: Bool = false) -> some View {
        Button {
            onAction(action)
        } label: {
            Text(title).font(Theme.font(14))
                .foregroundStyle(destructive ? Theme.badInk : Theme.ink)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(title)
    }
}

/// A rectangle with its top-left corner squared off: the chat bubble (`4 18 18 18`).
struct UnevenRoundedRect: Shape {
    let topLeft: CGFloat
    let others: CGFloat

    func path(in rect: CGRect) -> Path {
        let r = min(others, min(rect.width, rect.height) / 2)
        let tl = min(topLeft, r)
        var p = Path()
        p.move(to: CGPoint(x: rect.minX + tl, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
        p.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + r), radius: r)
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - r, y: rect.maxY), radius: r)
        p.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - r), radius: r)
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + tl))
        p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + tl, y: rect.minY), radius: tl)
        p.closeSubpath()
        return p
    }
}

/// Wraps its children onto new lines, like `flex-wrap: wrap`.
struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Edit

/// `MessageEditorMobile.tsx`: a bottom sheet with "Cancel editing message" and the composer prefilled.
struct EditSheet: View {
    @ObservedObject var model: ChannelModel
    let message: ChatMessage
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onDone) {
                HStack(spacing: 8) {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 14)).foregroundStyle(Theme.ink)
                    Text("Cancel editing message").font(Theme.font(12)).foregroundStyle(Theme.ink)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
            ComposerView(model: model, editing: message, onEdited: onDone)
        }
        .background(
            UnevenRoundedRectangleTop(radius: 8).fill(Theme.surfaceSolid)
                .shadow(color: Color(hex: 0x141A3C, alpha: 0.25), radius: 20, y: -6)
                .ignoresSafeArea(edges: .bottom)
        )
    }
}

/// Top corners rounded only.
struct UnevenRoundedRectangleTop: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + radius, y: rect.minY), radius: radius)
        p.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        p.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + radius), radius: radius)
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}

/// One name field and a Save button.
struct NameForm: View {
    @State private var name: String
    let footer: String
    let onSubmit: (String) async -> Void
    @State private var working = false

    init(initial: String, footer: String, onSubmit: @escaping (String) async -> Void) {
        _name = State(initialValue: initial)
        self.footer = footer
        self.onSubmit = onSubmit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Theme.label("Your name", size: 10.9, opacity: 35)
            TextField("e.g. Alice", text: $name).textFieldStyle(ChatFieldStyle())
            Text(footer).font(Theme.font(12)).foregroundStyle(Theme.muted)
            Button(working ? "Saving…" : "Save") {
                Task {
                    working = true
                    await onSubmit(name)
                    working = false
                }
            }
            .buttonStyle(InkButtonStyle())
            .disabled(working || name.trimmingCharacters(in: .whitespaces).isEmpty)
            .padding(.top, 12)
        }
    }
}
