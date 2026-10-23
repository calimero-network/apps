#if DEBUG
import CryptoKit
import Foundation
import MeroKit

/// An in-memory Calimero node with Mero AR installed, for tests. Debug builds only.
///
/// It answers the HTTP a node session sends (`/auth/token`, the admin API's
/// namespaces, contexts, invitations and blobs, and `/jsonrpc`) as a
/// `URLProtocol`, so the app's real code runs end to end with no network:
/// ``NodeHomes``, ``NodeTransport``, ``MeroARService`` and ``SceneStore``.
///
/// - **People**: every username that signs in is its own account
///   (`sha256(username)`), told apart by its bearer token. Two app sessions on
///   one fixture are two people on one node.
/// - **Homes**: a namespace lists only for its members. An invitation names
///   the namespace, and joining it makes the caller a member.
/// - **The contract** mirrors `logic/src/lib.rs` where the UI depends on it:
///   the room's creator is its admin, joiners are viewers until granted
///   editor, writes need editor, the caller's account is stamped on what it
///   adds, and a room scan's version bumps on each publish. Objects are kept as
///   JSON, so any object kind the app sends round-trips.
/// - **No live events**: `/sse` is refused, so the store re-reads instead.
///
/// The app uses it when launched with `MEROAR_FIXTURE=1` (UI tests), with its
/// state in a file so a second launch, as someone else, sees the first one's
/// rooms. Unit tests call ``reset(stateFile:)`` and use ``session``.
final class FixtureNode: URLProtocol {
    static let baseURL = "http://fixture.meroar.test"
    static let applicationId = String(repeating: "a1", count: 32)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var state = State()
    nonisolated(unsafe) private static var stateFile: URL?

    /// Start over, optionally keeping the state in `stateFile` (loaded if it exists).
    static func reset(stateFile: URL? = nil, wipe: Bool = true) {
        lock.lock()
        defer { lock.unlock() }
        self.stateFile = stateFile
        if wipe, let stateFile { try? FileManager.default.removeItem(at: stateFile) }
        if let stateFile, let data = try? Data(contentsOf: stateFile),
            let loaded = try? JSONDecoder().decode(State.self, from: data)
        {
            state = loaded
        } else {
            state = State()
        }
    }

