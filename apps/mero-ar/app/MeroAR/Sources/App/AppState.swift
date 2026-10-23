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
/// Two ways in:
/// - **Calimero Cloud** (the default). ``MeroClient/signInWithCloud(callbackScheme:)``
///   opens the Calimero wallet in the system auth sheet; the person approves
///   this device with their passkey; the SDK verifies the device certificate,
///   finds the relay that serves the account, and logs in there.
/// - **A node URL**, entered by hand with the node's admin username and
///   password. For a node you run yourself (a local `merod`): no Cloud account,
///   no passkey. The node can also create rooms, which a Cloud session joins by
///   invitation.
@MainActor
public final class AppState: ObservableObject {
    public enum Phase: Equatable { case restoring, signedOut, lobby, inRoom }

    /// The URL scheme the wallet returns to (`meroar://enrol`). Registered in
    /// `project.yml` → `CFBundleURLTypes`.
    public static let callbackScheme = "meroar"
    /// The app's package on the Calimero app registry.
    public static let package = "com.calimero.mero-ar"
    public static let registry = "https://apps.calimero.network"

    @Published public private(set) var phase: Phase = .restoring
    /// The nickname others see: sent to a room's roster on `join`, and kept
    /// across launches.
    @Published public var displayName: String {
        didSet { defaults.set(displayName.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Key.displayName) }
    }
    @Published public private(set) var recentRooms: [RoomSummary] = []
    /// The homes (namespaces) this session can see, each with its rooms.
    @Published public private(set) var homes: [Home] = []
    /// Rooms of this app in no visible home (rooms a node made before homes).
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

    // Node sign-in.
    @Published public private(set) var nodeURL: String?
    @Published public var lastNodeURL: String
    @Published public var lastNodeUser: String
    @Published public private(set) var isConnectingNode = false
    @Published public var nodeError: String?

    public let client: MeroClient
    public private(set) var service: MeroARService?
    public private(set) var store: SceneStore?
    private var nodeMero: Mero?
    /// Bumped by every ``loadHomes()``; an older load that finishes late
    /// drops its result instead of overwriting a newer one.
    private var homesLoad = 0
    private let urlSession: URLSession
    /// How long to wait for a room or home just created or joined to reach the relay.
    var syncAttempts = 8
    var syncDelay: UInt64 = 1_500_000_000

    private let defaults: UserDefaults

    private enum Key {
        static let recent = "meroar.recentRooms"
        static let roomId = "meroar.roomId"
        static let roomName = "meroar.roomName"
        static let displayName = "meroar.username"
        static let nodeURL = "meroar.nodeURL"
        static let nodeUser = "meroar.nodeUser"
    }

    public init(client: MeroClient? = nil, defaults: UserDefaults = .standard, urlSession: URLSession = .shared) {
        // Device keys, the Cloud session and the relay tokens live in this app's
        // own Keychain service, so Mero AR never shares a session with another
        // Calimero app installed on the same phone.
        self.client = client ?? MeroClient(cloud: CloudSignIn.keychain(service: "network.calimero.meroar"))
        self.defaults = defaults
        self.urlSession = urlSession
        self.displayName = defaults.string(forKey: Key.displayName) ?? ""
        self.lastNodeURL = defaults.string(forKey: Key.nodeURL) ?? "http://localhost:2450"
        self.lastNodeUser = defaults.string(forKey: Key.nodeUser) ?? "admin"
        if let data = defaults.data(forKey: Key.recent),
            let rooms = try? JSONDecoder().decode([RoomSummary].self, from: data)
        {
            recentRooms = rooms
        } else if let id = defaults.string(forKey: Key.roomId), !id.isEmpty {
            // The one-room memory of earlier versions.
            recentRooms = [RoomSummary(id: id, name: defaults.string(forKey: Key.roomName) ?? "", lastOpened: nil)]
        }
    }

    /// Signed in to a node directly (not through Cloud).
    public var isNodeSession: Bool { nodeMero != nil }

    /// Whether this session can found homes: a node always can, a Cloud
    /// account once a relay serves it.
    public var canCreateHomes: Bool { nodeMero != nil || client.connection?.relay != nil }

