import MeroKit
import MeroKitUI
import Security
import SwiftUI
import VoteCore

/// The app's voting-group reference, not MeroKit's (an org/team id) of the same name.
typealias GroupRef = VoteCore.GroupRef

/// Which Calimero 1.0 cluster the app talks to, from Info.plist: `MeroNodeURL` (a node of
/// your Cloud cluster; empty = the sign-in screen asks) and `MeroDevNodeURL`. See ../README.md.
enum AppConfig {
    /// Where the node's consent page returns (`mero-vote://consent`).
    static var callback: CloudCallback {
        .scheme(CloudSettings.string("MeroVoteCallbackScheme") ?? "mero-vote", path: "consent")
    }

    static var config: MeroProviderConfig {
        MeroProviderConfig(nodeURL: CloudSettings.clusterURL, packageName: VoteConstants.packageName)
    }
}

@main
struct MeroVoteApp: App {
    @StateObject private var session = MeroAppSession(
        packageName: VoteConstants.packageName, callback: AppConfig.callback, config: AppConfig.config,
        keychainService: "network.calimero.vote")

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

/// Signed out: the sign-in screen. Signed in: the voting groups, and everything under them.
struct RootView: View {
    @EnvironmentObject private var session: MeroAppSession
    @StateObject private var invitation = InvitationModel()
    @State private var path = NavigationPath()
    private let keys = KeychainTrusteeKeyStore()

    var body: some View {
        Group {
            if session.isRestoring && session.backend == nil {
                ProgressView().tint(Palette.ink).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.ground)
            } else if let backend = session.backend {
                NavigationStack(path: $path) {
                    GroupsScreen(
                        backend: backend, applicationId: session.applicationId ?? "",
                        openInvitation: { invitation.open($0) }, open: { path.append($0) }
                    )
                    .navigationDestination(for: GroupRef.self) { group in
                        GroupScreen(backend: backend, group: group) { path.append($0) }
                    }
                    .navigationDestination(for: PollRoute.self) { route in
                        PollScreen(backend: backend, route: route, keys: keys)
                    }
                }
                .id(session.revision)
            } else {
                SignInView(invited: invitation.stage == .confirm)
            }
        }
        .onChange(of: session.pendingInvitation) { raw in
            guard let raw else { return }
            invitation.open(raw)
            session.dismissPendingInvitation()
        }
        .sheet(isPresented: invitationShown) {
            InvitationSheet(model: invitation) { group in
                var next = NavigationPath()
                next.append(group)
                path = next
            }
            .environmentObject(session)
            .presentationDetents([.medium])
            .interactiveDismissDisabled(invitation.stage == .joining)
        }
    }

    private var invitationShown: Binding<Bool> {
        Binding(
            get: { invitation.stage != .idle && session.backend != nil },
            set: { if !$0 { invitation.reset() } })
    }
}

/// Join a voting group from a link: ask, join, then open it.
struct InvitationSheet: View {
    @EnvironmentObject private var session: MeroAppSession
    @ObservedObject var model: InvitationModel
    let open: (GroupRef) -> Void

    var body: some View {
        VStack(spacing: 18) {
            switch model.stage {
            case .idle:
                EmptyView()
            case .confirm:
                header(symbol: "envelope.open", tone: Palette.limeSoft, title: "Join this voting group?")
                Text(
                    "Joining makes your account a member of the workspace it lives in, and its polls and ballots sync to you from the other members."
                )
                .font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
                Button("Join") { accept() }.buttonStyle(PrimaryButtonStyle())
                Button("Not now") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            case .joining:
                ProgressView().tint(Palette.ink).controlSize(.large).padding(.top, 12)
                Text("Joining…").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                Text("This can take up to a minute when no other member is online.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
            case .joined(let group):
                header(symbol: "checkmark", tone: Palette.lime, title: "You're in")
                Text("The voting group opens next.").font(.system(size: 16)).foregroundStyle(Palette.muted)
                Spacer(minLength: 0)
                Button("Open") {
                    open(group)
                    model.reset()
                }
                .buttonStyle(PrimaryButtonStyle())
            case .failed(let message):
                header(symbol: "exclamationmark.triangle", tone: Palette.dangerSoft, title: "Couldn't join")
                Text(message).font(.system(size: 16)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                Spacer(minLength: 0)
                if model.invitation != nil {
                    Button("Try again") { accept() }.buttonStyle(PrimaryButtonStyle())
                }
                Button("Close") { model.reset() }.buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.surface)
    }

    private func header(symbol: String, tone: Color, title: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 60, height: 60)
                .background(Circle().fill(tone))
            Text(title).font(Typeface.display(22)).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
        }
        .padding(.top, 8)
    }

    private func accept() {
        Haptics.tap()
        Task {
            await model.accept(backend: { session.backend }, didJoin: { await session.didJoinNamespace() })
            if case .joined = model.stage { Haptics.success() } else { Haptics.failure() }
        }
    }
}

/// Trustee keys in the Keychain, this device only: the one secret that can
/// help decrypt anything never syncs anywhere (the web keeps it in localStorage).
final class KeychainTrusteeKeyStore: TrusteeKeyStore, @unchecked Sendable {
    private let service = "network.calimero.vote.trustee"

    func load(contextId: String, pollId: String, account: String) -> TrusteeKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: TrusteeKey.name(contextId: contextId, pollId: pollId, account: account),
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? TrusteeKey.parse(
            String(decoding: data, as: UTF8.self), contextId: contextId, pollId: pollId, account: account)
    }

    func save(_ key: TrusteeKey) -> Bool {
        let name = TrusteeKey.name(contextId: key.contextId, pollId: key.pollId, account: key.account)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: name,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(key.json().utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }
}
