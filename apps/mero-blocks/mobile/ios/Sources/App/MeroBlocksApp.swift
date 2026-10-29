import BlocksCore
import MeroKit
import MeroKitUI
import SwiftUI
import UIKit

@main
struct MeroBlocksApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var session = MeroAppSession(
        packageName: BlocksConstants.packageName, callback: AppConfig.callback, config: AppConfig.config,
        walletURL: AppConfig.walletURL, keychainService: AppConfig.keychainService)
    @StateObject private var settings = PlayerSettings()

    var body: some Scene {
        WindowGroup {
            RootView(session: session, client: session.client, settings: settings)
                .preferredColorScheme(.light)
                .tint(Theme.ink)
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Restoring → a splash. Signed out → sign-in. Signed in → the worlds, and the game over them.
struct RootView: View {
    @ObservedObject var session: MeroAppSession
    @ObservedObject var client: MeroClient
    @ObservedObject var settings: PlayerSettings
    @State private var didRestore = false
    /// Kept here, above the per-session views, so a join that rebuilds the session keeps the
    /// world it opened.
    @State private var playing: WorldRef?
    @State private var joining: BlocksInvitation?

    var body: some View {
        Group {
            if !didRestore || session.isRestoring {
                Splash(text: "Restoring your session…")
            } else if !session.isSignedIn {
                SignInView(session: session, client: client, invited: session.pendingInvitation != nil)
            } else if let backend = session.backend {
                NavigationStack {
                    WorldsScreen(
                        backend: backend, applicationId: session.applicationId, account: session.account ?? "",
                        settings: settings,
                        onOpen: { playing = $0 }, onJoin: { joining = $0 },
                        onSignOut: { Task { await session.signOut() } }
                    )
                    .id(session.revision)
                }
            } else {
                Splash(text: "Connecting to your relay…") {
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
                guard let backend = session.backend else { throw BlocksError.noRelay }
                let worlds = WorldsModel(backend: backend, applicationId: session.applicationId)
                let ref = try await worlds.join(invitation) { await session.didJoinNamespace() }
                playing = ref
            }
        }
        .fullScreenCover(item: $playing) { world in
            if let backend = session.backend {
                GameScreen(
                    backend: backend, world: world,
                    myId: client.delegatedSession?.keys.signPublicKey ?? "",
                    settings: settings
                ) { playing = nil }
            }
        }
    }

    /// An invitation link the system handed the app is asked about once signed in.
    private func pickUpInvitation() {
        guard didRestore, session.isSignedIn, let link = session.pendingInvitation else { return }
        session.dismissPendingInvitation()
        joining = BlocksInvitation.parse(link)
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

/// The shell is portrait; the game asks for landscape while it is on screen.
final class AppDelegate: NSObject, UIApplicationDelegate {
    static var orientations: UIInterfaceOrientationMask = .portrait

    func application(
        _ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        UIDevice.current.userInterfaceIdiom == .pad ? .all : Self.orientations
    }

    /// Switch the allowed orientations and rotate to them now.
    static func lock(_ mask: UIInterfaceOrientationMask) {
        orientations = mask
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            var controller = scene.windows.first?.rootViewController
            while let current = controller {
                current.setNeedsUpdateOfSupportedInterfaceOrientations()
                controller = current.presentedViewController
            }
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
        }
    }
}
