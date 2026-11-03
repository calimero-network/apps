import IssueTrackerCore
import MeroKit
import MeroKitUI
import SwiftUI

@main
struct IssueTrackerApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: Tracker.packageName, callback: AppConfig.callback, config: AppConfig.providerConfig,
        keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.light)
                .tint(Theme.ink)
                .task { if !DemoMode.isOn { await session.restore() } }
                // Invitation links, and the consent page sending the person back.
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Signed out → sign-in; signed in → the tracker, rebuilt when the session's
/// backend is (`revision`). An invitation link opens a confirmation sheet.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @State private var justJoined: String?

    private var activeBackend: (any MeroAppBackend)? { DemoMode.backend ?? session.backend }

    var body: some View {
        Group {
            if let backend = activeBackend {
                TrackerView(
                    backend: backend, applicationId: DemoMode.applicationId ?? session.applicationId, justJoined: $justJoined,
                    session: session, signOut: { Task { await session.signOut() } }
                )
                .id(session.revision)
            } else if session.isRestoring {
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.ground.ignoresSafeArea())
            } else {
                SignInView()
            }
        }
        .sheet(item: pendingInvitation) { link in
            JoinInvitationSheet(link: link.value, justJoined: $justJoined)
                .environmentObject(session)
        }
    }

    private var pendingInvitation: Binding<IdentifiedString?> {
        Binding(
            get: { activeBackend == nil ? nil : session.pendingInvitation.map(IdentifiedString.init) },
            set: { if $0 == nil { session.dismissPendingInvitation() } })
    }
}

struct IdentifiedString: Identifiable {
    let value: String
    var id: String { value }
}
