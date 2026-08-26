import SwiftUI

/// Who's in the room and what they may do.
///
/// The room's creator is its only admin to start with; everyone who joins is a
/// viewer until promoted, so this sheet is how a second device gets to place
/// anything. Only an admin sees the toggles — the contract enforces the same rule
/// regardless, this just avoids offering taps that would be rejected.
struct MembersSheet: View {
    @ObservedObject var store: SceneStore
    @Environment(\.dismiss) private var dismiss

    /// The invite link, once minted. Held so the share sheet has something to
    /// present and so a second tap does not mint a second invitation.
    @State private var inviteLink: String?
    @State private var inviting = false
    @State private var inviteError: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(rows) { row in
                        memberRow(row)
                    }
                } header: {
                    Text("\(rows.count) member\(rows.count == 1 ? "" : "s")")
                } footer: {
                    Text(footerText)
                }

                Section {
                    Button {
                        Task { await mintInvite() }
                    } label: {
                        HStack {
                            Label("Invite someone", systemImage: "square.and.arrow.up")
                            if inviting {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(inviting)

                    if let link = inviteLink {
                        ShareLink(item: link) {
                            Label("Share link", systemImage: "link")
                        }
                        Text(link)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .lineLimit(3)
                    }

                    if let inviteError {
                        Text(inviteError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                } header: {
                    Text("Invite")
                } footer: {
                    // Says plainly where the link is meant to be opened, because
                    // the answer is not obvious: this app talks to a node on a
                    // computer, so the link is for that computer, not the phone.
                    Text(
                        "Send this link to someone. Opened on a computer with Calimero Desktop it "
                            + "installs Mero AR if needed and joins this room. They can also paste "
                            + "it into the app's room field."
                    )
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.bg0)
            .navigationTitle("Room")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .refreshable { await store.refreshRoster() }
        }
        .task { await store.refreshRoster() }
    }

    /// Mint a namespace invitation for this room and build its shareable link.
    private func mintInvite() async {
        inviting = true
        inviteError = nil
        defer { inviting = false }
        do {
            let invite = try await store.service.createRoomInvite()
            inviteLink = try invite.shareableLink()
        } catch {
            inviteError = "Could not create an invite: \(error.localizedDescription)"
        }
    }

    /// `myRole` is empty until it first resolves — don't render "You are a ."
    private var footerText: String {
        if store.isAdmin {
            return "Editors can place, move, and delete objects, and publish the room scan."
        }
        if store.myRole.isEmpty {
            return "Only an admin can change roles."
        }
        return "Only an admin can change roles. You are \(article(store.myRole)) \(store.myRole)."
    }

    /// Roles joined onto member names, newest-joined last, with us pinned first.
    private var rows: [Row] {
        let names = Dictionary(uniqueKeysWithValues: store.members.map { ($0.id, $0.username) })
        let known = store.roles.map { Row(id: $0.member, name: names[$0.member] ?? shortId($0.member), role: $0.role) }
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

    private func memberRow(_ row: Row) -> some View {
        HStack(spacing: 12) {
            // Rows are members (accounts) and presence is per device, so ask
            // "is any device of this member here" rather than indexing by row id.
            Circle()
                .fill(store.onlineMembers.contains(row.id) ? Theme.accent3 : Color.white.opacity(0.2))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.name).foregroundStyle(.white)
                    if row.id == store.memberId {
                        Text("you").font(.caption2).foregroundStyle(.white.opacity(0.5))
                    }
                    if row.id == store.room?.owner {
                        Image(systemName: "crown.fill").font(.caption2).foregroundStyle(Theme.accent2)
                    }
                }
                Text(row.role.capitalized)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.55))
            }
            Spacer()
            // An admin's rights come from the admin tier, not the editor role, so
            // there is nothing to toggle for them.
            if store.isAdmin && row.role != "admin" {
                Toggle("", isOn: Binding(
                    get: { row.role == "editor" },
                    set: { enabled in Task { await store.setEditor(row.id, enabled: enabled) } }
                ))
                .labelsHidden()
                .tint(Theme.accent)
            }
        }
        .listRowBackground(Theme.field)
    }

    private func shortId(_ id: String) -> String {
        id.count > 12 ? "\(id.prefix(6))…\(id.suffix(4))" : id
    }

    private func article(_ role: String) -> String {
        "aeiou".contains(role.lowercased().first ?? "x") ? "an" : "a"
    }
}
