import SwiftUI

/// Who's in the room and what they may do, plus invitations.
///
/// The room's creator is its only admin to start with; everyone who joins is a
/// viewer until promoted, so this sheet is how a second person gets to place
/// anything. Only an admin sees the toggles: the contract enforces the same
/// rule regardless; this just avoids offering taps that would be refused.
struct MembersSheet: View {
    @ObservedObject var store: SceneStore
    @EnvironmentObject private var app: AppState
    @Environment(\.openURL) private var openURL
    @State private var editNickname = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SheetHeader(
                    title: "People", subtitle: "\(rows.count) in this room · \(store.onlineMembers.count) here now")
                InviteLinkCard(
                    title: "Invite someone",
                    subtitle: "They join this room's home, then build with you."
                ) {
                    try await store.service.createRoomInvite().shareableLink()
                }
                if app.roomUpdate != nil || app.isAwaitingApproval || app.approvalNotice != nil {
                    updateCard
                }
                membersCard
                detailsCard
            }
            .padding(24)
        }
        .refreshable { await store.refreshRoster() }
        .preferredColorScheme(.dark)
        .task { await store.refreshRoster() }
        .sheet(isPresented: $editNickname) {
            NicknameSheet().presentationDetents([.height(340)]).presentationBackground(.ultraThinMaterial)
        }
    }

    // MARK: - Members

    private var membersCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Eyebrow(text: "Members")
                Spacer()
                if !store.myRole.isEmpty {
                    Pill(text: "You: \(store.myRole.capitalized)", tone: store.canEdit ? .accent : .neutral)
                }
            }
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    memberRow(row)
                    if index < rows.count - 1 { Divider().overlay(Theme.glassStroke).padding(.leading, 66) }
                }
            }
            .glass()
            Text(footerText).font(.system(size: 12.5)).foregroundStyle(Theme.textFaint)
        }
    }

    private func memberRow(_ row: Row) -> some View {
        let isMe = row.id == store.memberId
        let online = store.onlineMembers.contains(row.id)
        return HStack(spacing: 12) {
            Avatar(id: row.id, name: row.name, size: 40, me: isMe, online: online)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(isMe ? "\(row.name) (you)" : row.name)
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text).lineLimit(1)
                    if row.id == store.room?.owner {
                        Image(systemName: "crown.fill").font(.system(size: 11)).foregroundStyle(Theme.warning)
                            .accessibilityLabel("Owner")
                    }
                }
                Text(online ? "Here now" : "Away").font(.system(size: 12)).foregroundStyle(Theme.textFaint)
            }
            Spacer()
            if isMe {
                Button {
                    Haptics.tap()
                    editNickname = true
                } label: {
                    Image(systemName: "pencil")
                }
                .buttonStyle(CircleButtonStyle(size: 34))
                .accessibilityLabel("Change your nickname")
                .accessibilityIdentifier("editNicknameButton")
            }
            if store.isAdmin && row.role != "admin" {
                Toggle(
                    "Editor",
                    isOn: Binding(
                        get: { row.role == "editor" },
                        set: { enabled in Task { await store.setEditor(row.id, enabled: enabled) } }
                    )
                )
                .labelsHidden()
                .tint(Theme.violet)
                .accessibilityLabel("Editor access for \(row.name)")
                .accessibilityIdentifier("editorToggle-\(MembersSheet.shortId(row.id))")
            } else {
                Pill(text: row.role.capitalized, tone: row.role == "viewer" ? .neutral : .accent)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Details

    private var detailsCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: "dot.radiowaves.left.and.right").foregroundStyle(Theme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.isLive ? "Live" : "Syncing by refresh")
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text)
                        Text(
                            store.isLive
                                ? "Changes arrive as they happen."
                                : "The live stream isn't up right now, so the room refreshes every few seconds."
                        )
                        .font(.system(size: 12.5)).foregroundStyle(Theme.textFaint)
                    }
                }
                TechnicalDetails(rows: [
                    ("Room ID", store.service.contextId),
                    ("Your member ID", store.memberId),
                    ("Cluster node", store.service.endpoint),
                ])
            }
        }
    }

    // MARK: - Update

    /// A newer Mero AR release. Core approves an upgrade only on the node's
    /// consent page, so the button opens it in the browser and waits.
    private var updateCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: "arrow.up.circle.fill").foregroundStyle(Theme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(app.isAwaitingApproval ? "Waiting for your approval" : "Update available")
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text)
                        if let update = app.roomUpdate {
                            Text("This room runs \(update.current). Version \(update.latest) is out.")
                                .font(.system(size: 12.5)).foregroundStyle(Theme.textFaint)
                        }
                    }
                }
                if let notice = app.approvalNotice {
                    Text(notice).font(.system(size: 12.5)).foregroundStyle(Theme.textDim)
                }
                if app.isAwaitingApproval {
                    HStack {
                        ProgressView().tint(Theme.textDim)
                        Text("Approve the upgrade in Safari, then come back.")
                            .font(.system(size: 12.5)).foregroundStyle(Theme.textDim)
                        Spacer()
                        Button("Stop waiting") { app.cancelApprovalWait() }
                            .buttonStyle(LinkButtonStyle())
                    }
                } else if app.roomUpdate != nil, store.isAdmin {
                    Button {
                        Haptics.tap()
                        app.requestRoomUpgrade { url in openURL(url) }
                    } label: {
                        ButtonLabel(title: "Review and approve", icon: "checkmark.shield.fill")
                    }
                    .buttonStyle(PrimaryButtonStyle(height: 48))
                    .accessibilityIdentifier("approveUpgradeButton")
                } else if app.roomUpdate != nil {
                    Text("An admin of this room's home can approve it.")
                        .font(.system(size: 12.5)).foregroundStyle(Theme.textFaint)
                }
            }
        }
    }

    // MARK: - Data

    private var footerText: String {
        if store.isAdmin { return "Editors can place, move and delete objects, and share the room scan." }
        return "Only an admin can change roles."
    }

    /// Roles joined onto member names, with us pinned first.
    private var rows: [Row] {
        let names = Dictionary(store.members.map { ($0.id, $0.username) }, uniquingKeysWith: { a, _ in a })
        let known = store.roles.map {
            Row(id: $0.member, name: names[$0.member] ?? Self.shortId($0.member), role: $0.role)
        }
        return known.sorted { lhs, rhs in
            if lhs.id == store.memberId { return true }
            if rhs.id == store.memberId { return false }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    private struct Row: Identifiable {
        let id: String
        let name: String
        let role: String
    }

    static func shortId(_ id: String) -> String {
        id.count > 12 ? "\(id.prefix(6))…\(id.suffix(4))" : id
    }
}
