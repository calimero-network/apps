import MeroKit
import PassCore
import SwiftUI

/// One team: its vaults, a new vault, and invitations.
struct TeamScreen: View {
    let team: TeamRow
    let onOpen: (VaultRef) -> Void
    @StateObject private var model: TeamModel
    @State private var creating = false
    @State private var invite: (title: String, link: String, hint: String)?
    @State private var error: String?

    init(backend: any MeroAppBackend, team: TeamRow, applicationId: String, onOpen: @escaping (VaultRef) -> Void) {
        self.team = team
        self.onOpen = onOpen
        _model = StateObject(
            wrappedValue: TeamModel(
                backend: backend, namespaceId: team.id, teamName: team.name, applicationId: applicationId))
    }

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    Tile(name: team.name, size: 52)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(team.name).font(Typeface.display(24)).foregroundStyle(Palette.ink)
                        Text("Open vaults are shared with everyone in this team.")
                            .font(.system(size: 14)).foregroundStyle(Palette.muted)
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 8, trailing: 20))
            }
            if let error {
                Banner(tone: .danger, symbol: "exclamationmark.circle.fill", title: nil, text: error) { self.error = nil }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }
            vaults
            Section {
                DetailsDisclosure(rows: [("Team id", team.id)])
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .passNavigation(team.name)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        creating = true
                    } label: {
                        Label("New vault", systemImage: "plus")
                    }
                    Button {
                        inviteToTeam()
                    } label: {
                        Label("Invite to team", systemImage: "person.badge.plus")
                    }
                } label: {
                    Image(systemName: "plus.circle.fill").font(.system(size: 22)).foregroundStyle(Palette.ink)
                }
                .accessibilityLabel("New vault or invite")
            }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(isPresented: $creating) {
            NameSheet(
                title: "New vault", label: "Vault name", placeholder: "Bank logins, Production keys…",
                hint: "Everyone already in \(team.name) gets it. Its key is made on this phone the first time it opens.",
                action: "Create"
            ) { name in
                let ref = try await model.create(name: name)
                onOpen(ref)
            }
            .presentationDetents([.medium])
        }
        .sheet(isPresented: inviteShown) {
            if let invite {
                InviteLinkSheet(title: invite.title, link: invite.link, hint: invite.hint).presentationDetents([.medium, .large])
            }
        }
    }

    @ViewBuilder
    private var vaults: some View {
        switch model.phase {
        case .loading where model.vaults.isEmpty:
            HStack { Spacer(); ProgressView().tint(Palette.ink); Spacer() }
                .listRowBackground(Color.clear)
                .padding(.vertical, 40)
        case .failed(let message):
            ErrorState(message: message) { Task { await model.load() } }.listRowBackground(Color.clear)
        default:
            if model.vaults.isEmpty {
                EmptyState(
                    symbol: "lock.rectangle.stack", title: "No vaults in this team yet",
                    message: "Create one: everyone already in the team gets it.",
                    action: ("New vault", { creating = true })
                )
                .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(model.vaults) { vault in
                        Button {
                            enter(vault)
                        } label: {
                            VaultRowView(vault: vault, entering: model.entering == vault.id)
                        }
                        .swipeActions(edge: .trailing) {
                            Button {
                                inviteToVault(vault)
                            } label: {
                                Label("Invite", systemImage: "person.badge.plus")
                            }
                            .tint(Palette.ink)
                        }
                        .contextMenu {
                            Button {
                                inviteToVault(vault)
                            } label: {
                                Label("Invite someone to \(vault.name)", systemImage: "person.badge.plus")
                            }
                        }
                    }
                } header: {
                    SectionLabel(text: "Vaults")
                }
            }
        }
    }

    private var inviteShown: Binding<Bool> {
        Binding(get: { invite != nil }, set: { if !$0 { invite = nil } })
    }

    private func enter(_ vault: VaultRow) {
        Haptics.tap()
        Task {
            do {
                onOpen(try await model.enter(vault))
            } catch {
                self.error = PassErrorText.describe(error)
            }
        }
    }

    private func inviteToTeam() {
        Task {
            do {
                invite = (
                    "Invite to \(team.name)", try await model.teamInvite(),
                    "Anyone who opens this link can join the team and open every vault that is not invite-only. Their devices get each vault's key the next time a member who holds it opens the vault."
                )
            } catch {
                self.error = PassErrorText.describe(error)
            }
        }
    }

    private func inviteToVault(_ vault: VaultRow) {
        Task {
            do {
                invite = (
                    "Invite to \(vault.name)", try await model.vaultInvite(vault),
                    "This link lands them in “\(vault.name)”, but the access it grants is the whole of \(team.name): every open vault in the team, including ones added later."
                )
            } catch {
                self.error = PassErrorText.describe(error)
            }
        }
    }
}

struct VaultRowView: View {
    let vault: VaultRow
    let entering: Bool

    var body: some View {
        HStack(spacing: 14) {
            Tile(name: vault.name, size: 40, symbol: "lock.fill")
            VStack(alignment: .leading, spacing: 4) {
                Text(vault.name).font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.ink)
                if vault.contextId == nil {
                    Text("Still syncing").font(.system(size: 13)).foregroundStyle(Palette.muted)
                } else if vault.joined {
                    Badge(text: "You are in", strong: true)
                } else {
                    Badge(text: "Not joined, tap to join")
                }
            }
            Spacer()
            if entering {
                ProgressView().tint(Palette.ink)
            } else {
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}
