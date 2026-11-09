import Foundation
import MeroKit
import MeroKitUI

/// A room the lobby can list: one in a home, or one this person opened before.
public struct RoomSummary: Identifiable, Equatable, Codable {
    public let id: String
    public var name: String
    public var lastOpened: Date?
    public var objectCount: Int?
    public var memberCount: Int?
}

/// Session state: owns the sign-in and, once a room is open, the service and
/// scene store for it.
///
/// Calimero 1.0: the app talks to a node of the person's Calimero Cloud
/// cluster over the sealed channel (the node's TDX quote verified first) and
/// signs in with a passkey. Two ways in:
/// - **Calimero Cloud**: the cluster address from the Cloud console, then the
///   device's passkey (``PlatformPasskey``), or "Create account" for a new one.
/// - **A development cluster** (`merod local`): a node URL whose mock
///   attestation is trusted (`allowMock`), signed in with a soft passkey the
///   SDK keeps for that node.
@MainActor
public final class AppState: ObservableObject {
    public enum Phase: Equatable { case restoring, signedOut, lobby, inRoom }

    /// The app's package on the Calimero app registry: what a home is founded
    /// for and a room created from.
    public static let package = "com.calimero.mero-ar"
    /// Where the consent page sends the person back to. Core accepts only an
    /// https origin the cluster is configured with (http on localhost), never
    /// a custom scheme, so this is the Cloud console, or the local console a
    /// `merod local` cluster allows.
    static let consentReturnCloud = "https://cloud.calimero.network/"
    static let consentReturnLocal = "http://localhost:3000/"

    @Published public private(set) var phase: Phase = .restoring
    /// The nickname others see: sent to a room's roster on `join`, and kept
    /// across launches.
    @Published public var displayName: String {
        didSet { defaults.set(displayName.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Key.displayName) }
    }
    @Published public private(set) var recentRooms: [RoomSummary] = []
    /// The homes (organizations) this account is in that hold Mero AR rooms.
    @Published public private(set) var homes: [Home] = []
    /// Mero AR rooms this account reaches that belong to no organization.
    @Published public private(set) var looseRooms: [RoomSummary] = []
    @Published public private(set) var isEntering = false
    @Published public private(set) var isCreating = false
    @Published public private(set) var isLoadingHomes = false
    /// Why the homes couldn't be listed. Set only when the listing itself
    /// failed, so the lobby never reads a failure as "no homes yet".
    @Published public private(set) var homesError: String?
    /// Something worth knowing after creating or joining a home.
    @Published public var homeNotice: String?
    @Published public var roomError: String?

    // Sign-in.
    /// The cluster address last used, prefilled on the sign-in screen.
    @Published public var clusterURL: String
    /// The development node URL last used.
    @Published public var devNodeURL: String
    @Published public var signInError: String?
    /// Creating an account: the sign-up policy check and the passkey's two prompts.
    @Published public internal(set) var isCreatingAccount = false
    /// The cluster takes new accounts with an invite only: the sign-in screen asks for one.
    @Published public var signUpNeedsInvite = false

    // Updates and approvals for the open room.
    /// A newer Mero AR release the open room could run.
    @Published public private(set) var roomUpdate: RoomUpdate?
    /// The consent page is open in the browser and the app waits for the decision.
    @Published public private(set) var isAwaitingApproval = false
    @Published public var approvalNotice: String?

    public let client: MeroClient
    public private(set) var service: MeroARService?
    public private(set) var store: SceneStore?
    /// Set in debug builds by the in-memory cluster (`MEROAR_FIXTURE=1`).
    private var fixture: RoomCluster?
    private var approvalTask: Task<Void, Never>?
    /// Bumped by every ``loadHomes()``; an older load that finishes late
    /// drops its result instead of overwriting a newer one.
    private var homesLoad = 0
    /// How long to wait for a room or home just created or joined to be reachable.
    var syncAttempts = 8
    var syncDelay: UInt64 = 1_500_000_000

