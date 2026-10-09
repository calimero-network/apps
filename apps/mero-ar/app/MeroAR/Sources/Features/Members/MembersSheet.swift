import SwiftUI

/// Who's in the room and what they may do, plus invitations.
///
/// The room's creator is its only admin to start with; everyone who joins is a
/// viewer until promoted, so this sheet is how a second person gets to place
/// anything. Only an admin sees the toggles — the contract enforces the same
/// rule regardless; this just avoids offering taps that would be refused.
struct MembersSheet: View {
    @ObservedObject var store: SceneStore
    @Environment(\.dismiss) private var dismiss

    /// The invite link, once minted. Held so a second tap does not mint a
    /// second invitation.
    @State private var inviteLink: String?
    @State private var inviting = false
    @State private var inviteError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    membersCard
                    inviteCard
                    detailsCard
                }
                .padding(Theme.gutter)
            }
            .background(ScreenBackground())
            .refreshable { await store.refreshRoster() }
            .navigationTitle("Room")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.ink)
                }
            }
        }
        .presentationBackground(Theme.bg)
        .task { await store.refreshRoster() }
    }

    // MARK: - Members

    private var membersCard: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Eyebrow("\(rows.count) member\(rows.count == 1 ? "" : "s")")
                    Spacer()
                    if !store.myRole.isEmpty {
                        Badge(text: "You: \(store.myRole.capitalized)", tone: store.canEdit ? .accent : .neutral)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 8)

                if rows.isEmpty {
                    Text("Loading members…")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textFaint)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 16)
                } else {
                    ForEach(rows) { row in
                        Rectangle().fill(Theme.border).frame(height: 1)
                        memberRow(row)
                    }
                }

                Rectangle().fill(Theme.border).frame(height: 1)
                Text(footerText)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.textFaint)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
            }
        }
    }

    private func memberRow(_ row: Row) -> some View {
        let isMe = row.id == store.memberId
        // Rows are members (accounts) and presence is per device, so ask "is any
        // device of this member here" rather than indexing by row id.
        let online = store.onlineMembers.contains(row.id)
        return HStack(spacing: 12) {
            Avatar(id: row.id, name: row.name, size: 34, me: isMe)
                .overlay(alignment: .bottomTrailing) {
                    if online {
                        Circle()
                            .fill(Theme.accent)
                            .frame(width: 10, height: 10)
                            .overlay(Circle().stroke(Theme.surface, lineWidth: 2))
                            .accessibilityLabel("Here now")
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    if isMe {
                        Text("you").font(.system(size: 12.5)).foregroundStyle(Theme.textFaint)
                    }
                    if row.id == store.room?.owner {
                        Image(systemName: "crown")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.accentInk)
                            .accessibilityLabel("Owner")
                    }
                }
                Text(online ? "\(row.role.capitalized) · here now" : row.role.capitalized)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.textFaint)
            }
            Spacer(minLength: 8)
            // An admin's rights come from the admin tier, not the editor role,
            // so there is nothing to toggle for them.
            if store.isAdmin && row.role != "admin" {
                Toggle(
                    "Editor",
                    isOn: Binding(
                        get: { row.role == "editor" },
                        set: { enabled in Task { await store.setEditor(row.id, enabled: enabled) } }
                    )
                )
                .labelsHidden()
                .tint(Theme.accentInk)
                .accessibilityLabel("Editor access for \(row.name)")
            } else {
                Badge(text: row.role.capitalized, tone: row.role == "viewer" ? .neutral : .accent)
            }
        }
        .padding(.horizontal, 20)
        .frame(minHeight: 64)
    }

    // MARK: - Invite

    private var inviteCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                CardHeader(
                    icon: "person.badge.plus", title: "Invite someone",
                    meta: "They join with their own Calimero account", accent: true)

                if let link = inviteLink {
                    IdField(value: link)
                    ShareLink(item: link) {
                        ButtonLabel(title: "Share invite link", icon: "square.and.arrow.up")
                    }
                    .buttonStyle(PrimaryButtonStyle(height: 44))
                    .accessibilityIdentifier("shareInviteButton")
                } else {
                    Button {
                        Task { await mintInvite() }
                    } label: {
                        ButtonLabel(title: "Create invite link", icon: "link", isLoading: inviting)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(inviting)
                    .accessibilityIdentifier("createInviteButton")
                }

                if let inviteError {
                    Callout(tone: .danger, title: "Couldn't create an invite", message: inviteError)
                }

                Text(
                    "Send the link to someone. They paste it into Mero AR on their phone, or open it on a "
                        + "computer with Calimero Desktop. New people start as viewers."
                )
                .font(.system(size: 12.5))
                .foregroundStyle(Theme.textFaint)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Details

    private var detailsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                CardHeader(
                    icon: "dot.radiowaves.left.and.right", title: store.isLive ? "Live sync" : "Syncing by refresh",
                    meta: store.isLive
                        ? "Changes from others appear as they happen."
                        : "The relay's live session isn't up; the room refreshes every few seconds.")
                TechnicalDetails(rows: [
                    ("Room (context) ID", store.service.contextId),
                    ("Your member ID", store.memberId),
                    ("Relay", store.service.relay.relayURL),
                ])
            }
        }
    }

    // MARK: - Data

    /// Mint a namespace invitation for this room and build its shareable link.
    private func mintInvite() async {
        inviting = true
        inviteError = nil
        defer { inviting = false }
        do {
            let invite = try await store.service.createRoomInvite()
            inviteLink = try invite.shareableLink()
            Haptics.success()
        } catch {
            inviteError = userMessage(error)
        }
    }

    /// `myRole` is empty until it first resolves — don't render "You are a ."
    private var footerText: String {
        if store.isAdmin {
            return "Editors can place, move and delete objects, and share the room scan."
        }
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
