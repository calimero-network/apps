import MeroKitUI
import SwiftUI

@main
struct MeroChatApp: App {
    @StateObject private var session = SessionModel()

    var body: some Scene {
        WindowGroup {
            RootView(session: session, client: session.client)
                .onOpenURL { url in
                    Task { await session.handle(url) }
                }
        }
    }
}

/// Signed out → the Cloud sign-in screen. Signed in → the workspaces.
struct RootView: View {
    @ObservedObject var session: SessionModel
    @ObservedObject var client: MeroClient
    @State private var didRestore = false

    var body: some View {
        Group {
            if !didRestore || session.isRestoring {
                ProgressView("Restoring your session…")
            } else if client.isAuthenticated, let backend = session.backend {
                WorkspacesScreen(session: session, backend: backend)
                    .id(session.revision)
            } else if client.isAuthenticated {
                // Signed in; the relay connection is still being set up.
                VStack(spacing: 16) {
                    ProgressView("Connecting to your relay…")
                    Button("Sign out") { Task { await session.signOut() } }
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
        // The client replaced its transport/admin (sign-in, a join, sign-out).
        .onChange(of: client.sessionRevision) { _ in
            if didRestore { session.rebuild() }
        }
    }
}
