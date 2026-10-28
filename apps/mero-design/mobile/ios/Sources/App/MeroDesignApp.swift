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
    @State private var invitationNotice = false

    var body: some View {
        Group {
            if !didRestore || session.isRestoring {
                Splash(text: "Restoring your session…")
            } else if session.isSignedIn, let backend = session.backend {
                NavigationStack(path: $router.path) {
                    TeamsScreen(session: session, backend: backend)
                        .navigationDestination(for: Router.Route.self) { route in
                            switch route {
                            case .team(let id, let name):
                                BoardsScreen(backend: backend, teamId: id, teamName: name)
                            case .board(let teamId, let contextId, let name):
                                BoardScreen(
                                    backend: backend, teamId: teamId, contextId: contextId, name: name,
                                    blobs: SessionBlobs(admin: session.client.admin))
                            }
                        }
                }
                .id(session.revision)
            } else if session.isSignedIn {
                Splash(text: "Connecting to your relay…") {
                    Button("Sign out") { Task { await session.signOut() } }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                }
            } else {
                SignInView(session: session, client: session.client)
            }
        }
        .task {
            guard !didRestore else { return }
            await session.restore()
            didRestore = true
        }
        .onChange(of: session.pendingInvitation) { pending in
            if pending != nil { invitationNotice = true }
        }
        .alert("Open the invitation on the web", isPresented: $invitationNotice) {
            Button("OK") { session.dismissPendingInvitation() }
        } message: {
            Text("This app views boards in teams you are already in. Accept the invitation in Mero Design on the web or desktop, and the team appears here.")
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