    /// Whether a nickname has been chosen yet (asked for once, after sign-in).
    public var hasNickname: Bool { !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The last room entered, offered as "Continue where you left off".
    public var lastRoomId: String { recentRooms.first?.id ?? "" }
    public var lastRoomName: String { recentRooms.first?.name ?? "" }

    // MARK: - Session

    /// Reconnect a Cloud session from a previous launch. Lands on sign-in if
    /// there is none (a node session is not kept: its password is never stored).
    public func restore() async {
        let env = ProcessInfo.processInfo.environment
        if let node = env["MEROAR_NODE"], !node.isEmpty, let user = env["MEROAR_NODE_USER"],
            let pass = env["MEROAR_NODE_PASS"]
        {
            // Development and recording hook: sign in to that node at launch.
            await connectNode(node, username: user, password: pass)
            if phase == .lobby, let room = env["MEROAR_ROOM"], !room.isEmpty {
                await enter(roomOrInvite: room, quiet: true)
            }
            return
        }
        guard await client.restoreCloudSession(), client.isAuthenticated else {
            phase = .signedOut
            return
        }
        phase = .lobby
        await loadHomes()
    }

    /// "Continue with Calimero Cloud".
    public func signIn() async {
        await client.signInWithCloud(callbackScheme: Self.callbackScheme)
        if client.isAuthenticated {
            phase = .lobby
            await loadHomes()
        }
    }

    /// A wallet callback delivered by the system (`onOpenURL`) rather than
    /// through the auth sheet.
    public func handle(url: URL) async {
        guard await client.handleEnrolmentCallback(url) else { return }
        if client.isAuthenticated, phase == .signedOut {
            phase = .lobby
            await loadHomes()
        }
    }

    /// "Manually enter node URL": sign in to a node with its admin username and
    /// password. The URL and username are remembered; the password is not.
    public func connectNode(_ rawURL: String, username: String, password: String) async {
        nodeError = nil
        let urlString = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: urlString), url.scheme == "http" || url.scheme == "https", url.host != nil else {
            nodeError = "Enter a full node URL, like http://localhost:2450."
            return
        }
        guard !username.isEmpty, !password.isEmpty else {
            nodeError = "Enter the node's admin username and password."
            return
        }
        lastNodeURL = urlString
        lastNodeUser = username
        defaults.set(urlString, forKey: Key.nodeURL)
        defaults.set(username, forKey: Key.nodeUser)
        isConnectingNode = true
        defer { isConnectingNode = false }
        let mero = Mero(config: MeroConfig(baseURL: url, tokenStore: MemoryTokenStore()), session: urlSession)
        do {
            _ = try await mero.authenticate(Credentials(username: username, password: password))
            nodeMero = mero
            nodeURL = urlString
            phase = .lobby
            await loadHomes()
        } catch {
            nodeError = Self.nodeLoginMessage(error, url: urlString)
        }
    }

    /// What a failed node sign-in says. The SDK types the failure, so a
    /// lockout after too many attempts doesn't read as a wrong password.
    static func nodeLoginMessage(_ error: Error, url: String) -> String {
        switch LoginFailureReason(error) {
        case .invalidCredentials:
            return "The node refused that username or password."
        case .rateLimited(let retryAfter?) where retryAfter > 0:
            let seconds = Int(retryAfter.rounded(.up))
            return "Too many failed attempts. Try again in \(seconds) second\(seconds == 1 ? "" : "s")."
        case .rateLimited:
            return "Too many failed attempts. Try again later."
        case .unreachable:
            return "Can't reach a node at \(url). Is merod running?"
        case .notFound:
            return "No node sign-in at \(url). Check the URL and port."
        case .serverError, .other:
            return userMessage(error)
        }
    }

    public func signOut() async {
        leaveRoom()
        if let nodeMero {
            await nodeMero.logout()
            self.nodeMero = nil
            nodeURL = nil
        } else {
            await client.logout()
        }
        homes = []
        looseRooms = []
        homesError = nil
        homeNotice = nil
        phase = .signedOut
    }

    // MARK: - Rooms

    /// The name to join with: what the person typed, else a short account id.
    public var effectiveDisplayName: String {
        let typed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty { return typed }
        guard let account = client.account else { return "Guest" }
        return "Guest \(account.prefix(4))"
    }

    /// The homes this session can open rooms in: the Cloud account's
    /// namespaces through its relay, or the node's own.
    private func directory() -> HomeDirectory? {
        if let nodeMero { return NodeHomes(mero: nodeMero, nodeURL: nodeURL ?? "") }
        guard let connection = client.connection, connection.relay != nil else { return nil }
        return CloudHomes(cloud: client.cloudSignIn, connection: connection, urlSession: urlSession)
    }

