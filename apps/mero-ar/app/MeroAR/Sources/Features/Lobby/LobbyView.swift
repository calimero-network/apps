import MeroKitUI
import SwiftUI

/// After sign-in: your rooms, a new room (on a node), and joining one by
/// invitation.
struct LobbyView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var client: MeroClient

    @State private var input = ""
    @State private var showSettings = false
    @State private var showCreate = false
    @State private var showJoin = false

    var body: some View {
        ZStack(alignment: .top) {
            SpatialBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    notices
                    actions
                    roomsSection
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.top, 8)
                .padding(.bottom, 40)
                .frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await app.loadNodeRooms() }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showSettings) {
            SettingsSheet().presentationDetents([.medium, .large]).presentationBackground(.ultraThinMaterial)
        }
        .sheet(isPresented: $showCreate) {
            CreateRoomSheet().presentationDetents([.height(360)]).presentationBackground(.ultraThinMaterial)
        }
        .sheet(isPresented: $showJoin) {
            JoinRoomSheet().presentationDetents([.medium, .large]).presentationBackground(.ultraThinMaterial)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                Text(greeting)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.textDim)
                Text("Your rooms")
                    .font(Theme.display(36))
                    .tracking(-1)
                    .foregroundStyle(Theme.text)
            }
            Spacer()
            Button {
                Haptics.tap()
                showSettings = true
            } label: {
                Avatar(id: client.account ?? app.nodeURL ?? "", name: app.effectiveDisplayName, size: 46, me: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Settings")
            .accessibilityIdentifier("accountButton")
        }
        .padding(.top, 12)
    }

    private var greeting: String {
        let name = app.displayName.trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? "Welcome back" : "Hi, \(name)"
    }

    @ViewBuilder private var notices: some View {
        if app.isNodeSession {
            Callout(
                tone: .accent, title: "Signed in to your node",
                message: "\(app.nodeURL ?? "") · rooms you create live on this node.")
        } else if client.isSignedInWithoutRelay {
            Callout(
                tone: .info, title: "No relay yet",
                message: "Your account gets a relay when you redeem your first invitation.")
        } else if let note = client.cloudNote {
            Callout(tone: .warning, title: "Limited connection", message: note)
        }
    }

    // MARK: - Actions

    private var actions: some View {
        HStack(spacing: 12) {
            if app.isNodeSession {
                actionTile(
                    title: "New room", subtitle: "Start a shared space", icon: "plus", gradient: true,
                    id: "createRoomButton"
                ) { showCreate = true }
            }
            actionTile(
                title: "Join", subtitle: "Paste an invite", icon: "link", gradient: !app.isNodeSession,
                id: "joinRoomButton"
            ) { showJoin = true }
        }
    }

    private func actionTile(
        title: String, subtitle: String, icon: String, gradient: Bool, id: String, action: @escaping () -> Void
    ) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            VStack(alignment: .leading, spacing: 14) {
                IconTile(systemName: icon, size: 44, gradient: gradient)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Theme.title(18)).foregroundStyle(Theme.text)
                    Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.textFaint)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glass()
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier(id)
    }

    // MARK: - Rooms

    private var rooms: [RoomSummary] {
        var seen = Set<String>()
        var list: [RoomSummary] = []
        for room in app.nodeRooms + app.recentRooms where !seen.contains(room.id) {
            seen.insert(room.id)
            list.append(room)
        }
        return list
    }

    @ViewBuilder private var roomsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Eyebrow(text: app.isNodeSession ? "On this node" : "Recent")
                Spacer()
                if app.isLoadingRooms { ProgressView().controlSize(.small).tint(Theme.textDim) }
            }
            if let error = app.roomError {
                Callout(tone: .danger, title: "Couldn't open the room", message: error)
                    .accessibilityIdentifier("roomError")
            }
            if let error = app.roomsError {
                Callout(tone: .danger, title: "Couldn't load this node's rooms", message: error)
                    .accessibilityIdentifier("roomsError")
            }
            if rooms.isEmpty, app.roomsError == nil {
                EmptyState(
                    icon: "cube.transparent",
                    title: "No rooms yet",
                    message: app.isNodeSession
                        ? "Create a room, then invite people to build in it with you."
                        : "Rooms open by invitation. Paste one with Join.")
            } else {
                ForEach(Array(rooms.enumerated()), id: \.element.id) { index, room in
                    RoomCard(room: room, isEntering: app.isEntering) {
                        Haptics.tap()
                        Task { await app.enter(roomOrInvite: room.id) }
                    }
                    .accessibilityIdentifier(index == 0 ? "recentRoomButton" : "roomRow-\(room.id.prefix(8))")
                    .contextMenu {
                        Button(role: .destructive) {
                            app.forget(roomId: room.id)
                        } label: {
                            Label("Remove from recents", systemImage: "trash")
                        }
                    }
                }
            }
        }
    }
}

