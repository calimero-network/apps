import Combine
import Foundation
import MeroKit
import MeroKitUI

/// The space this phone last opened, remembered across launches.
public struct SpaceSelection: Codable, Equatable {
    /// The space's app instance.
    public var appId: String
    public var displayName: String
}

/// Persists the last ``SpaceSelection`` and the tracker this device shares as.
public struct SpacePreferences {
    private let defaults: UserDefaults
    private let key = "merotag.space.v2"
    private let sharingKey = "merotag.sharingTracker"

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var space: SpaceSelection? {
        get { defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(SpaceSelection.self, from: $0) } }
        nonmutating set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) {
                defaults.set(data, forKey: key)
            } else {
                defaults.removeObject(forKey: key)
            }
        }
    }

    public var sharingTrackerId: String? {
        get { defaults.string(forKey: sharingKey) }
        nonmutating set { defaults.set(newValue, forKey: sharingKey) }
    }
}

/// Session-level state.
///
/// Sign-in is a passkey on a Calimero 1.0 cluster: the person enters the
/// address of their cluster (from the Calimero Cloud console) and signs in,
/// or creates an account, with the phone's passkey. For development, a
/// `merod local` cluster is reached by its node URL with mock attestation
/// allowed; the SDK keeps a software passkey for it. Every call then goes to
/// the cluster over its sealed channel as that account.
@MainActor
public final class AppState: ObservableObject {
    public enum Phase: Equatable {
        /// Restoring a previous session at launch.
        case launching
        case signedOut
        /// Signed in; no space open yet.
        case choosingSpace
        case ready
    }

    /// The URL scheme invite deep links use (`merotag://join?invitation=…`).
    public static let urlScheme = "merotag"
    /// A `merod local` cluster's first node.
    public static let defaultDevNodeURL = "http://localhost:2501"

    @Published public private(set) var phase: Phase = .launching
    /// Why the last session ended, when the user did not end it.
    @Published public var sessionNotice: String?
    @Published public private(set) var spaceError: String?
    @Published public private(set) var isOpeningSpace = false
    @Published public private(set) var isCreatingSpace = false
    @Published public private(set) var isJoiningSpace = false
    /// An invite that arrived as a deep link, waiting to be accepted on the
    /// space screen. Kept through sign-in.
    @Published public var pendingInvite: String?
    /// A space this account is in that could not be reached (offline, the
    /// cluster briefly away). Offered back as "Try again" on the space
    /// screen, so a transient failure doesn't read as "you have no space".
    @Published public private(set) var unreachableSpace: SpaceSelection?
    @Published public private(set) var store: TrackerStore?
    @Published public private(set) var space: SpaceSelection?
    /// Who the caller is in the open space (org standing included).
    @Published public private(set) var me: Me?
    /// A newer release of Mero Tag the open space could run, if any.
    @Published public private(set) var availableUpdate: String?
    /// An update approval is waiting on the consent page.
    @Published public private(set) var isAwaitingApproval = false
    @Published public private(set) var updateMessage: String?
    /// The cluster address last used, prefilled on the sign-in screen.
    @Published public var lastClusterURL: String = UserDefaults.standard.string(forKey: "merotag.clusterURL") ?? ""
    /// The development node URL last used.
    @Published public var lastDevNodeURL: String =
        UserDefaults.standard.string(forKey: "merotag.devNodeURL")
        ?? ProcessInfo.processInfo.environment["MEROTAG_PREFILL_URL"] ?? AppState.defaultDevNodeURL

    public let client: MeroClient
    public let preferences: SpacePreferences
    private let makeTransport: @MainActor (MeroClient) -> (any ContextTransport)?
    private let makeDirectory: @MainActor (MeroClient) -> (any SpaceDirectory)?
    /// How often to retry reaching a space just created or joined: a new app
    /// instance or org membership can take a moment to apply on every node.
    var syncAttempts = 8
    var syncDelay: UInt64 = 1_500_000_000
    private var forward: AnyCancellable?
    private var approvalTask: Task<Void, Never>?
    /// Unit tests only: an account to act as without a cluster.
    private var accountForTesting: String?