    /// List the homes and their rooms.
    ///
    /// A failed listing is not an empty one: it keeps the homes already shown
    /// and sets ``homesError``, so a slow or unreachable relay or node never
    /// reads as "No homes yet" (which invites creating a duplicate).
    public func loadHomes() async {
        guard let directory = directory() else { return }
        let session = nodeMero
        homesLoad += 1
        let load = homesLoad
        isLoadingHomes = true
        defer { if load == homesLoad { isLoadingHomes = false } }
        let listing: HomeListing
        do {
            listing = try await directory.list()
        } catch {
            // A cancelled load (pull-to-refresh torn down as the lobby is
            // replaced) didn't fail: it says nothing about the session.
            guard load == homesLoad, nodeMero === session, !Task.isCancelled else { return }
            homesError = userMessage(error)
            return
        }
        guard load == homesLoad, nodeMero === session else { return }
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

    /// Found a home (a namespace running Mero AR) and its first room, then
    /// enter the room.
    public func createHome(named rawName: String, firstRoom rawRoom: String) async {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        let room = rawRoom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { roomError = "Give the home a name."; return }
        guard !room.isEmpty else { roomError = "Name the first room."; return }
        guard let directory = directory() else { roomError = MeroARError.noRelay.errorDescription; return }
        isCreating = true
        roomError = nil
        homeNotice = nil
        defer { isCreating = false }
        let home: CreatedHome
        do {
            home = try await directory.createHome(named: name)
        } catch {
            roomError = "Couldn't create the home. (\(userMessage(error)))"
            return
        }
        if let note = home.hostingNote {
            homeNotice = "\(name) isn't hosted in Calimero Cloud yet, so people without their own node may not "
                + "be able to join." + (note.isEmpty ? "" : " (\(note))")
        }
        await createRoom(named: room, inHome: home.id, directory: directory)
    }

    /// Create a room in a home and enter it.
    public func createRoom(named rawName: String, inHome homeId: String) async {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { roomError = "Give the room a name."; return }
        guard let directory = directory() else { roomError = MeroARError.noRelay.errorDescription; return }
        isCreating = true
        roomError = nil
        defer { isCreating = false }
        await createRoom(named: name, inHome: homeId, directory: directory)
    }

    private func createRoom(named name: String, inHome homeId: String, directory: HomeDirectory) async {
        let contextId: String
        do {
            contextId = try await directory.createRoom(named: name, inHome: homeId)
        } catch {
            roomError = "Couldn't create the room. (\(userMessage(error)))"
            await loadHomes()
            return
        }
        remember(roomId: contextId, name: name)
        isCreating = false
        // A room just created reaches the relay asynchronously.
        await enter(roomOrInvite: contextId, attempts: syncAttempts)
        await loadHomes()
    }

    /// A shareable link inviting someone to a home and every room in it.
    public func inviteLink(toHome home: Home) async throws -> String {
        guard let directory = directory() else { throw MeroARError.noRelay }
        return try await directory.invite(toHome: home.id, homeName: home.name).shareableLink()
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
            var contextId = text
            var invitedName = ""
            if let invite = RoomInvite.decode(pasted: text) {
                if invite.isHomeInvite {
                    try await joinHome(invite)
                    return
                }
                contextId = try await redeem(invite)
                invitedName = invite.roomName
            }
            let service = try await openService(contextId: contextId, attempts: attempts)
            let store = SceneStore(service: service)
            let name = effectiveDisplayName

            self.service = service
            self.store = store
            defaults.set(name, forKey: Key.displayName)
            remember(roomId: contextId, name: invitedName)
            phase = .inRoom
            await store.bootstrap(username: name)
            if let roomName = store.room?.name, !roomName.isEmpty { remember(roomId: contextId, name: roomName) }
        } catch {
            if !quiet { roomError = userMessage(error) }
        }
    }

    /// Open the room's contract, retrying while a room just created or joined
    /// reaches the relay.
    private func openService(contextId: String, attempts: Int) async throws -> MeroARService {
        var attempt = 1
        while true {
            do {
                if let nodeMero {
                    return try await MeroARService.open(
                        transport: NodeTransport(mero: nodeMero, nodeURL: nodeURL ?? ""), mero: nodeMero,
                        contextId: contextId, account: "", mintInvitation: MeroARService.nodeMinter(nodeMero))
                }
                guard let connection = client.connection, let relay = connection.relay else {
                    throw MeroARError.noRelay
                }
                return try await MeroARService.open(
                    relay: relay, mero: connection.mero, contextId: contextId,
                    account: connection.session.account,
                    mintInvitation: MeroARService.cloudMinter(client.cloudSignIn, connection: connection))
            } catch MeroARError.noRelay {
                throw MeroARError.noRelay
            } catch {
                guard attempt < attempts else { throw error }
                attempt += 1
                try? await Task.sleep(nanoseconds: syncDelay)
            }
        }
    }

