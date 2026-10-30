import BattleshipsCore
import MeroKit
import MeroKitUI
import Security
import SwiftUI

/// Which cluster the app talks to, from Info.plist (see ../README.md).
enum AppConfig {
    /// Where the node's consent page sends the person back (`battleships://consent`).
    static var callback: CloudCallback {
        .scheme(CloudSettings.string("BattleshipsCallbackScheme") ?? "battleships", path: "consent")
    }

    /// The package, and the Cloud cluster's node when one is configured (`MeroNodeURL`).
    /// Without one the sign-in screen asks for it, or for a development node.
    static var config: MeroProviderConfig {
        MeroProviderConfig(nodeURL: CloudSettings.clusterURL, packageName: Battleships.packageName)
    }
}

@main
struct BattleshipsApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: Battleships.packageName, callback: AppConfig.callback, config: AppConfig.config,
        keychainService: "network.calimero.battleships")

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

    /// The package's two services: instances are created per service and tagged with it. On a
    /// Calimero 1.0 cluster the node's app record (and the tag in its metadata) says which is which.
    private func battleshipsBackend(_ backend: any MeroAppBackend) -> any BattleshipsBackend {
        guard let cloud = backend as? CalimeroAppBackend else { return ServiceBattleshipsBackend(app: backend) }
        let client = cloud.client
        return ServiceBattleshipsBackend(
            app: cloud,
            tagService: { id, name, service in
                var metadata = try await client.getApp(id)["metadata"]?.objectValue ?? [:]
                metadata["name"] = .string(name)
                metadata["service"] = .string(service)
                try await client.setAppMetadata(id, .object(metadata))
            },
            readService: { id in
                let app = try await client.getApp(id)
                return app["service"]?.stringValue ?? app["metadata"]?["service"]?.stringValue
            })
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