    private let defaults: UserDefaults

    private enum Key {
        static let recent = "meroar.recentRooms"
        static let roomId = "meroar.roomId"
        static let roomName = "meroar.roomName"
        static let displayName = "meroar.username"
        static let clusterURL = "meroar.clusterURL"
        static let devNodeURL = "meroar.devNodeURL"
    }

    public init(client: MeroClient? = nil, defaults: UserDefaults = .standard) {
        // The session (and a development soft passkey) live in this app's own
        // Keychain service, so Mero AR never shares one with another app.
        self.client = client ?? MeroClient(
            config: MeroProviderConfig(packageName: Self.package),
            store: KeychainCloudSessionStore(service: "network.calimero.meroar"))
        self.defaults = defaults
        self.displayName = defaults.string(forKey: Key.displayName) ?? ""
        self.clusterURL = defaults.string(forKey: Key.clusterURL) ?? ""
        self.devNodeURL = defaults.string(forKey: Key.devNodeURL) ?? "http://localhost:2501"
        if let data = defaults.data(forKey: Key.recent),
            let rooms = try? JSONDecoder().decode([RoomSummary].self, from: data)
        {
            recentRooms = rooms
        }
    }

    /// The cluster this session talks to, once signed in.
    public var cluster: RoomCluster? {
        if let fixture { return fixture }
        guard client.isAuthenticated, let cloud = client.cloud else { return nil }
        return CloudCluster(client: cloud, passkey: client.passkeyForNode(), endpoint: client.nodeURL ?? "")
    }

    /// Signed in to a development cluster (mock attestation trusted).
    public var isDevelopmentCluster: Bool { fixture == nil && client.allowMock }

    /// Whether this session can found homes.
    public var canCreateHomes: Bool { cluster != nil }

    /// Whether a nickname has been chosen yet (asked for once, after sign-in).
    public var hasNickname: Bool { !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The last room entered, offered as "Continue where you left off".
    public var lastRoomId: String { recentRooms.first?.id ?? "" }
    public var lastRoomName: String { recentRooms.first?.name ?? "" }

    // MARK: - Session

    /// Reconnect a stored session (refreshing it). Lands on sign-in if there is none.
    public func restore() async {
        if fixture != nil {
            phase = .lobby
            await loadHomes()
            return
        }
        guard await client.restore(), client.isAuthenticated else {
            phase = .signedOut
            return
        }
        phase = .lobby
        await loadHomes()
    }

    /// Debug builds: sign in to an in-memory cluster.
    func useFixture(_ cluster: RoomCluster) {
        fixture = cluster
    }

    /// "Continue with passkey": sign in to the cluster at `address`.
    public func signIn(clusterAddress address: String) async {
        guard let url = checkedURL(address, https: true) else { return }
        rememberCluster(url)
        client.connect(nodeURL: url, allowMock: false)
        if await client.signIn() { await didSignIn() } else { signInError = client.errorMessage }
    }

    /// "Create account": register a new passkey on the cluster at `address`.
    /// `invite` is an invite link or code, for a cluster that takes new
    /// accounts by invitation only.
    public func createAccount(clusterAddress address: String, invite: String = "") async {
        guard let url = checkedURL(address, https: true) else { return }
        rememberCluster(url)
        client.connect(nodeURL: url, allowMock: false)
        if await signUp(name: effectiveDisplayName, invite: Self.signUpInvite(from: invite)) { await didSignIn() }
    }

    /// A development cluster (`merod local`): trust its mock attestation and
    /// sign in with the soft passkey kept for that node, creating the account
    /// the first time.
    public func signInToDevelopmentCluster(nodeURL address: String) async {
        guard let url = checkedURL(address, https: false) else { return }
        devNodeURL = url
        defaults.set(url, forKey: Key.devNodeURL)
        client.connect(nodeURL: url, allowMock: true)
        if await client.signInOrSignUp(name: effectiveDisplayName) { await didSignIn() } else {
            signInError = client.errorMessage
        }
    }

    private func checkedURL(_ raw: String, https: Bool) -> String? {
        signInError = nil
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text), let scheme = url.scheme, url.host != nil,
            scheme == "https" || (!https && scheme == "http")
        else {
            signInError = https
                ? "Enter your cluster's address from the Calimero Cloud console, like https://node-1.example.calimero.network."
                : "Enter the node's URL, like http://localhost:2501."
            return nil
        }
        return text
    }

