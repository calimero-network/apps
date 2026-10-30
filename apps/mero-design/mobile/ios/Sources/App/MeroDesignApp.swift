import DesignCore
import MeroKit
import MeroKitUI
import SwiftUI

@main
struct MeroDesignApp: App {
    @StateObject private var session = AppConfig.makeSession()
    @StateObject private var router = Router()

    var body: some Scene {
        WindowGroup {
            RootView(session: session, router: router)
                .tint(Theme.ink)
                .preferredColorScheme(.light)
                // Board links, invitation links, and the consent page sending the person back.
                .onOpenURL { url in
                    if let link = DesignFormat.parseBoardLink(url.absoluteString) {
                        router.open(teamId: link.teamId, contextId: link.contextId)
                        return
                    }
                    Task { await session.handle(url) }
                }
        }
    }
}

/// Where the navigation stack is. A board link pushes its team and board.
@MainActor
final class Router: ObservableObject {
    enum Route: Hashable {
        case team(id: String, name: String)
        case board(teamId: String, contextId: String, name: String)
    }

    @Published var path: [Route] = []

    func open(teamId: String, contextId: String) {
        path = [.team(id: teamId, name: "Boards"), .board(teamId: teamId, contextId: contextId, name: "")]
    }
}

/// Restoring → a splash. Signed out → sign in. Signed in → teams.
struct RootView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var router: Router
    @State private var didRestore = false
    @State private var joining = false
    @State private var joinError: String?

    /// The signed-in account's backend, or the demo's (Debug, `-MeroDemo YES`).
    private var activeBackend: (any MeroAppBackend)? { DemoMode.backend ?? (session.isSignedIn ? session.backend : nil) }

    var body: some View {
        Group {
            if !didRestore || session.isRestoring {
                Splash(text: "Restoring your session…")
            } else if let backend = activeBackend {
                NavigationStack(path: $router.path) {
                    TeamsScreen(session: session, backend: backend)
                        .navigationDestination(for: Router.Route.self) { route in
                            switch route {
                            case .team(let id, let name):
                                BoardsScreen(backend: backend, teamId: id, teamName: name)
                            case .board(let teamId, let contextId, let name):
                                BoardScreen(
                                    backend: backend, teamId: teamId, contextId: contextId, name: name,
                                    blobs: DemoMode.blobs ?? BackendBlobs(backend: backend))
                            }
                        }
                }
                .id(session.revision)
            } else if session.isSignedIn {
                Splash(text: "Connecting to your cluster…") {
                    Button("Sign out") { Task { await session.signOut() } }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                }
            } else {
                SignInView(session: session, client: session.client)
            }
        }
        .task {
            guard !didRestore else { return }
            if !DemoMode.isOn { await session.restore() }
            didRestore = true
        }
        .alert(
            "Join this team?",
            isPresented: Binding(
                get: { session.pendingInvitation != nil && session.isSignedIn && !joining }, set: { _ in })
        ) {
            Button("Join") { Task { await join() } }
            Button("Not now", role: .cancel) { session.dismissPendingInvitation() }
        } message: {
            Text("You were invited to a team on Mero Design. Its boards show up here once you join.")
        }
        .alert(
            "Couldn't join", isPresented: Binding(get: { joinError != nil }, set: { if !$0 { joinError = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(joinError ?? "")
        }
        .overlay {
            if joining {
                ZStack {
                    Color.black.opacity(0.15).ignoresSafeArea()
                    VStack(spacing: 12) {
                        ProgressView().tint(Theme.ink)
                        Text("Joining…").font(Theme.body(14, .semibold))
                    }
                    .card(padding: 24)
                }
            }
        }
    }

    /// Redeem the invitation link that opened the app (`POST /invites/{token}/redeem`).
    private func join() async {
        joining = true
        defer { joining = false }
        do {
            let joined = try await session.redeemPendingInvitation()
            Haptics.success()
            router.path = [.team(id: joined.namespaceId, name: "Boards")]
        } catch {
            session.dismissPendingInvitation()
            joinError = DesignFormat.errorText(error)
        }
    }
}

struct Splash<Actions: View>: View {
    let text: String
    @ViewBuilder var actions: () -> Actions

    init(text: String, @ViewBuilder actions: @escaping () -> Actions = { EmptyView() }) {
        self.text = text
        self.actions = actions
    }

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            VStack(spacing: 16) {
                AppMark(size: 52)
                ProgressView().tint(Theme.ink)
                Text(text).font(Theme.body(14)).foregroundStyle(Theme.muted)
                actions()
            }
        }
    }
}
