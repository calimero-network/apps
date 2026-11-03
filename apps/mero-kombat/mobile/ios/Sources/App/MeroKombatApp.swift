import KombatCore
import MeroKit
import MeroKitUI
import SwiftUI

@main
struct MeroKombatApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: KombatConstants.packageName, callback: AppConfig.callback, config: AppConfig.config,
        keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView(session: session, client: session.client)
                .preferredColorScheme(.light)
                .tint(Theme.ink)
                .statusBarHidden(true)
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Where the navigation stack can go from the arenas list.
enum Route: Hashable {
    case arena(ArenaRef)
    case practice
}

/// Restoring → a splash. Signed out → sign-in (practice is open without an account). Signed in →
/// the arenas, and the arena opened.
struct RootView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @State private var didRestore = false
    /// Kept here, above the per-session views, so a join that rebuilds the session keeps the
    /// arena it opened.
    @State private var path: [Route] = []
    @State private var joining: KombatInvitation?
    private let store = DefaultsPlayerStore()

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if !didRestore || session.isRestoring {
                    Splash(text: "Restoring your session…")
                } else if !session.isSignedIn {
                    SignInView(
                        session: session, client: client, invited: session.pendingInvitation != nil,
                        onPractice: { path = [.practice] })
                } else if let backend = session.backend {
                    LobbyScreen(
                        session: session, backend: backend, applicationId: session.applicationId, account: session.account ?? "",
                        onOpen: { path = [.arena($0)] }, onPractice: { path = [.practice] }, onJoin: { joining = $0 },
                        onSignOut: { Task { await session.signOut() } }
                    )
                    .id(session.revision)
                } else {
                    Splash(text: "Connecting to your cluster…") {
                        Button("Sign out") { Task { await session.signOut() } }
                            .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                    }
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .practice:
                    PracticeScreen(store: store)
                case .arena(let ref):
                    if let backend = session.backend {
                        ArenaScreen(backend: backend, ref: ref, store: store)
                            .id("\(ref.contextId)-\(session.revision)")
                    } else {
                        Splash(text: "Connecting to your cluster…")
                    }
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
        .sheet(item: $joining) { invitation in
            JoinSheet(invitation: invitation) {
                guard let backend = session.backend else { throw KombatError.signedOut }
                let lobby = LobbyModel(backend: backend, applicationId: session.applicationId)
                let ref = try await lobby.join(invitation) { await session.didJoinNamespace() }
                path = [.arena(ref)]
            }
        }
    }

    /// An invitation link the system handed the app is asked about once signed in.
    private func pickUpInvitation() {
        guard didRestore, session.isSignedIn, let link = session.pendingInvitation else { return }
        session.dismissPendingInvitation()
        joining = KombatInvitation.parse(link)
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
        .toolbar(.hidden, for: .navigationBar)
    }
}
