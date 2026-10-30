import MeroKit
import PassCore
import SwiftUI

/// Your teams: each one the people, and the vaults they share.
struct TeamsScreen: View {
    let backend: any MeroAppBackend
    let openInvitation: (String) -> Void
    @StateObject private var model: TeamsModel
    @State private var creating = false
    @State private var joining = false
    @State private var invite: (title: String, link: String, hint: String)?
    @State private var error: String?

    init(backend: any MeroAppBackend, openInvitation: @escaping (String) -> Void) {
        self.backend = backend
        self.openInvitation = openInvitation
        _model = StateObject(wrappedValue: TeamsModel(backend: backend))
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("END-TO-END ENCRYPTED").font(.system(size: 12, weight: .semibold)).tracking(0.8)
                        .foregroundStyle(Palette.muted)
                    Text("Your vaults").font(Typeface.display(28)).foregroundStyle(Palette.ink)
                    Text("A team is the people. Every vault inside it is readable by everyone you invite.")
                        .font(.system(size: 15)).foregroundStyle(Palette.muted)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 8, trailing: 20))
            }
            if let error {
                Banner(tone: .danger, symbol: "exclamationmark.circle.fill", title: nil, text: error) { self.error = nil }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            }
            content
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .passNavigation("Vaults")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        creating = true
                    } label: {
                        Label("New team", systemImage: "plus")
                    }
                    Button {
                        joining = true
                    } label: {
                        Label("Join with a link", systemImage: "link")
                    }
                } label: {
                    Image(systemName: "plus.circle.fill").font(.system(size: 22)).foregroundStyle(Palette.ink)
                }
                .accessibilityLabel("New team or join")
            }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(isPresented: $creating) {
            NameSheet(
                title: "New team", label: "Team name", placeholder: "Acme, the family, the lab…",
                hint: "You become its Admin and can invite people.", action: "Create"
            ) { name in
                try await model.create(name: name)
            }
            .presentationDetents([.medium])
        }
        .sheet(isPresented: $joining) {
            JoinSheet(open: openInvitation).presentationDetents([.medium])
        }
        .sheet(isPresented: inviteShown) {
            if let invite {
                InviteLinkSheet(title: invite.title, link: invite.link, hint: invite.hint).presentationDetents([.medium, .large])
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading where model.teams.isEmpty:
            HStack { Spacer(); ProgressView().tint(Palette.ink); Spacer() }
                .listRowBackground(Color.clear)
                .padding(.vertical, 40)
        case .failed(let message):
            ErrorState(message: message) { Task { await model.load() } }.listRowBackground(Color.clear)
        default:
            if model.teams.isEmpty {
                EmptyState(
                    symbol: "person.3",
                    title: "No teams yet",
                    message: "Start one, or open an invitation link someone sent you.",
                    action: ("New team", { creating = true }))
                    .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(model.teams) { team in
                        NavigationLink(value: team) {
                            TeamRowView(team: team)
                        }
                        .swipeActions(edge: .trailing) {
                            Button {
                                inviteTo(team)
                            } label: {
                                Label("Invite", systemImage: "person.badge.plus")
                            }
                            .tint(Palette.ink)
                        }
                        .contextMenu {
                            Button {
                                inviteTo(team)
                            } label: {
                                Label("Invite someone", systemImage: "person.badge.plus")
                            }
                        }
                    }
                } header: {
                    SectionLabel(text: "Teams")
                }
            }
        }
    }

    private var inviteShown: Binding<Bool> {
        Binding(get: { invite != nil }, set: { if !$0 { invite = nil } })
    }

    private func inviteTo(_ team: TeamRow) {
        Task {
            do {
                let link = try await model.invite(team)
                invite = (
                    "Invite to \(team.name)", link,
                    "Anyone who opens this link can join the team and open every vault that is not invite-only. Their devices get each vault's key the next time a member who holds it opens the vault."
                )
            } catch {
                self.error = PassErrorText.describe(error)
            }
        }
    }
}

struct TeamRowView: View {
    let team: TeamRow

    var body: some View {
        HStack(spacing: 14) {
            Tile(name: team.name, size: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(team.name).font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.ink)
                HStack(spacing: 6) {
                    Badge(text: "\(team.vaultCount) vault\(team.vaultCount == 1 ? "" : "s")")
                    if team.memberCount > 0 {
                        Badge(text: "\(team.memberCount) member\(team.memberCount == 1 ? "" : "s")")
                    }
                }
            }
        }
        .padding(.vertical, 6)
    }
}

/// A one-field create sheet: a name, then the action.
struct NameSheet: View {
    let title: String
    let label: String
    let placeholder: String
    let hint: String
    let action: String
    let submit: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: title, action: action, canAct: !name.trimmingCharacters(in: .whitespaces).isEmpty, busy: busy,
                cancel: { dismiss() }, act: save)
            VStack(alignment: .leading, spacing: 14) {
                if let error { Banner(tone: .danger, symbol: "exclamationmark.circle.fill", title: nil, text: error) }
                VStack(alignment: .leading, spacing: 6) {
                    Text(label).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.muted)
                    TextField(placeholder, text: $name)
                        .font(.system(size: 17))
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit(save)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                }
                Text(hint).font(.system(size: 14)).foregroundStyle(Palette.muted)
                Spacer()
            }
            .padding(20)
        }
        .background(Palette.surface)
        .onAppear { focused = true }
    }

    private func save() {
        guard !busy, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        busy = true
        error = nil
        Task {
            do {
                try await submit(name)
                Haptics.success()
                dismiss()
            } catch {
                self.error = PassErrorText.describe(error)
                Haptics.failure()
            }
            busy = false
        }
    }
}
