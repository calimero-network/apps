import MeroKit
import MeroKitUI
import PhotosUI
import SwiftUI
import UIKit

/// `BaseModal.tsx`: a dimmed, blurred backdrop and a solid card with an icon
/// box, a title, a close button and a hairline under the header.
struct DialogFrame<Content: View>: View {
    let icon: String
    let title: String
    var iconTint: Color = Theme.accent
    let onClose: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            Theme.scrim.ignoresSafeArea().onTapGesture(perform: onClose)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 10) {
                        Image(systemName: icon)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(iconTint)
                            .frame(width: 28, height: 28)
                            .background(RoundedRectangle(cornerRadius: 10).fill(iconTint.opacity(0.10)))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(iconTint.opacity(0.20), lineWidth: 1))
                        Text(title).font(Theme.font(14, .semibold)).foregroundStyle(Theme.ink)
                        Spacer()
                        Button(action: onClose) {
                            Image(systemName: "xmark")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.ink(30))
                                .frame(width: 28, height: 28)
                        }
                        .accessibilityLabel("Close")
                    }
                    .padding(.bottom, 16)
                    .overlay(alignment: .bottom) { Rectangle().fill(Theme.ink(7)).frame(height: 1) }
                    .padding(.bottom, 24)
                    content()
                }
                .padding(28)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Theme.surfaceSolid)
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.ink(8), lineWidth: 1))
                        .shadow(color: Color(hex: 0x141A3C, alpha: 0.45), radius: 32, y: 24)
                )
                .padding(.horizontal, 16)
                .padding(.vertical, 60)
            }
            .scrollBounceBehaviorBasedOnSize()
        }
        .transition(.opacity.combined(with: .scale(scale: 0.98)))
    }
}

extension View {
    /// Only bounce a scroll view whose content overflows (iOS 16.4+).
    @ViewBuilder func scrollBounceBehaviorBasedOnSize() -> some View {
        if #available(iOS 16.4, *) {
            scrollBounceBehavior(.basedOnSize)
        } else {
            self
        }
    }
}

// MARK: - Create channel

/// `CreateChannelPopup.tsx`.
struct CreateChannelDialog: View {
    @ObservedObject var model: ChannelsModel
    let onClose: () -> Void
    @State private var name = ""
    @State private var isPublic = true
    @State private var working = false

    var body: some View {
        DialogFrame(icon: "bubble.left", title: "Create new Channel", onClose: onClose) {
            Theme.label("Channel name", size: 10.9, opacity: 35).padding(.bottom, 8)
            TextField("# channel name", text: $name)
                .textFieldStyle(ChatFieldStyle())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("channelNameField")
            if let problem = problem {
                Text(problem).font(Theme.font(12)).foregroundStyle(Theme.badInk).padding(.top, 6)
            }
            if let error = model.errorText {
                Banner(kind: .error, text: error) { model.errorText = nil }.padding(.top, 10)
            }
            Theme.label("Visibility", size: 10.9, opacity: 35).padding(.top, 20).padding(.bottom, 8)
            HStack(spacing: 8) {
                visibility("Public", selected: isPublic) { isPublic = true }
                visibility("Private", selected: !isPublic) { isPublic = false }
            }
            Button {
                Task {
                    working = true
                    let ok = await model.create(name: cleaned, isPublic: isPublic)
                    working = false
                    if ok { onClose() }
                }
            } label: {
                HStack(spacing: 8) {
                    if working { ProgressView().tint(Theme.onInk) }
                    Text(working ? "Creating…" : "Create")
                }
            }
            .buttonStyle(InkButtonStyle())
            .disabled(working || cleaned.isEmpty || problem != nil)
            .padding(.top, 24)
            .accessibilityIdentifier("createChannelButton")
        }
    }

