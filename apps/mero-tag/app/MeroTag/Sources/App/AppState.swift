import Combine
import Foundation
import MeroKit
import MeroKitUI

/// The space this device last opened, remembered across launches.
public struct SpaceSelection: Codable, Equatable {
    public var contextId: String
    public var displayName: String
}

/// Persists the last ``SpaceSelection`` and the tracker this device shares as.
public struct SpacePreferences {
    private let defaults: UserDefaults
    private let key = "merotag.space"
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

/// Session-level state. Two ways in:
/// - **Calimero Cloud**: the wallet approves this device with the person's
///   passkey, and every call then goes through the hosted relay that serves
///   their account — writes as warrant intents, reads as queries, events over
///   the relay's Bearer session.
/// - **A node** (``NodeSession``): "Manually enter node URL" signs in to a node
///   the person runs, a local `merod`, with its admin username and password;
///   calls are the node's JSON-RPC and events its SSE.
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

    /// The URL scheme the wallet returns to (`merotag://enrol`). Registered
    /// under `CFBundleURLTypes` in project.yml / Info.plist.
    public static let callbackScheme = "merotag"

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
    /// Something worth knowing about the space just created (not hosted yet).
    @Published public private(set) var spaceNotice: String?
    @Published public private(set) var store: TrackerStore?
    @Published public private(set) var space: SpaceSelection?
    /// The node, when signed in to one directly rather than through Cloud.
    @Published public private(set) var node: NodeSession?
    @Published public private(set) var isConnectingNode = false
    @Published public private(set) var nodeError: String?
    /// The node URL and username last used, prefilled on the sign-in screen.
    /// The password is never stored.
    @Published public var lastNodeURL: String = UserDefaults.standard.string(forKey: "merotag.nodeURL")
        ?? ProcessInfo.processInfo.environment["MEROTAG_PREFILL_URL"] ?? "http://localhost:4001"
    @Published public var lastNodeUser: String = UserDefaults.standard.string(forKey: "merotag.nodeUser") ?? "dev"

    public let client: MeroClient
    public let preferences: SpacePreferences
    private let makeTransport: (CloudConnection) -> (any ContextTransport)?
    private let makeDirectory: @MainActor (MeroClient) -> any SpaceDirectory
    /// How long to wait for a joined space to reach the relay.
    var syncAttempts = 8
    var syncDelay: UInt64 = 1_500_000_000
    private var forward: AnyCancellable?