    private func rememberCluster(_ url: String) {
        clusterURL = url
        defaults.set(url, forKey: Key.clusterURL)
    }

    private func didSignIn() async {
        signInError = nil
        phase = .lobby
        await loadHomes()
    }

    public func signOut() async {
        leaveRoom()
        if fixture == nil { await client.logout() }
        homes = []
        looseRooms = []
        homesError = nil
        homeNotice = nil
        phase = .signedOut
    }

    /// A call failed because the session is over: back to sign-in.
    func sessionEnded() {
        leaveRoom()
        signInError = "Your session ended. Sign in again."
        homes = []
        looseRooms = []
        phase = .signedOut
        Task { await client.logout() }
    }

    // MARK: - Rooms

    /// The name to join with: what the person typed, else a short account id.
    public var effectiveDisplayName: String {
        let typed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty { return typed }
        guard let account = client.account else { return "Guest" }
        return "Guest \(account.prefix(4))"
    }

    /// List the homes and their rooms.
    ///
    /// A failed listing is not an empty one: it keeps the homes already shown
    /// and sets ``homesError``, so a slow or unreachable cluster never reads as
    /// "No homes yet" (which invites creating a duplicate).
    public func loadHomes() async {
        guard let cluster else { return }
        homesLoad += 1
        let load = homesLoad
        isLoadingHomes = true
        defer { if load == homesLoad { isLoadingHomes = false } }
        let listing: HomeListing
        do {
            listing = try await cluster.listHomes()
        } catch {
            // A cancelled load (pull-to-refresh torn down as the lobby is
            // replaced) didn't fail: it says nothing about the session.
            guard load == homesLoad, !Task.isCancelled else { return }
            if error is LoginRequired { return sessionEnded() }
            homesError = userMessage(error)
            return
        }
        guard load == homesLoad else { return }
        homesError = nil
        homes = listing.homes.map { home in
            var home = home
            home.rooms = sortedByRecent(home.rooms)
            return home
        }
        looseRooms = sortedByRecent(listing.looseRooms)
    }