    public init(
        client: MeroClient? = nil,
        preferences: SpacePreferences = SpacePreferences(),
        makeTransport: @escaping @MainActor (MeroClient) -> (any ContextTransport)? = { client in
            client.cloud.map { CloudTransport(client: $0) }
        },
        makeDirectory: @escaping @MainActor (MeroClient) -> (any SpaceDirectory)? = { client in
            client.cloud.map { CloudSpaces(client: $0, passkey: client.passkeyForNode()) }
        }
    ) {
        self.client =
            client
            ?? MeroClient(
                config: MeroProviderConfig(packageName: SpaceInvite.appSlug),
                store: KeychainCloudSessionStore(service: "network.calimero.merotag"))
        self.preferences = preferences
        self.makeTransport = makeTransport
        self.makeDirectory = makeDirectory
        self.space = preferences.space
        // Views observe AppState only; re-publish the client's changes.
        forward = self.client.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    // MARK: Account

    /// The signed-in account (64 hex), or `nil`.
    public var account: String? { accountForTesting ?? client.account }

    /// The cluster this session talks to.
    public var nodeURL: String? { client.nodeURL }

    /// Signed in to a development cluster (mock attestation).
    public var isDevelopmentCluster: Bool { client.allowMock }

    /// Reconnect a session from a previous launch.
    public func restore() async {
        guard phase == .launching else { return }
        let env = ProcessInfo.processInfo.environment
        if let url = env["MEROTAG_DEV_NODE"], !url.isEmpty {
            // Demo / UI-test hook: the same path as "Development cluster",
            // optionally straight into a space (MEROTAG_SPACE, MEROTAG_NAME).
            phase = .signedOut
            if let space = env["MEROTAG_SPACE"], !space.isEmpty {
                preferences.space = SpaceSelection(appId: space, displayName: env["MEROTAG_NAME"] ?? "dev")
            }
            await signInToDevCluster(url: url, name: env["MEROTAG_NAME"] ?? "dev")
            return
        }
        if await client.restore(), client.isAuthenticated {
            await didSignIn()
        } else {
            phase = .signedOut
        }
    }

    /// Sign in to the person's cluster with this phone's passkey.
    public func signIn(clusterURL: String) async {
        guard useCluster(clusterURL) != nil else { return }
        if await client.signIn() { await didSignIn() }
    }

    /// Create an account on the cluster with a new passkey on this phone.
    public func createAccount(clusterURL: String, name rawName: String) async {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            client.errorMessage = "Enter your name for the new account."
            return
        }
        guard useCluster(clusterURL) != nil else { return }
        if await client.signUp(name: name) { await didSignIn() }
    }

    /// "Development cluster": a `merod local` node, trusted with mock
    /// attestation, signed in with the software passkey the SDK keeps for it
    /// (an account is made on first use).
    public func signInToDevCluster(url rawURL: String, name: String) async {
        sessionNotice = nil
        client.errorMessage = nil
        guard let url = Self.validURL(rawURL, allowHTTP: true) else {
            client.errorMessage = "Enter a full node URL, like \(Self.defaultDevNodeURL)."
            return
        }
        lastDevNodeURL = url
        UserDefaults.standard.set(url, forKey: "merotag.devNodeURL")
        client.connect(nodeURL: url, allowMock: true)
        if await client.signInOrSignUp(name: name.isEmpty ? "dev" : name) { await didSignIn() }
    }

    /// Point the client at a production cluster; `nil` (with a message) when the address is unusable.
    private func useCluster(_ raw: String) -> String? {
        sessionNotice = nil
        client.errorMessage = nil
        guard let url = Self.validURL(raw, allowHTTP: false) else {
            client.errorMessage = "Enter your cluster's address from the Calimero Cloud console, like https://…"
            return nil
        }
        lastClusterURL = url
        UserDefaults.standard.set(url, forKey: "merotag.clusterURL")
        client.connect(nodeURL: url, allowMock: false)
        return url
    }