    public init(
        client: MeroClient? = nil,
        preferences: SpacePreferences = SpacePreferences(),
        makeTransport: @escaping (CloudConnection) -> (any ContextTransport)? = { RelayTransport($0) },
        makeDirectory: @escaping @MainActor (MeroClient) -> any SpaceDirectory = {
            CloudSpaces(cloud: $0.cloudSignIn, connection: $0.connection)
        }
    ) {
        self.client = client ?? MeroClient()
        self.preferences = preferences
        self.makeTransport = makeTransport
        self.makeDirectory = makeDirectory
        self.space = preferences.space
        // Views observe AppState only; re-publish the client's changes.
        forward = self.client.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    // MARK: Account

    /// The signed-in account (64 hex), or `nil`: the Cloud account, or the
    /// node's own.
    public var account: String? { client.account ?? node?.accountId }

    /// Whether this session can found spaces: a node always can, a Cloud
    /// account once a relay serves it.
    public var canCreateSpaces: Bool { node != nil || client.connection?.relay != nil }

    /// Reconnect a session from a previous launch.
    public func restore() async {
        guard phase == .launching else { return }
        let env = ProcessInfo.processInfo.environment
        if let url = env["MEROTAG_NODE"], let user = env["MEROTAG_NODE_USER"], let pass = env["MEROTAG_NODE_PASS"] {
            // Demo / UI-test hook: the same path as "Manually enter node URL",
            // optionally straight into a space (MEROTAG_SPACE, MEROTAG_NAME).
            phase = .signedOut
            if let space = env["MEROTAG_SPACE"], !space.isEmpty {
                preferences.space = SpaceSelection(contextId: space, displayName: env["MEROTAG_NAME"] ?? user)
            }
            await signInToNode(url: url, username: user, password: pass)
            return
        }
        if await client.restoreCloudSession(), client.isAuthenticated {
            await didSignIn()
        } else {
            phase = .signedOut
        }
    }

    /// "Continue with Calimero": the wallet in the system auth sheet.
    public func signIn() async {
        sessionNotice = nil
        await client.signInWithCloud(callbackScheme: Self.callbackScheme)
        if client.isAuthenticated { await didSignIn() }
    }

    /// "Manually enter node URL": sign in to a node with its admin credentials.
    public func signInToNode(url: String, username: String, password: String) async {
        sessionNotice = nil
        nodeError = nil
        guard !username.isEmpty, !password.isEmpty else {
            nodeError = "Enter the node's admin username and password."
            return
        }
        isConnectingNode = true
        defer { isConnectingNode = false }
        do {
            let session = try await NodeSession.connect(url: url, username: username, password: password)
            lastNodeURL = session.url
            lastNodeUser = username
            UserDefaults.standard.set(session.url, forKey: "merotag.nodeURL")
            UserDefaults.standard.set(username, forKey: "merotag.nodeUser")
            node = session
            await didSignIn()
        } catch MeroError.network {
            nodeError = "Can't reach a node at \(url.trimmingCharacters(in: .whitespaces)). Is merod running?"
        } catch MeroError.authenticationFailed {
            nodeError = "The node refused that username or password."
        } catch {
            nodeError = (error as? LocalizedError)?.errorDescription ?? "Couldn't sign in to the node."
        }
    }

    /// The transport and member for the current session, or nil when signed out.
    private func currentTransport() -> (any ContextTransport)? {
        if let node { return NodeTransport(mero: node.mero) }
        return client.connection.flatMap(makeTransport)
    }

    private func currentDirectory() -> any SpaceDirectory {
        if let node { return NodeSpaces(mero: node.mero) }
        return makeDirectory(client)
    }

    /// A URL delivered to the app (`onOpenURL`): an invite link
    /// (`merotag://join?invitation=…`, or the shareable https link when the OS
    /// routes it here), or a wallet callback that bypassed the auth sheet.
    public func handleOpenURL(_ url: URL) async {
        if SpaceInvite.decode(deepLink: url) != nil {
            receiveInvite(url.absoluteString)
            return
        }
        guard url.scheme == Self.callbackScheme else { return }
        if await client.handleEnrolmentCallback(url), client.isAuthenticated {
            await didSignIn()
        }
    }

    /// Hold an invite until the person accepts it on the space screen. While
    /// signed out it waits for sign-in; with a space open, ``SpaceView``
    /// offers to switch.
    public func receiveInvite(_ raw: String) {
        pendingInvite = raw
        spaceError = nil
    }

    private func didSignIn() async {
        if pendingInvite != nil {
            // An invite is waiting: show it rather than reopening the last space.
            phase = .choosingSpace
        } else if let saved = preferences.space {
            await openSpace(contextId: saved.contextId, displayName: saved.displayName)
            if phase != .ready { phase = .choosingSpace }
        } else {
            phase = .choosingSpace
        }
    }

    // MARK: Space

    /// Open `contextId` as the signed-in account and join it under `displayName`.
    public func openSpace(contextId rawId: String, displayName rawName: String) async {
        await openSpace(contextId: rawId, displayName: rawName, attempts: 1)
    }

    /// As ``openSpace(contextId:displayName:)``, retrying the first read: a
    /// space just joined or created reaches the relay asynchronously.
    func openSpace(contextId rawId: String, displayName rawName: String, attempts: Int) async {
        let contextId = rawId.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        spaceError = nil
        guard !contextId.isEmpty else { spaceError = "Enter the space ID you were given."; return }
        guard !displayName.isEmpty else { spaceError = "Choose a name others will see."; return }
        guard let account else {
            phase = .signedOut
            return
        }
        guard let transport = currentTransport() else {
            spaceError = "No relay serves your account yet. Accept an invitation to a space from its owner to get one."
            return
        }

        isOpeningSpace = true
        defer { isOpeningSpace = false }

        let service = MeroService(transport: transport, contextId: contextId, memberId: account)
        // Reaching the space before switching screens: a mistyped ID should be
        // an inline error, not an empty map.
        var lastError: Error?
        for attempt in 1...max(attempts, 1) {
            do {
                _ = try await service.getSpace()
                lastError = nil
                break
            } catch {
                if let reason = TrackerStore.sessionEndReason(error) { return sessionEnded(reason) }
                lastError = error
                if attempt < attempts { try? await Task.sleep(nanoseconds: syncDelay) }
            }
        }
        if let lastError {
            spaceError = attempts > 1
                ? "You joined, but the space hasn't reached your relay yet. Try again in a moment. ("
                    + TrackerStore.message(for: lastError) + ")"
                : "Couldn't open that space. Check that your account is a member. ("
                    + TrackerStore.message(for: lastError) + ")"
            return
        }

        let store = TrackerStore(service: service)
        store.onSessionEnded = { [weak self] reason in self?.sessionEnded(reason) }
        let selection = SpaceSelection(contextId: contextId, displayName: displayName)
        preferences.space = selection
        self.space = selection
        self.store = store
        phase = .ready
        await store.bootstrap(displayName: displayName)
    }

    /// Found a new space for Mero Tag as this account and open it.
    public func createSpace(name rawName: String, displayName rawDisplay: String) async {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = rawDisplay.trimmingCharacters(in: .whitespacesAndNewlines)
        spaceError = nil
        spaceNotice = nil
        guard !name.isEmpty else { spaceError = "Give the space a name."; return }
        guard !displayName.isEmpty else { spaceError = "Choose a name others will see."; return }
        guard account != nil else { phase = .signedOut; return }

        isCreatingSpace = true
        defer { isCreatingSpace = false }
        let created: CreatedSpace
        do {
            created = try await currentDirectory().createSpace(named: name)
        } catch {
            if let reason = TrackerStore.sessionEndReason(error) { return sessionEnded(reason) }
            spaceError = "Couldn't create the space. (" + TrackerStore.message(for: error) + ")"
            return
        }
        if !created.hosted {
            spaceNotice = "Your space isn't hosted in Calimero Cloud yet, so people without their own node may not "
                + "be able to join." + (created.hostingNote.map { " (\($0))" } ?? "")
        }
        await openSpace(contextId: created.contextId, displayName: displayName, attempts: syncAttempts)
    }

    /// Accept an invite (a link, a deep link or a bare token) and open the
    /// space it is for. A refused join is kept rather than thrown: "already a
    /// member" is fine to continue from, and only whether the space then
    /// opens tells the two apart.
    public func joinSpace(invite raw: String, displayName rawDisplay: String) async {
        let displayName = rawDisplay.trimmingCharacters(in: .whitespacesAndNewlines)
        spaceError = nil
        guard let invite = SpaceInvite.decode(pasted: raw) else {
            spaceError = "That isn't a Mero Tag invite link. Ask the space's owner to send it again."
            return
        }
        guard !displayName.isEmpty else { spaceError = "Choose a name others will see."; return }
        guard account != nil else { phase = .signedOut; return }

        isJoiningSpace = true
        defer { isJoiningSpace = false }
        let hadRelay = node != nil || client.connection?.relay != nil
        var refusal: Error?
        do {
            try await currentDirectory().join(invite)
        } catch {
            if let reason = TrackerStore.sessionEndReason(error) { return sessionEnded(reason) }
            refusal = error
        }
        // A relayless account just earned a relay: connect to it.
        if !hadRelay { await client.restoreCloudSession() }
        if let refusal, node == nil, client.connection?.relay == nil {
            spaceError = "This invite wasn't accepted. (" + TrackerStore.message(for: refusal) + ")"
            return
        }
        await openSpace(
            contextId: invite.contextId, displayName: displayName, attempts: refusal == nil ? syncAttempts : 1)
        if phase == .ready {
            pendingInvite = nil
        } else if let refusal {
            spaceError = "This invite wasn't accepted. (" + TrackerStore.message(for: refusal) + ")"
        }
    }

    /// A shareable invite link to the open space, signed by this account.
    public func inviteLink() async throws -> String {
        guard let space else { throw SpaceDirectoryError.notInASpace }
        let name = store?.space?.name ?? ""
        return try await currentDirectory().invite(contextId: space.contextId, spaceName: name).shareableLink()
    }

    /// Leave the open space (stay signed in) to pick another.
    public func leaveSpace() async {
        if let store {
            store.stop()
            await store.goOffline()
        }
        store = nil
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

    /// The account session ended under the app (revoked, device removed).
    /// Unlike ``signOut()`` this leaves a reason on the sign-in screen.
    public func sessionEnded(_ reason: String) {
        guard phase != .signedOut else { return }
        sessionNotice = reason + " Please sign in again."
        store?.stop()
        store = nil
        phase = .signedOut
        let node = self.node
        self.node = nil
        Task {
            await client.logout()
            await node?.mero.logout()
        }
    }

    private func tearDown() async {
        store = nil
        preferences.sharingTrackerId = nil
        await client.logout()
        await node?.mero.logout()
        node = nil
        phase = .signedOut
    }

    // MARK: Test hooks

    /// Put the state machine in `phase` directly (unit tests only).
    func setPhaseForTesting(_ phase: Phase) { self.phase = phase }
}
