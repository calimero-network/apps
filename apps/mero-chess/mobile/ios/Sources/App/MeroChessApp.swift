import ChessCore
import MeroKit
import MeroKitUI
import SwiftUI

@main
struct MeroChessApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: ChessConstants.packageName, callback: AppConfig.callback, config: AppConfig.config,
        keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView(session: session, client: session.client)
                .preferredColorScheme(.light)
                .tint(Theme.ink)
                // Invitation links, and the consent page sending the person back.
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Restoring → a splash. Signed out → sign-in. Signed in → the tables, and the table opened.
struct RootView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @State private var didRestore = false
    /// Kept here, above the per-session views, so a join that rebuilds the session keeps the
    /// table it opened.
    @State private var path: [TableRef] = []
    @State private var joining: ChessInvitation?
    @StateObject private var approvals: ApprovalsModel

    init(session: MeroAppSession, client: MeroClient) {
        self.session = session
        self.client = client
        _approvals = StateObject(
            wrappedValue: ApprovalsModel(
                packageName: ChessConstants.packageName, appName: "Mero Chess",
                fetch: { [weak session] org in
                    guard let session else { throw CancellationError() }
                    return try await session.pendingApprovals(org: org)
                },
                consent: { [weak session] request in await session?.requestConsent(request) }))
    }

    var body: some View {
        Group {
            if !didRestore || session.isRestoring {
                Splash(text: "Restoring your session…")
            } else if !session.isSignedIn {
                SignInView(session: session, client: client, invited: session.pendingInvitation != nil)
            } else if let backend = session.backend {
                NavigationStack(path: $path) {
                    LobbyScreen(
                        backend: backend, applicationId: session.applicationId, account: session.account ?? "",
                        approvals: approvals,
                        onOpen: { path = [$0] }, onJoin: { joining = $0 },
                        onSignOut: { Task { await session.signOut() } }
                    )
                    .id(session.revision)
                    .navigationDestination(for: TableRef.self) { ref in
                        TableScreen(backend: backend, ref: ref).id("\(ref.contextId)-\(session.revision)")
                    }
                }
            } else {
                Splash(text: "Connecting to your cluster…") {
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
        .sheet(item: $joining) { invitation in
            JoinSheet(invitation: invitation) {
                guard let backend = session.backend else { throw ChessError.noRelay }
                let lobby = LobbyModel(backend: backend, applicationId: session.applicationId)
                let ref = try await lobby.join(invitation) { await session.didJoinNamespace() }
                path = [ref]
            }
        }
    }

    /// An invitation link the system handed the app is asked about once signed in.
    private func pickUpInvitation() {
        guard didRestore, session.isSignedIn, let link = session.pendingInvitation else { return }
        session.dismissPendingInvitation()
        joining = ChessInvitation.parse(link)
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
