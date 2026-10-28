import BattleshipsCore
import MeroKit
import MeroKitUI
import SwiftUI

/// Every lobby this account is in, founding a new one, and joining one from a link.
struct LobbiesScreen: View {
    @EnvironmentObject private var session: MeroAppSession
    @StateObject private var model: LobbiesModel
    let openInvitation: (String) -> Void
    let open: (AppNamespace) -> Void
    @State private var creating = false
    @State private var joining = false
    @State private var confirmSignOut = false

    init(
        backend: any BattleshipsBackend, applicationId: String?, openInvitation: @escaping (String) -> Void,
        open: @escaping (AppNamespace) -> Void
    ) {
        _model = StateObject(wrappedValue: LobbiesModel(backend: backend, applicationId: applicationId))
        self.openInvitation = openInvitation
        self.open = open
    }

    var body: some View {
        content
            .background(Palette.ground.ignoresSafeArea())
            .navigationTitle("Battleships")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(Palette.ground, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Menu {
                        if let account = DemoMode.backend?.account ?? session.account {
                            Text("Signed in as \(Names.short(account))")
                        }
                        Button(role: .destructive) { confirmSignOut = true } label: {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } label: {
                        Image(systemName: "person.crop.circle").font(.system(size: 18)).foregroundStyle(Palette.ink)
                    }
                    .accessibilityLabel("Account")
                    .accessibilityIdentifier("lobbies.account")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button { creating = true } label: { Label("New lobby", systemImage: "plus.square") }
                        Button { joining = true } label: { Label("Join with a link", systemImage: "link") }
                    } label: {
                        Image(systemName: "plus").font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.ink)
                            .frame(width: 34, height: 34)
                            .background(Circle().fill(Palette.lime))
                    }
                    .accessibilityLabel("New lobby")
                    .accessibilityIdentifier("lobbies.add")
                }
            }
            .task { await model.load() }
            .refreshable { await model.load() }
            .sheet(isPresented: $creating) {
                CreateLobbySheet(model: model) { lobby in
                    creating = false
                    open(lobby)
                }
                .presentationDetents([.medium])
            }
            .sheet(isPresented: $joining) {
                JoinLinkSheet { raw in
                    joining = false
                    openInvitation(raw)
                }
                .presentationDetents([.medium])
            }
            .confirmationDialog("Sign out of Battleships?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await session.signOut() } }
            } message: {
                Text("Boards you placed stay on this phone, so you can pick your matches up again.")
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading where model.lobbies.isEmpty:
            ProgressView().tint(Palette.ink).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ScrollView { ErrorState(message: message) { Task { await model.load() } }.padding(.top, 60) }
        default:
            if model.lobbies.isEmpty {
                ScrollView {
                    VStack(spacing: 4) {
                        EmptyState(
                            symbol: "person.3", title: "No lobbies yet",
                            message: "A lobby is where you and your friends challenge each other. Start one, or open an invitation link.",
                            action: ("New lobby", { creating = true }))
                        Button("Join with a link") { joining = true }
                            .buttonStyle(SecondaryButtonStyle(compact: true))
                    }
                    .padding(.top, 40)
                }
            } else {
                List {
                    ForEach(Array(model.lobbies.enumerated()), id: \.element.id) { index, lobby in
                        Button { open(lobby) } label: { LobbyRow(lobby: lobby) }
                            .accessibilityIdentifier("lobbies.card.\(index)")
                            .listRowBackground(Palette.ground)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
    }
}

private struct LobbyRow: View {
    let lobby: AppNamespace

    var body: some View {
        Card(padding: 14) {
            HStack(spacing: 12) {
                SymbolTile(symbol: "person.3.fill", size: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text(Names.lobby(lobby)).font(Typeface.display(17)).foregroundStyle(Palette.ink).lineLimit(1)
                    Text(lobby.memberCount == 1 ? "1 player" : lobby.memberCount > 1 ? "\(lobby.memberCount) players" : "Lobby")
                        .font(.system(size: 14)).foregroundStyle(Palette.muted)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
            }
        }
    }
}

private struct CreateLobbySheet: View {
    @ObservedObject var model: LobbiesModel
    let created: (AppNamespace) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "New lobby", action: "Create", canAct: !name.trimmingCharacters(in: .whitespaces).isEmpty,
                busy: busy, cancel: { dismiss() }, act: create)
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: "Name")
                TextField("Friday night fleet", text: $name)
                    .font(.system(size: 17))
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(create)
                Text("You can invite players once it's created.")
                    .font(.system(size: 14)).foregroundStyle(Palette.muted)
                if let error {
                    Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger)
                }
                Spacer()
            }
            .padding(16)
        }
        .background(Palette.surface)
        .onAppear { focused = true }
    }

    private func create() {
        guard !busy, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        busy = true
        error = nil
        Haptics.tap()
        Task {
            do {
                let lobby = try await model.create(name: name)
                Haptics.success()
                created(lobby)
            } catch {
                self.error = ErrorText.describe(error, fallback: "Couldn't create the lobby. Try again.")
                Haptics.failure()
            }
            busy = false
        }
    }
}

/// Paste an invitation link someone sent.
private struct JoinLinkSheet: View {
    let submit: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var raw = ""

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Join a lobby", action: "Continue", canAct: !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                busy: false, cancel: { dismiss() }, act: { submit(raw) })
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: "Invitation link")
                TextField("https://links.calimero.network/…", text: $raw, axis: .vertical)
                    .font(.system(size: 15, design: .monospaced))
                    .lineLimit(3...6)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sunken))
                if UIPasteboard.general.hasStrings {
                    Button {
                        raw = UIPasteboard.general.string ?? ""
                    } label: {
                        Label("Paste", systemImage: "doc.on.clipboard")
                    }
                    .buttonStyle(SecondaryButtonStyle(compact: true))
                }
                Spacer()
            }
            .padding(16)
        }
        .background(Palette.surface)
    }
}
