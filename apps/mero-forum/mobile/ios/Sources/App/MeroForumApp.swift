import ForumCore
import MeroKit
import MeroKitUI
import SwiftUI

/// Where sign-in goes, from Info.plist (empty = the SDK's defaults).
enum AppConfig {
    static var callback: CloudCallback { .scheme(string("MeroForumCallbackScheme") ?? "mero-forum") }

    static var config: MeroProviderConfig {
        MeroProviderConfig(
            packageName: ForumConstants.packageName,
            registryURL: string("MeroRegistryURL"),
            cloudBaseURL: string("MeroCloudBaseURL").flatMap(URL.init(string:)))
    }

    static var walletURL: URL? { string("MeroWalletURL").flatMap(URL.init(string:)) }

    private static func string(_ key: String) -> String? {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces).nilIfBlank
    }
}

extension String {
    var nilIfBlank: String? { isEmpty ? nil : self }
}

@main
struct MeroForumApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: ForumConstants.packageName, callback: AppConfig.callback, config: AppConfig.config,
        walletURL: AppConfig.walletURL, keychainService: "network.calimero.forum")

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.light)
                .tint(Palette.ink)
                .task { await session.restore() }
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Signed out: the sign-in screen. Signed in: the spaces, and everything under them.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @StateObject private var invitation = InvitationModel()
    @State private var path = NavigationPath()
    private let names = DefaultsNameStore()

    var body: some View {
        Group {
            if session.isRestoring && session.backend == nil {
                ProgressView().tint(Palette.ink).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.ground)
            } else if let backend = session.backend {
                NavigationStack(path: $path) {
                    SpacesScreen(backend: backend, openInvitation: { invitation.open($0) })
                        .navigationDestination(for: AppNamespace.self) { space in
                            ForumsScreen(
                                backend: backend, space: space,
                                applicationId: session.applicationId ?? space.applicationId
                            ) { path.append($0) }
                        }
                        .navigationDestination(for: ForumRef.self) { forum in
                            FeedScreen(backend: backend, forum: forum, names: names) { path.append($0) }
                        }
                }
                .id(session.revision)
            } else {
                SignInView(invitedTo: invitedTitle)
            }
        }
        .onChange(of: session.pendingInvitation) { raw in
            guard let raw else { return }
            invitation.open(raw)
            session.dismissPendingInvitation()
        }
        .sheet(isPresented: invitationShown) {
            InvitationSheet(model: invitation) { destination in
                var next = NavigationPath()
                if let space = destination.space { next.append(space) }
                if let forum = destination.forum { next.append(forum) }
                path = next
            }
            .environmentObject(session)
            .presentationDetents([.medium])
            .interactiveDismissDisabled(isJoining)
        }
    }

    /// Signed out with an invitation waiting: the sign-in screen says so.
    private var invitedTitle: String? {
        if case .confirm(let title, _) = invitation.stage { return title }
        return nil
    }

    private var isJoining: Bool {
        if case .joining = invitation.stage { return true }
        return false
    }

    private var invitationShown: Binding<Bool> {
        Binding(
            get: { invitation.stage != .idle && session.backend != nil },
            set: { if !$0 { invitation.reset() } })
    }
}

extension InvitationDestination {
    var space: AppNamespace? {
        AppNamespace(id: namespaceId, name: spaceName, applicationId: "")
    }
}