    private var cleaned: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
    }

    private var problem: String? {
        cleaned.isEmpty ? nil : ChatFormat.channelNameProblem(cleaned, existing: model.channels.map(\.name))
    }

    private func visibility(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Theme.font(12.8, .semibold))
                .foregroundStyle(selected ? Theme.accent : Theme.ink(45))
                .frame(maxWidth: .infinity, minHeight: 38)
                .background(RoundedRectangle(cornerRadius: 12).fill(selected ? Theme.accent(8) : Theme.ink(3)))
                .overlay(
                    RoundedRectangle(cornerRadius: 12).stroke(selected ? Theme.accent(40) : Theme.ink(7), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Invite

/// `GroupInviteModal.tsx`: mint an invitation link and copy or share it.
struct InviteDialog: View {
    @ObservedObject var workspaces: WorkspacesModel
    let workspace: Workspace
    let onClose: () -> Void
    @State private var link: String?
    @State private var copied = false
    @State private var failed = false

    var body: some View {
        DialogFrame(icon: "person.badge.plus", title: "Invite to workspace", onClose: onClose) {
            Text("Share this link with anyone you want to invite.")
                .font(Theme.font(12)).foregroundStyle(Theme.ink(35)).padding(.bottom, 16)
            if let link, let url = URL(string: link) {
                Button {
                    UIPasteboard.general.string = link
                    copied = true
                } label: {
                    Text(copied ? "✓ Copied!" : "Copy invite link")
                        .font(Theme.font(13, .semibold))
                        .foregroundStyle(copied ? Theme.accent : Theme.ink)
                        .frame(maxWidth: .infinity, minHeight: 42)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.ink(5)))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.ink(10), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("copyInviteLink")
                ShareLink(item: url) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .font(Theme.font(13, .semibold))
                        .frame(maxWidth: .infinity, minHeight: 42)
                }
                .buttonStyle(SecondaryButtonStyle())
                .padding(.top, 10)
                Button("Done", action: onClose)
                    .buttonStyle(InkButtonStyle())
                    .padding(.top, 16)
            } else if failed {
                if let error = workspaces.errorText {
                    Banner(kind: .error, text: error) { workspaces.errorText = nil }
                }
                Button("Try again") { Task { await mint() } }
                    .buttonStyle(InkButtonStyle())
                    .padding(.top, 16)
            } else {
                HStack(spacing: 10) {
                    ProgressView().tint(Theme.accent)
                    Text("Generating invitation…").font(Theme.font(13)).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
        }
        .task { await mint() }
    }

    private func mint() async {
        failed = false
        link = await workspaces.inviteLink(for: workspace)
        failed = link == nil
    }
}

// MARK: - Settings

/// `SettingsPopup.tsx`: profile, workspace, appearance, then change workspace and log out.
struct SettingsDialog: View {
    @ObservedObject var session: SessionModel
    let workspace: Workspace
    let channelRole: ChatRole
    /// The open channel: a profile picture is set per channel, as on the web.
    var channel: ChannelModel?
    let onChangeWorkspace: () -> Void
    let onClose: () -> Void
    @AppStorage(ThemeChoice.storageKey) private var theme = ThemeChoice.light.rawValue
    @State private var copied = false
    @State private var photo: PhotosPickerItem?
    @State private var savingPhoto = false
    @State private var photoNote: String?

    var body: some View {
        DialogFrame(icon: "gearshape", title: "Settings", onClose: onClose) {
            VStack(alignment: .leading, spacing: 12) {
                card {
                    HStack(spacing: 12) {
                        profilePicture
                        VStack(alignment: .leading, spacing: 2) {
                            Theme.label("Profile", size: 10, opacity: 35)
                            Text(session.displayName.isEmpty ? "No name yet" : session.displayName)
                                .font(Theme.font(14, .semibold)).foregroundStyle(Theme.ink)
                            if let account = session.account {
                                Button {
                                    UIPasteboard.general.string = account
                                    copied = true
                                } label: {
                                    HStack(spacing: 4) {
                                        Text("\(account.prefix(8))…\(account.suffix(6))")
                                            .font(.system(size: 11.5, design: .monospaced))
                                        Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 10))
                                    }
                                    .foregroundStyle(Theme.ink(35))
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Copy account id")
                            }
                        }
                        Spacer()
                    }
                }
                card {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Theme.label("Workspace", size: 10, opacity: 35)
                            Text(workspace.name).font(Theme.font(14, .semibold)).foregroundStyle(Theme.ink)
                        }
                        Spacer()
                        roleBadge
                    }
                }
                card {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Theme.label("Appearance", size: 10, opacity: 35)
                            Text("Theme").font(Theme.font(14, .semibold)).foregroundStyle(Theme.ink)
                        }
                        Spacer()
                        HStack(spacing: 2) {
                            segment("Light", .light)
                            segment("Dark", .dark)
                        }
                        .padding(3)
                        .background(Capsule().fill(Theme.sunken))
                        .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                    }
                }
                if let photoNote {
                    Text(photoNote).font(Theme.font(12)).foregroundStyle(Theme.muted)
                }
                if let error = channel?.errorText {
                    Banner(kind: .error, text: error) { channel?.errorText = nil }
                }
                if let relay = session.client.relayURL {
                    card {
                        VStack(alignment: .leading, spacing: 2) {
                            Theme.label("Relay", size: 10, opacity: 35)
                            Text(relay).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.ink2)
                                .textSelection(.enabled)
                        }
                    }
                }
                HStack(spacing: 10) {
                    Button {
                        onClose()
                        onChangeWorkspace()
                    } label: {
                        Text("→ Change workspace").font(Theme.font(13, .semibold)).foregroundStyle(Theme.ink)
                            .padding(.horizontal, 14).frame(minHeight: 36)
                            .background(Capsule().fill(Theme.ink(4)))
                            .overlay(Capsule().stroke(Theme.ink(12), lineWidth: 1))
                    }
                    Spacer()
                    Button {
                        Task { await session.signOut() }
                    } label: {
                        Label("Logout", systemImage: "rectangle.portrait.and.arrow.right")
                            .font(Theme.font(13, .semibold)).foregroundStyle(Theme.badInk)
                            .padding(.horizontal, 14).frame(minHeight: 36)
                            .background(Capsule().fill(Color(hex: 0xFF5050, alpha: 0.06)))
                            .overlay(Capsule().stroke(Color(hex: 0xFF5050, alpha: 0.25), lineWidth: 1))
                    }
                    .accessibilityIdentifier("logoutButton")
                }
                .buttonStyle(.plain)
                .padding(.top, 8)
            }
        }
    }

    /// The 40px circle; tap it to choose a photo for this channel.
    @ViewBuilder private var profilePicture: some View {
        let initial = Circle()
            .fill(
                LinearGradient(
                    colors: [Theme.accent(45), Theme.accent(20)], startPoint: .topLeading, endPoint: .bottomTrailing)
            )
            .frame(width: 40, height: 40)
            .overlay(
                Text(String(session.displayName.prefix(1)).uppercased())
                    .font(Theme.font(16, .bold)).foregroundStyle(Theme.ink))
        if let channel {
            PhotosPicker(selection: $photo, matching: .images) {
                ZStack(alignment: .bottomTrailing) {
                    if let blob = channel.avatars[channel.me] {
                        BlobImage(blobId: blob, load: { try await channel.blob($0) })
                            .frame(width: 40, height: 40).clipShape(Circle())
                    } else {
                        initial
                    }
                    Image(systemName: savingPhoto ? "hourglass" : "camera.fill")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 16, height: 16)
                        .background(Circle().fill(Theme.ink))
                        .offset(x: 2, y: 2)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Change profile picture")
            .accessibilityIdentifier("changeAvatar")
            .onChange(of: photo) { item in
                guard let item else { return }
                Task {
                    savingPhoto = true
                    do {
                        let image = try await AttachmentPicking.image(from: item)
                        channel.displayNameHint = session.displayName
                        if await channel.setAvatar(image) {
                            photoNote = "Your profile picture has been saved in #\(channel.channel.name)."
                        }
                    } catch {
                        channel.errorText = error.localizedDescription
                    }
                    savingPhoto = false
                    photo = nil
                }
            }
        } else {
            initial
        }
    }

    @ViewBuilder private var roleBadge: some View {
        let (text, color): (String, Color) =
            switch channelRole {
            case .admin: ("Admin", Theme.accent)
            case .mod: ("Moderator", Theme.violet)
            default: ("Member", Theme.muted)
            }
        Text(text).font(Theme.font(11, .bold)).foregroundStyle(color)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(RoundedRectangle(cornerRadius: 5).fill(color.opacity(0.12)))
    }

    private func card(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.ink(3)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.ink(7), lineWidth: 1))
    }

    private func segment(_ title: String, _ choice: ThemeChoice) -> some View {
        let active = theme == choice.rawValue
        return Button {
            theme = choice.rawValue
        } label: {
            Text(title).font(Theme.font(12.5, .semibold))
                .foregroundStyle(active ? Theme.ink : Theme.muted)
                .padding(.horizontal, 12).frame(height: 26)
                .background {
                    if active {
                        Capsule().fill(Theme.surfaceSolid).shadow(color: .black.opacity(0.08), radius: 2, y: 1)
                    }
                }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Channel details

/// `ChannelDetailsPopup.tsx`: About (created, managed by) and Members with roles.
struct ChannelDetailsDialog: View {
    @ObservedObject var model: ChannelModel
    let onClose: () -> Void
    @State private var tab = 0
    @State private var info: ChannelInfo?
    @State private var roles: [String: ChatRole] = [:]

    var body: some View {
        DialogFrame(
            icon: model.channel.isPrivate ? "lock" : "number", title: model.channel.name, onClose: onClose
        ) {
            HStack(spacing: 18) {
                tabButton("About", 0)
                tabButton("Members (\(model.names.count))", 1)
                Spacer()
            }
            .padding(.bottom, 16)
            if tab == 0 { about } else { members }
        }
        .task {
            info = await model.channelInfo()
            roles = await model.roles()
        }
    }

    private func tabButton(_ title: String, _ index: Int) -> some View {
        Button {
            tab = index
        } label: {
            Text(title)
                .font(Theme.font(12.8, tab == index ? .semibold : .regular))
                .foregroundStyle(tab == index ? Theme.accent : Theme.muted)
                .padding(.bottom, 6)
                .overlay(alignment: .bottom) {
                    if tab == index { Rectangle().fill(Theme.ink).frame(height: 2) }
                }
        }
        .buttonStyle(.plain)
    }

    private var about: some View {
        VStack(spacing: 0) {
            aboutRow(
                "Created",
                info.map { ChatFormat.day(Date(timeIntervalSince1970: TimeInterval($0.createdAt))) } ?? "—")
            Rectangle().fill(Theme.ink(7)).frame(height: 1)
            aboutRow("Managed by", info.map { model.displayName(of: $0.creator) } ?? "—")
        }
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.ink(3)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.ink(7), lineWidth: 1))
    }

    private func aboutRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(Theme.font(13)).foregroundStyle(Theme.muted)
            Spacer()
            Text(value).font(Theme.font(13, .medium)).foregroundStyle(Theme.ink)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private var members: some View {
        VStack(spacing: 6) {
            ForEach(model.names.sorted { $0.value.localizedCaseInsensitiveCompare($1.value) == .orderedAscending }, id: \.key) {
                id, name in
                let role = roles[id] ?? .user
                HStack(spacing: 10) {
                    AvatarView(name: name, size: 24)
                    Text(id == model.me ? "\(name) (you)" : name)
                        .font(Theme.font(13, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    badge(role)
                    Spacer()
                    if model.myRole.canModerate, id != model.me {
                        Menu {
                            roleActions(id: id, role: role)
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.muted)
                                .frame(width: 30, height: 30)
                        }
                        .accessibilityLabel("Member actions")
                    }
                }
                .padding(.vertical, 4)
            }
            if let error = model.errorText {
                Banner(kind: .error, text: error) { model.errorText = nil }
            }
        }
    }

    @ViewBuilder private func roleActions(id: String, role: ChatRole) -> some View {
        if model.myRole.isAdmin {
            if role == .user { Button("↑ Mod") { set(id, .mod) } }
            if role == .mod {
                Button("↑ Admin") { set(id, .admin) }
                Button("↓ User") { set(id, .user) }
            }
            if role == .admin { Button("↓ Mod") { set(id, .mod) } }
        }
        if role == .banned {
            Button("Unban") { set(id, .user) }
        } else if role != .admin {
            Button("Ban", role: .destructive) { set(id, .banned) }
        }
    }

    private func set(_ id: String, _ role: ChatRole) {
        Task {
            if await model.setRole(of: id, to: role) { roles = await model.roles() }
        }
    }

    @ViewBuilder private func badge(_ role: ChatRole) -> some View {
        switch role {
        case .admin: tag("ADMIN", Theme.accent)
        case .mod: tag("MOD", Theme.accent)
        case .banned: tag("BANNED", Theme.badInk)
        case .user: EmptyView()
        }
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text).font(Theme.font(9.5, .bold)).tracking(0.5).foregroundStyle(color)
            .padding(.horizontal, 5).padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 4).fill(color.opacity(0.12)))
    }
}

