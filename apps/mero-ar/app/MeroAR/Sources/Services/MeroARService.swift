import Foundation
import MeroKit

/// The Mero AR contract in one room (an app instance), spoken through a
/// ``RoomCluster``: on core 1.0 that is the sealed channel to the person's
/// Calimero cluster, signed in with their passkey.
///
/// - **Writes** are `POST /apps/{app}/intents`. They run once, on the room's
///   Raft leader, as the signed-in account: the contract sees
///   `env::account_id()` = this person, whichever device they use.
/// - **Reads** are `POST /apps/{app}/views`.
/// - **Blobs** (world maps, room scans, photos) live with the app instance.
/// - **Live events** are the app's sealed SSE stream.
///
/// Top-level argument keys are snake_case (Rust parameter names); nested
/// structs (`transform`, `position`, `SceneObject`) use the camelCase encoding
/// the contract's serde derives expect.
public final class MeroARService: @unchecked Sendable {
    public let cluster: RoomCluster
    /// The room's app id.
    public let contextId: String
    /// Who this session is in the room: an account id (64 hex), as `whoami` on
    /// the contract reports it. Compare roster rows, object authors and the room
    /// owner against this.
    public let memberId: String

    public init(cluster: RoomCluster, contextId: String, memberId: String) {
        self.cluster = cluster
        self.contextId = contextId
        self.memberId = memberId
    }

    /// Where calls go, for the technical details.
    public var endpoint: String { cluster.endpoint }

    // MARK: - Entering a room

    /// Ask the room who we are. The first read is also the honest failure
    /// point: a room the account can't reach answers it with a typed error.
    public static func open(cluster: RoomCluster, contextId: String) async throws -> MeroARService {
        let member = try await cluster.view(String.self, app: contextId, method: "whoami")
        return MeroARService(cluster: cluster, contextId: contextId, memberId: member.lowercased())
    }

    // MARK: - Invitations

    /// Mint a shareable invitation to this room: an invite to the room's home
    /// (its organization), with the room's app id riding along so the joiner
    /// enters it straight after redeeming.
    public func createRoomInvite() async throws -> RoomInvite {
        guard let home = try await cluster.home(ofRoom: contextId) else {
            throw MeroARError.invitationRefused("this room belongs to no home to invite people into")
        }
        let token = try await cluster.invite(toHome: home)
        let name = (try? await getRoom().name) ?? ""
        let homeName = try? await cluster.homeName(home)
        return RoomInvite(orgId: home, token: token, appId: contextId, roomName: name, homeName: homeName)
    }

    /// A newer Mero AR release this room could run, if there is one.
    public func availableUpdate() async throws -> RoomUpdate? { try await cluster.availableUpdate(app: contextId) }

    // MARK: - Reads

    public func whoami() async throws -> String { try await read("whoami") }
    public func getRoom() async throws -> RoomInfo { try await read("get_room") }
    public func getObjects() async throws -> [SceneObject] { try await read("get_objects") }
    public func getMembers() async throws -> [Member] { try await read("get_members") }
    public func getPresence() async throws -> [Presence] { try await read("get_presence") }
    public func getComments() async throws -> [SpatialComment] { try await read("get_comments") }

    /// `Option<SceneObject>`: absent and `null` both come back as nil.
    public func getObject(id: String) async throws -> SceneObject? {
        let value = try await cluster.view(app: contextId, method: "get_object", args: ["id": .string(id)])
        guard let value, value != .null else { return nil }
        return try MeroJSON.decode(SceneObject.self, from: try MeroJSON.encode(value))
    }

    // MARK: - Roles

    /// The caller's effective role: "admin", "editor", or "viewer".
    public func myRole() async throws -> String { try await read("my_role") }
    public func canEdit() async throws -> Bool { try await read("can_edit") }
    public func listRoles() async throws -> [MemberRole] { try await read("list_roles") }

    public func grantEditor(member: String) async throws {
        try await write("grant_editor", ["member": .string(member)])
    }
    public func revokeEditor(member: String) async throws {
        try await write("revoke_editor", ["member": .string(member)])
    }
    public func transferOwnership(to member: String) async throws {
        try await write("transfer_ownership", ["new_owner": .string(member)])
    }
    public func renameRoom(_ name: String) async throws {
        try await write("rename_room", ["name": .string(name)])
    }

    // MARK: - Membership

    /// Enter the room. The contract takes the member id from the caller's
    /// account, so only a display name goes over the wire.
    public func join(username: String) async throws {
        try await write("join", ["username": .string(username), "avatar": .null])
    }

    public func updateUsername(_ username: String) async throws {
        try await write("update_member_username", ["username": .string(username)])
    }

    // MARK: - Objects

    public func addObject(_ object: SceneObject) async throws {
        try await write("add_object", ["object": try JSONValue(encoding: object)])
    }

