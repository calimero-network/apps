import MeroKit
import MeroKitUI
import PixartCore
import SwiftUI

@main
struct MeroPixartApp: App {
    @StateObject private var session = AppConfig.makeSession()
    @StateObject private var router = Router()

    var body: some Scene {
        WindowGroup {
            RootView(session: session, router: router)
                .tint(Theme.ink)
                .preferredColorScheme(.light)
                .onOpenURL { url in
                    if let link = PixartFormat.parseProjectLink(url.absoluteString) {
                        router.open(teamId: link.teamId, contextId: link.contextId)
                        return
                    }
                    Task { await session.handle(url) }
                }
        }
    }
}

/// Where the navigation stack is. A project link pushes its team and project.
@MainActor
final class Router: ObservableObject {
    enum Route: Hashable {
        case team(id: String, name: String)
        case project(teamId: String, contextId: String, name: String)
    }

    @Published var path: [Route] = []

    func open(teamId: String, contextId: String) {
        path = [.team(id: teamId, name: "Projects"), .project(teamId: teamId, contextId: contextId, name: "")]
    }

    func openTeam(id: String, name: String) {
        path = [.team(id: id, name: name)]
    }
}

/// Restoring → a splash. Signed out → sign in. Signed in → teams.
struct RootView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var router: Router
    @StateObject private var invitation = InvitationModel()
    @State private var didRestore = false

    var body: some View {
        Group {
            if !didRestore || session.isRestoring {
                Splash(text: "Restoring your session…")
            } else if session.isSignedIn, let backend = session.backend {
                SignedInView(session: session, router: router, backend: backend)
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
            guard let pending else { return }
            invitation.open(pending)
            session.dismissPendingInvitation()
        }
        .onChange(of: invitation.stage) { stage in
            if case .joined(let teamId, let name) = stage {
                Haptics.success()
                router.openTeam(id: teamId, name: name)
                invitation.reset()
            }
        }
        .alert(alertTitle, isPresented: alertShown, presenting: invitation.stage) { stage in
            switch stage {
            case .confirm:
                Button("Join") {
                    Haptics.tap()
                    Task { await invitation.accept(backend: { session.backend }, didJoin: { await session.didJoinNamespace() }) }
                }
                Button("Not now", role: .cancel) { invitation.reset() }
            default:
                Button("OK", role: .cancel) { invitation.reset() }
            }
        } message: { stage in
            switch stage {
            case .confirm(let title):
                Text("You've been invited to \(title). Join to see its projects here and on the web.")
            case .failed(let message):
                Text(message)
            default:
                EmptyView()
            }
        }
        .overlay {
            if case .joining(let title) = invitation.stage {
                ZStack {
                    Color.black.opacity(0.12).ignoresSafeArea()
                    VStack(spacing: 12) {
                        ProgressView().tint(Theme.ink)
                        Text("Joining \(title)…").font(Theme.body(15, .medium)).foregroundStyle(Theme.ink)
                    }
                    .card(padding: 24)
                }
            }
        }
    }

    private var alertShown: Binding<Bool> {
        Binding(
            get: {
                switch invitation.stage {
                case .confirm, .failed: return true
                default: return false
                }
            },
            set: { shown in
                if !shown, case .failed = invitation.stage { invitation.reset() }
            })
    }

    private var alertTitle: String {
        if case .failed = invitation.stage { return "Couldn't join" }
        return "Join this team?"
    }
}

/// The navigation stack, with one blob cache for the signed-in session.
struct SignedInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var router: Router
    let backend: any MeroAppBackend
    @StateObject private var holder: StoreHolder

    init(session: MeroAppSession, router: Router, backend: any MeroAppBackend) {
        self.session = session
        self.router = router
        self.backend = backend
        _holder = StateObject(wrappedValue: StoreHolder(BlobStore(loader: SessionBlobs(admin: session.client.admin))))
    }

    var body: some View {
        NavigationStack(path: $router.path) {
            TeamsScreen(session: session, backend: backend)
                .navigationDestination(for: Router.Route.self) { route in
                    switch route {
                    case .team(let id, let name):
                        ProjectsScreen(backend: backend, teamId: id, teamName: name, blobs: holder.store)
                    case .project(let teamId, let contextId, let name):
                        ArtworkScreen(backend: backend, teamId: teamId, contextId: contextId, name: name, blobs: holder.store)
                    }
                }
        }
    }
}

@MainActor
final class StoreHolder: ObservableObject {
    let store: BlobStore
    init(_ store: BlobStore) { self.store = store }
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
