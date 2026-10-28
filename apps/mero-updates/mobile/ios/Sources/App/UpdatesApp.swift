import MeroKit
import MeroKitUI
import SwiftUI
import UpdatesCore

@main
struct UpdatesApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: AppConfig.packageName, callback: AppConfig.callback, config: AppConfig.config,
        walletURL: AppConfig.walletURL, keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .tint(Palette.ink)
                .preferredColorScheme(.light)
                .task { await session.restore() }
                .onOpenURL { url in Task { await session.handle(url) } }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { Task { await session.handle(url) } }
                }
        }
    }
}

/// A company on the navigation stack, and whether it was just joined (its
/// audiences may not have synced yet).
struct CompanyRoute: Hashable {
    let company: CompanySummary
    var justJoined = false
}

/// Signed out: sign in. Signed in: companies → a company's audiences, or the
/// open audience with its tabs.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @AppStorage("openAudience") private var storedAudience = ""
    @State private var audience: AudienceSummary?
    @State private var path: [CompanyRoute] = []

    var body: some View {
        Group {
            if let backend = session.backend {
                if let audience, let contextId = audience.contextId {
                    AudienceView(
                        audience: audience, contextId: contextId, backend: backend,
                        onSwitch: { leave(to: audience) },
                        onSignOut: signOut
                    )
                    .id("\(contextId)|\(session.revision)")
                } else {
                    CompaniesView(
                        backend: backend, applicationId: session.applicationId, path: $path,
                        onOpen: open, onSignOut: signOut
                    )
                    .id(session.revision)
                }
            } else {
                SignInView(client: session.client)
            }
        }
        .onAppear { audience = Self.decode(storedAudience) }
        .sheet(
            isPresented: Binding(
                get: { session.pendingInvitation != nil && session.backend != nil },
                set: { if !$0 { session.dismissPendingInvitation() } })
        ) {
            if let raw = session.pendingInvitation, let backend = session.backend {
                InvitationSheet(raw: raw, backend: backend) { landing in
                    session.dismissPendingInvitation()
                    Task { await session.didJoinNamespace() }
                    land(landing)
                }
            }
        }
    }

    private func land(_ landing: InvitationLanding) {
        switch landing {
        case .audience(let audience): open(audience)
        case .company(let company):
            close()
            path = [CompanyRoute(company: company, justJoined: true)]
        }
    }

    private func open(_ audience: AudienceSummary) {
        self.audience = audience
        storedAudience = Self.encode(audience)
    }

    private func close() {
        audience = nil
        storedAudience = ""
    }

    /// Back to the audience list of the company this audience is in.
    private func leave(to audience: AudienceSummary) {
        close()
        path = [CompanyRoute(company: CompanySummary(id: audience.companyId, name: audience.companyName))]
    }

    private func signOut() {
        close()
        path = []
        Task { await session.signOut() }
    }

    private static func encode(_ audience: AudienceSummary) -> String {
        (try? JSONEncoder().encode(audience)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }

    private static func decode(_ raw: String) -> AudienceSummary? {
        guard !raw.isEmpty else { return nil }
        return try? JSONDecoder().decode(AudienceSummary.self, from: Data(raw.utf8))
    }
}
