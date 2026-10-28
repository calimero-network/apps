import BlocksCore
import MeroKit
import SwiftUI

/// The worlds this account plays in, with who is playing in each.
struct WorldsScreen: View {
    let account: String
    let settings: PlayerSettings
    let onOpen: (WorldRef) -> Void
    let onJoin: (BlocksInvitation) -> Void
    let onSignOut: () -> Void
    @StateObject private var model: WorldsModel
    @State private var creating = false
    @State private var pasting = false
    @State private var share: SharedLink?
    @State private var leaving: WorldRef?
    @State private var actionError: String?

    init(
        backend: any MeroAppBackend, applicationId: String?, account: String, settings: PlayerSettings,
        onOpen: @escaping (WorldRef) -> Void, onJoin: @escaping (BlocksInvitation) -> Void,
        onSignOut: @escaping () -> Void
    ) {
        self.account = account
        self.settings = settings
        self.onOpen = onOpen
        self.onJoin = onJoin
        self.onSignOut = onSignOut
        _model = StateObject(wrappedValue: WorldsModel(backend: backend, applicationId: applicationId))
    }

    var body: some View {
        List {
            if let message = model.error ?? actionError {
                ErrorBanner(message: message) {
                    model.dismissError()
                    actionError = nil
                }
                .plainRow()
            }
            if let notice = model.notice {
                NoticeBanner(message: notice) { model.dismissNotice() }.plainRow()
            }
            if !model.loaded {
                HStack { Spacer(); ProgressView().tint(Theme.ink); Spacer() }
                    .padding(.vertical, 48)
                    .plainRow()
            } else if !model.hasRelay {
                EmptyState(
                    icon: "link", title: "Join your first world",
                    text: "Your account has no relay yet. Open an invitation link a friend sent you, or paste it here.",
                    action: "Join with a link"
                ) { pasting = true }
                .plainRow()
            } else if model.worlds.isEmpty {
                EmptyState(
                    icon: nil, title: "No worlds yet",
                    text: "Create one, or open an invite link a friend sent you.", action: "Create world"
                ) { creating = true }
                .plainRow()
            } else {
                ForEach(model.worlds) { entry in
                    Button {
                        Haptics.tap()
                        onOpen(entry.ref)
                    } label: {
                        WorldRow(entry: entry)
                    }
                    .buttonStyle(.plain)
                    .plainRow()
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button {
                            invite(entry.ref)
                        } label: {
                            Label("Invite", systemImage: "person.badge.plus")
                        }
                        .tint(Theme.ink)
                    }
                    .swipeActions(edge: .leading, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            leaving = entry.ref
                        } label: {
                            Label("Leave", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.ground.ignoresSafeArea())
        .navigationTitle("Worlds")
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                NavigationLink {
                    SettingsScreen(settings: settings, account: account, onSignOut: onSignOut)
                } label: {
                    Image(systemName: "gearshape")
                }
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
                .accessibilityLabel("Create world")
            }
        }
        .refreshable { await model.load() }
        .task { await model.load() }
        .sheet(isPresented: $creating) {
            NewWorldSheet { name, seed in
                let ref = try await model.create(name: name, seed: seed)
                onOpen(ref)
            }
        }
        .sheet(isPresented: $pasting) {
            PasteLinkSheet { invitation in
                pasting = false
                onJoin(invitation)
            }
        }
        .sheet(item: $share) { link in ShareSheet(items: [link.url]) }
        .confirmationDialog(
            "Leave \(leaving?.name ?? "this world")?", isPresented: Binding(get: { leaving != nil }, set: { if !$0 { leaving = nil } }), titleVisibility: .visible,
            presenting: leaving
        ) { world in
            Button("Leave world", role: .destructive) { leave(world) }
            Button("Cancel", role: .cancel) { leaving = nil }
        } message: { _ in
            Text("It disappears from your list. Someone in it can invite you back.")
        }
    }

    private func invite(_ ref: WorldRef) {
        Haptics.tap()
        Task {
            do {
                share = SharedLink(url: try await model.inviteLink(ref))
            } catch {
                actionError = BlocksText.error(error)
            }
        }
    }

    private func leave(_ ref: WorldRef) {
        leaving = nil
        Task {
            do {
                try await model.leave(ref)
                Haptics.success()
            } catch {
                actionError = BlocksText.error(error)
            }
        }
    }
}

/// One world in the list.
private struct WorldRow: View {
    let entry: WorldEntry

    var body: some View {
        HStack(spacing: 14) {
            WorldThumb(seed: entry.ref.contextId)
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.ref.name).font(Theme.heading(16)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(BlocksText.online(entry.online) ?? "Syncing…")
                    .font(Theme.body(13)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            if let online = entry.online, online > 0 {
                HStack(spacing: 5) {
                    Circle().fill(Theme.online).frame(width: 7, height: 7)
                    Text("Live").font(Theme.body(12, .semibold)).foregroundStyle(Theme.ink)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(Theme.limeSoft))
            }
            Image(systemName: "play.fill").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
                .frame(width: 32, height: 32)
                .background(Circle().fill(Theme.lime))
        }
        .card(padding: 14)
        .contentShape(Rectangle())
    }
}

/// A small landscape for a world: sky, hills and ground in the game's own colours, shaped by
/// the world's id so each row looks its own (the web app's world cards do the same).
struct WorldThumb: View {
    let seed: String

    var body: some View {
        Canvas { context, size in
            var hash: UInt32 = 2_166_136_261
            for byte in seed.utf8 { hash = (hash ^ UInt32(byte)) &* 16_777_619 }
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(hex: 0x87C4EB)))
            let columns = 6
            let width = size.width / CGFloat(columns)
            for column in 0..<columns {
                hash = hash &* 1_103_515_245 &+ 12345
                let height = size.height * (0.35 + CGFloat((hash >> 16) % 30) / 100)
                let x = CGFloat(column) * width
                let top = size.height - height
                context.fill(
                    Path(CGRect(x: x, y: top, width: width + 0.5, height: height)), with: .color(Color(hex: 0x8A5A3B)))
                context.fill(
                    Path(CGRect(x: x, y: top, width: width + 0.5, height: size.height * 0.12)),
                    with: .color(Color(hex: 0x5DAA3C)))
            }
        }
        .accessibilityHidden(true)
    }
}

struct EmptyState: View {
    /// An SF Symbol, or nil for the block.
    let icon: String?
    let title: String
    let text: String
    let action: String
    let onAction: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Group {
                if let icon {
                    Image(systemName: icon).font(.system(size: 30, weight: .medium)).foregroundStyle(Theme.ink)
                } else {
                    BlockGlyph().frame(width: 36, height: 36)
                }
            }
            .frame(width: 72, height: 72)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Theme.limeSoft))
            Text(title).font(Theme.heading(20)).foregroundStyle(Theme.ink)
            Text(text).font(Theme.body(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            Button(action: onAction) { Text(action) }
                .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                .padding(.top, 4)
        }
        .padding(.vertical, 40)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
    }
}

/// A lime banner for something worth knowing that is not an error.
struct NoticeBanner: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill").foregroundStyle(Theme.ink)
            Text(message).font(Theme.body(14)).foregroundStyle(Theme.ink).frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
            }
            .accessibilityLabel("Dismiss")
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.limeSoft))
    }
}

extension View {
    /// A list row that draws its own card: no separator, no inset background.
    func plainRow() -> some View {
        listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
    }
}

struct SharedLink: Identifiable {
    let url: String
    var id: String { url }
}