    /// `raw` as a node URL: https (or http when `allowHTTP`), with a host.
    static func validURL(_ raw: String, allowHTTP: Bool) -> String? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty, !text.contains("://") { text = (allowHTTP ? "http://" : "https://") + text }
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased(), url.host?.isEmpty == false,
            scheme == "https" || (allowHTTP && scheme == "http")
        else { return nil }
        return text.hasSuffix("/") ? String(text.dropLast()) : text
    }

    /// A URL delivered to the app (`onOpenURL`): an invite link
    /// (`merotag://join?invitation=…`, or the shareable https link when the
    /// OS routes it here).
    public func handleOpenURL(_ url: URL) async {
        if SpaceInvite.decode(deepLink: url) != nil {
            receiveInvite(url.absoluteString)
        }
    }

    /// Hold an invite until the person accepts it on the space screen. While
    /// signed out it waits for sign-in; with a space open, ``SpaceView``
    /// offers to switch.
    public func receiveInvite(_ raw: String) {
        pendingInvite = raw
        spaceError = nil
        unreachableSpace = nil
    }

    func didSignIn() async {
        sessionNotice = nil
        if pendingInvite != nil {
            // An invite is waiting: show it rather than reopening the last space.
            phase = .choosingSpace
        } else if let saved = preferences.space {
            await openSpace(appId: saved.appId, displayName: saved.displayName)
            if phase != .ready { phase = .choosingSpace }
        } else {
            phase = .choosingSpace
        }
    }

    // MARK: Space

    /// Open the space `appId` as the signed-in account and join it under `displayName`.
    public func openSpace(appId rawId: String, displayName rawName: String) async {
        await openSpace(appId: rawId, displayName: rawName, attempts: 1)
    }

    /// As ``openSpace(appId:displayName:)``, retrying the first read: a space
    /// just created or joined can take a moment to apply on every node.
    func openSpace(appId rawId: String, displayName rawName: String, attempts: Int) async {
        let appId = rawId.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        // The retry belongs to the error it came with: a new attempt drops both.
        spaceError = nil
        unreachableSpace = nil
        guard !appId.isEmpty else { spaceError = "Enter the space ID you were given."; return }
        guard !displayName.isEmpty else { spaceError = "Choose a name others will see."; return }
        guard account != nil else {
            phase = .signedOut
            return
        }
        guard let transport = makeTransport(client) else {
            spaceError = SpaceDirectoryError.notConnected.errorDescription
            return
        }

        isOpeningSpace = true
        defer { isOpeningSpace = false }

        // Reaching the space before switching screens: a mistyped ID should be
        // an inline error, not an empty map. `whoami` is that check, and tells
        // us our member id and org standing.
        var opened: MeroService?
        var lastError: Error?
        for attempt in 1...max(attempts, 1) {
            do {
                opened = try await MeroService.open(transport: transport, appId: appId)
                lastError = nil
                break
            } catch {
                if let reason = TrackerStore.sessionEndReason(error) { return sessionEnded(reason) }
                lastError = error
                if attempt < attempts { try? await Task.sleep(nanoseconds: syncDelay) }
            }
        }
        guard let service = opened else {
            let lastError = lastError ?? ContractError.unexpectedResponse(method: "whoami")
            if Self.isUnreachable(lastError) {
                unreachableSpace = SpaceSelection(appId: appId, displayName: displayName)
                spaceError = "Couldn't reach your space right now. It's still yours: try again in a moment. ("
                    + TrackerStore.message(for: lastError) + ")"
                return
            }
            spaceError = attempts > 1
                ? "The space isn't ready on your cluster yet. Try again in a moment. ("
                    + TrackerStore.message(for: lastError) + ")"
                : "Couldn't open that space. Check that your account is a member. ("
                    + TrackerStore.message(for: lastError) + ")"
            return
        }

        unreachableSpace = nil
        let store = TrackerStore(service: service)
        store.onSessionEnded = { [weak self] reason in self?.sessionEnded(reason) }
        let selection = SpaceSelection(appId: appId, displayName: displayName)
        preferences.space = selection
        self.space = selection
        self.me = try? await service.whoami()
        self.store = store
        phase = .ready
        await store.bootstrap(displayName: displayName)
        await checkForUpdate()
    }

    /// Retry the space that could not be reached.
    public func retryUnreachableSpace() async {
        guard let space = unreachableSpace else { return }
        await openSpace(appId: space.appId, displayName: space.displayName)
    }

    /// The request never got an answer, or the cluster couldn't serve it:
    /// nothing says the account isn't a member, so try again later.
    static func isUnreachable(_ error: Error) -> Bool {
        switch error {
        case is URLError, is UnavailableError, is WrongNode: return true
        default: return false
        }
    }

    /// Create a new space as this account and open it.
    public func createSpace(name rawName: String, displayName rawDisplay: String) async {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = rawDisplay.trimmingCharacters(in: .whitespacesAndNewlines)
        spaceError = nil
        unreachableSpace = nil
        guard !name.isEmpty else { spaceError = "Give the space a name."; return }
        guard !displayName.isEmpty else { spaceError = "Choose a name others will see."; return }
        guard account != nil else { phase = .signedOut; return }
        guard let directory = makeDirectory(client) else {
            spaceError = SpaceDirectoryError.notConnected.errorDescription
            return
        }

        isCreatingSpace = true
        defer { isCreatingSpace = false }
        let created: CreatedSpace
        do {
            created = try await directory.createSpace(named: name)
        } catch {
            if let reason = TrackerStore.sessionEndReason(error) { return sessionEnded(reason) }
            spaceError = "Couldn't create the space. (" + TrackerStore.message(for: error) + ")"
            return
        }
        await openSpace(appId: created.appId, displayName: displayName, attempts: syncAttempts)
    }

    /// Accept an invite (a link, a deep link or a bare token) and open the
    /// space it is for. A refused redeem is kept rather than thrown: an
    /// account that is already a member can still open the space, and only
    /// whether it then opens tells the two apart.
    public func joinSpace(invite raw: String, displayName rawDisplay: String) async {
        let displayName = rawDisplay.trimmingCharacters(in: .whitespacesAndNewlines)
        spaceError = nil
        unreachableSpace = nil
        guard let invite = SpaceInvite.decode(pasted: raw) else {
            spaceError = "That isn't a Mero Tag invite link. Ask the space's owner to send it again."
            return
        }
        guard !displayName.isEmpty else { spaceError = "Choose a name others will see."; return }
        guard account != nil else { phase = .signedOut; return }
        guard let directory = makeDirectory(client) else {
            spaceError = SpaceDirectoryError.notConnected.errorDescription
            return
        }

        isJoiningSpace = true
        defer { isJoiningSpace = false }
        var refusal: Error?
        do {
            try await directory.join(invite)
        } catch {
            if let reason = TrackerStore.sessionEndReason(error) { return sessionEnded(reason) }
            refusal = error
        }
        await openSpace(appId: invite.appId, displayName: displayName, attempts: refusal == nil ? syncAttempts : 1)
        if phase == .ready {
            pendingInvite = nil
        } else if let refusal {
            spaceError = "This invite wasn't accepted. (" + TrackerStore.message(for: refusal) + ")"
        }
    }

    /// A shareable invite link to the open space.
    public func inviteLink() async throws -> String {
        guard let space else { throw SpaceDirectoryError.notInAnOrganization }
        guard let directory = makeDirectory(client) else { throw SpaceDirectoryError.notConnected }
        let name = store?.space?.name ?? ""
        return try await directory.invite(appId: space.appId, spaceName: name).shareableLink()
    }

    // MARK: Updates

    /// Whether the registry has a newer Mero Tag than the open space runs.
    func checkForUpdate() async {
        availableUpdate = nil
        guard let cloud = client.cloud, let space else { return }
        guard
            let current = try? await cloud.listApps(package: SpaceInvite.appSlug)
                .first(where: { $0.appId == space.appId })?.version,
            let latest = try? await cloud.package(SpaceInvite.appSlug).latest,
            latest != current
        else { return }
        availableUpdate = latest
    }

    /// Ask the cluster for the update's consent page, open it in the system
    /// browser, and wait for the decision. Only the space's owner (or an
    /// organization admin) can approve; the page says what changes.
    public func approveUpdate(open: @escaping (URL) -> Void) {
        guard let cloud = client.cloud, let space, let version = availableUpdate else { return }
        updateMessage = nil
        isAwaitingApproval = true
        let returnTo = Self.consentReturnTo(devCluster: client.allowMock)
        approvalTask?.cancel()
        approvalTask = Task { [weak self] in
            do {
                let started = try await cloud.requestConsent(
                    upgradeConsent(app: space.appId, toVersion: version, returnTo: returnTo))
                guard let url = URL(string: started.url) else {
                    throw AccountError.protocolViolation("the cluster answered no consent page")
                }
                open(url)
                let result = try await cloud.waitForConsent(started.requestId, expiresAt: started.expiresAt)
                guard let self else { return }
                switch result.status {
                case .approved:
                    self.updateMessage = "Approved. Your space moves to version \(version) shortly."
                    self.availableUpdate = nil
                case .declined:
                    self.updateMessage = "The update was declined."
                case .pending:
                    self.updateMessage = "The approval page expired. Try again when you're ready."
                }
            } catch is CancellationError {
            } catch {
                self?.updateMessage = TrackerStore.message(for: error)
            }
            self?.isAwaitingApproval = false
        }
    }

    /// Stop waiting for an approval (the page stays valid until it expires).
    public func cancelApproval() {
        approvalTask?.cancel()
        approvalTask = nil
        isAwaitingApproval = false
    }

    /// Where the consent page sends the person afterwards. The node accepts
    /// only an https origin the cluster is configured with (http on
    /// localhost), never an app scheme, so it is the Calimero Cloud console
    /// (or `merod local`'s development origin); the app learns the decision
    /// by asking the cluster, not from the redirect.
    static func consentReturnTo(devCluster: Bool) -> String {
        devCluster ? "http://localhost:3000/" : "https://cloud.calimero.network/"
    }

    /// Leave the open space (stay signed in) to pick another.
    public func leaveSpace() async {
        if let store {
            store.stop()
            await store.goOffline()
        }
        cancelApproval()
        store = nil
        me = nil
        availableUpdate = nil
        unreachableSpace = nil
        preferences.space = nil
        preferences.sharingTrackerId = nil
        phase = .choosingSpace
    }

    // MARK: Sign out

    public func signOut() async {
        if let store {
            store.stop()
            await store.goOffline()
        }
        await tearDown()
    }

    /// The account session ended under the app (revoked, expired).
    /// Unlike ``signOut()`` this leaves a reason on the sign-in screen.
    public func sessionEnded(_ reason: String) {
        guard phase != .signedOut else { return }
        sessionNotice = reason + " Please sign in again."
        store?.stop()
        store = nil
        me = nil
        unreachableSpace = nil
        cancelApproval()
        accountForTesting = nil
        phase = .signedOut
        Task { await client.logout() }
    }

    private func tearDown() async {
        cancelApproval()
        store = nil
        me = nil
        availableUpdate = nil
        unreachableSpace = nil
        accountForTesting = nil
        preferences.sharingTrackerId = nil
        await client.logout()
        phase = .signedOut
    }

    // MARK: Test hooks

    /// Put the state machine in `phase` directly (unit tests only).
    func setPhaseForTesting(_ phase: Phase) { self.phase = phase }

    /// Act as `account` without a cluster (unit tests only).
    func signInForTesting(account: String) { accountForTesting = account }
}