    static var session: URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FixtureNode.self]
        return URLSession(configuration: config)
    }

    /// The account id a username signs in as.
    static func account(_ username: String) -> String {
        SHA256.hash(data: Data(username.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: State

    struct Namespace: Codable {
        var id: String
        var name: String
        var members: [String]
        var createdAt: Int
    }

    struct Room: Codable {
        var id: String
        var namespace: String
        var name: String
        var admins: [String]
        var editors: [String] = []
        var members: [String: JSONValue] = [:]
        var objects: [String: JSONValue] = [:]
        var order: [String] = []
        var comments: [String: JSONValue] = [:]
        var presence: [String: JSONValue] = [:]
        var scan: JSONValue?
        var worldMap = ""
        var version: UInt64 = 0
    }

    struct State: Codable {
        var namespaces: [Namespace] = []
        var rooms: [Room] = []
        var blobs: [String: Data] = [:]
        /// Invitation salt (hex) → the namespace it admits to.
        var invitations: [String: String] = [:]
        var counter = 0
    }

    private struct Failure: Error {
        let status: Int
        let message: String
    }

    // MARK: URLProtocol

    override class func canInit(with request: URLRequest) -> Bool {
        request.url.map { $0.absoluteString.hasPrefix(baseURL) } ?? false
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url!
        let method = request.httpMethod ?? "GET"
        let body = Self.body(of: request)
        let token = (request.value(forHTTPHeaderField: "Authorization") ?? "").replacingOccurrences(of: "Bearer ", with: "")
        let user = token.hasPrefix("fx.") ? String(token.dropFirst(3)) : nil

        var status = 200
        var contentType = "application/json"
        var payload: Data
        Self.lock.lock()
        do {
            let reply = try Self.route(method: method, url: url, body: body, user: user)
            switch reply {
            case .json(let value):
                payload = try MeroJSON.encode(value)
            case .raw(let data):
                payload = data
                contentType = "application/octet-stream"
            }
            Self.save()
        } catch let failure as Failure {
            status = failure.status
            payload = Data(#"{"error":"\#(failure.message)"}"#.utf8)
        } catch {
            status = 500
            payload = Data(#"{"error":"\#(error)"}"#.utf8)
        }
        Self.lock.unlock()

        let response = HTTPURLResponse(
            url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": contentType])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: payload)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func body(of request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 16_384)
        while stream.hasBytesAvailable {
            let read = stream.read(&chunk, maxLength: chunk.count)
            if read <= 0 { break }
            buffer.append(chunk, count: read)
        }
        return buffer
    }

    private static func save() {
        guard let stateFile, let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: stateFile, options: .atomic)
    }

    private enum Reply {
        case json(JSONValue)
        case raw(Data)
    }

    private static func ok(_ data: JSONValue) -> Reply { .json(["data": data]) }

    private static func nextId() -> String {
        state.counter += 1
        return SHA256.hash(data: Data("fixture-\(state.counter)-\(UUID().uuidString)".utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Routes

    private static func route(method: String, url: URL, body: Data, user: String?) throws -> Reply {
        let parts = url.path.split(separator: "/").map(String.init)
        let json = (try? MeroJSON.decode(JSONValue.self, from: body)) ?? .null

        if method == "POST", url.path == "/auth/token" {
            let provider = json["providerData"] ?? json["provider_data"]
            let username = provider?["username"]?.stringValue
                ?? json["publicKey"]?.stringValue ?? json["public_key"]?.stringValue ?? ""
            let password = provider?["password"]?.stringValue ?? ""
            guard !username.isEmpty, password != "wrong" else { throw Failure(status: 401, message: "invalid credentials") }
            return ok(["access_token": .string("fx.\(username)"), "refresh_token": .string("fx.\(username)")])
        }
        if url.path.hasPrefix("/auth/") { return ok([:]) }

        guard let user else { throw Failure(status: 401, message: "no session") }
        let me = account(user)

        // Ids (64 hex) become `:id`, so routes read as paths.
        let id = parts.first { $0.count == 64 && $0.allSatisfy(\.isHexDigit) } ?? ""
        let key = method + " /" + parts.map { $0 == id && !id.isEmpty ? ":id" : $0 }.joined(separator: "/")
        switch key {
        case "POST /jsonrpc":
            return .json(rpc(json, caller: me))

        case "GET /admin-api/applications":
            return ok([
                "apps": [[
                    "id": .string(applicationId), "blob": ["bytecode": "b", "compiled": "c"], "size": 1,
                    "source": "registry", "metadata": [], "signer_id": "fixture", "package": .string(AppState.package),
                    "version": "0.0.1",
                ]]
            ])

        case "GET /admin-api/namespaces":
            return ok(.array(state.namespaces.filter { $0.members.contains(me) }.map(namespaceJSON)))

        case "POST /admin-api/namespaces":
            let namespace = Namespace(
                id: nextId(), name: json["name"]?.stringValue ?? "", members: [me],
                createdAt: Int(Date().timeIntervalSince1970))
            state.namespaces.append(namespace)
            return ok(["namespaceId": .string(namespace.id)])

        case "GET /admin-api/namespaces/:id":
            return ok(namespaceJSON(try namespace(id, for: me)))

        case "GET /admin-api/namespaces/:id/groups":
            _ = try namespace(id, for: me)
            return ok([])

        case "POST /admin-api/namespaces/:id/invite":
            _ = try namespace(id, for: me)
            let salt = (0..<32).map { _ in Int.random(in: 0...255) }
            state.invitations[salt.map { String(format: "%02x", $0) }.joined()] = id
            let invitation = SignedGroupOpenInvitation(
                invitation: GroupInvitationFromAdmin(
                    inviterIdentity: Array(repeating: 1, count: 32), groupId: Array(repeating: 2, count: 32),
                    expirationTimestamp: Int(Date().timeIntervalSince1970) + 86_400, secretSalt: salt),
                inviterSignature: String(repeating: "5", count: 88))
            return ok(["invitation": try JSONValue(encoding: invitation)])

        case "POST /admin-api/namespaces/:id/join":
            let inner = json["invitation"]?["invitation"]
            let salt = (inner?["secret_salt"]?.arrayValue ?? inner?["secretSalt"]?.arrayValue ?? [])
                .compactMap { $0.doubleValue.map { String(format: "%02x", Int($0)) } }.joined()
            guard state.invitations[salt] == id, let index = state.namespaces.firstIndex(where: { $0.id == id }) else {
                throw Failure(status: 403, message: "this invitation is not for that namespace")
            }
            if !state.namespaces[index].members.contains(me) { state.namespaces[index].members.append(me) }
            return ok(["namespaceId": .string(id), "memberIdentity": "fixture", "memberAccount": .string(me)])

        case "GET /admin-api/groups/:id/contexts":
            _ = try namespace(id, for: me)
            return ok(.array(state.rooms.filter { $0.namespace == id }.map {
                ["contextId": .string($0.id), "name": .string($0.name)]
            }))

        case "GET /admin-api/contexts":
            let mine = Set(state.namespaces.filter { $0.members.contains(me) }.map(\.id))
            return ok(["contexts": .array(state.rooms.filter { mine.contains($0.namespace) }.map(contextJSON))])

        case "POST /admin-api/contexts":
            let groupId = json["groupId"]?.stringValue ?? ""
            _ = try namespace(groupId, for: me)
            let params = (json["initializationParams"]?.arrayValue ?? []).compactMap { $0.doubleValue.map { UInt8($0) } }
            let initial = (try? MeroJSON.decode(JSONValue.self, from: Data(params)))?["name"]?.stringValue
            let room = Room(
                id: nextId(), namespace: groupId, name: initial ?? json["name"]?.stringValue ?? "", admins: [me])
            state.rooms.append(room)
            return ok(["contextId": .string(room.id), "memberPublicKey": "fixture", "groupId": .string(groupId)])

        case "GET /admin-api/contexts/:id":
            return ok(contextJSON(try room(id, for: me)))

        case "GET /admin-api/contexts/:id/group":
            return ok(.string(try room(id, for: me).namespace))

        case "PUT /admin-api/blobs":
            let id = SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
            state.blobs[id] = body
            return ok(["blob_id": .string(id), "size": .number(Double(body.count))])

        case "GET /admin-api/blobs/:id":
            guard let data = state.blobs[id] else { throw Failure(status: 404, message: "no such blob") }
            return .raw(data)

        default:
            throw Failure(status: 404, message: "the fixture node has no \(method) \(url.path)")
        }
    }

    private static func namespace(_ id: String, for me: String) throws -> Namespace {
        guard let namespace = state.namespaces.first(where: { $0.id == id }), namespace.members.contains(me) else {
            throw Failure(status: 404, message: "namespace not found")
        }
        return namespace
    }

    private static func room(_ id: String, for me: String) throws -> Room {
        guard let room = state.rooms.first(where: { $0.id == id }) else {
            throw Failure(status: 404, message: "context not found")
        }
        _ = try namespace(room.namespace, for: me)
        return room
    }

    private static func namespaceJSON(_ n: Namespace) -> JSONValue {
        [
            "namespaceId": .string(n.id), "appKey": "fixture", "targetApplicationId": .string(applicationId),
            "createdAt": .number(Double(n.createdAt)), "name": .string(n.name),
            "memberCount": .number(Double(n.members.count)),
            "contextCount": .number(Double(state.rooms.filter { $0.namespace == n.id }.count)), "subgroupCount": 0,
        ]
    }

    private static func contextJSON(_ r: Room) -> JSONValue {
        [
            "id": .string(r.id), "applicationId": .string(applicationId), "contextStateHash": "h", "dagHeads": [],
            "groupId": .string(r.namespace),
        ]
    }

    // MARK: The contract

    private static func rpc(_ request: JSONValue, caller: String) -> JSONValue {
        let params = request["params"] ?? .null
        let contextId = params["contextId"]?.stringValue ?? ""
        let method = params["method"]?.stringValue ?? ""
        let args = params["argsJson"] ?? [:]
        do {
            guard let index = state.rooms.firstIndex(where: { $0.id == contextId }) else {
                throw Failure(status: 404, message: "context not found")
            }
            _ = try namespace(state.rooms[index].namespace, for: caller)
            let output = try call(method, args, room: &state.rooms[index], caller: caller)
            return ["jsonrpc": "2.0", "id": 1, "result": ["output": output]]
        } catch let failure as Failure {
            return ["jsonrpc": "2.0", "id": 1, "error": ["type": "FunctionCallError", "data": .string(failure.message)]]
        } catch {
            return ["jsonrpc": "2.0", "id": 1, "error": ["type": "FunctionCallError", "data": .string("\(error)")]]
        }
    }

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
        func bump() -> UInt64 {
            room.version += 1
            return room.version
        }
        func lockedByOther(_ id: String) -> Bool {
            guard let holder = room.objects[id]?["lockedBy"]?.stringValue else { return false }
            return holder != caller
        }

        switch method {
        case "whoami": return .string(caller)
        case "my_role": return .string(role(caller))
        case "can_edit": return .bool(role(caller) != "viewer")
        case "get_role": return .string(role(string("member")))
        case "list_roles":
            return .array(room.members.keys.sorted().map { ["member": .string($0), "role": .string(role($0))] })
        case "grant_editor":
            try requireAdmin()
            if !room.editors.contains(string("member")) { room.editors.append(string("member")) }
            return .null
        case "revoke_editor":
            try requireAdmin()
            room.editors.removeAll { $0 == string("member") }
            return .null
        case "get_room":
            return [
                "name": .string(room.name), "objectCount": .number(Double(room.objects.count)),
                "memberCount": .number(Double(room.members.count)), "worldMapBlob": .string(room.worldMap),
                "version": .number(Double(room.version)), "owner": .string(room.admins.first ?? ""),
            ]
        case "rename_room":
            try requireAdmin()
            room.name = string("name")
            return .null
        case "join":
            if room.members[caller] == nil {
                room.members[caller] = [
                    "id": .string(caller), "username": .string(string("username")), "avatar": .null,
                    "joinedAt": args["timestamp"] ?? 0,
                ]
            }
            return .null
        case "get_members": return .array(room.members.keys.sorted().compactMap { room.members[$0] })
        case "update_member_username":
            if case .object(var member)? = room.members[caller] {
                member["username"] = .string(string("username"))
                room.members[caller] = .object(member)
            }
            return .null
        case "add_object":
            try requireEditor()
            guard case .object(var object)? = args["object"], let id = object["id"]?.stringValue else {
                throw Failure(status: 400, message: "an object needs an id")
            }
            object["createdBy"] = .string(caller)
            object["lockedBy"] = .null
            object["version"] = .number(Double(bump()))
            room.objects[id] = .object(object)
            if !room.order.contains(id) { room.order.append(id) }
            return .string(id)
        case "update_transform", "update_color":
            try requireEditor()
            let id = string("id")
            guard case .object(var object)? = room.objects[id], !lockedByOther(id) else { return .null }
            if method == "update_transform" { object["transform"] = args["transform"] ?? .null }
            else { object["color"] = args["color"] ?? .null }
            object["updatedAt"] = args["updated_at"] ?? 0
            object["version"] = .number(Double(bump()))
            room.objects[id] = .object(object)
            return .null
        case "lock_object", "unlock_object":
            try requireEditor()
            let id = string("id")
            guard case .object(var object)? = room.objects[id] else { return .null }
            let holder = object["lockedBy"]?.stringValue
            if method == "lock_object", holder == nil {
                object["lockedBy"] = .string(caller)
            } else if method == "unlock_object", holder == caller || role(caller) == "admin" {
                object["lockedBy"] = .null
            }
            object["version"] = .number(Double(bump()))
            room.objects[id] = .object(object)
            return .null
        case "delete_object":
            try requireEditor()
            let id = string("id")
            if !lockedByOther(id) {
                room.objects[id] = nil
                room.order.removeAll { $0 == id }
            }
            return .null
        case "clear_objects":
            try requireAdmin()
            room.objects = [:]
            room.order = []
            return .null
        case "get_objects": return .array(room.order.compactMap { room.objects[$0] })
        case "get_object": return room.objects[string("id")] ?? .null
        case "add_comment":
            try requireEditor()
            room.comments[string("id")] = [
                "id": .string(string("id")), "text": .string(string("text")), "position": args["position"] ?? .null,
                "author": .string(caller), "createdAt": args["created_at"] ?? 0,
            ]
            return .null
        case "delete_comment":
            try requireEditor()
            let author = room.comments[string("id")]?["author"]?.stringValue
            guard author == nil || author == caller || role(caller) == "admin" else {
                throw Failure(status: 403, message: "only the comment's author or an admin can delete it")
            }
            room.comments[string("id")] = nil
            return .null
        case "get_comments": return .array(room.comments.keys.sorted().compactMap { room.comments[$0] })
        case "update_presence":
            room.presence[caller] = [
                "identity": .string(caller), "member": .string(caller), "cameraPosition": args["camera_position"] ?? .null,
                "cameraRotation": args["camera_rotation"] ?? .null, "updatedAt": args["updated_at"] ?? 0,
            ]
            return .null
        case "get_presence": return .array(room.presence.keys.sorted().compactMap { room.presence[$0] })
        case "set_world_map":
            try requireEditor()
            room.worldMap = string("blob_id")
            return .null
        case "set_room_scan":
            try requireEditor()
            guard !string("json_blob").isEmpty else { throw Failure(status: 400, message: "a room scan needs its JSON blob") }
            let version = UInt64(room.scan?["version"]?.doubleValue ?? 0) + 1
            room.scan = [
                "jsonBlob": args["json_blob"] ?? .null, "jsonSize": args["json_size"] ?? 0,
                "usdzBlob": args["usdz_blob"] ?? .null, "usdzSize": args["usdz_size"] ?? .null,
                "width": args["width"] ?? 0, "length": args["length"] ?? 0, "height": args["height"] ?? 0,
                "objectCount": args["object_count"] ?? 0, "sample": args["sample"] ?? false,
                "scannedBy": .string(caller), "scannedAt": args["scanned_at"] ?? 0,
                "version": .number(Double(version)),
            ]
            return .number(Double(version))
        case "get_room_scan": return room.scan ?? .null
        case "clear_room_scan":
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
    /// in-memory ``FixtureNode`` (UI tests), else as usual.
    ///
    /// `MEROAR_FIXTURE_RESET=1` starts the fixture empty. Each fixture user
    /// gets their own preferences, so two people taking turns on one
    /// simulator don't share recent rooms or a nickname.
    static func launch() -> AppState {
        let env = ProcessInfo.processInfo.environment
        guard env["MEROAR_FIXTURE"] == "1" else { return AppState() }
        let reset = env["MEROAR_FIXTURE_RESET"] == "1"
        let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("meroar-fixture.json")
        FixtureNode.reset(stateFile: file, wipe: reset)
        let user = env["MEROAR_NODE_USER"] ?? "fixture"
        let suite = "meroar.fixture.\(user)"
        let defaults = UserDefaults(suiteName: suite) ?? .standard
        if reset || env["MEROAR_FIXTURE_FRESH_USER"] == "1" { defaults.removePersistentDomain(forName: suite) }
        return AppState(defaults: defaults, urlSession: FixtureNode.session)
    }
}
#endif
