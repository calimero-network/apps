import MeroKit
import MeroKitUI
import StandupCore
import SwiftUI

@main
struct StandupApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: AppConfig.packageName, callback: AppConfig.callback, config: AppConfig.config,
        keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .tint(Palette.ink)
                .preferredColorScheme(.light)
                .task { if !DemoMode.isOn { await session.restore() } }
                // Invitation links, and the consent page sending the person back.
                .onOpenURL { url in Task { await session.handle(url) } }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { Task { await session.handle(url) } }
                }
        }
    }
}

/// Signed out: the sign-in screen. Signed in: the teams, or the open team.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @AppStorage("openTeam") private var storedTeam = ""
    @State private var openTeam: TeamSummary?

    /// The signed-in account's backend, or the demo's (Debug, `-MeroDemo YES`).
    private var activeBackend: (any MeroAppBackend)? { DemoMode.backend ?? session.backend }
    private var activeApplicationId: String? { DemoMode.applicationId ?? session.applicationId }

    var body: some View {
        Group {
            if let backend = activeBackend {
                if let team = openTeam {
                    TeamView(
                        team: team, backend: backend,
                        onSwitchTeam: { close() },
                        onSignOut: { signOut() }
                    )
                    .id("\(team.contextId)|\(session.revision)")
                } else {
                    TeamsView(
                        backend: backend, applicationId: activeApplicationId,
                        onOpen: open, onSignOut: { signOut() }
                    )
                    .id(session.revision)
                }
            } else {
                SignInView(client: session.client)
            }
        }
        .onAppear { openTeam = DemoMode.isOn ? nil : Self.decode(storedTeam) }
        .sheet(
            isPresented: Binding(
                get: { session.pendingInvitation != nil && activeBackend != nil },
                set: { if !$0 { session.dismissPendingInvitation() } })
        ) {
            if let raw = session.pendingInvitation, let backend = activeBackend {
                InvitationSheet(raw: raw, backend: backend, applicationId: activeApplicationId) { team in
                    session.dismissPendingInvitation()
                    Task { await session.didJoinNamespace() }
                    open(team)
                }
            }
        }
    }

    private func open(_ team: TeamSummary) {
        openTeam = team
        storedTeam = Self.encode(team)
    }

    private func close() {
        openTeam = nil
        storedTeam = ""
    }

    private func signOut() {
        close()
        Task { await session.signOut() }
    }

    private static func encode(_ team: TeamSummary) -> String {
        [team.namespaceId, team.contextId, team.name].joined(separator: "\n")
    }

    private static func decode(_ raw: String) -> TeamSummary? {
        let parts = raw.components(separatedBy: "\n")
        guard parts.count == 3, !parts[1].isEmpty else { return nil }
        return TeamSummary(namespaceId: parts[0], contextId: parts[1], name: parts[2])
    }
}
