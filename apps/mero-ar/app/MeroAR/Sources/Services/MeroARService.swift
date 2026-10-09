import Foundation
import MeroKit

/// The Mero AR contract, spoken through the account's Cloud relay.
///
/// A phone does not run a node and never holds a node password. After Cloud
/// sign-in (wallet passkey → device certificate → hosted relay) every call goes
/// through the SDK's relay session:
///
/// - **Writes** are warrant intents — ``RelayClient/execute(contextId:method:argsJson:)``.
///   The device signs a warrant naming the method and its arguments; the relay
///   executes it *as the account*, so the contract sees `env::account_id()` =
///   this person on every device they own.
/// - **Reads** are ``RelayClient/query(contextId:method:argsJson:)``: a Bearer
///   query for a view method, which the SDK upgrades to a warrant if the node
///   says the method writes.
/// - **Blobs and live events** need the relay's Bearer session (``Mero``),
///   which exists once the relay's node key is established. Without it the
///   room still works — the store polls instead of streaming, and the world map
///   cannot be shared — and ``CloudConnection/readNote`` says why.
///
/// Top-level `argsJson` keys are snake_case (Rust parameter names); nested
/// structs (`transform`, `position`, `SceneObject`) use the camelCase encoding
/// the contract's serde derives expect. `MeroJSON` applies no key strategy, so
/// what is written here is what goes on the wire — and into the warrant hash.
public final class MeroARService: @unchecked Sendable {
    public let relay: RelayClient
    /// The relay's Bearer session (blobs, invitations, SSE), or nil when the
    /// relay's node key could not be established.
    public let mero: Mero?
    public let contextId: String
    /// Who this session is in the room: an account id (64 hex), as `whoami` on
    /// the contract reports it. Compare roster rows, object authors and the room
    /// owner against this.
    public let memberId: String

    /// Signs a namespace invitation as the account (see ``InvitationMinter``),
    /// or nil when this session cannot — no Cloud connection behind it.
    let mintInvitation: InvitationMinter?

    public init(
        relay: RelayClient, mero: Mero?, contextId: String, memberId: String,
        mintInvitation: InvitationMinter? = nil
    ) {
        self.relay = relay
        self.mero = mero
        self.contextId = contextId
        self.memberId = memberId
        self.mintInvitation = mintInvitation
    }

    /// Mints a signed invitation to a namespace id.
    public typealias InvitationMinter = @Sendable (_ namespaceId: String) async throws -> SignedGroupOpenInvitation

    /// The account-signed minter: ``CloudSignIn/createNamespaceInvitation(_:namespaceId:invitedRole:validForSeconds:)``
    /// signs the invitation with this device's certificate key — the relay is
    /// only read (members, group info, routing), never asked to mint. The
    /// namespace's TEE relays are named as admitters, which is what lets an
    /// invitee with no node of their own be admitted.
    public static func cloudMinter(_ cloud: CloudSignIn, connection: CloudConnection) -> InvitationMinter {
        { namespaceId in try await cloud.createNamespaceInvitation(connection, namespaceId: namespaceId) }
    }

    /// Whether live events and blob transfer are available on this session.
    public var hasBearerSession: Bool { mero != nil }

    // MARK: - Entering a room

    /// Confirm the relay serves `contextId` and ask the room who we are.
    ///
    /// `describe` is the honest failure point: a relay that does not hold the
    /// context answers it with a typed 4xx, which reads far better than the
    /// first write failing later. `whoami` falls back to the signed-in account —
    /// the two are the same value whenever the relay executes as the author.
    public static func open(
        relay: RelayClient, mero: Mero?, contextId: String, account: String,
        mintInvitation: InvitationMinter? = nil
    ) async throws -> MeroARService {
        _ = try await relay.describe(contextId)
        let member = (try? await relay.query(String.self, contextId: contextId, method: "whoami"))
            .flatMap { $0.isEmpty ? nil : $0 } ?? account.lowercased()
        return MeroARService(
            relay: relay, mero: mero, contextId: contextId, memberId: member, mintInvitation: mintInvitation)
    }

    // MARK: - Invitations

