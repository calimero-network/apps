import BattleshipsCore
import MeroKit
import MeroKitUI
import Security
import SwiftUI

/// Where sign-in goes, from Info.plist (empty = the SDK's defaults).
enum AppConfig {
    static var callback: CloudCallback { .scheme(string("BattleshipsCallbackScheme") ?? "battleships") }

    static var config: MeroProviderConfig {
        MeroProviderConfig(
            packageName: Battleships.packageName,
            registryURL: string("MeroRegistryURL"),
            cloudBaseURL: string("MeroCloudBaseURL").flatMap(URL.init(string:)))
    }

    static var walletURL: URL? { string("MeroWalletURL").flatMap(URL.init(string:)) }

    private static func string(_ key: String) -> String? {
        let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces)
        return value?.isEmpty == false ? value : nil
    }
}

@main
struct BattleshipsApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: Battleships.packageName, callback: AppConfig.callback, config: AppConfig.config,
        walletURL: AppConfig.walletURL, keychainService: "network.calimero.battleships")

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.light)
                .tint(Palette.ink)
                .task { if !DemoMode.isOn { await session.restore() } }
                .onOpenURL { url in Task { await session.handle(url) } }
        }
    }
}

/// Where the stack can go: a lobby, or a match in one.
enum Route: Hashable {
    case lobby(AppNamespace)
    case match(MatchRoute)
}

/// A match, who you are in it, and its lobby (for a rematch).
struct MatchRoute: Hashable {
    let ref: MatchRef
    let me: String
    let lobby: AppNamespace
}

/// Signed out: the sign-in screen. Signed in: the lobbies, and everything under them.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @StateObject private var invitation = InvitationModel()
    @State private var path = NavigationPath()
    private let store: any BoardStore = DemoMode.boardStore ?? KeychainBoardStore()

    /// The demo account's backend in demo mode (Debug, `-MeroDemo YES`), else the session's.
    private var activeBackend: (any MeroAppBackend)? { DemoMode.backend ?? session.backend }

    private var applicationId: String? { DemoMode.applicationId ?? session.applicationId }

    var body: some View {
        Group {
            if session.isRestoring && activeBackend == nil {
                ProgressView().tint(Palette.ink).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.ground)
            } else if let backend = activeBackend {
                let game = battleshipsBackend(backend)
                NavigationStack(path: $path) {
                    LobbiesScreen(
                        backend: game, applicationId: applicationId,
                        openInvitation: { invitation.open($0) }, open: { path.append(Route.lobby($0)) }
                    )
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case .lobby(let lobby):
                            LobbyScreen(backend: game, lobby: lobby) { path.append(Route.match($0)) }
                        case .match(let match):
                            MatchScreen(backend: game, route: match, store: store) { next in
                                path.removeLast()
                                path.append(Route.match(next))
                            }
                        }
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
            InvitationSheet(model: invitation) { namespaceId, title in
                var next = NavigationPath()
                next.append(Route.lobby(AppNamespace(id: namespaceId, name: title, applicationId: applicationId ?? "")))
                path = next
            }
            .environmentObject(session)
            .presentationDetents([.medium])
            .interactiveDismissDisabled(isJoining)
        }
    }

    /// The bundle's two services need the admin's `serviceName`, which the SDK's backend exposes
    /// as `DelegatedAppBackend.admin`.
    private func battleshipsBackend(_ backend: any MeroAppBackend) -> any BattleshipsBackend {
        if let delegated = backend as? DelegatedAppBackend {
            return AdminBattleshipsBackend(app: delegated, admin: delegated.admin)
        }
        return PlainBackend(app: backend)
    }

    private var invitedTitle: String? {
        if case .confirm(let title) = invitation.stage { return title }
        return nil
    }

    private var isJoining: Bool {
        if case .joining = invitation.stage { return true }
        return false
    }

    private var invitationShown: Binding<Bool> {
        Binding(
            get: { invitation.stage != .idle && activeBackend != nil },
            set: { if !$0 { invitation.reset() } })
    }
}

/// A backend with no admin to name services through: contexts are created with the bundle's
/// default service, and none reports one.
private struct PlainBackend: BattleshipsBackend {
    let app: any MeroAppBackend

    func createServiceContext(
        groupId: String, applicationId: String, service: String, name: String, initArgs: JSONValue
    ) async throws -> String {
        try await app.createContext(groupId: groupId, applicationId: applicationId, name: name, initArgs: initArgs)
    }

    func serviceName(contextId: String) async throws -> String? { nil }
}

/// Boards in the Keychain: this device only, never synced or backed up, readable after the first
/// unlock (an answer to a shot may be due while the phone is locked in a pocket).
final class KeychainBoardStore: BoardStore, @unchecked Sendable {
    private let service = "network.calimero.battleships.boards"

    func load(owner: String, matchId: String) -> StoredBoard? {
        var query = base(owner: owner, matchId: matchId)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(StoredBoard.self, from: data)
    }

    func save(_ board: StoredBoard, owner: String, matchId: String) -> Bool {
        guard let data = try? JSONEncoder().encode(board) else { return false }
        let query = base(owner: owner, matchId: matchId)
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    func clear(owner: String, matchId: String) {
        SecItemDelete(base(owner: owner, matchId: matchId) as CFDictionary)
    }

    private func base(owner: String, matchId: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: Self.key(owner: owner, matchId: matchId),
        ]
    }
}
