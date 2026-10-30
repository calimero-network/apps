import MeroKitUI
import SwiftUI

@main
struct MeroChatApp: App {
    @StateObject private var session = SessionModel()
    @AppStorage(ThemeChoice.storageKey) private var theme = ThemeChoice.light.rawValue

    var body: some Scene {
        WindowGroup {
            RootView(session: session, client: session.client)
                .preferredColorScheme((ThemeChoice(rawValue: theme) ?? .light).scheme)
                .tint(Theme.accent)
                // Invitation links, and the consent page sending the person back.
                .onOpenURL { url in
                    Task { await session.handle(url) }
                }
        }
    }
}

/// Signed out → the landing page. Signed in → the workspace picker, then the workspace.
struct RootView: View {
    @ObservedObject var session: SessionModel
    @ObservedObject var client: MeroClient
    @State private var didRestore = false

    var body: some View {
        Group {
            if !didRestore || session.isRestoring {
                ZStack {
                    GroundBackground()
                    VStack(spacing: 14) {
                        AppMark(size: 48)
                        ProgressView().tint(Theme.accent)
                        Text("Restoring your session…").font(Theme.font(13)).foregroundStyle(Theme.muted)
                    }
                }
            } else if client.isAuthenticated, let backend = session.backend {
                SignedInView(session: session, backend: backend)
                    .id(session.revision)
            } else if client.isAuthenticated {
                ZStack {
                    GroundBackground()
                    VStack(spacing: 16) {
                        ProgressView().tint(Theme.accent)
                        Text("Connecting to your cluster…").font(Theme.font(14)).foregroundStyle(Theme.ink(38))
                        Button("Sign out") { Task { await session.signOut() } }
                            .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                    }
                }
            } else {
                SignInView(session: session, client: client)
            }
        }
        .task {
            guard !didRestore else { return }
            await session.restore()
            didRestore = true
        }
        // The client signed in, refreshed into another account or signed out.
        .onChange(of: client.sessionRevision) { _ in
            if didRestore { session.rebuild() }
        }
    }
}

/// The workspace picker until one is chosen, then that workspace.
struct SignedInView: View {
    @ObservedObject var session: SessionModel
    let backend: CloudChatBackend
    @StateObject private var workspaces: WorkspacesModel
    @AppStorage("mero-chat:workspace") private var workspaceId = ""
    @State private var picking = false

    init(session: SessionModel, backend: CloudChatBackend) {
        self.session = session
        self.backend = backend
        _workspaces = StateObject(
            wrappedValue: WorkspacesModel(
                backend: backend,
                applicationId: { [weak session] in session?.applicationId },
                displayName: { [weak session] in session?.displayName ?? "" }))
    }

    var body: some View {
        Group {
            if !picking, !session.displayName.isEmpty,
                let workspace = workspaces.workspaces.first(where: { $0.id == workspaceId })
            {
                ChatShell(
                    session: session, backend: backend, workspaces: workspaces, workspace: workspace,
                    onChangeWorkspace: { picking = true }
                )
                .id(workspace.id)
            } else {
                WorkspacePicker(session: session, model: workspaces) { workspace in
                    workspaceId = workspace.id
                    picking = false
                }
            }
        }
        .task { await workspaces.load() }
        .onChange(of: session.pendingInvitation) { link in
            if link != nil { picking = true }
        }
    }
}
