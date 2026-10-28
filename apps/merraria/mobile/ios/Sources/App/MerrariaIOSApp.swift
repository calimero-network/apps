import MeroKit
import MeroKitUI
import MerrariaCore
import SwiftUI

@main
struct MerrariaIOSApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: MerrariaConstants.packageName, callback: AppConfig.callback, config: AppConfig.config,
        walletURL: AppConfig.walletURL, keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView(session: session, client: session.client)
                .preferredColorScheme(.light)
                .tint(Theme.ink)
                .statusBarHidden()
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Restoring → a splash. Signed out → sign-in. Signed in → the worlds, and the world being played
/// over them, full screen.
struct RootView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @State private var didRestore = false
    /// Kept here, above the per-session views, so a join that rebuilds the session keeps the world
    /// it opened.
    @State private var playing: WorldRef?
    @State private var joining: WorldInvitation?
    /// A world just joined, opened once the join sheet has gone (one presentation at a time).
    @State private var joined: WorldRef?
    private let settings = DefaultsPlayerSettings()

    var body: some View {
        Group {
            if !didRestore || session.isRestoring {
                Splash(text: "Restoring your session…")
            } else if !session.isSignedIn {
                SignInView(session: session, client: client, invited: session.pendingInvitation != nil)
            } else if let backend = session.backend {
                NavigationStack {
                    WorldsScreen(
                        backend: backend, applicationId: session.applicationId, account: session.account ?? "",
                        settings: settings, onPlay: { playing = $0 }, onJoin: { joining = $0 },
                        onSignOut: { Task { await session.signOut() } }
                    )
                    .id(session.revision)
                }
                .fullScreenCover(item: $playing) { ref in
                    GameScreen(backend: backend, ref: ref, settings: settings) { playing = nil }
                }
            } else {
                Splash(text: "Connecting to your relay…") {
                    Button("Sign out") { Task { await session.signOut() } }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                }
            }
        }
        .task {
            guard !didRestore else { return }
            await session.restore()
            didRestore = true
        }
        .onChange(of: session.pendingInvitation) { _ in pickUpInvitation() }
        .onChange(of: session.isSignedIn) { _ in pickUpInvitation() }
        .onChange(of: didRestore) { _ in pickUpInvitation() }
        .sheet(item: $joining, onDismiss: openJoined) { invitation in
            JoinSheet(invitation: invitation) {
                guard let backend = session.backend else { throw MerrariaError.noRelay }
                let worlds = WorldsModel(backend: backend, applicationId: session.applicationId)
                joined = try await worlds.join(invitation) { await session.didJoinNamespace() }
            }
        }
    }

    private func openJoined() {
        guard let ref = joined else { return }
        joined = nil
        playing = ref
    }

    /// An invitation link the system handed the app is asked about once signed in.
    private func pickUpInvitation() {
        guard didRestore, session.isSignedIn, let link = session.pendingInvitation else { return }
        session.dismissPendingInvitation()
        joining = WorldInvitation.parse(link)
    }
}

struct Splash<Footer: View>: View {
    let text: String
    @ViewBuilder var footer: Footer

    init(text: String, @ViewBuilder footer: () -> Footer = { EmptyView() }) {
        self.text = text
        self.footer = footer()
    }

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            VStack(spacing: 16) {
                AppMark(size: 56)
                ProgressView().tint(Theme.ink)
                Text(text).font(Theme.body(14)).foregroundStyle(Theme.muted)
                footer
            }
        }
    }
}