/// One room in the lobby: a gradient thumbnail, name, counts and when you were last in it.
private struct RoomCard: View {
    let room: RoomSummary
    let isEntering: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous).fill(AvatarTone.gradient(for: room.id))
                    Image(systemName: "cube.transparent.fill")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                }
                .frame(width: 64, height: 64)
                VStack(alignment: .leading, spacing: 6) {
                    Text(room.name.isEmpty ? "Untitled room" : room.name)
                        .font(Theme.title(18))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        if let objects = room.objectCount {
                            Label("\(objects)", systemImage: "cube").labelStyle(.titleAndIcon)
                        }
                        if let members = room.memberCount {
                            Label("\(members)", systemImage: "person.2").labelStyle(.titleAndIcon)
                        }
                        if let opened = room.lastOpened {
                            Text(opened.formatted(.relative(presentation: .named)))
                        }
                    }
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Theme.textFaint)
                    .monospacedDigit()
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.textDim)
                    .frame(width: 36, height: 36)
                    .modifier(Glass(shape: Circle()))
            }
            .padding(14)
            .glass()
        }
        .buttonStyle(PressableStyle())
        .disabled(isEntering)
    }
}

/// Pressed = a slight sink.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

// MARK: - Sheets

/// Name a new room; it is created on the signed-in node.
struct CreateRoomSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SheetHeader(title: "New room", subtitle: "A shared space on your node. You'll be its admin.")
            TextInput(placeholder: "Living room", text: $name, icon: "cube.transparent", identifier: "roomNameInput")
                .submitLabel(.go)
                .onSubmit(create)
            if let error = app.roomError {
                Callout(tone: .danger, message: error)
            }
            Button(action: create) {
                ButtonLabel(title: "Create and enter", icon: "sparkles", isLoading: app.isEntering)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || app.isEntering)
            .accessibilityIdentifier("confirmCreateRoomButton")
            Spacer(minLength: 0)
        }
        .padding(24)
        .preferredColorScheme(.dark)
    }

    private func create() {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty, !app.isEntering else { return }
        Haptics.tap()
        Task {
            await app.createRoom(named: name)
            if app.roomError == nil { dismiss() }
        }
    }
}

/// Paste an invitation (or a room id) and choose the name others see.
struct JoinRoomSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var input = ""

    private var looksLikeInvite: Bool { RoomInvite.looksLikeInvite(input) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SheetHeader(title: "Join a room", subtitle: "Paste the invite link someone sent you.")
                Field(
                    label: "Invite link or room ID",
                    hint: looksLikeInvite ? nil : "An invite joins you to the room's space first; a room ID opens one you're in."
                ) {
                    HStack(spacing: 10) {
                        TextInput(
                            placeholder: "https://links.calimero.network/…", text: $input,
                            icon: looksLikeInvite ? "checkmark.seal.fill" : "link", identifier: "roomInput")
                        #if canImport(UIKit) && os(iOS)
                        Button {
                            if let pasted = UIPasteboard.general.string { input = pasted }
                        } label: {
                            Image(systemName: "doc.on.clipboard")
                        }
                        .buttonStyle(CircleButtonStyle(size: 54))
                        .accessibilityLabel("Paste")
                        #endif
                    }
                }
                if looksLikeInvite {
                    Callout(tone: .success, title: inviteTitle, message: "You'll join the room's space, then enter.")
                }
                Field(label: "Your name in rooms", hint: "Shown to others in the room.") {
                    TextInput(
                        placeholder: app.effectiveDisplayName, text: $app.displayName, icon: "person.fill",
                        identifier: "displayNameInput")
                }
                if let error = app.roomError {
                    Callout(tone: .danger, title: "Couldn't open the room", message: error)
                        .accessibilityIdentifier("roomError")
                }
                Button {
                    Haptics.tap()
                    Task {
                        await app.enter(roomOrInvite: input)
                        if app.roomError == nil { dismiss() }
                    }
                } label: {
                    ButtonLabel(
                        title: looksLikeInvite ? "Join and enter" : "Enter room", icon: "arrow.right",
                        isLoading: app.isEntering)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || app.isEntering)
                .accessibilityIdentifier("enterRoomButton")
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }

    private var inviteTitle: String {
        if let name = RoomInvite.decode(pasted: input)?.roomName, !name.isEmpty { return "Invite to \(name)" }
        return "Invite recognised"
    }
}

