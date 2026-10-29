import CrmCore
import MeroKit
import MeroKitUI
import SwiftUI

@main
struct CrmApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: AppConfig.packageName, callback: AppConfig.callback, config: AppConfig.config,
        walletURL: AppConfig.walletURL, keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .tint(Palette.ink)
                .preferredColorScheme(.light)
                .task { if !DemoMode.isOn { await session.restore() } }
                .onOpenURL { url in Task { await session.handle(url) } }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { Task { await session.handle(url) } }
                }
        }
    }
}

/// Signed out: sign in. Signed in: the workspaces, or the open pipeline.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @AppStorage("openPipeline") private var stored = ""
    @State private var open: PipelineRef?

    /// The demo account's backend in demo mode (Debug, `-MeroDemo YES`), else the session's.
    private var activeBackend: (any MeroAppBackend)? { DemoMode.backend ?? session.backend }

    var body: some View {
        Group {
            if let backend = activeBackend {
                if let pipeline = open {
                    PipelineShell(
                        pipeline: pipeline, backend: backend,
                        onSwitch: { close() },
                        onSignOut: { signOut() }
                    )
                    .id("\(pipeline.contextId)|\(session.revision)")
                } else {
                    WorkspacesView(
                        backend: backend, applicationId: DemoMode.applicationId ?? session.applicationId,
                        onOpen: openPipeline, onSignOut: { signOut() }
                    )
                    .id(session.revision)
                }
            } else {
                SignInView(client: session.client)
            }
        }
        .onAppear { open = Self.decode(stored) }
        .sheet(
            isPresented: Binding(
                get: { session.pendingInvitation != nil && activeBackend != nil },
                set: { if !$0 { session.dismissPendingInvitation() } })
        ) {
            if let raw = session.pendingInvitation, let backend = activeBackend {
                InvitationSheet(raw: raw, backend: backend, applicationId: DemoMode.applicationId ?? session.applicationId) { pipeline in
                    session.dismissPendingInvitation()
                    Task { await session.didJoinNamespace() }
                    if let pipeline { openPipeline(pipeline) } else { close() }
                }
            }
        }
    }

    private func openPipeline(_ pipeline: PipelineRef) {
        open = pipeline
        stored = (try? String(data: JSONEncoder().encode(pipeline), encoding: .utf8) ?? "") ?? ""
    }

    private func close() {
        open = nil
        stored = ""
    }

    private func signOut() {
        close()
        Task { await session.signOut() }
    }

    private static func decode(_ raw: String) -> PipelineRef? {
        guard !raw.isEmpty else { return nil }
        return try? JSONDecoder().decode(PipelineRef.self, from: Data(raw.utf8))
    }
}
