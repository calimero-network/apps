import KombatCore
import MeroKit
import MeroKitUI
import SwiftUI

/// The arenas: practice first, then every arena in every organization this account is in.
struct LobbyScreen: View {
    let account: String
    let onOpen: (ArenaRef) -> Void
    let onPractice: () -> Void
    let onJoin: (KombatInvitation) -> Void
    let onSignOut: () -> Void
    @StateObject private var model: LobbyModel
    @StateObject private var approvals: ApprovalsModel
    @State private var creating = false
    @State private var pasting = false
    @State private var showingAccount = false
    @State private var share: SharedLink?
    @State private var actionError: String?

    init(
        session: MeroAppSession, backend: any MeroAppBackend, applicationId: String?, account: String, onOpen: @escaping (ArenaRef) -> Void,
        onPractice: @escaping () -> Void, onJoin: @escaping (KombatInvitation) -> Void,
        onSignOut: @escaping () -> Void
    ) {
        self.account = account
        self.onOpen = onOpen
        self.onPractice = onPractice
        self.onJoin = onJoin
        self.onSignOut = onSignOut
        _model = StateObject(wrappedValue: LobbyModel(backend: backend, applicationId: applicationId))
        _approvals = StateObject(wrappedValue: ApprovalsModel(session: session))
    }

    var body: some View {
        GeometryReader { geometry in
            // Landscape: a centred column, not rows stretched across the whole phone.
            let side = max(16, (geometry.size.width - 720) / 2)
            List {
                ApprovalsSection(model: approvals, side: side)
                if let message = model.error ?? actionError {
                    ErrorBanner(message: message) {
                        model.dismissError()
                        actionError = nil
                    }
                    .plainRow(side)
                }
                Button {
                    Haptics.tap()
                    onPractice()
                } label: {
                    PracticeRow()
                }
                .buttonStyle(.plain)
                .plainRow(side)

                if !model.loaded {
                    HStack { Spacer(); ProgressView().tint(Theme.ink); Spacer() }
                        .padding(.vertical, 40)
                        .plainRow(side)
                } else if model.arenas.isEmpty {
                    EmptyState(
                        title: "No arenas yet",
                        text: "Start one with New arena, or open an invitation link someone sent you.",
                        action: "New arena"
                    ) { creating = true }
                    .plainRow(side)
                } else {
                    Text("Arenas")
                        .font(Theme.body(13, .semibold)).foregroundStyle(Theme.muted)
                        .padding(.top, 6)
                        .plainRow(side)
                    ForEach(model.arenas) { entry in
                        Button {
                            Haptics.tap()
                            onOpen(entry.ref)
                        } label: {
                            ArenaRow(entry: entry)
                        }
                        .buttonStyle(.plain)
                        .plainRow(side)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button {
                                invite(entry.ref)
                            } label: {
                                Label("Invite", systemImage: "square.and.arrow.up")
                            }
                            .tint(Theme.ink)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
        .background(Theme.ground.ignoresSafeArea())
        .navigationTitle("Arenas")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button { showingAccount = true } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Account")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button { creating = true } label: { Label("New arena", systemImage: "plus") }
                        .disabled(!model.hasRelay)
                    Button { pasting = true } label: { Label("Join with a link", systemImage: "link") }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New arena")
            }
        }
        .refreshable { await loadAll() }
        .task { await loadAll() }
        .sheet(isPresented: $creating) {
            NewArenaSheet(namespaces: model.namespaces) { title, namespaceId in
                let ref = try await model.create(title: title, namespaceId: namespaceId)
                onOpen(ref)
            }
        }
        .sheet(isPresented: $pasting) {
            PasteLinkSheet { invitation in
                pasting = false
                onJoin(invitation)
            }
        }
        .sheet(isPresented: $showingAccount) {
            AccountSheet(account: account, onSignOut: onSignOut)
        }
        .sheet(item: $share) { link in ShareSheet(items: [link.url]) }
    }

    private func invite(_ ref: ArenaRef) {
        Task {
            do {
                share = SharedLink(url: try await model.inviteLink(ref))
            } catch {
                actionError = KombatText.error(error)
            }
        }
    }
}

extension LobbyScreen {
    /// The arenas, then what waits for approval in the account and in each organization.
    fileprivate func loadAll() async {
        await model.load()
        await approvals.refresh(orgs: model.namespaces.map(\.id))
    }
}

/// Practice against the CPU, offline: always the first row.
private struct PracticeRow: View {
    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.lime)
                .frame(width: 48, height: 48)
                .overlay(Image(systemName: "target").font(.system(size: 20, weight: .semibold)).foregroundStyle(Theme.ink))
            VStack(alignment: .leading, spacing: 3) {
                Text("Practice vs CPU").font(Theme.heading(16)).foregroundStyle(Theme.ink)
                Text("Off the chain: nothing here is a transaction.").font(Theme.body(13)).foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .card(padding: 14)
        .contentShape(Rectangle())
    }
}

/// One arena in the list: both corners, the title, and where the fight is.
private struct ArenaRow: View {
    let entry: ArenaEntry

    var body: some View {
        let summary = entry.summary
        HStack(spacing: 14) {
            HStack(spacing: -10) {
                FighterBadge(fighter: summary?.fighters.first ?? nil, size: 40)
                FighterBadge(fighter: summary?.fighters.last ?? nil, size: 40, mirrored: true)
                    .overlay(
                        RoundedRectangle(cornerRadius: 40 * 0.27, style: .continuous)
                            .strokeBorder(Theme.surface, lineWidth: 2))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(summary?.title ?? KombatConstants.defaultTitle).font(Theme.heading(16)).foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(summary?.players ?? (entry.namespaceName ?? "Syncing…"))
                    .font(Theme.body(13)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            if let summary {
                Text("\(summary.totalActions) tx").font(Theme.mono).foregroundStyle(Theme.muted)
                Text(summary.state)
                    .font(Theme.body(12, .semibold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(summary.live && summary.mine ? Theme.lime : Theme.sunken))
            }
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .card(padding: 14)
        .contentShape(Rectangle())
    }
}

struct EmptyState: View {
    let title: String
    let text: String
    let action: String
    let onAction: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            FighterBadge(fighter: "kinetic", size: 64)
            Text(title).font(Theme.heading(20)).foregroundStyle(Theme.ink)
            Text(text).font(Theme.body(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            Button(action: onAction) { Text(action) }
                .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                .padding(.top, 4)
        }
        .padding(.vertical, 28)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
    }
}

extension View {
    /// A list row that draws its own card: no separator, no inset background.
    func plainRow(_ side: CGFloat = 16) -> some View {
        listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 6, leading: side, bottom: 6, trailing: side))
    }
}

struct SharedLink: Identifiable {
    let url: String
    var id: String { url }
}
