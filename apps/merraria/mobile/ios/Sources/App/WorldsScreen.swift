import MeroKit
import MeroKitUI
import MerrariaCore
import SwiftUI

/// The worlds this account plays in: open one, make one, join one from a link, invite to one.
struct WorldsScreen: View {
    let account: String
    let settings: PlayerSettings
    let onPlay: (WorldRef) -> Void
    let onJoin: (WorldInvitation) -> Void
    let onSignOut: () -> Void
    @StateObject private var model: WorldsModel
    @StateObject private var approvals: ApprovalsModel
    @State private var creating = false
    @State private var pasting = false
    @State private var showingSettings = false
    @State private var share: SharedLink?
    @State private var actionError: String?
    /// A world just created or a link just pasted, acted on once its sheet has gone.
    @State private var created: WorldRef?
    @State private var pasted: WorldInvitation?

    init(
        session: MeroAppSession, backend: any MeroAppBackend, applicationId: String?, account: String, settings: PlayerSettings,
        onPlay: @escaping (WorldRef) -> Void, onJoin: @escaping (WorldInvitation) -> Void,
        onSignOut: @escaping () -> Void
    ) {
        self.account = account
        self.settings = settings
        self.onPlay = onPlay
        self.onJoin = onJoin
        self.onSignOut = onSignOut
        _model = StateObject(wrappedValue: WorldsModel(backend: backend, applicationId: applicationId))
        _approvals = StateObject(wrappedValue: ApprovalsModel(session: session))
    }

    var body: some View {
        List {
            ApprovalsSection(model: approvals)
            if let message = model.error ?? actionError {
                ErrorBanner(message: message) {
                    model.dismissError()
                    actionError = nil
                }
                .plainRow()
            }
            if !model.loaded {
                HStack { Spacer(); ProgressView().tint(Theme.ink); Spacer() }
                    .padding(.vertical, 48)
                    .plainRow()
            } else if model.worlds.isEmpty {
                EmptyState(
                    title: "No worlds yet",
                    text: "Create a world to start digging, or join a friend's with an invitation link.",
                    action: "Create world"
                ) { creating = true }
                .plainRow()
            } else {
                ForEach(model.worlds) { entry in
                    Button {
                        Haptics.tap()
                        onPlay(entry.ref)
                    } label: {
                        WorldRow(entry: entry)
                    }
                    .buttonStyle(.plain)
                    .plainRow()
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
        .background(Theme.ground.ignoresSafeArea())
        .navigationTitle("Worlds")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button { showingSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("Settings")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button { creating = true } label: { Label("Create world", systemImage: "plus") }
                        .disabled(!model.hasRelay)
                    Button { pasting = true } label: { Label("Join with a link", systemImage: "link") }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Create or join a world")
            }
        }
        .refreshable { await loadAll() }
        .task { await loadAll() }
        .sheet(isPresented: $creating, onDismiss: openCreated) {
            NewWorldSheet { name, seed in
                created = try await model.create(name: name, seed: seed)
            }
        }
        .sheet(isPresented: $pasting, onDismiss: joinPasted) {
            PasteLinkSheet { invitation in
                pasted = invitation
                pasting = false
            }
        }
        .sheet(isPresented: $showingSettings) {
            SettingsSheet(account: account, settings: settings, onSignOut: onSignOut)
        }
        .sheet(item: $share) { link in ShareSheet(items: [link.url]) }
    }

    private func openCreated() {
        guard let ref = created else { return }
        created = nil
        onPlay(ref)
    }

    private func joinPasted() {
        guard let invitation = pasted else { return }
        pasted = nil
        onJoin(invitation)
    }

    private func invite(_ ref: WorldRef) {
        Task {
            do {
                share = SharedLink(url: try await model.inviteLink(ref))
            } catch {
                actionError = MerrariaText.error(error)
            }
        }
    }
}

extension WorldsScreen {
    /// The worlds, then what waits for approval in the account and in each world.
    fileprivate func loadAll() async {
        await model.load()
        await approvals.refresh(orgs: model.worlds.map(\.ref.namespaceId))
    }
}

/// One world in the list.
private struct WorldRow: View {
    let entry: WorldEntry

    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.sunken)
                .frame(width: 48, height: 48)
                .overlay(AppMark(size: 30))
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.ref.name).font(Theme.heading(16)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(MerrariaText.players(max(entry.players, 1)))
                    .font(Theme.body(13)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                Image(systemName: "play.fill").font(.system(size: 11, weight: .bold))
                Text("Play").font(Theme.body(13, .semibold))
            }
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Capsule().fill(Theme.lime))
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
            AppMark(size: 64)
            Text(title).font(Theme.heading(20)).foregroundStyle(Theme.ink)
            Text(text).font(Theme.body(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                .frame(maxWidth: 440)
            Button(action: onAction) { Text(action) }
                .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                .padding(.top, 4)
        }
        .padding(.vertical, 32)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
    }
}
