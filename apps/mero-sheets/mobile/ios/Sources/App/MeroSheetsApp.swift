import SheetsCore
import MeroKitUI
import SwiftUI

@main
struct MeroSheetsApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: MeroSheets.packageName, callback: AppConfig.callback, config: AppConfig.providerConfig,
        keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.light)
                .tint(Theme.ink)
                .task { await session.restore() }
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Signed out → sign-in; signed in → the app, rebuilt when the session's
/// backend is (`revision`). An invitation link opens a confirmation sheet.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @State private var justJoined: JoinedWorkspace?

    var body: some View {
        Group {
            if let backend = session.backend {
                SheetsView(
                    backend: backend, applicationId: session.applicationId, justJoined: $justJoined,
                    signOut: { Task { await session.signOut() } }
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
            get: { session.backend == nil ? nil : session.pendingInvitation.map(IdentifiedString.init) },
            set: { if $0 == nil { session.dismissPendingInvitation() } })
    }
}

/// A workspace joined from an invitation, and the spreadsheet the link named.
struct JoinedWorkspace: Equatable {
    let namespaceId: String
    let contextId: String?
}

struct IdentifiedString: Identifiable {
    let value: String
    var id: String { value }
}

struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 18) {
                Image(systemName: "tablecells")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 76, height: 76)
                    .background(Theme.lime, in: RoundedRectangle(cornerRadius: 22))
                Text("Mero Sheets").font(Theme.heading(28)).foregroundStyle(Theme.ink)
                Text("Collaborative spreadsheets for your team. Open your team\u{2019}s sheets, read the numbers and charts, and update a value on the go.")
                    .font(.system(size: 16)).foregroundStyle(Theme.text2).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)
            Spacer()
            VStack(spacing: 12) {
                CloudSignInPanel(style: .app)
                Text("Your spreadsheets live with your team on its Calimero cluster, not on a vendor's server.")
                    .font(.system(size: 13)).foregroundStyle(Theme.text3).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.ground.ignoresSafeArea())
    }
}