/// Title and subtitle at the top of a sheet, with a close button.
struct SheetHeader: View {
    let title: String
    var subtitle: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(Theme.display(28)).tracking(-0.6).foregroundStyle(Theme.text)
                if let subtitle {
                    Text(subtitle).font(.system(size: 15)).foregroundStyle(Theme.textDim)
                }
            }
            Spacer(minLength: 0)
            Button {
                Haptics.tap()
                dismiss()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(CircleButtonStyle(size: 36))
            .accessibilityLabel("Close")
            .accessibilityIdentifier("closeSheetButton")
        }
        .padding(.top, 8)
    }
}

/// Who you are, how you're connected, and sign out.
struct SettingsSheet: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var client: MeroClient
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SheetHeader(title: "Settings")
                GlassCard {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(spacing: 14) {
                            Avatar(
                                id: client.account ?? app.nodeURL ?? "", name: app.effectiveDisplayName, size: 52,
                                me: true)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(app.effectiveDisplayName).font(Theme.title(19)).foregroundStyle(Theme.text)
                                Pill(text: connectionText, tone: connectionTone, dot: true)
                            }
                        }
                        Field(label: "Your name in rooms") {
                            TextInput(
                                placeholder: app.effectiveDisplayName, text: $app.displayName, icon: "person.fill",
                                identifier: "settingsNameInput")
                        }
                        TechnicalDetails(rows: detailRows)
                    }
                }
                GlassCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("About Mero AR", systemImage: "info.circle.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.text)
                        Text(
                            "Rooms are Calimero contexts: the scene is a CRDT replicated peer to peer between the "
                                + "nodes of the people in it, and the room scan is shared as a blob inside the room. "
                                + "Live AR needs an ARKit iPhone or iPad."
                        )
                        .font(.system(size: 13.5))
                        .foregroundStyle(Theme.textDim)
                        Text("Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")")
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Theme.textFaint)
                    }
                }
                Button {
                    Task {
                        dismiss()
                        await app.signOut()
                    }
                } label: {
                    ButtonLabel(title: "Sign out", icon: "rectangle.portrait.and.arrow.right")
                }
                .buttonStyle(GlassButtonStyle(destructive: true))
                .accessibilityIdentifier("signOutButton")
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }

    private var connectionText: String {
        if app.isNodeSession { return "Your node" }
        return client.relayURL == nil ? "No relay yet" : "Calimero Cloud"
    }

    private var connectionTone: Tone {
        app.isNodeSession || client.relayURL != nil ? .success : .warning
    }

    private var detailRows: [(label: String, value: String)] {
        var rows: [(label: String, value: String)] = []
        if let node = app.nodeURL { rows.append(("Node", node)) }
        if let account = client.account { rows.append(("Account", account)) }
        if let device = client.connection?.session.device { rows.append(("Device", device)) }
        if let relay = client.relayURL { rows.append(("Relay", relay)) }
        if let key = client.connection?.nodeKey { rows.append(("Relay node key", key)) }
        return rows
    }
}
