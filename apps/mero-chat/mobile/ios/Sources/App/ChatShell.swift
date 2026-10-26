import MeroKit
import SwiftUI

/// A workspace open, laid out as the web app lays it out below 1024px: the
/// sidebar is a full-screen panel that slides in from the left over the chat,
/// and picking a channel closes it.
struct ChatShell: View {
    @ObservedObject var session: SessionModel
    let backend: DelegatedChatBackend
    @ObservedObject var workspaces: WorkspacesModel
    let workspace: Workspace
    let onChangeWorkspace: () -> Void

    @StateObject private var channels: ChannelsModel
    @State private var current: ChannelEntry?
    @State private var browsing = false
    @State private var sidebarOpen = true
    @State private var dialog: ShellDialog?

    init(
        session: SessionModel, backend: DelegatedChatBackend, workspaces: WorkspacesModel, workspace: Workspace,
        onChangeWorkspace: @escaping () -> Void
    ) {
        self.session = session
        self.backend = backend
        self.workspaces = workspaces
        self.workspace = workspace
        self.onChangeWorkspace = onChangeWorkspace
        _channels = StateObject(
            wrappedValue: ChannelsModel(
                workspace: workspace, backend: backend,
                displayName: { [weak session] in session?.displayName ?? "" }))
    }

    var body: some View {
        ZStack {
            GroundBackground()
            Group {
                if browsing {
                    BrowseChannelsScreen(
                        model: channels, onBack: { sidebarOpen = true },
                        onOpen: { open($0) })
                } else if let current {
                    ChatScreen(
                        session: session, backend: backend, channel: current, workspace: workspace,
                        workspaces: workspaces, onBack: { sidebarOpen = true },
                        onChangeWorkspace: onChangeWorkspace, onChannelsChanged: { Task { await channels.load() } }
                    )
                    .id(current.id)
                } else {
                    Color.clear
                }
            }
            if sidebarOpen || (current == nil && !browsing) {
                SidebarView(
                    model: channels, workspaces: workspaces, workspace: workspace, current: current,
                    browsing: browsing,
                    onOpen: { open($0) },
                    onBrowse: {
                        browsing = true
                        sidebarOpen = false
                    },
                    onCreateChannel: { dialog = .createChannel },
                    onSwitchWorkspace: { _ in onChangeWorkspace() },
                    onNewWorkspace: onChangeWorkspace
                )
                .transition(.move(edge: .leading))
                .zIndex(1)
            }
            if let dialog {
                dialogView(dialog).zIndex(2)
            }
        }
        .animation(.easeOut(duration: 0.3), value: sidebarOpen)
        .task { await channels.load() }
    }

    private func open(_ channel: ChannelEntry) {
        channels.markOpened(channel.id)
        current = channel
        browsing = false
        sidebarOpen = false
    }

    @ViewBuilder private func dialogView(_ dialog: ShellDialog) -> some View {
        switch dialog {
        case .createChannel:
            CreateChannelDialog(model: channels) { self.dialog = nil }
        }
    }
}

private enum ShellDialog: Equatable {
    case createChannel
}

// MARK: - Sidebar

/// `SideSelector.tsx` at phone width: the logo, the workspace switcher,
/// Browse Channels, then CHANNELS and DIRECT MESSAGES.
struct SidebarView: View {
    @ObservedObject var model: ChannelsModel
    @ObservedObject var workspaces: WorkspacesModel
    let workspace: Workspace
    let current: ChannelEntry?
    let browsing: Bool
    let onOpen: (ChannelEntry) -> Void
    let onBrowse: () -> Void
    let onCreateChannel: () -> Void
    let onSwitchWorkspace: (Workspace) -> Void
    let onNewWorkspace: () -> Void

    @State private var switcherOpen = false

