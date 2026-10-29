import MeroKit
import MeroKitUI
import ModelsCore
import SwiftUI

@main
struct MeroModelsApp: App {
    @StateObject private var session = AppConfig.makeSession()
    @StateObject private var router = Router()
    @StateObject private var invitation = InvitationModel()

    var body: some Scene {
        WindowGroup {
            RootView(session: session, router: router, invitation: invitation)
                .tint(Theme.ink)
                .preferredColorScheme(.light)
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Where the navigation stack is. A redeemed invitation pushes its studio and scene.
@MainActor
final class Router: ObservableObject {
    enum Route: Hashable {
        case studio(id: String, name: String)
        case scene(studioId: String, contextId: String, name: String)
    }

    @Published var path: [Route] = []

    func open(studioId: String, contextId: String) {
        path = [.studio(id: studioId, name: "Scenes"), .scene(studioId: studioId, contextId: contextId, name: "")]
    }
}

/// Restoring → a splash. Signed out → sign in. Signed in → studios.
struct RootView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var router: Router
    @ObservedObject var invitation: InvitationModel
    @State private var didRestore = false

    var body: some View {
        Group {
            if !didRestore || session.isRestoring {
                Splash(text: "Restoring your session…")
            } else if session.isSignedIn, let backend = session.backend {
                NavigationStack(path: $router.path) {
                    StudiosScreen(session: session, backend: backend, invitation: invitation)
                        .navigationDestination(for: Router.Route.self) { route in
                            switch route {
                            case .studio(let id, let name):
                                ScenesScreen(backend: backend, studioId: id, studioName: name)
                            case .scene(let studioId, let contextId, let name):
                                SceneScreen(
                                    backend: backend, studioId: studioId, contextId: contextId, name: name,
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
        .onChange(of: session.pendingInvitation) { raw in
            guard let raw else { return }
            invitation.open(raw)
            session.dismissPendingInvitation()
        }
        .sheet(isPresented: Binding(get: { invitation.stage != .idle }, set: { if !$0 { invitation.reset() } })) {
            InvitationSheet(model: invitation, session: session) { studioId, contextId in
                router.open(studioId: studioId, contextId: contextId)
            }
            .presentationDetents([.medium])
        }
    }
}

/// Confirm an invitation, join, and open the scene it names.
struct InvitationSheet: View {
    @ObservedObject var model: InvitationModel
    @ObservedObject var session: MeroAppSession
    let open: (_ studioId: String, _ contextId: String) -> Void

    var body: some View {
        VStack(spacing: 16) {
            switch model.stage {
            case .idle, .confirm:
                header(icon: "person.badge.plus", title: "Join this studio?")
                Text("Joining makes you a member of the studio this scene belongs to, so you can open every scene in it.")
                    .font(Theme.body(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                Spacer()
                if session.isSignedIn {
                    Button("Join and open") {
                        Haptics.tap()
                        Task { await model.accept(backend: { session.backend }, didJoin: { await session.didJoinNamespace() }) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                } else {
                    Text("Sign in first, then open the link again.").font(Theme.body(14)).foregroundStyle(Theme.muted)
                }
                Button("Not now") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            case .joining:
                header(icon: "hourglass", title: "Joining…")
                ProgressView().tint(Theme.ink)
                Spacer()
            case .joined(let studioId, let contextId):
                header(icon: "checkmark.circle", title: "You're in")
                Text("The scene syncs from the other members. It may take a moment to appear in full.")
                    .font(Theme.body(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                Spacer()
                Button("Open the scene") {
                    model.reset()
                    open(studioId, contextId)
                }
                .buttonStyle(PrimaryButtonStyle())
                .onAppear { Haptics.success() }
            case .failed(let message):
                header(icon: "exclamationmark.triangle", title: "Couldn't join")
                Text(message).font(Theme.body(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                Spacer()
                Button("Close") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Theme.ground)
    }

    private func header(icon: String, title: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 26, weight: .regular))
                .foregroundStyle(Theme.ink)
                .frame(width: 60, height: 60)
                .background(Theme.lime, in: Circle())
            Text(title).font(Theme.heading(20)).foregroundStyle(Theme.ink)
        }
        .padding(.top, 8)
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