    /// Mint a shareable invitation to this room.
    ///
    /// The room lives in a namespace (its root group); the invitation is issued
    /// against that namespace and **signed by the account on this device**
    /// (``InvitationMinter``), not minted ad hoc by the relay. The context id
    /// rides along so the joiner can enter the room directly instead of polling
    /// to see which context appeared.
    public func createRoomInvite() async throws -> RoomInvite {
        guard let mero, let mintInvitation else { throw MeroARError.readsUnavailable }
        guard let namespaceId = try await mero.admin.getContextGroup(contextId) else {
            throw MeroError.decoding("this room has no namespace to invite into")
        }
        let signed = try await mintInvitation(namespaceId)
        let name = (try? await getRoom().name) ?? ""
        return RoomInvite(namespaceId: namespaceId, contextId: contextId, roomName: name, invitation: signed)
    }

    // MARK: - Reads

    public func whoami() async throws -> String { try await read("whoami") }
    public func getRoom() async throws -> RoomInfo { try await read("get_room") }
    public func getObjects() async throws -> [SceneObject] { try await read("get_objects") }
    public func getMembers() async throws -> [Member] { try await read("get_members") }
    public func getPresence() async throws -> [Presence] { try await read("get_presence") }
    public func getComments() async throws -> [SpatialComment] { try await read("get_comments") }