    /// Redeem an invitation to a whole home, then list it in the lobby.
    private func joinHome(_ invite: RoomInvite) async throws {
        let name = invite.homeName.flatMap { $0.isEmpty ? nil : $0 } ?? "the home"
        if let nodeMero {
            do {
                _ = try await nodeMero.admin.joinNamespace(
                    invite.namespaceId, request: JoinNamespaceRequest(invitation: invite.invitation))
            } catch {
                // Already a member is fine; whether the home lists decides.
            }
            _ = try? await nodeMero.admin.syncGroupContexts(invite.namespaceId)
        } else {
            let hadRelay = client.connection?.relay != nil
            var refusal: Error?
            do {
                _ = try await client.cloudSignIn.join(namespaceId: invite.namespaceId, invitation: invite.invitation)
            } catch {
                refusal = error
            }
            if !hadRelay { await client.restoreCloudSession() }
            if let refusal, client.connection?.relay == nil {
                throw MeroARError.invitationRefused(userMessage(refusal))
            }
        }
        // Cross-node sync is asynchronous: wait for the home to list.
        for attempt in 1...max(syncAttempts, 1) {
            await loadHomes()
            if homes.contains(where: { $0.id == invite.namespaceId }) {
                homeNotice = "You joined \(name). Pick a room to enter."
                return
            }
            if attempt < syncAttempts { try? await Task.sleep(nanoseconds: syncDelay) }
        }
        throw MeroARError.homeNotSynced
    }

    public func leaveRoom() {
        store?.stop()
        store = nil
        service = nil
        if phase == .inRoom { phase = .lobby }
    }

    public func forget(roomId: String) {
        recentRooms.removeAll { $0.id == roomId }
        saveRecent()
    }

    /// Redeem an invitation and return the room to enter.
    private func redeem(_ invite: RoomInvite) async throws -> String {
        if let nodeMero {
            // A node joins the namespace itself, then pulls the room's context.
            do {
                _ = try await nodeMero.admin.joinNamespace(
                    invite.namespaceId, request: JoinNamespaceRequest(invitation: invite.invitation))
            } catch {
                // Already a member is fine; the room's absence below decides.
            }
            _ = try? await nodeMero.admin.syncGroupContexts(invite.namespaceId)
            for attempt in 1...8 {
                if (try? await nodeMero.admin.getContext(invite.contextId)) != nil { return invite.contextId }
                if attempt < 8 { try? await Task.sleep(nanoseconds: 1_500_000_000) }
            }
            throw MeroARError.roomNotSynced
        }
        return try await redeemOnCloud(invite)
    }

    /// The SDK resolves the admitting relay through the Cloud manager, signs the
    /// member-join op with this device's certificate, and — for an account with
    /// no relay yet — adopts the admitting relay. Cross-node sync is
    /// asynchronous, so the room is polled for on the relay before entering.
    ///
    /// A refused join is KEPT, not discarded: "already a member" is fine to
    /// continue from, a rejected signature is terminal, and only the room's
    /// absence afterwards tells them apart.
    private func redeemOnCloud(_ invite: RoomInvite) async throws -> String {
        let hadRelay = client.connection?.relay != nil
        var joinRefusal: Error?
        do {
            _ = try await client.cloudSignIn.join(
                namespaceId: invite.namespaceId, invitation: invite.invitation)
        } catch {
            joinRefusal = error
        }

        // A relayless account just earned a relay: connect to it.
        if !hadRelay { await client.restoreCloudSession() }
        guard let relay = client.connection?.relay else {
            if let joinRefusal { throw MeroARError.invitationRefused(userMessage(joinRefusal)) }
            throw MeroARError.noRelay
        }

        for attempt in 1...8 {
            if (try? await relay.describe(invite.contextId)) != nil { return invite.contextId }
            if attempt < 8 { try? await Task.sleep(nanoseconds: 1_500_000_000) }
        }
        if let joinRefusal { throw MeroARError.invitationRefused(userMessage(joinRefusal)) }
        throw MeroARError.roomNotSynced
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
