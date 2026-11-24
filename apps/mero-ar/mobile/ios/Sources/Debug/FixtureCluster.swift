#if DEBUG
import CryptoKit
import Foundation
import MeroKit

/// An in-memory Calimero 1.0 cluster with Mero AR deployed, for tests. Debug
/// builds only.
///
/// It is a ``RoomCluster``, so the app's real code runs end to end with no
/// network: ``MeroARService``, ``SceneStore`` and ``AppState``.
///
/// - **People**: each ``FixtureCluster`` instance is one account
///   (`sha256(username)`). Two instances on one shared state are two people on
///   one cluster.
/// - **Homes** are organizations: one lists only for its members. An invite
///   token names the organization, and redeeming it makes the caller a member.
/// - **The contract** mirrors `logic/src/lib.rs` where the UI depends on it:
///   the room's creator is its admin, joiners are viewers until granted
///   editor, writes need editor, the caller's account is stamped on what it
///   adds, the cluster stamps record times, and a room scan's version bumps on
///   each publish. Objects are kept as JSON, so any object kind round-trips.
/// - **No live events**: the stream finishes at once, so the store re-reads.
///
/// The app uses it when launched with `MEROAR_FIXTURE=1` (UI tests), with its
/// state in a file so a second launch, as someone else, sees the first one's
/// rooms. Unit tests call ``reset(stateFile:wipe:)``.
final class FixtureCluster: RoomCluster, @unchecked Sendable {
    static let endpointURL = "https://fixture.meroar.test"
    let username: String
    let account: String

    init(username: String) {
        self.username = username
        self.account = Self.account(username)
    }

    var endpoint: String { Self.endpointURL }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var state = State()
    nonisolated(unsafe) private static var stateFile: URL?
    /// Newer releases a test wants the fixture to offer.
    nonisolated(unsafe) static var latestVersion = "0.0.1"

    /// Start over, optionally keeping the state in `stateFile` (loaded if it exists).
    static func reset(stateFile: URL? = nil, wipe: Bool = true) {
        lock.lock()
        defer { lock.unlock() }
        self.stateFile = stateFile
        latestVersion = "0.0.1"
        if wipe, let stateFile { try? FileManager.default.removeItem(at: stateFile) }
        if let stateFile, let data = try? Data(contentsOf: stateFile),
            let loaded = try? JSONDecoder().decode(State.self, from: data)
        {
            state = loaded
        } else {
            state = State()
        }
    }