    /// `Option<SceneObject>`: absent and `null` both come back as nil.
    public func getObject(id: String) async throws -> SceneObject? {
        let value = try await relay.query(contextId: contextId, method: "get_object", argsJson: ["id": .string(id)])
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

    /// Enter the room. The contract derives the member id from the warrant's
    /// author, so only a display name goes over the wire.
    public func join(username: String) async throws {
        try await write("join", [
            "username": .string(username),
            "avatar": .null,
            "timestamp": .number(Double(Self.ms())),
        ])
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
            "updated_at": .number(Double(Self.ms())),
        ])
    }

    public func updateColor(id: String, color: String) async throws {
        try await write("update_color", [
            "id": .string(id),
            "color": .string(color),
            "updated_at": .number(Double(Self.ms())),
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
            "created_at": .number(Double(Self.ms())),
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
            "updated_at": .number(Double(Self.ms())),
        ])
    }

    // MARK: - World map (ARWorldMap relocalization)

    /// How long a world-map upload may take.
    ///
    /// Not the SDK default: `MeroConfig.timeout` is 10 seconds (it mirrors
    /// mero-js), right for an admin call and wrong for an `ARWorldMap` of a
    /// scanned room, which is megabytes on a phone uplink. Downloads use the
    /// SDK's own context-blob timeout (60s, covering the node's 30s peer probe).
    static let uploadTimeout: TimeInterval = 120

    /// Upload a serialized `ARWorldMap`, then point the room at the new blob.
    @discardableResult
    public func publishWorldMap(_ data: Data) async throws -> String {
        let blobId = try await uploadWorldMap(data)
        try await write("set_world_map", ["blob_id": .string(blobId)])
        return blobId
    }

    /// Upload the bytes into this room's blob space and return the blob id.
    ///
    /// `context_id` is mandatory in practice: since core#3823 (0.11.0-rc.39)
    /// removed the blob DHT, it is the ONLY way another device's node can find
    /// the blob. An upload without it is announced to nobody.
    ///
    /// Same request `admin.uploadBlob` builds (raw octet-stream body,
    /// `context_id` in the query, `{ data: { blob_id, size } }` back), sent on
    /// the SDK transport only to carry ``uploadTimeout``.
    func uploadWorldMap(_ data: Data) async throws -> String {
        guard let mero else { throw MeroARError.readsUnavailable }
        let (response, _) = try await mero.http.sendRaw(
            HttpRequest(
                path: blobUploadPath,
                method: .put,
                body: .data(data, contentType: "application/octet-stream"),
                timeout: Self.uploadTimeout))
        let envelope = try MeroJSON.decode(ApiResponse<BlobRef>.self, from: response)
        guard let blobId = envelope.data?.blobId, !blobId.isEmpty else {
            throw MeroError.decoding("the relay accepted the world map but returned no blob id")
        }
        return blobId
    }

    /// Fetch the room's shared world map through the SDK blob API, naming the
    /// context so the node can find a blob a peer holds. A blob id is hex
    /// (core#3691) and used verbatim, never re-encoded.
    public func downloadWorldMap(blobId: String) async throws -> Data {
        guard let mero else { throw MeroARError.readsUnavailable }
        return try await mero.admin.getBlob(blobId, contextId: contextId)
    }

    /// `PUT` path for a world-map upload into this room.
    var blobUploadPath: String {
        "/admin-api/blobs?context_id=\(Self.query(contextId))"
    }

    /// Percent-encode an id for a URL. Ids are hex today and need no escaping;
    /// this keeps a future id spelling from producing a malformed path.
    static func query(_ value: String) -> String {
        value.addingPercentEncoding(
            withAllowedCharacters: CharacterSet(
                charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
            )) ?? value
    }

    /// `{ blob_id, size }` — core spells blob DTOs snake_case.
    struct BlobRef: Codable, Sendable {
        let blobId: String
        let size: Int?
        enum CodingKeys: String, CodingKey {
            case blobId = "blob_id"
            case size
        }
    }

    // MARK: - Live events

    /// Contract events for this room over the relay's Bearer SSE session,
    /// flattened out of the node's `StateMutation` envelope. Finishes at once
    /// when there is no Bearer session; the store polls then.
    public func events() -> AsyncStream<ARSceneEvent> {
        guard let mero else { return AsyncStream { $0.finish() } }
        let raw = mero.events(contextIds: [contextId])
        return AsyncStream { continuation in
            let task = Task {
                do {
                    for try await event in raw {
                        for decoded in ARSceneEvent.from(event) { continuation.yield(decoded) }
                    }
                } catch {
                    // The SDK's stream only throws once it has given up; the
                    // store reconnects and re-reads state.
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Relay plumbing

    private func read<T: Decodable>(_ method: String, _ args: [String: JSONValue] = [:]) async throws -> T {
        try await relay.query(T.self, contextId: contextId, method: method, argsJson: .object(args))
    }

    /// A warranted write. Contract methods returning `()` send no `returns`,
    /// which is success.
    private func write(_ method: String, _ args: [String: JSONValue] = [:]) async throws {
        _ = try await relay.execute(contextId: contextId, method: method, argsJson: .object(args))
    }

    private static func ms() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }
}

// MARK: - Errors

public enum MeroARError: LocalizedError, Equatable {
    /// Signed in, but no relay serves the account yet.
    case noRelay
    /// The relay's Bearer session is not established (blobs, invites, events).
    case readsUnavailable
    /// The invitation was redeemed but the room never reached the relay.
    case roomNotSynced
    case invitationRefused(String)

    public var errorDescription: String? {
        switch self {
        case .noRelay:
            return "Your account doesn't have a relay yet. Paste an invitation to a room to get one."
        case .readsUnavailable:
            return "The relay session isn't fully established yet, so this isn't available. Try again shortly."
        case .roomNotSynced:
            return "You joined the space, but the room hasn't reached your relay yet. Try again in a moment."
        case .invitationRefused(let reason):
            return "This invitation wasn't accepted: \(reason)"
        }
    }
}

/// The contract's own sentence for a refused call ("view-only: …"), else the
/// SDK's description.
func userMessage(_ error: Error) -> String {
    switch error {
    case AccountError.intentRefused(let reason, _, _):
        return reason
    case AccountError.invitationNotClaimable:
        return "Nobody could redeem an invite to this room yet: no relay that can admit people serves its space. "
            + "Try again once the space is hosted in Calimero Cloud."
    case MeroError.rpc(let rpcError):
        return rpcError.message
    case MeroError.authRevoked:
        return "Your session was revoked. Sign in again."
    case MeroError.network(let detail):
        return "Can't reach your relay: \(detail)"
    default:
        if let urlError = error as? URLError { return "Can't reach your relay (\(urlError.code.rawValue))." }
        return (error as? LocalizedError)?.errorDescription ?? "Something went wrong."
    }
}

// MARK: - Encodable → JSONValue

extension JSONValue {
    /// Bridge a `Codable` model into the SDK's dynamic JSON type, preserving the
    /// model's own key names (no snake_case conversion) so nested contract
    /// structs stay camelCase.
    init<T: Encodable>(encoding value: T) throws {
        let data = try JSONEncoder().encode(value)
        self = try JSONDecoder().decode(JSONValue.self, from: data)
    }
}
