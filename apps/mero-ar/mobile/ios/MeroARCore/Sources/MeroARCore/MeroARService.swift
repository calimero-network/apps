import Foundation
import MeroKit

/// The Mero AR contract in one room (an app instance), spoken through a
/// ``RoomCluster``: on core 1.0 that is the sealed channel to the person's
/// Calimero cluster, signed in with their passkey.
///
/// - **Writes** are `POST /apps/{app}/intents`. They run once, on the room's
///   Raft leader, as the signed-in account: the contract sees
///   `env::caller()` = this person, whichever device they use.
/// - **Reads** are `POST /apps/{app}/views`.
/// - **Blobs** (world maps, room scans, photos) live with the app instance.
/// - **Live events** are the app's sealed SSE stream.
///
/// Methods and top-level argument keys are camelCase, as the component ABI
/// names them; nested structs (`transform`, `position`, `SceneObject`) use the
/// camelCase encoding the contract's serde derives expect. A `u64` argument
/// (`jsonSize`, `usdzSize`) or result (`setRoomScan`'s version) is a decimal
/// string; inside a record (`SceneObject.version`, `RoomScan.jsonSize`) it stays
/// a JSON number.
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
        let member = try await MeroArClient(contract: RoomContract(cluster: cluster, app: contextId)).whoami()
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

    public func whoami() async throws -> String { try await contract.whoami() }
    public func getRoom() async throws -> RoomInfo { try Self.model(try await contract.getRoom()) }
    public func getObjects() async throws -> [SceneObject] { try Self.models(try await contract.getObjects()) }
    public func getMembers() async throws -> [Member] { try Self.models(try await contract.getMembers()) }
    public func getPresence() async throws -> [Presence] { try Self.models(try await contract.getPresence()) }
    public func getComments() async throws -> [SpatialComment] { try Self.models(try await contract.getComments()) }

    /// `Option<SceneObject>`: absent and `null` both come back as nil.
    public func getObject(id: String) async throws -> SceneObject? {
        guard let value = try await contract.getObject(id: id), value != .null else { return nil }
        return try Self.model(value)
    }

    // MARK: - Roles

    /// The caller's effective role: "admin", "editor", or "viewer".
    public func myRole() async throws -> String { try await contract.myRole() }
    public func canEdit() async throws -> Bool { try await contract.canEdit() }
    public func listRoles() async throws -> [MemberRole] { try Self.models(try await contract.listRoles()) }

    public func grantEditor(member: String) async throws { try await contract.grantEditor(member: member) }
    public func revokeEditor(member: String) async throws { try await contract.revokeEditor(member: member) }
    public func transferOwnership(to member: String) async throws { try await contract.transferOwnership(newOwner: member) }
    public func renameRoom(_ name: String) async throws { try await contract.renameRoom(name: name) }

    // MARK: - Membership

    /// Enter the room. The contract takes the member id from the caller's
    /// account, so only a display name goes over the wire.
    public func join(username: String) async throws { try await contract.join(username: username) }

    public func updateUsername(_ username: String) async throws {
        try await contract.updateMemberUsername(username: username)
    }

    // MARK: - Objects

    /// Adds the object; the contract answers its id, which is `object.id`.
    public func addObject(_ object: SceneObject) async throws {
        _ = try await contract.addObject(object: try JSONValue(encoding: object))
    }

    public func updateTransform(id: String, transform: Transform) async throws {
        try await contract.updateTransform(id: id, transform: try JSONValue(encoding: transform))
    }

    public func updateColor(id: String, color: String) async throws {
        try await contract.updateColor(id: id, color: color)
    }

    public func lock(id: String) async throws { try await contract.lockObject(id: id) }
    public func unlock(id: String) async throws { try await contract.unlockObject(id: id) }
    public func deleteObject(id: String) async throws { try await contract.deleteObject(id: id) }
    public func clearObjects() async throws { try await contract.clearObjects() }

    // MARK: - Comments

    public func addComment(text: String, position: Vec3) async throws {
        try await contract.addComment(id: UUID().uuidString, text: text, position: try JSONValue(encoding: position))
    }

    public func deleteComment(id: String) async throws { try await contract.deleteComment(id: id) }

    // MARK: - Presence

    public func updatePresence(position: Vec3, rotation: Quat) async throws {
        try await contract.updatePresence(
            cameraPosition: try JSONValue(encoding: position), cameraRotation: try JSONValue(encoding: rotation))
    }

    // MARK: - World map (ARWorldMap relocalization)

    /// Upload a serialized `ARWorldMap`, then point the room at the new blob.
    @discardableResult
    public func publishWorldMap(_ data: Data) async throws -> String {
        let blobId = try await uploadBlob(data)
        try await contract.setWorldMap(blobId: blobId)
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
        guard let value = try await contract.getRoomScan(), value != .null else { return nil }
        return try Self.model(value)
    }

    /// Upload the room model (and the USDZ, when there is one) into the room's
    /// blob space, then record them as the room's scan. Returns the new version.
    @discardableResult
    public func publishRoomScan(_ model: RoomModel, usdz: Data? = nil) async throws -> UInt64 {
        let json = try model.encoded()
        let jsonBlob = try await uploadBlob(json)
        var usdzBlob: String?
        var usdzSize: UInt64?
        if let usdz {
            usdzBlob = try await uploadBlob(usdz)
            usdzSize = UInt64(usdz.count)
        }
        _ = try await contract.setRoomScan(
            jsonBlob: jsonBlob, jsonSize: UInt64(json.count), usdzBlob: usdzBlob, usdzSize: usdzSize,
            width: Double(model.width), length: Double(model.length), height: Double(model.height),
            objectCount: UInt32(model.objects.count), sample: model.sample)
        return try await getRoomScan()?.version ?? 0
    }

    /// Remove the room's scan (admin).
    public func clearRoomScan() async throws { try await contract.clearRoomScan() }

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

    /// The room's contract through the client `meroctl app codegen` generated from
    /// `logic/res/abi.json` (`Generated/MeroArClient.swift`).
    private var contract: MeroArClient { MeroArClient(contract: RoomContract(cluster: cluster, app: contextId)) }

    /// The ABI names the contract's records without their shape, so the client
    /// answers their JSON; this reads it into the models the app keeps.
    private static func model<T: Decodable>(_ value: JSONValue) throws -> T {
        try MeroJSON.decode(T.self, from: try MeroJSON.encode(value))
    }

    private static func models<T: Decodable>(_ values: [JSONValue]) throws -> [T] {
        try values.map { try model($0) }
    }
}
