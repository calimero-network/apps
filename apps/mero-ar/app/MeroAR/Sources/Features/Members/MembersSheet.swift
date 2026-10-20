import SwiftUI

/// Who's in the room and what they may do, plus invitations.
///
/// The room's creator is its only admin to start with; everyone who joins is a
/// viewer until promoted, so this sheet is how a second person gets to place
/// anything. Only an admin sees the toggles: the contract enforces the same
/// rule regardless; this just avoids offering taps that would be refused.
struct MembersSheet: View {
    @ObservedObject var store: SceneStore

    /// The invite link, once minted. Held so a second tap does not mint a
    /// second invitation.
    @State private var inviteLink: String?
    @State private var inviting = false
    @State private var inviteError: String?
    @State private var copied = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SheetHeader(
                    title: "People", subtitle: "\(rows.count) in this room · \(store.onlineMembers.count) here now")
                inviteCard
                membersCard
                detailsCard
            }
            .padding(24)
        }
        .refreshable { await store.refreshRoster() }
        .preferredColorScheme(.dark)
        .task { await store.refreshRoster() }
    }

    // MARK: - Invite

    private var inviteCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    IconTile(systemName: "person.badge.plus", size: 42, gradient: true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Invite someone").font(Theme.title(17)).foregroundStyle(Theme.text)
                        Text("They join the room's space, then build with you.")
                            .font(.system(size: 13)).foregroundStyle(Theme.textFaint)
                    }
                }
                if let link = inviteLink {
                    HStack(spacing: 10) {
                        Image(systemName: "link").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.accent)
                        Text(link)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(Theme.textDim)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.black.opacity(0.25)))
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Invite link")
                    .accessibilityIdentifier("inviteLink")
                    HStack(spacing: 10) {
                        ShareLink(item: link) {
                            ButtonLabel(title: "Share", icon: "square.and.arrow.up")
                        }
                        .buttonStyle(PrimaryButtonStyle(height: 46))
                        .accessibilityIdentifier("shareInviteButton")
                        Button {
                            #if canImport(UIKit) && os(iOS)
                            UIPasteboard.general.string = link
                            #endif
                            Haptics.success()
                            copied = true
                        } label: {
                            ButtonLabel(title: copied ? "Copied" : "Copy link", icon: copied ? "checkmark" : "doc.on.doc")
                        }
                        .buttonStyle(GlassButtonStyle(height: 46))
                        .accessibilityIdentifier("copyInviteButton")
                    }
                } else {
                    Button {
                        Haptics.tap()
                        Task { await mintInvite() }
                    } label: {
                        ButtonLabel(title: "Create invite link", icon: "link", isLoading: inviting)
                    }
                    .buttonStyle(PrimaryButtonStyle(height: 50))
                    .disabled(inviting)
                    .accessibilityIdentifier("createInviteButton")
                }
                if let inviteError {
                    Callout(tone: .danger, message: inviteError)
                }
            }
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
                        Text(store.isLive ? "Live sync" : "Syncing by refresh")
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text)
                        Text(
                            store.isLive
                                ? "Changes arrive as they happen."
                                : "The live session isn't up yet, so the room refreshes every few seconds."
                        )
                        .font(.system(size: 12.5)).foregroundStyle(Theme.textFaint)
                    }
                }
                TechnicalDetails(rows: [
                    ("Room (context) ID", store.service.contextId),
                    ("Your member ID", store.memberId),
                    (store.service.relay == nil ? "Node" : "Relay", store.service.transport.endpoint),
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
