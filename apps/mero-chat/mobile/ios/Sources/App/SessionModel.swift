import Foundation
import MeroKit
import MeroKitUI

#if canImport(Combine)
import Combine
#endif

/// The signed-in account on a Calimero 1.0 cluster: passkey sign-in through
/// MeroKitUI's ``MeroClient`` (Calimero Cloud, or a development node with mock
/// attestation), and the ``ChatBackend`` built over the SDK's
/// `CalimeroAppBackend` (orgs, teams, app instances, sealed `/views` and
/// `/intents`).
@MainActor
final class SessionModel: ObservableObject {
    let client: MeroClient

    @Published private(set) var backend: CloudChatBackend?
    /// What waits for this person's approval (consent page in the system browser).
    private(set) lazy var approvals = ApprovalsModel(
        packageName: ChatConstants.packageName, appName: "Mero Chat",
        fetch: { [weak self] org in
            guard let self else { throw CancellationError() }
            return try await self.pendingApprovals(org: org)
        },
        consent: { [weak self] request, confirm in await self?.requestConsent(request, confirm: confirm) })
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
    #if canImport(Combine)
    private var watching: AnyCancellable?
    #endif

    init(client: MeroClient? = nil) {
        self.client =
            client
            ?? MeroClient(
                config: AppConfig.providerConfig,
                store: KeychainCloudSessionStore(service: AppConfig.keychainService))
        displayName = UserDefaults.standard.string(forKey: Self.displayNameKey) ?? ""
        #if canImport(Combine)
        watching = self.client.objectWillChange.sink { [weak self] _ in
            Task { @MainActor in self?.rebuild() }
        }
        #endif
    }

    var isSignedIn: Bool { client.isAuthenticated }
    var account: String? { client.account }
    /// Chat's package: what a workspace (org) is founded for and a channel's
    /// app instance created from.
    var applicationId: String? { client.config.packageName }
    /// The node the session talks to.
    var nodeURL: String? { client.nodeURL }
    /// Whether that node is a development one (mock attestation allowed).
    var isDevelopment: Bool { client.allowMock }

    /// Reconnect the stored session (refresh token in the Keychain), if there is one.
    func restore() async {
        isRestoring = true
        defer { isRestoring = false }
        _ = await client.restore()
        rebuild()
    }

    /// Talk to `nodeURL` from now on: a Calimero Cloud cluster, or with
    /// `allowMock` a development node (`merod local`).
    func connect(nodeURL: String, allowMock: Bool) {
        client.connect(nodeURL: nodeURL, allowMock: allowMock)
        rebuild()
    }

    /// Sign in on Calimero Cloud through Mero Chat's served page, where the
    /// person signs in or creates an account with their passkey, as on the web.
    func signInWithServedPage() async {
        _ = await client.signInWithServedPage(cluster: AppConfig.cluster, callback: AppConfig.signInCallback)
        rebuild()
    }

    /// Sign in with the device's passkey (a development node: the soft one kept for it).
    func signIn() async {
        _ = await client.signIn()
        rebuild()
    }

    /// Create an account named `name` with a new passkey. On a real cluster
    /// the node then asks the new passkey to sign the account (`412
    /// CONFIRM_REQUIRED`): that second prompt waits for ``confirmSignUp()``
    /// (``awaitingSignUpConfirm``), a tap of its own. A development node's
    /// software passkey answers both at once.
    func signUp(name: String) async {
        var passkey = client.passkeyForNode()
        if let base = passkey, !client.allowMock {
            passkey = SignUpPasskey(base: base) { [weak self] in
                guard let self else { throw PasskeyCancelled() }
                try await self.waitForConfirmTap()
            }
        }
        _ = await client.signUp(name: name, passkey: passkey)
        finishConfirm(throwing: PasskeyCancelled())
        rebuild()
    }

    /// The passkey was made; the account waits for the person to tap "Confirm".
    @Published private(set) var awaitingSignUpConfirm = false
    private var confirmTap: CheckedContinuation<Void, Error>?

    /// The tap that starts the sign-up's second passkey prompt.
    func confirmSignUp() { finishConfirm(throwing: nil) }

    /// Back out of the sign-up at its second prompt.
    func cancelSignUp() { finishConfirm(throwing: PasskeyCancelled()) }

    private func waitForConfirmTap() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            confirmTap?.resume(throwing: PasskeyCancelled())
            confirmTap = continuation
            awaitingSignUpConfirm = true
        }
    }

    private func finishConfirm(throwing error: Error?) {
        awaitingSignUpConfirm = false
        guard let tap = confirmTap else { return }
        confirmTap = nil
        if let error { tap.resume(throwing: error) } else { tap.resume() }
    }

    /// A development node: sign in with the soft passkey kept for it, or
    /// create the account on first use.
    func signInOrSignUp(name: String?) async {
        _ = await client.signInOrSignUp(name: name)
        rebuild()
    }

    func signOut() async {
        await client.logout()
        rebuild()
    }

    /// A URL the system handed the app: an invitation link, or the node's
    /// consent page sending the person back (nothing to do: the approval
    /// sheet reads the result itself).
    func handle(_ url: URL) async {
        if consentReturn(url) != nil { return }
        if ChatInvitation.parse(url.absoluteString) != nil {
            pendingInvitation = url.absoluteString
        }
    }

    /// After redeeming an invitation: re-read what the account sees.
    func didJoinWorkspace() async {
        revision += 1
    }

    // MARK: Approvals

    /// What waits for this person's approval in `org` (or their own apps).
    func pendingApprovals(org: String?) async throws -> PendingApprovals {
        guard let cloud = client.cloud else { throw AccountError.notSignedIn("sign in first") }
        return try await cloud.pendingApprovals(org: org)
    }

    /// Open the node's consent page in the system browser; the decision.
    /// `confirm` runs first, with the node's answer: the screen shows its confirmation code.
    func requestConsent(
        _ request: @escaping (String) -> ConsentRequest, confirm: @escaping @MainActor (ConsentStarted) async -> Bool
    ) async -> ConsentResult? {
        await client.requestConsent(request, callback: AppConfig.callback, confirm: confirm)
    }

    /// Talk to what the Calimero Cloud field names: a cluster by name (its
    /// nodes from the node directory) or a node by URL. `false`, with the
    /// reason in the client's error, when it can't.
    func connectCloud(_ input: String) async -> Bool {
        switch ClusterTarget.parse(input) {
        case .url(let url)?:
            connect(nodeURL: url, allowMock: false)
            return true
        case .name(let name)?:
            let ok = await client.connect(cluster: name)
            rebuild()
            return ok
        case nil:
            client.errorMessage = "Enter the cluster's name or a node address."
            return false
        }
    }

    /// Rebuild the backend from the client's current session. A no-op when
    /// nothing about the session changed, so open screens are not reset.
    func rebuild() {
        let key = [
            "\(client.sessionRevision)", client.account ?? "-", client.nodeURL ?? "-",
            client.cloud == nil ? "0" : "1",
        ].joined(separator: "|")
        guard key != lastKey else { return }
        lastKey = key
        if let cloud = client.cloud, let account = client.account {
            let app = CalimeroAppBackend(
                client: cloud, account: account, packageName: ChatConstants.packageName,
                packageVersion: client.config.packageVersion, passkey: client.passkeyForNode())
            backend = CloudChatBackend(
                app: app,
                privateTeams: { org in
                    guard let info = try? await cloud.getOrg(org) else { return [] }
                    return Set(info.teams.values.filter { $0.join == .invite }.map { teamGroupId(org: org, team: $0.teamId) })
                })
        } else {
            backend = nil
        }
        revision += 1
    }
}