    /// The account id a username signs in as.
    static func account(_ username: String) -> String {
        SHA256.hash(data: Data(username.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: State

    struct Org: Codable {
        var id: String
        var name: String
        var members: [String]
    }

    struct Room: Codable {
        var id: String
        var org: String
        var name: String
        var version = "0.0.1"
        var admins: [String]
        var editors: [String] = []
        var members: [String: JSONValue] = [:]
        var objects: [String: JSONValue] = [:]
        var order: [String] = []
        var comments: [String: JSONValue] = [:]
        var presence: [String: JSONValue] = [:]
        var scan: JSONValue?
        var worldMap = ""
        var counter: UInt64 = 0
    }

    struct State: Codable {
        var orgs: [Org] = []
        var rooms: [Room] = []
        var blobs: [String: Data] = [:]
        /// Invite token → the organization it admits to.
        var invites: [String: String] = [:]
        var counter = 0
        var clock: UInt64 = 1_700_000_000_000
    }

    /// A refused request, shaped like the cluster's typed errors.
    struct Failure: Error, LocalizedError {
        let status: Int
        let message: String
        var errorDescription: String? { message }
    }

    private func locked<T>(_ work: () throws -> T) throws -> T {
        Self.lock.lock()
        defer {
            Self.save()
            Self.lock.unlock()
        }
        return try work()
    }

    private static func save() {
        guard let stateFile, let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: stateFile, options: .atomic)
    }

    private static func nextId() -> String {
        state.counter += 1
        return SHA256.hash(data: Data("fixture-\(state.counter)-\(UUID().uuidString)".utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    /// The cluster's clock, in ms, strictly increasing.
    private static func now() -> UInt64 {
        state.clock += 1
        return state.clock
    }

    private func org(_ id: String) throws -> Org {
        guard let org = Self.state.orgs.first(where: { $0.id == id }), org.members.contains(account) else {
            throw Failure(status: 404, message: "that home isn't there, or your account can't reach it")
        }
        return org
    }

    private func roomIndex(_ id: String) throws -> Int {
        guard let index = Self.state.rooms.firstIndex(where: { $0.id == id }) else {
            throw Failure(status: 404, message: "that room isn't there, or your account can't reach it")
        }
        _ = try org(Self.state.rooms[index].org)
        return index
    }

    // MARK: RoomCluster

    func view(app: String, method: String, args: [String: JSONValue]) async throws -> JSONValue? {
        try await call(app: app, method: method, args: args)
    }

    @discardableResult
    func call(app: String, method: String, args: [String: JSONValue]) async throws -> JSONValue? {
        try locked {
            let index = try roomIndex(app)
            // Work on a copy: an `inout` into `Self.state` would hold the whole
            // state exclusively, and `now()` bumps `Self.state.clock` mid-call.
            var room = Self.state.rooms[index]
            let out = try Self.call(method, .object(args), room: &room, caller: account)
            Self.state.rooms[index] = room
            return out == .null ? nil : out
        }
    }

    func events(app: String) -> AsyncThrowingStream<CloudEvent, Error> {
        AsyncThrowingStream { $0.finish() }
    }

    func uploadBlob(app: String, data: Data) async throws -> String {
        try locked {
            _ = try roomIndex(app)
            let id = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            Self.state.blobs[id] = data
            return id
        }
    }

    func downloadBlob(app: String, id: String) async throws -> Data {
        try locked {
            _ = try roomIndex(app)
            guard let data = Self.state.blobs[id] else { throw Failure(status: 404, message: "no such blob") }
            return data
        }
    }

    func listHomes() async throws -> HomeListing {
        try locked {
            let mine = Self.state.orgs.filter { $0.members.contains(account) }
            return HomeListing(homes: mine.map { org in
                Home(
                    id: org.id, name: org.name, memberCount: org.members.count,
                    rooms: Self.state.rooms.filter { $0.org == org.id }.map {
                        RoomSummary(id: $0.id, name: $0.name, lastOpened: nil)
                    })
            })
        }
    }

    func createHome(named name: String) async throws -> String {
        try locked {
            let org = Org(id: Self.nextId(), name: name, members: [account])
            Self.state.orgs.append(org)
            return org.id
        }
    }

    func createRoom(named name: String, inHome homeId: String) async throws -> String {
        try locked {
            _ = try org(homeId)
            let room = Room(id: Self.nextId(), org: homeId, name: name, admins: [account])
            Self.state.rooms.append(room)
            return room.id
        }
    }

    func home(ofRoom app: String) async throws -> String? {
        try locked { Self.state.rooms[try roomIndex(app)].org }
    }

    func homeName(_ homeId: String) async throws -> String {
        try locked { try org(homeId).name }
    }

    func invite(toHome homeId: String) async throws -> String {
        try locked {
            _ = try org(homeId)
            let token = "inv_" + Self.nextId().prefix(24)
            Self.state.invites[token] = homeId
            return token
        }
    }

    func redeem(token: String) async throws {
        try locked {
            guard let home = Self.state.invites[token], let index = Self.state.orgs.firstIndex(where: { $0.id == home })
            else { throw Failure(status: 404, message: "this invitation is unknown or has expired") }
            if !Self.state.orgs[index].members.contains(account) { Self.state.orgs[index].members.append(account) }
        }
    }

    func availableUpdate(app: String) async throws -> RoomUpdate? {
        try locked {
            let current = Self.state.rooms[try roomIndex(app)].version
            return current == Self.latestVersion ? nil : RoomUpdate(current: current, latest: Self.latestVersion)
        }
    }

    // MARK: The contract

    private static func call(_ method: String, _ args: JSONValue, room: inout Room, caller: String) throws -> JSONValue {
        func role(_ who: String) -> String {
            room.admins.contains(who) ? "admin" : room.editors.contains(who) ? "editor" : "viewer"
        }
        func requireEditor() throws {
            guard role(caller) != "viewer" else {
                throw Failure(status: 403, message: "view-only: editor or admin access is required to change this room")
            }
        }
        func requireAdmin() throws {
            guard role(caller) == "admin" else { throw Failure(status: 403, message: "admin access is required for this operation") }
        }
        func string(_ key: String) -> String { args[key]?.stringValue ?? "" }
        /// A `u64` argument arrives as a decimal string; a record keeps it a number.
        func number(_ value: JSONValue?) -> JSONValue? {
            guard let text = value?.stringValue, let n = UInt64(text) else { return nil }
            return .number(Double(n))
        }
        func bump() -> UInt64 {
            room.counter += 1
            return room.counter
        }
        func lockedByOther(_ id: String) -> Bool {
            guard let holder = room.objects[id]?["lockedBy"]?.stringValue else { return false }
            return holder != caller
        }

        switch method {
        case "whoami": return .string(caller)
        case "myRole": return .string(role(caller))
        case "canEdit": return .bool(role(caller) != "viewer")
        case "getRole": return .string(role(string("member")))
        case "listRoles":
            return .array(room.members.keys.sorted().map { ["member": .string($0), "role": .string(role($0))] })
        case "grantEditor":
            try requireAdmin()
            if !room.editors.contains(string("member")) { room.editors.append(string("member")) }
            return .null
        case "revokeEditor":
            try requireAdmin()
            room.editors.removeAll { $0 == string("member") }
            return .null
        case "getRoom":
            return [
                "name": .string(room.name), "objectCount": .number(Double(room.objects.count)),
                "memberCount": .number(Double(room.members.count)), "worldMapBlob": .string(room.worldMap),
                "version": .number(Double(room.counter)), "owner": .string(room.admins.first ?? ""),
            ]
        case "renameRoom":
            try requireAdmin()
            room.name = string("name")
            return .null
        case "join":
            if room.members[caller] == nil {
                room.members[caller] = [
                    "id": .string(caller), "username": .string(string("username")), "avatar": .null,
                    "joinedAt": .number(Double(now())),
                ]
            }
            return .null
        case "getMembers": return .array(room.members.keys.sorted().compactMap { room.members[$0] })
        case "updateMemberUsername":
            if case .object(var member)? = room.members[caller] {
                member["username"] = .string(string("username"))
                room.members[caller] = .object(member)
            }
            return .null
        case "addObject":
            try requireEditor()
            guard case .object(var object)? = args["object"], let id = object["id"]?.stringValue else {
                throw Failure(status: 400, message: "an object needs an id")
            }
            object["createdBy"] = .string(caller)
            object["createdAt"] = .number(Double(now()))
            object["updatedAt"] = .number(Double(now()))
            object["lockedBy"] = .null
            object["version"] = .number(Double(bump()))
            room.objects[id] = .object(object)
            if !room.order.contains(id) { room.order.append(id) }
            return .string(id)
        case "updateTransform", "updateColor":
            try requireEditor()
            let id = string("id")
            guard case .object(var object)? = room.objects[id], !lockedByOther(id) else { return .null }
            if method == "updateTransform" { object["transform"] = args["transform"] ?? .null }
            else { object["color"] = args["color"] ?? .null }
            object["updatedAt"] = .number(Double(now()))
            object["version"] = .number(Double(bump()))
            room.objects[id] = .object(object)
            return .null
        case "lockObject", "unlockObject":
            try requireEditor()
            let id = string("id")
            guard case .object(var object)? = room.objects[id] else { return .null }
            let holder = object["lockedBy"]?.stringValue
            if method == "lockObject", holder == nil {
                object["lockedBy"] = .string(caller)
            } else if method == "unlockObject", holder == caller || role(caller) == "admin" {
                object["lockedBy"] = .null
            }
            object["version"] = .number(Double(bump()))
            room.objects[id] = .object(object)
            return .null
        case "deleteObject":
            try requireEditor()
            let id = string("id")
            if !lockedByOther(id) {
                room.objects[id] = nil
                room.order.removeAll { $0 == id }
            }
            return .null
        case "clearObjects":
            try requireAdmin()
            room.objects = [:]
            room.order = []
            return .null
        case "getObjects": return .array(room.order.compactMap { room.objects[$0] })
        case "getObject": return room.objects[string("id")] ?? .null
        case "addComment":
            try requireEditor()
            room.comments[string("id")] = [
                "id": .string(string("id")), "text": .string(string("text")), "position": args["position"] ?? .null,
                "author": .string(caller), "createdAt": .number(Double(now())),
            ]
            return .null
        case "deleteComment":
            try requireEditor()
            let author = room.comments[string("id")]?["author"]?.stringValue
            guard author == nil || author == caller || role(caller) == "admin" else {
                throw Failure(status: 403, message: "only the comment's author or an admin can delete it")
            }
            room.comments[string("id")] = nil
            return .null
        case "getComments": return .array(room.comments.keys.sorted().compactMap { room.comments[$0] })
        case "updatePresence":
            room.presence[caller] = [
                "identity": .string(caller), "member": .string(caller), "cameraPosition": args["cameraPosition"] ?? .null,
                "cameraRotation": args["cameraRotation"] ?? .null, "updatedAt": .number(Double(now())),
            ]
            return .null
        case "getPresence": return .array(room.presence.keys.sorted().compactMap { room.presence[$0] })
        case "setWorldMap":
            try requireEditor()
            room.worldMap = string("blobId")
            return .null
        case "setRoomScan":
            try requireEditor()
            guard !string("jsonBlob").isEmpty else { throw Failure(status: 400, message: "a room scan needs its JSON blob") }
            let version = UInt64(room.scan?["version"]?.doubleValue ?? 0) + 1
            room.scan = [
                "jsonBlob": args["jsonBlob"] ?? .null, "jsonSize": number(args["jsonSize"]) ?? 0,
                "usdzBlob": args["usdzBlob"] ?? .null, "usdzSize": number(args["usdzSize"]) ?? .null,
                "width": args["width"] ?? 0, "length": args["length"] ?? 0, "height": args["height"] ?? 0,
                "objectCount": args["objectCount"] ?? 0, "sample": args["sample"] ?? false,
                "scannedBy": .string(caller), "scannedAt": .number(Double(now())),
                "version": .number(Double(version)),
            ]
            // A `u64` result is a decimal string on the wire.
            return .string(String(version))
        case "getRoomScan": return room.scan ?? .null
        case "clearRoomScan":
            try requireAdmin()
            room.scan = nil
            return .null
        default:
            throw Failure(status: 400, message: "the fixture contract has no method \(method)")
        }
    }
}

extension AppState {
    /// The app as launched: with `MEROAR_FIXTURE=1`, signed in to an
    /// in-memory ``FixtureCluster`` as `MEROAR_FIXTURE_USER` (UI tests), else
    /// as usual.
    ///
    /// `MEROAR_FIXTURE_RESET=1` starts the fixture empty. Each fixture user
    /// gets their own preferences, so two people taking turns on one device
    /// don't share recent rooms or a nickname.
    static func launch() -> AppState {
        let env = ProcessInfo.processInfo.environment
        guard env["MEROAR_FIXTURE"] == "1" else { return AppState() }
        let reset = env["MEROAR_FIXTURE_RESET"] == "1"
        let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("meroar-fixture.json")
        FixtureCluster.reset(stateFile: file, wipe: reset)
        let user = env["MEROAR_FIXTURE_USER"] ?? "fixture"
        let suite = "meroar.fixture.\(user)"
        let defaults = UserDefaults(suiteName: suite) ?? .standard
        if reset || env["MEROAR_FIXTURE_FRESH_USER"] == "1" { defaults.removePersistentDomain(forName: suite) }
        let state = AppState(defaults: defaults)
        state.useFixture(FixtureCluster(username: user))
        return state
    }
}
#endif