// MARK: - Reactions list

/// `MessageReactionsList.tsx`: who reacted with what.
struct ReactionsListDialog: View {
    let message: ChatMessage
    let nameOf: (String) -> String
    let onClose: () -> Void
    @State private var selected: String?

    var body: some View {
        DialogFrame(icon: "face.smiling", title: "Message Reactions", onClose: onClose) {
            let emojis = message.reactions.filter { !$0.value.isEmpty }.keys.sorted()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(emojis, id: \.self) { emoji in
                        Button {
                            selected = emoji
                        } label: {
                            Text("\(emoji) \(message.reactions[emoji]?.count ?? 0)")
                                .font(Theme.font(13))
                                .foregroundStyle(Theme.ink)
                                .padding(.horizontal, 10).frame(height: 28)
                                .background(RoundedRectangle(cornerRadius: 8).fill(selected == emoji ? Theme.sunken : .clear))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.bottom, 12)
            if let selected, let users = message.reactions[selected], !users.isEmpty {
                ForEach(users, id: \.self) { user in
                    HStack(spacing: 10) {
                        AvatarView(name: nameOf(user), size: 24)
                        Text(nameOf(user)).font(Theme.font(13, .medium)).foregroundStyle(Theme.ink)
                    }
                    .padding(.vertical, 4)
                }
            } else {
                Text(selected == nil ? "Select a reaction to see who reacted" : "No users reacted with this emoji")
                    .font(Theme.font(13)).foregroundStyle(Theme.muted)
            }
        }
        .onAppear { selected = message.reactions.filter { !$0.value.isEmpty }.keys.sorted().first }
    }
}

// MARK: - Search

/// `ChatSearchOverlay.tsx`: search this channel's messages.
struct SearchOverlay: View {
    @ObservedObject var model: ChannelModel
    let onOpenThread: (String) -> Void
    let onClose: () -> Void
    @State private var query = ""
    @State private var hits: [SearchHit] = []
    @State private var cursor: String?
    @State private var searched = ""
    @State private var searching = false

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            Theme.scrim.ignoresSafeArea().onTapGesture(perform: onClose)
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Search Messages").font(Theme.font(18, .medium)).foregroundStyle(Theme.ink)
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.ink2)
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(Theme.sunken))
                    }
                    .accessibilityLabel("Close search")
                }
                Theme.label("Search messages", size: 10.9, opacity: 35)
                TextField("Search message text", text: $query)
                    .textFieldStyle(ChatFieldStyle())
                    .submitLabel(.search)
                    .onSubmit { Task { await run(reset: true) } }
                    .accessibilityIdentifier("searchField")
                HStack(spacing: 8) {
                    Button(searching ? "Searching..." : "Search") { Task { await run(reset: true) } }
                        .buttonStyle(InkButtonStyle(fullWidth: false))
                        .disabled(searching || query.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Clear") {
                        query = ""
                        hits = []
                        searched = ""
                        cursor = nil
                    }
                    .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                }
                if !searched.isEmpty {
                    Text(hits.isEmpty ? "No messages matched \"\(searched)\"" : "\(hits.count) result\(hits.count == 1 ? "" : "s")")
                        .font(Theme.font(12)).foregroundStyle(Theme.muted)
                }
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(hits) { hit in result(hit) }
                        if cursor != nil, !hits.isEmpty {
                            Button("Load more results") { Task { await run(reset: false) } }
                                .font(Theme.font(13, .semibold)).foregroundStyle(Theme.accent).padding(.top, 4)
                        }
                    }
                }
            }
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: 10).fill(Theme.surfaceSolid)
                    .shadow(color: Color(hex: 0x141A3C, alpha: 0.45), radius: 32, y: 24)
            )
            .padding(.horizontal, 16)
            .padding(.vertical, 48)
        }
    }

    private func result(_ hit: SearchHit) -> some View {
        let parts = hit.highlighted
        let name = model.displayName(of: hit.sender)
        return Button {
            if let parent = hit.parentMessageId { onOpenThread(parent) } else { onClose() }
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                Text("# \(model.channel.name)")
                    .font(Theme.font(11, .semibold)).foregroundStyle(Theme.accent)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: 5).fill(Theme.accent(15)))
                HStack(spacing: 10) {
                    AvatarView(name: name, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name).font(Theme.font(15, .semibold)).foregroundStyle(Theme.ink)
                        Text(Self.date(hit.timestamp)).font(Theme.font(12)).foregroundStyle(Theme.muted)
                    }
                }
                (Text(parts.before) + Text(parts.match).foregroundColor(Theme.ink).bold() + Text(parts.after))
                    .font(Theme.font(13))
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.leading)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func run(reset: Bool) async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        searching = true
        defer { searching = false }
        if reset {
            hits = []
            cursor = nil
        }
        if let page = await model.search(q, cursor: reset ? nil : cursor) {
            hits += page.hits
            cursor = page.nextCursor
        }
        searched = q
    }

    static func date(_ seconds: UInt64) -> String {
        let f = DateFormatter()
        f.dateFormat = "MMM d, yyyy, hh:mm a"
        return f.string(from: Date(timeIntervalSince1970: TimeInterval(seconds)))
    }
}
