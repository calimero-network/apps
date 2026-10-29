import DocsCore
import MeroKit
import MeroKitUI
import SwiftUI

@main
struct MeroDocsApp: App {
    @StateObject private var session = AppConfig.makeSession()
    @StateObject private var router = Router()

    var body: some Scene {
        WindowGroup {
            RootView(session: session, router: router)
                .tint(Theme.ink)
                .preferredColorScheme(.light)
                .onOpenURL { url in
                    if let target = DocsFormat.parseDocLink(url.absoluteString) {
                        router.open(target)
                        return
                    }
                    Task { await session.handle(url) }
                }
        }
    }
}

/// Where the navigation stack is. A document link pushes its workspace and document.
@MainActor
final class Router: ObservableObject {
    enum Route: Hashable {
        case workspace(Workspace)
        case folder(workspaceId: String, folderId: String)
        case doc(DocTarget, contextId: String?, title: String?)
    }

    @Published var path: [Route] = []

    func open(_ target: DocTarget) {
        path = [
            .workspace(Workspace(id: target.workspaceId, name: "Workspace", memberCount: 0)),
            .doc(target, contextId: nil, title: nil),
        ]
    }
}

/// One `WorkspaceModel` per workspace for the session, shared by its screens.
@MainActor
final class WorkspaceModels: ObservableObject {
    private var models: [String: WorkspaceModel] = [:]
    let recents = DefaultsRecentStore()

    func model(_ workspace: Workspace, backend: any MeroAppBackend) -> WorkspaceModel {
        if let m = models[workspace.id] { return m }
        let m = WorkspaceModel(backend: backend, workspace: workspace, recents: recents)
        models[workspace.id] = m
        return m
    }
}

/// Restoring → a splash. Signed out → sign in. Signed in → workspaces.
struct RootView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var router: Router
    @State private var didRestore = false
    @State private var invitationNotice = false

    var body: some View {
        Group {
            if let backend = DemoMode.backend {
                SignedInView(session: session, router: router, backend: backend)
            } else if !didRestore || session.isRestoring {
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
            if !DemoMode.isOn { await session.restore() }
            didRestore = true
        }
        .onChange(of: session.pendingInvitation) { pending in
            if pending != nil { invitationNotice = true }
        }
        .alert("Open the invitation on the web", isPresented: $invitationNotice) {
            Button("OK") { session.dismissPendingInvitation() }
        } message: {
            Text("This app reads workspaces you are already in. Accept the invitation in Mero Docs on the web or desktop, and the workspace appears here.")
        }
    }
}

private struct SignedInView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var router: Router
    let backend: any MeroAppBackend
    @StateObject private var models = WorkspaceModels()

    var body: some View {
        NavigationStack(path: $router.path) {
            WorkspacesScreen(session: session, backend: backend)
                .navigationDestination(for: Router.Route.self) { route in
                    switch route {
                    case .workspace(let ws):
                        WorkspaceScreen(model: models.model(ws, backend: backend))
                    case .folder(let wsId, let folderId):
                        FolderScreen(
                            model: models.model(Workspace(id: wsId, name: "", memberCount: 0), backend: backend),
                            folderId: folderId)
                    case .doc(let target, let contextId, let title):
                        DocumentScreen(
                            model: DocumentModel(
                                backend: backend, workspaceId: target.workspaceId, folderId: target.folderId,
                                docId: target.docId, contextId: contextId,
                                folderName: models.model(
                                    Workspace(id: target.workspaceId, name: "", memberCount: 0), backend: backend
                                ).folder(target.folderId)?.name ?? "",
                                title: title, blobs: DemoMode.blobs ?? SessionBlobs(admin: session.client.admin), recents: models.recents),
                            focusBlock: target.blockId)
                    }
                }
        }
        .environmentObject(router)
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