    public func updateTransform(id: String, transform: Transform) async throws {
        try await write("update_transform", [
            "id": .string(id),
            "transform": try JSONValue(encoding: transform),
        ])
    }

    public func updateColor(id: String, color: String) async throws {
        try await write("update_color", [
            "id": .string(id),
            "color": .string(color),
        ])
    }

    public func lock(id: String) async throws { try await write("lock_object", ["id": .string(id)]) }
    public func unlock(id: String) async throws { try await write("unlock_object", ["id": .string(id)]) }
    public func deleteObject(id: String) async throws { try await write("delete_object", ["id": .string(id)]) }
    public func clearObjects() async throws { try await write("clear_objects") }

    // MARK: - Comments

    public func addComment(text: String, position: Vec3) async throws {
        try await write("add_comment", [
            "id": .string(UUID().uuidString),
            "text": .string(text),
            "position": try JSONValue(encoding: position),
        ])
    }

    public func deleteComment(id: String) async throws {
        try await write("delete_comment", ["id": .string(id)])
    }

    // MARK: - Presence

    public func updatePresence(position: Vec3, rotation: Quat) async throws {
        try await write("update_presence", [
            "camera_position": try JSONValue(encoding: position),
            "camera_rotation": try JSONValue(encoding: rotation),
        ])
    }

    // MARK: - World map (ARWorldMap relocalization)

    /// Upload a serialized `ARWorldMap`, then point the room at the new blob.
    @discardableResult
    public func publishWorldMap(_ data: Data) async throws -> String {
        let blobId = try await uploadBlob(data)
        try await write("set_world_map", ["blob_id": .string(blobId)])
        return blobId
    }

    /// Upload bytes to this room's blobs and return the blob id.
    func uploadBlob(_ data: Data) async throws -> String {
        try await cluster.uploadBlob(app: contextId, data: data)
    }

    /// Fetch the room's shared world map.
    public func downloadWorldMap(blobId: String) async throws -> Data { try await downloadBlob(blobId: blobId) }

    /// Fetch any blob of this room (a world map, a photo).
    public func downloadBlob(blobId: String) async throws -> Data {
        try await cluster.downloadBlob(app: contextId, id: blobId)
    }

    // MARK: - Room scan (the shared 3D model of the room)

    /// The room's current scan, if one has been published.
    public func getRoomScan() async throws -> RoomScanRecord? {
        let value = try await cluster.view(app: contextId, method: "get_room_scan", args: [:])
        guard let value, value != .null else { return nil }
        return try MeroJSON.decode(RoomScanRecord.self, from: try MeroJSON.encode(value))
    }

    /// Upload the room model (and the USDZ, when there is one) into the room's
    /// blob space, then record them as the room's scan. Returns the new version.
    @discardableResult
    public func publishRoomScan(_ model: RoomModel, usdz: Data? = nil) async throws -> UInt64 {
        let json = try model.encoded()
        let jsonBlob = try await uploadBlob(json)
        var usdzBlob: JSONValue = .null
        var usdzSize: JSONValue = .null
        if let usdz {
            usdzBlob = .string(try await uploadBlob(usdz))
            usdzSize = .number(Double(usdz.count))
        }
        try await cluster.call(
            app: contextId, method: "set_room_scan",
            args: [
                "json_blob": .string(jsonBlob), "json_size": .number(Double(json.count)),
                "usdz_blob": usdzBlob, "usdz_size": usdzSize,
                "width": .number(Double(model.width)), "length": .number(Double(model.length)),
                "height": .number(Double(model.height)), "object_count": .number(Double(model.objects.count)),
                "sample": .bool(model.sample),
            ])
        return try await getRoomScan()?.version ?? 0
    }

    /// Remove the room's scan (admin).
    public func clearRoomScan() async throws { try await write("clear_room_scan") }

    /// Download the room model a scan record names.
    public func loadRoomModel(_ record: RoomScanRecord) async throws -> RoomModel {
        try RoomModel.decode(try await downloadBlob(blobId: record.jsonBlob))
    }

    // MARK: - Live events

    /// Contract events for this room, from the app's sealed SSE stream. The
    /// stream finishes when the connection drops; the store reconnects and
    /// re-reads state.
    public func events() -> AsyncStream<ARSceneEvent> {
        let raw = cluster.events(app: contextId)
        return AsyncStream { continuation in
            let task = Task {
                do {
                    for try await event in raw {
                        if let decoded = ARSceneEvent(event) { continuation.yield(decoded) }
                    }
                } catch {
                    // Reconnecting is the store's job.
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Plumbing

    private func read<T: Decodable>(_ method: String, _ args: [String: JSONValue] = [:]) async throws -> T {
        try await cluster.view(T.self, app: contextId, method: method, args: args)
    }

    /// A write. Contract methods returning `()` answer nothing, which is success.
    private func write(_ method: String, _ args: [String: JSONValue] = [:]) async throws {
        try await cluster.call(app: contextId, method: method, args: args)
    }
}