    private func sortedByRecent(_ rooms: [RoomSummary]) -> [RoomSummary] {
        rooms.map { room in
            var room = room
            room.lastOpened = recentRooms.first { $0.id == room.id }?.lastOpened
            return room
        }
        .sorted {
            if ($0.lastOpened ?? .distantPast) != ($1.lastOpened ?? .distantPast) {
                return ($0.lastOpened ?? .distantPast) > ($1.lastOpened ?? .distantPast)
            }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    /// Found a home (an organization running Mero AR) and its first room,
    /// then enter the room.
    public func createHome(named rawName: String, firstRoom rawRoom: String) async {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        let room = rawRoom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { roomError = "Give the home a name."; return }
        guard !room.isEmpty else { roomError = "Name the first room."; return }
        guard let cluster else { roomError = MeroARError.notSignedIn.errorDescription; return }
        isCreating = true
        roomError = nil
        homeNotice = nil
        defer { isCreating = false }
        let home: String
        do {
            home = try await cluster.createHome(named: name)
        } catch {
            roomError = "Couldn't create the home. (\(userMessage(error)))"
            return
        }
        await createRoom(named: room, inHome: home, cluster: cluster)
    }

    /// Create a room in a home and enter it.
    public func createRoom(named rawName: String, inHome homeId: String) async {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { roomError = "Give the room a name."; return }
        guard let cluster else { roomError = MeroARError.notSignedIn.errorDescription; return }
        isCreating = true
        roomError = nil
        defer { isCreating = false }
        await createRoom(named: name, inHome: homeId, cluster: cluster)
    }

    private func createRoom(named name: String, inHome homeId: String, cluster: RoomCluster) async {
        let appId: String
        do {
            appId = try await cluster.createRoom(named: name, inHome: homeId)
        } catch {
            roomError = "Couldn't create the room. (\(userMessage(error)))"
            await loadHomes()
            return
        }
        remember(roomId: appId, name: name)
        isCreating = false
        await enter(roomOrInvite: appId, attempts: syncAttempts)
        await loadHomes()
    }

    /// A shareable link inviting someone to a home and every room in it.
    public func inviteLink(toHome home: Home) async throws -> String {
        guard let cluster else { throw MeroARError.notSignedIn }
        let token = try await cluster.invite(toHome: home.id)
        return try RoomInvite(orgId: home.id, token: token, appId: "", roomName: "", homeName: home.name)
            .shareableLink()
    }

    /// Change the nickname, and tell the open room so its roster shows it.
    public func setNickname(_ raw: String) async {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        displayName = name
        guard let service, let store else { return }
        do {
            try await service.updateUsername(name)
            await store.refreshRoster()
        } catch {
            store.lastError = userMessage(error)
        }
    }

    /// Enter a room from whatever was pasted: an invitation link, a bare
    /// invitation token, or a room id.
    public func enter(roomOrInvite input: String, quiet: Bool = false, attempts: Int = 1) async {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            roomError = "Paste an invite link, or the room's ID."
            return
        }
        isEntering = true
        roomError = nil
        defer { isEntering = false }

        do {
            guard let cluster else { throw MeroARError.notSignedIn }
            var contextId = text
            var invitedName = ""
            if let invite = RoomInvite.decode(pasted: text) {
                try await redeem(invite, cluster: cluster)
                if invite.isHomeInvite {
                    try await waitForHome(invite)
                    return
                }
                contextId = invite.appId
                invitedName = invite.roomName
            }
            let service = try await openService(contextId: contextId, cluster: cluster, attempts: invitedName.isEmpty ? attempts : max(attempts, syncAttempts))
            let store = SceneStore(service: service)
            let name = effectiveDisplayName

            self.service = service
            self.store = store
            defaults.set(name, forKey: Key.displayName)
            remember(roomId: contextId, name: invitedName)
            phase = .inRoom
            await store.bootstrap(username: name)
            if let roomName = store.room?.name, !roomName.isEmpty { remember(roomId: contextId, name: roomName) }
            await checkForUpdate()
        } catch {
            if error is LoginRequired { return sessionEnded() }
            if !quiet { roomError = userMessage(error) }
        }
    }

    /// Open the room's contract, retrying while a room just created or joined
    /// becomes reachable.
    private func openService(contextId: String, cluster: RoomCluster, attempts: Int) async throws -> MeroARService {
        var attempt = 1
        while true {
            do {
                return try await MeroARService.open(cluster: cluster, contextId: contextId)
            } catch let error as LoginRequired {
                throw error
            } catch {
                guard attempt < attempts else { throw error }
                attempt += 1
                try? await Task.sleep(nanoseconds: syncDelay)
            }
        }
    }

    /// Redeem an invite token as this account. "Already a member" is fine to
    /// continue from; whether the room or home is reachable afterwards decides.
    private func redeem(_ invite: RoomInvite, cluster: RoomCluster) async throws {
        do {
            try await cluster.redeem(token: invite.token)
        } catch let error as LoginRequired {
            throw error
        } catch let error as CalimeroError where error.status == 409 {
            // Already a member.
        } catch {
            throw MeroARError.invitationRefused(userMessage(error))
        }
    }

    /// After redeeming an invitation to a whole home, wait for it to list.
    private func waitForHome(_ invite: RoomInvite) async throws {
        let name = invite.homeName.flatMap { $0.isEmpty ? nil : $0 } ?? "the home"
        for attempt in 1...max(syncAttempts, 1) {
            await loadHomes()
            if homes.contains(where: { $0.id == invite.orgId }) {
                homeNotice = "You joined \(name). Pick a room to enter."
                return
            }
            if attempt < syncAttempts { try? await Task.sleep(nanoseconds: syncDelay) }
        }
        throw MeroARError.homeNotSynced
    }

    public func leaveRoom() {
        approvalTask?.cancel()
        approvalTask = nil
        isAwaitingApproval = false
        roomUpdate = nil
        store?.stop()
        store = nil
        service = nil
        if phase == .inRoom { phase = .lobby }
    }

    public func forget(roomId: String) {
        recentRooms.removeAll { $0.id == roomId }
        saveRecent()
    }

    // MARK: - Updates and approvals

    /// Whether a newer Mero AR release is out for the open room.
    public func checkForUpdate() async {
        guard let service else { return }
        roomUpdate = try? await service.availableUpdate()
    }

    /// Ask for the open room to be upgraded. Core approves upgrades only on
    /// the node's consent page, so this opens it in the system browser and
    /// waits for the decision there.
    public func requestRoomUpgrade(open: @escaping @MainActor (URL) -> Void) {
        guard let update = roomUpdate, let service, let cloud = client.cloud, fixture == nil else { return }
        approvalTask?.cancel()
        approvalNotice = nil
        isAwaitingApproval = true
        let returnTo = client.allowMock ? Self.consentReturnLocal : Self.consentReturnCloud
        approvalTask = Task { [weak self] in
            do {
                let started = try await cloud.requestConsent(
                    upgradeConsent(app: service.contextId, toVersion: update.latest, returnTo: returnTo))
                guard let url = URL(string: started.url) else {
                    throw MeroARError.invitationRefused("the cluster answered no consent page")
                }
                open(url)
                let result = try await cloud.waitForConsent(started.requestId, expiresAt: started.expiresAt)
                guard let self, !Task.isCancelled else { return }
                self.isAwaitingApproval = false
                switch result.status {
                case .approved:
                    self.approvalNotice = "Approved. The room moves to \(update.latest) shortly."
                    await self.checkForUpdate()
                case .declined:
                    self.approvalNotice = "The upgrade was declined."
                case .pending:
                    self.approvalNotice = "The approval wasn't finished in time. Try again."
                }
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.isAwaitingApproval = false
                self.approvalNotice = userMessage(error)
            }
        }
    }

    /// Stop waiting for a consent decision (the page itself stays valid until it expires).
    public func cancelApprovalWait() {
        approvalTask?.cancel()
        approvalTask = nil
        isAwaitingApproval = false
    }

    /// Move a room to the top of the recent list (keeping a known name).
    private func remember(roomId: String, name: String) {
        var entry = recentRooms.first { $0.id == roomId } ?? RoomSummary(id: roomId, name: "", lastOpened: nil)
        if !name.isEmpty { entry.name = name }
        entry.lastOpened = Date()
        recentRooms.removeAll { $0.id == roomId }
        recentRooms.insert(entry, at: 0)
        if recentRooms.count > 12 { recentRooms.removeLast(recentRooms.count - 12) }
        saveRecent()
    }

    private func saveRecent() {
        if let data = try? JSONEncoder().encode(recentRooms) { defaults.set(data, forKey: Key.recent) }
        defaults.set(recentRooms.first?.id ?? "", forKey: Key.roomId)
        defaults.set(recentRooms.first?.name ?? "", forKey: Key.roomName)
    }
}
