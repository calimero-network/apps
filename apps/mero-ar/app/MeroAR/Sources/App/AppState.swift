import Foundation
import MeroKit
import MeroKitUI

/// A room the lobby can list: one this person opened before, or one on the
/// node they signed in to.
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
    /// Display name sent to the room's roster on `join`.
    @Published public var displayName: String
    @Published public private(set) var recentRooms: [RoomSummary] = []
    /// Rooms on the signed-in node (node sessions only).
    @Published public private(set) var nodeRooms: [RoomSummary] = []
    @Published public private(set) var isEntering = false
    @Published public private(set) var isLoadingRooms = false
    /// Why the node's rooms couldn't be listed. Set only when the listing
    /// itself failed, so the lobby never reads a failure as "no rooms yet".
    @Published public private(set) var roomsError: String?
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
    /// Bumped by every ``loadNodeRooms()``; an older load that finishes late
    /// drops its result instead of overwriting a newer one.
    private var roomsLoad = 0
    private let urlSession: URLSession

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
    }

    /// "Continue with Calimero Cloud".
    public func signIn() async {
        await client.signInWithCloud(callbackScheme: Self.callbackScheme)
        if client.isAuthenticated { phase = .lobby }
    }

    /// A wallet callback delivered by the system (`onOpenURL`) rather than
    /// through the auth sheet.
    public func handle(url: URL) async {
        guard await client.handleEnrolmentCallback(url) else { return }
        if client.isAuthenticated, phase == .signedOut { phase = .lobby }
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
            if displayName.isEmpty { displayName = username }
            phase = .lobby
            await loadNodeRooms()
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
            nodeRooms = []
            roomsError = nil
        } else {
            await client.logout()
        }
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

    /// The node's Mero AR rooms: its contexts running this app.
    ///
    /// A failed listing is not an empty one: it keeps the rooms already shown
    /// and sets ``roomsError``, so a slow or unreachable node never reads as
    /// "No rooms yet" (which invites creating a duplicate room).
    public func loadNodeRooms() async {
        guard let nodeMero else { return }
        roomsLoad += 1
        let load = roomsLoad
        isLoadingRooms = true
        defer { if load == roomsLoad { isLoadingRooms = false } }
        let mine: [ContextWithGroup]
        do {
            let appIds = Set(
                try await nodeMero.admin.listApplications().apps.filter { $0.package == Self.package }.map(\.id))
            mine = appIds.isEmpty ? [] : try await nodeMero.admin.getContexts().contexts.filter {
                appIds.contains($0.applicationId)
            }
        } catch {
            // A cancelled load (pull-to-refresh torn down as the lobby is
            // replaced) didn't fail: it says nothing about the node.
            guard load == roomsLoad, self.nodeMero === nodeMero, !Task.isCancelled else { return }
            roomsError = userMessage(error)
            return
        }
        var rooms: [RoomSummary] = []
        let transport = NodeTransport(mero: nodeMero, nodeURL: nodeURL ?? "")
        for context in mine {
            let info = try? await transport.query(RoomInfo.self, contextId: context.id, method: "get_room")
            rooms.append(
                RoomSummary(
                    id: context.id, name: info?.name ?? "",
                    lastOpened: recentRooms.first { $0.id == context.id }?.lastOpened,
                    objectCount: info?.objectCount, memberCount: info?.memberCount))
        }
        guard load == roomsLoad, self.nodeMero === nodeMero else { return }
        roomsError = nil
        nodeRooms = rooms.sorted { ($0.lastOpened ?? .distantPast) > ($1.lastOpened ?? .distantPast) }
    }

    /// Create a room on the signed-in node: Mero AR from the registry (if the
    /// node doesn't have it yet), a namespace, an open group, and the room's
    /// context named `name`. Then enter it.
    public func createRoom(named rawName: String) async {
        guard let nodeMero else { return }
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            roomError = "Give the room a name."
            return
        }
        isEntering = true
        roomError = nil
        defer { isEntering = false }
        do {
            let appId: String
            if let bundle = ProcessInfo.processInfo.environment["MEROAR_APP_BUNDLE"], !bundle.isEmpty {
                // Development: a locally built .mpk (a path on the node's own
                // machine), for a contract newer than the registry's.
                appId = try await nodeMero.admin.installDevApplication(InstallDevApplicationRequest(path: bundle))
                    .applicationId
            } else if let installed = try await installedAppId(on: nodeMero) {
                appId = installed
            } else {
                guard
                    let version = try await nodeMero.admin.getRegistryVersions(
                        registryUrl: Self.registry, packageName: Self.package
                    ).first
                else { throw MeroError.decoding("\(Self.package) is not on the app registry") }
                appId = try await nodeMero.admin.installFromRegistry(packageName: Self.package, version: version)
                    .applicationId
            }
            let namespace = try await nodeMero.admin.createNamespace(
                CreateNamespaceRequest(applicationId: appId, name: name))
            let group = try await nodeMero.admin.createGroupInNamespace(
                namespace.namespaceId, request: CreateGroupInNamespaceRequest(groupName: name, visibility: "open"))
            let params = try JSONSerialization.data(withJSONObject: ["name": name])
            let context = try await nodeMero.admin.createContext(
                CreateContextRequest(
                    applicationId: appId, groupId: group.groupId, initializationParams: params.map { Int($0) },
                    name: name))
            remember(roomId: context.contextId, name: name)
            isEntering = false
            await enter(roomOrInvite: context.contextId)
            await loadNodeRooms()
        } catch {
            roomError = userMessage(error)
        }
    }

    /// Throws when the node can't list its apps, rather than reading that as
    /// "not installed" and installing a second copy.
    private func installedAppId(on mero: Mero) async throws -> String? {
        let apps = try await mero.admin.listApplications().apps
        // The newest install of the package (a dev bundle and a registry
        // install can sit side by side on a development node).
        return apps.last { $0.package == Self.package }?.id
    }

    /// Enter a room from whatever was pasted: an invitation link, a bare
    /// invitation token, or a room id.
    public func enter(roomOrInvite input: String, quiet: Bool = false) async {
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
                contextId = try await redeem(invite)
                invitedName = invite.roomName
            }
            let service: MeroARService
            if let nodeMero {
                service = try await MeroARService.open(
                    transport: NodeTransport(mero: nodeMero, nodeURL: nodeURL ?? ""), mero: nodeMero,
                    contextId: contextId, account: "", mintInvitation: MeroARService.nodeMinter(nodeMero))
            } else {
                guard let connection = client.connection, let relay = connection.relay else {
                    throw MeroARError.noRelay
                }
                service = try await MeroARService.open(
                    relay: relay, mero: connection.mero, contextId: contextId,
                    account: connection.session.account,
                    mintInvitation: MeroARService.cloudMinter(client.cloudSignIn, connection: connection))
            }
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
