import SwiftUI

/// The open space: who's in it, who's online, the session, and sign-out.
struct SpaceView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var sharing: LocationSharing
    @ObservedObject var store: TrackerStore
    @State private var confirmSignOut = false
    @State private var confirmLeave = false
    /// The invite link, once created. Held so a second tap shares the same one.
    @State private var inviteLink: String?
    @State private var isInviting = false
    @State private var inviteError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Cal.Space.stack) {
                    PageHeader(title: store.space?.name ?? "Space", subtitle: summary) {
                        ConnectionPill(connection: store.connection)
                    }

                    if let pending = app.pendingInvite {
                        pendingInviteCallout(pending)
                    }
                    if let notice = app.spaceNotice {
                        Callout(tone: .warning, title: "Not hosted yet", message: notice)
                    }

                    inviteCard

                    SectionLabel(title: "Members")
                    if store.members.isEmpty {
                        EmptyState(
                            systemImage: "person.2", title: "No members yet",
                            message: "Members appear here once they open this space.", compact: true)
                    } else {
                        Card(padding: 0) {
                            VStack(spacing: 0) {
                                ForEach(Array(store.members.enumerated()), id: \.element.id) { index, member in
                                    if index > 0 { Hairline().padding(.leading, 60) }
                                    MemberRow(
                                        member: member, isMe: member.id == store.memberId,
                                        online: store.isOnline(member.id),
                                        lastSeen: store.presence[member.id]?.lastSeen)
                                }
                            }
                        }
                    }

                    SectionLabel(title: "This device")
                    Card {
                        VStack(alignment: .leading, spacing: 14) {
                            CardHeader(
                                systemImage: "iphone", title: app.space?.displayName ?? "You",
                                meta: sharingSummary, accent: sharing.isSharing)
                            HStack(spacing: 8) {
                                Button {
                                    confirmLeave = true
                                } label: {
                                    Label("Switch space", systemImage: "arrow.left.arrow.right")
                                }
                                .buttonStyle(.cal(.secondary))

                                Button {
                                    confirmSignOut = true
                                } label: {
                                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                                }
                                .buttonStyle(.cal(.danger))
                                .accessibilityIdentifier("signOutButton")
                            }
                            TechnicalDetails(items: AccountDetails.items(app, contextId: app.space?.contextId))
                        }
                    }
                }
                .calPage()
            }
            .background(Cal.bg.ignoresSafeArea())
            .refreshable { await store.refresh() }
            .toolbar { ToolbarItem(placement: .calLeading) { BrandTitle() } }
            .inlineNavigationTitle()
            .calNavigationBar()
            .confirmationDialog("Sign out of Mero Tag?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    sharing.stop()
                    Task { await app.signOut() }
                }
            } message: {
                Text("Location sharing stops. This device stays approved for your account.")
            }
            .confirmationDialog("Switch to another space?", isPresented: $confirmLeave, titleVisibility: .visible) {
                Button("Switch space") {
                    sharing.stop()
                    Task { await app.leaveSpace() }
                }
            } message: {
                Text("Location sharing in this space stops.")
            }
        }
    }

    // MARK: Invite

    private var inviteCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                CardHeader(
                    systemImage: "person.badge.plus", title: "Invite people",
                    meta: "They join with their own Calimero account", accent: true)

                if let inviteLink {
                    IdField(value: inviteLink)
                    ShareLink(
                        item: inviteLink,
                        subject: Text("Join \(store.space?.name ?? "my space") on Mero Tag"),
                        message: Text("Join my space on Mero Tag: open this link, or paste it into the app.")
                    ) {
                        Label("Share invite link", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.cal(.primary, size: .large, fullWidth: true))
                    .accessibilityIdentifier("shareInviteButton")
                } else {
                    LoadingButton(
                        title: "Create invite link", systemImage: "link", isLoading: isInviting, kind: .secondary,
                        size: .regular, action: { Task { await makeInvite() } })
                        .accessibilityIdentifier("createInviteButton")
                }

                if let inviteError {
                    Callout(tone: .danger, title: "Couldn't create an invite", message: inviteError)
                }

                Text("The link works for 24 hours. New members can see trackers once someone shares one with them.")
                    .font(.system(size: 12))
                    .foregroundStyle(Cal.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func makeInvite() async {
        isInviting = true
        inviteError = nil
        defer { isInviting = false }
        do {
            inviteLink = try await app.inviteLink()
            Platform.success()
        } catch {
            inviteError = TrackerStore.message(for: error)
        }
    }

    private func pendingInviteCallout(_ raw: String) -> some View {
        let name = SpaceInvite.decode(pasted: raw)?.spaceName ?? ""
        return Card {
            VStack(alignment: .leading, spacing: 12) {
                Callout(
                    tone: .info, title: name.isEmpty ? "You've been invited to a space" : "You've been invited to \(name)",
                    message: "Switch to it to join. Location sharing in this space stops.")
                HStack(spacing: 8) {
                    Button {
                        sharing.stop()
                        Task { await app.leaveSpace() }
                    } label: {
                        Label("Switch to it", systemImage: "arrow.right")
                    }
                    .buttonStyle(.cal(.primary))
                    Button("Not now") { app.pendingInvite = nil }
                        .buttonStyle(.cal(.plain))
                }
            }
        }
    }

    private var summary: String {
        let members = store.members.count
        let online = store.members.filter { store.isOnline($0.id) }.count
        return "\(members) \(members == 1 ? "member" : "members") · \(online) online"
    }

    private var sharingSummary: String {
        guard sharing.isSharing, let id = sharing.trackerId else { return "Not sharing location" }
        return "Sharing as \(store.tracker(id: id)?.name ?? "a tracker")"
    }
}

private struct MemberRow: View {
    let member: Member
    let isMe: Bool
    let online: Bool
    let lastSeen: UInt64?

    var body: some View {
        ListRow(title: isMe ? "\(member.username) (you)" : member.username, subtitle: subtitle, showsChevron: false) {
            Avatar(name: member.username, seed: member.id, size: 34, isMe: isMe)
        } trailing: {
            Badge(text: online ? "Online" : "Offline", tone: online ? .success : .neutral, dot: true)
        }
    }

    private var subtitle: String {
        if online { return "Active now" }
        guard let lastSeen, lastSeen > 0 else { return "Joined \(RelativeTime.string(fromMillis: member.joinedAt))" }
        return "Last seen \(RelativeTime.string(fromMillis: lastSeen))"
    }
}

/// Live / polling / connecting, as a status pill.
struct ConnectionPill: View {
    let connection: TrackerStore.Connection

    var body: some View {
        switch connection {
        case .live: StatusPill(text: "Live", state: .live)
        case .polling: StatusPill(text: "Refreshing", state: .waiting)
        case .connecting: StatusPill(text: "Connecting", state: .off)
        }
    }
}

enum RelativeTime {
    private static let formatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    static func string(fromMillis ms: UInt64, now: Date = Date()) -> String {
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        if abs(now.timeIntervalSince(date)) < 45 { return "just now" }
        return formatter.localizedString(for: date, relativeTo: now)
    }
}
