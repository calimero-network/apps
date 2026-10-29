import IssueTrackerCore
import MeroKit
import MeroKitUI
import SwiftUI

@main
struct IssueTrackerApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: Tracker.packageName, callback: AppConfig.callback, config: AppConfig.providerConfig,
        walletURL: AppConfig.walletURL, keychainService: AppConfig.keychainService)

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.light)
                .tint(Theme.ink)
                .task { if !DemoMode.isOn { await session.restore() } }
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
            get: { activeBackend == nil ? nil : session.pendingInvitation.map(IdentifiedString.init) },
            set: { if $0 == nil { session.dismissPendingInvitation() } })
    }
}

struct IdentifiedString: Identifiable {
    let value: String
    var id: String { value }
}

struct SignInView: View {
    @EnvironmentObject private var session: MeroAppSession
    @State private var signingIn = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 18) {
                Image(systemName: "checklist")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 76, height: 76)
                    .background(Theme.lime, in: RoundedRectangle(cornerRadius: 22))
                Text("Mero Issue Tracker").font(Theme.heading(28)).foregroundStyle(Theme.ink)
                Text("A private, real-time issue board for a small engineering team. Create, triage and discuss issues together.")
                    .font(.system(size: 16)).foregroundStyle(Theme.text2).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)
            Spacer()
            VStack(spacing: 12) {
                if let error = session.client.errorMessage, !signingIn {
                    Text(error).font(.system(size: 14)).foregroundStyle(Theme.danger).multilineTextAlignment(.center)
                }
                Button {
                    Theme.haptic()
                    signingIn = true
                    Task {
                        await session.signIn()
                        signingIn = false
                    }
                } label: {
                    HStack(spacing: 8) {
                        if signingIn { ProgressView().tint(Theme.ink) }
                        Text(signingIn ? "Waiting for the wallet…" : "Sign in with Calimero")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(signingIn)
                Text("Your board lives with your team, not on a server. Sign-in approves this phone with your Calimero account.")
                    .font(.system(size: 13)).foregroundStyle(Theme.text3).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.ground.ignoresSafeArea())
    }
}
