import MeroKit
import MeroKitUI
import PassCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Where sign-in goes, from Info.plist (empty = the SDK's defaults).
enum AppConfig {
    static var callback: CloudCallback { .scheme(string("MeroPassCallbackScheme") ?? "mero-pass") }

    static var config: MeroProviderConfig {
        MeroProviderConfig(
            packageName: PassConstants.packageName,
            registryURL: string("MeroRegistryURL"),
            cloudBaseURL: string("MeroCloudBaseURL").flatMap(URL.init(string:)))
    }

    static var walletURL: URL? { string("MeroWalletURL").flatMap(URL.init(string:)) }

    private static func string(_ key: String) -> String? {
        let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces)
        return value?.isEmpty == false ? value : nil
    }
}

/// What every screen shares: the device key, preferences, the toast, and the
/// label this phone registers its key under.
@MainActor
final class AppServices: ObservableObject {
    let keeper = DeviceKeeper(store: KeychainDeviceKeyStore())
    let preferences = DefaultsPreferences()
    @Published var toast: String?
    let deviceLabel = UIDevice.current.model == "iPad" ? "iPad" : "iPhone"

    private var toastTask: Task<Void, Never>?

    func show(_ text: String) {
        toast = text
        toastTask?.cancel()
        toastTask = Task {
            try? await Task.sleep(for: .seconds(2.5))
            if !Task.isCancelled { toast = nil }
        }
    }

    /// Copy a secret so it leaves the clipboard on its own: an expiring,
    /// this-device-only pasteboard item (never Universal Clipboard).
    func copySecret(_ value: String, what: String) {
        UIPasteboard.general.setItems(
            [[UTType.plainText.identifier: value]],
            options: [
                .expirationDate: Date().addingTimeInterval(TimeInterval(PassConstants.clipboardSeconds)),
                .localOnly: true,
            ])
        Haptics.tap()
        show("\(what) copied. Clears in \(PassConstants.clipboardSeconds)s.")
    }
}

@main
struct MeroPassApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: PassConstants.packageName, callback: AppConfig.callback, config: AppConfig.config,
        walletURL: AppConfig.walletURL, keychainService: "network.calimero.pass")
    @StateObject private var services = AppServices()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(services)
                .environmentObject(services.keeper)
                .preferredColorScheme(.light)
                .tint(Palette.ink)
                .task { await session.restore() }
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Signed out: sign in. Signed in but locked: unlock. Then the tabs.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @EnvironmentObject private var services: AppServices
    @EnvironmentObject private var keeper: DeviceKeeper
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var invitation = InvitationModel()
    @State private var backgroundedAt: Date?
    @State private var vaultPath = NavigationPath()
    @State private var tab = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                if session.isRestoring && session.backend == nil {
                    ProgressView().tint(Palette.ink).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Palette.ground)
                } else if let backend = session.backend {
                    if keeper.isUnlocked {
                        MainTabs(backend: backend, path: $vaultPath, tab: $tab, openInvitation: { invitation.open($0) })
                            .id("\(session.revision)-\(keeper.generation)")
                    } else {
                        LockScreen()
                    }
                } else {
                    SignInView(invitedTo: invitedTitle)
                }
            }
            if let toast = services.toast {
                Text(toast)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Palette.ink))
                    .padding(.bottom, 90)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            // The app switcher's snapshot shows nothing of the vault.
            if scenePhase != .active && keeper.isUnlocked {
                PrivacyCover()
            }
        }
        .animation(.easeOut(duration: 0.2), value: services.toast)
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .background:
                backgroundedAt = Date()
            case .active:
                if let at = backgroundedAt,
                    Date().timeIntervalSince(at) >= TimeInterval(services.preferences.autoLockMinutes * 60)
                {
                    keeper.lock()
                }
                backgroundedAt = nil
            default:
                break
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
                next.append(TeamRow(id: destination.namespaceId, name: destination.teamName, memberCount: 0, vaultCount: 0))
                if let vault = destination.vault { next.append(vault) }
                tab = 0
                vaultPath = next
            }
            .environmentObject(session)
            .presentationDetents([.medium])
            .interactiveDismissDisabled(isJoining)
        }
    }

    private var invitedTitle: String? {
        if case .confirm(let title, _, _) = invitation.stage { return title }
        return nil
    }

    private var isJoining: Bool {
        if case .joining = invitation.stage { return true }
        return false
    }

    private var invitationShown: Binding<Bool> {
        Binding(
            get: { invitation.stage != .idle && session.backend != nil && keeper.isUnlocked },
            set: { if !$0 { invitation.reset() } })
    }
}

struct PrivacyCover: View {
    var body: some View {
        ZStack {
            Palette.ground.ignoresSafeArea()
            Image(systemName: "lock.fill")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 72, height: 72)
                .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Palette.lime))
        }
    }
}

/// Vaults and Security.
struct MainTabs: View {
    let backend: any MeroAppBackend
    @Binding var path: NavigationPath
    @Binding var tab: Int
    let openInvitation: (String) -> Void
    @EnvironmentObject private var session: MeroAppSession

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack(path: $path) {
                TeamsScreen(backend: backend, openInvitation: openInvitation)
                    .navigationDestination(for: TeamRow.self) { team in
                        TeamScreen(
                            backend: backend, team: team,
                            applicationId: session.applicationId ?? ""
                        ) { path.append($0) }
                    }
                    .navigationDestination(for: VaultRef.self) { ref in
                        VaultScreen(backend: backend, ref: ref) { path.append($0) }
                    }
            }
            .tabItem { Label("Vaults", systemImage: "lock.rectangle.stack") }
            .tag(0)

            NavigationStack {
                SecurityScreen(backend: backend)
            }
            .tabItem { Label("Security", systemImage: "checkmark.shield") }
            .tag(1)
        }
    }
}