    var body: some View {
        ZStack(alignment: .top) {
            GroundBackground()
            VStack(alignment: .leading, spacing: 0) {
                logo
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        switcher
                        browseRow.padding(.top, 2)
                        if let error = model.errorText {
                            Banner(kind: .error, text: error) { model.errorText = nil }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                        }
                        sectionHeader("Channels", showPlus: true, action: onCreateChannel)
                        channelList
                        Rectangle().fill(Theme.ink(6)).frame(height: 1).padding(.horizontal, 12).padding(.vertical, 8)
                        sectionHeader("Direct messages", showPlus: false, action: {})
                        dmList
                    }
                    .padding(.bottom, 30)
                }
                .refreshable { await model.load() }
            }
            .padding(.top, 12)
            if switcherOpen { switcherMenu.padding(.top, 104) }
        }
        .overlay {
            if model.isLoading && model.channels.isEmpty && model.directMessages.isEmpty {
                ProgressView().tint(Theme.accent)
            }
        }
    }

    private var logo: some View {
        HStack(spacing: 10) {
            AppMark(size: 30)
            Text("Chat").font(Theme.font(19, .bold)).tracking(-0.57).foregroundStyle(Theme.ink)
        }
        .padding(.leading, 28)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.ink(6)).frame(height: 1) }
        .padding(.bottom, 8)
    }

    private var switcher: some View {
        Button {
            withAnimation(.easeOut(duration: 0.15)) { switcherOpen.toggle() }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "square.grid.2x2").font(.system(size: 14))
                Text(workspace.name).font(Theme.font(12, .semibold)).tracking(0.24).lineLimit(1)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.ink(40))
                    .rotationEffect(.degrees(switcherOpen ? 180 : 0))
            }
            .foregroundStyle(Theme.ink2)
            .padding(.horizontal, 12)
            .frame(height: 33)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
        .accessibilityIdentifier("workspaceSwitcher")
    }

    private var switcherMenu: some View {
        VStack(alignment: .leading, spacing: 2) {
            Theme.label("Workspaces", size: 10, opacity: 35).padding(.horizontal, 12).padding(.vertical, 6)
            ForEach(workspaces.workspaces) { item in
                let active = item.id == workspace.id
                Button {
                    switcherOpen = false
                    if !active { onSwitchWorkspace(item) }
                } label: {
                    HStack(spacing: 8) {
                        Circle().fill(active ? Theme.ink : .clear).frame(width: 6, height: 6)
                        Text(item.name).font(Theme.font(12, .medium)).lineLimit(1)
                        Spacer()
                    }
                    .foregroundStyle(active ? Theme.accent : Theme.ink)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(RoundedRectangle(cornerRadius: 8).fill(active ? Theme.accent(8) : .clear))
                }
                .buttonStyle(.plain)
            }
            Rectangle().fill(Theme.line).frame(height: 1).padding(.vertical, 4)
            Button {
                switcherOpen = false
                onNewWorkspace()
            } label: {
                Text("+ New workspace").font(Theme.font(12, .semibold)).foregroundStyle(Theme.accent)
                    .padding(.horizontal, 12).frame(height: 30)
            }
            .buttonStyle(.plain)
        }
        .padding(6)
        .popCard(radius: 14)
        .padding(.horizontal, 12)
    }

    private var browseRow: some View {
        Button(action: onBrowse) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 13))
                Text("Browse Channels").font(Theme.font(12, .semibold)).tracking(0.24)
                Spacer()
            }
            .foregroundStyle(browsing ? Theme.accent : Theme.muted)
            .padding(.horizontal, 12)
            .frame(height: 33)
            .background(RoundedRectangle(cornerRadius: 10).fill(browsing ? Theme.accent(8) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
        .accessibilityIdentifier("browseChannels")
    }

    private func sectionHeader(_ title: String, showPlus: Bool, action: @escaping () -> Void) -> some View {
        HStack {
            Theme.label(title)
            Spacer()
            if showPlus {
                Button(action: action) {
                    Image(systemName: "plus")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.ink(25))
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(title == "Channels" ? "Create channel" : "New direct message")
                .accessibilityIdentifier(title == "Channels" ? "createChannel" : "newDM")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }

    @ViewBuilder private var channelList: some View {
        let joined = model.channels.filter(\.isJoined)
        if joined.isEmpty, !model.isLoading {
            Text("No channels yet. Create one to start chatting.")
                .font(Theme.font(13))
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
        }
        VStack(spacing: 2) {
            ForEach(joined) { channel in
                row(channel) {
                    Image(systemName: channel.isPrivate ? "lock.fill" : "number")
                        .font(.system(size: channel.isPrivate ? 11 : 13, weight: .medium))
                        .foregroundStyle(Theme.ink)
                        .opacity(0.6)
                        .frame(width: 18, height: 18)
                }
            }
        }
        .padding(.horizontal, 6)
    }

    @ViewBuilder private var dmList: some View {
        if model.directMessages.isEmpty, !model.isLoading {
            Text("No direct messages yet.")
                .font(Theme.font(13))
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
        }
        VStack(spacing: 2) {
            ForEach(model.directMessages) { dm in
                row(dm) {
                    AvatarView(name: dm.name, size: 24)
                        .overlay(alignment: .bottomTrailing) {
                            Circle().fill(Theme.ink(22)).frame(width: 8, height: 8)
                                .overlay(Circle().stroke(Theme.surfaceSolid, lineWidth: 1.5))
                                .offset(x: 1, y: 1)
                        }
                }
            }
        }
        .padding(.horizontal, 6)
    }

    private func row(_ channel: ChannelEntry, @ViewBuilder icon: () -> some View) -> some View {
        let selected = current?.id == channel.id && !browsing
        let bold = selected || channel.unread > 0
        return Button {
            if channel.isJoined {
                onOpen(channel)
            } else {
                Task { await model.join(channel) }
            }
        } label: {
            HStack(spacing: channel.kind == .dm ? 8 : 6) {
                icon()
                Text(channel.name)
                    .font(Theme.font(14, bold ? .bold : .regular))
                    .foregroundStyle(bold ? Theme.ink : Theme.ink2)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if channel.unread > 0, !selected {
                    let mentions = channel.mentions > 0
                    Text("\(mentions ? channel.mentions : channel.unread)")
                        .font(Theme.font(11, .bold))
                        .foregroundStyle(mentions ? Theme.onInk : Theme.ink)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Capsule().fill(mentions ? Theme.ink : Theme.ink(18)))
                        .accessibilityLabel(mentions ? "\(channel.mentions) mentions" : "\(channel.unread) unread")
                }
            }
            .padding(.horizontal, 10)
            .frame(height: channel.kind == .dm ? 37 : 35)
            .background {
                if selected {
                    Color.clear.chatCard(radius: 11)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("channel-\(channel.name)")
    }
}

// MARK: - Browse channels

/// `SearchChannelsContainer.tsx`: every channel in the workspace, joined or not.
struct BrowseChannelsScreen: View {
    @ObservedObject var model: ChannelsModel
    let onBack: () -> Void
    let onOpen: (ChannelEntry) -> Void
    @State private var query = ""

    var body: some View {
        VStack(spacing: 0) {
            NavBar(onBack: onBack) {
                Text("Browse Channels").font(Theme.font(16, .semibold)).foregroundStyle(Theme.ink)
            } trailing: {
                EmptyView()
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    TextField("Search channels...", text: $query)
                        .textFieldStyle(ChatFieldStyle())
                        .textInputAutocapitalization(.never)
                    Text("Channel List").font(Theme.font(14, .semibold)).foregroundStyle(Theme.ink).padding(.top, 4)
                    let shown = model.channels.filter {
                        query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)
                    }
                    if model.channels.isEmpty {
                        empty("No channels yet",
                              "This workspace does not have any channels yet. Create your first channel from the Channels panel in the sidebar.")
                    } else if shown.isEmpty {
                        empty("No matching channels", "Try a different search or browse the full channel list.")
                    }
                    ForEach(shown) { channel in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("# \(channel.name)").font(Theme.font(14)).foregroundStyle(Theme.ink2)
                                Text(channel.isPrivate ? "Restricted channel" : "Open channel")
                                    .font(Theme.font(12)).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            if channel.isJoined {
                                Button("View") { onOpen(channel) }
                                    .font(Theme.font(13, .semibold)).foregroundStyle(Theme.ink)
                            } else {
                                Button("Join") { Task { await model.join(channel) } }
                                    .buttonStyle(InkButtonStyle(fullWidth: false))
                                    .frame(width: 74)
                                    .disabled(model.isWorking)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.sunken))
                    }
                }
                .padding(16)
            }
            .refreshable { await model.load() }
        }
        .background(Theme.surfaceSolid.ignoresSafeArea())
    }

    private func empty(_ title: String, _ body: String) -> some View {
        VStack(spacing: 6) {
            Text(title).font(Theme.font(15, .semibold)).foregroundStyle(Theme.ink)
            Text(body).font(Theme.font(13)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}

// MARK: - Nav bar

/// `CurbNavbar.tsx`: a solid bar with the back chevron, a title and round icon buttons.
struct NavBar<Title: View, Trailing: View>: View {
    let onBack: () -> Void
    @ViewBuilder let title: () -> Title
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 2) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 36, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Channels")
            .accessibilityIdentifier("sidebarButton")
            title()
            Spacer(minLength: 4)
            trailing()
        }
        .padding(.leading, 4)
        .padding(.trailing, 8)
        .frame(height: 44)
        .background(
            Theme.surfaceSolid
                .shadow(color: Color(hex: 0x28326E, alpha: 0.10), radius: 12, y: 6)
                .ignoresSafeArea(edges: .top)
        )
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }
}

/// A 36×36 round icon button in the nav bar.
struct NavIconButton: View {
    let systemImage: String
    let label: String
    var active = false
    var tint: Color = Theme.muted
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(active ? Theme.accent : tint)
                .frame(width: 36, height: 36)
                .background(Circle().fill(active ? Theme.accent(12) : .clear))
        }
        .accessibilityLabel(label)
    }
}
