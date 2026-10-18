import Foundation
import MeroKit
import MeroKitUI

/// The signed-in account, delegated only: Calimero Cloud enrolment (the
/// wallet certifies this device's key), the account's relay from the Cloud
/// manager, and the ``ChatBackend`` built over that relay.
///
/// There is no node login and no node URL anywhere: ``MeroClient`` is only
/// ever driven through its Cloud entry points (`signInWithCloud`,
/// `restoreCloudSession`, `handleEnrolmentCallback`, `logout`).
@MainActor
final class SessionModel: ObservableObject {
    let client: MeroClient

    @Published private(set) var backend: DelegatedChatBackend?
    /// Bumped whenever ``backend`` is rebuilt, so screens re-read.
    @Published private(set) var revision = 0
    @Published private(set) var isRestoring = false
    /// An invitation link that arrived (deep link) and waits to be redeemed.
    @Published var pendingInvitation: String?
    /// The name this account registers in the channels it joins or creates
    /// (`set_profile`). Kept on the device, like the web app's `chat-username`.
    @Published var displayName: String {
        didSet { UserDefaults.standard.set(displayName, forKey: Self.displayNameKey) }
    }

    private static let displayNameKey = "chat-username"
    private var lastKey = ""

    init(client: MeroClient? = nil) {
        if let client {
            self.client = client
        } else {
            let cloud = CloudSignIn.keychain(
                config: CloudConfig(walletURL: AppConfig.walletURL, cloudBaseURL: AppConfig.cloudBaseURL),
                service: AppConfig.keychainService)
            self.client = MeroClient(
                cloud: cloud,
                config: MeroProviderConfig(
                    packageName: ChatConstants.packageName, registryURL: AppConfig.registryURL,
                    cloudBaseURL: AppConfig.cloudBaseURL))
        }
        displayName = UserDefaults.standard.string(forKey: Self.displayNameKey) ?? ""
    }

    var isSignedIn: Bool { client.isAuthenticated }
    var account: String? { client.account }
    /// Chat's registry-derived application id, once resolved.
    var applicationId: String? { client.applicationId }

    /// Reconnect the stored Cloud session, if there is one. A session that had
    /// no relay asks the Cloud manager again first: joining elsewhere may have
    /// earned the account one.
    func restore() async {
        isRestoring = true
        defer { isRestoring = false }
        if let stored = await client.cloudSignIn.restoreSession(), stored.isRelayless {
            _ = try? await client.cloudSignIn.refreshRelay()
        }
        _ = await client.restoreCloudSession()
        rebuild()
    }

    func signIn() async {
        await client.signInWithCloud(callback: AppConfig.callback)
        rebuild()
    }

    func signOut() async {
        await client.logout()
        rebuild()
    }

    /// A URL the system handed the app: a wallet callback that finishes a
    /// sign-in, or an invitation link.
    func handle(_ url: URL) async {
        if await client.handleEnrolmentCallback(url) {
            rebuild()
            return
        }
        if ChatInvitation.parse(url.absoluteString) != nil {
            pendingInvitation = url.absoluteString
        }
    }

    /// After redeeming an invitation: a session that had no relay now has the
    /// admitting one, so reconnect to it.
    func didJoinWorkspace() async {
        guard backend?.hasRelay != true else { return }
        _ = await client.restoreCloudSession()
        rebuild()
    }

    /// Rebuild the backend from the client's current session. A no-op when
    /// nothing about the session changed, so open screens are not reset.
    func rebuild() {
        let connection = client.isAuthenticated && client.isDelegated ? client.connection : nil
        let account: String = connection?.session.account ?? "-"
        let relay: String = connection?.session.relayUrl ?? "-"
        let hasSession: Bool = connection?.mero != nil
        let hasAdmin: Bool = client.admin != nil
        let key = "\(client.sessionRevision)|\(account)|\(relay)|\(hasSession)|\(hasAdmin)"
        guard key != lastKey else { return }
        lastKey = key
        if let connection, let admin = client.admin {
            backend = DelegatedChatBackend(connection: connection, admin: admin, signIn: client.cloudSignIn)
        } else {
            backend = nil
        }
        revision += 1
    }
}
