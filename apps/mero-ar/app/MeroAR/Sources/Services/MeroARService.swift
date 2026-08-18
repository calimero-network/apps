import Foundation
import MeroKit

/// High-level wrapper over the Mero AR contract, on top of the shared Calimero
/// Swift SDK (`MeroKit`'s `Mero` actor — single-flight refresh, 401→refresh
/// retry, Keychain-backed tokens).
///
/// Top-level `argsJson` keys are snake_case (Rust parameter names); nested
/// structs (`transform`, `position`, `SceneObject`) use the camelCase encoding
/// the contract's serde derives expect. `MeroJSON` applies no key strategy, so
/// what is written here is what goes on the wire.
///
/// **No call carries `executorPublicKey`.** The node resolves the caller from
/// the auth token on the request and hands the contract `env::account_id()`; the
/// JSON-RPC `execute` payload has no such field to read, so passing one only
/// looked like it was steering something. Who a write is attributed to is
/// decided by which session signed it, not by an argument.
public final class MeroARService {
    public let mero: Mero
    public let contextId: String
    /// Who this session is in the room: an account id (64 hex), as
    /// `whoami` on the contract reports it. Compare roster rows, object authors,
    /// and the room owner against this — never against a context identity key.
    public let memberId: String

    public init(mero: Mero, contextId: String, memberId: String) {
        self.mero = mero
        self.contextId = contextId
        self.memberId = memberId
    }

    /// Ensure this node holds an identity in `contextId`, joining + pulling state
    /// first if the context arrived by invitation and was never opened here.
    ///
    /// Still required, and still the honest failure point: the node's membership
    /// check runs against this identity, so without one every call is rejected.
    /// It is no longer the *member id* though — see [`whoami`] — so the returned
    /// key is proof of membership and nothing more.
    @discardableResult
    public static func ensureIdentity(mero: Mero, contextId: String) async throws -> String {
        if let owned = try? await mero.admin.getContextIdentitiesOwned(contextId),
           let identity = owned.identities.first, !identity.isEmpty {
            return identity
        }
        _ = try? await mero.admin.joinContext(contextId)
        try? await mero.admin.syncContext(contextId)
        let owned = try await mero.admin.getContextIdentitiesOwned(contextId)
        guard let identity = owned.identities.first, !identity.isEmpty else {
            throw MeroARError.noIdentity
        }
        return identity
    }

    /// The account this session writes as, straight from the contract.
    ///
    /// The node-level `GET /admin-api/identity` (rc.23's replacement for the
    /// deleted per-namespace identity route) reports the same account, but it
    /// needs an admin scope and answers in a vocabulary this app otherwise never
    /// uses. Asking the room keeps one source for "who am I here".
    public static func whoami(mero: Mero, contextId: String) async throws -> String {
        try await mero.rpc.execute(contextId: contextId, method: "whoami", argsJson: [:])
    }

    private func ms() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }

    // ── Reads ───────────────────────────────────────────────────────────────
    public func getRoom() async throws -> RoomInfo { try await call("get_room") }
    public func getObjects() async throws -> [SceneObject] { try await call("get_objects") }
    public func getMembers() async throws -> [Member] { try await call("get_members") }
    public func getPresence() async throws -> [Presence] { try await call("get_presence") }
    public func getComments() async throws -> [SpatialComment] { try await call("get_comments") }

    public func getObject(id: String) async throws -> SceneObject? {
        try await callOptional("get_object", ["id": .string(id)])
    }

    // ── Roles ─────────────────────────────────────────────────────────────────
    /// The caller's effective role: "admin", "editor", or "viewer".
    public func myRole() async throws -> String { try await call("my_role") }
    public func canEdit() async throws -> Bool { try await call("can_edit") }
    public func listRoles() async throws -> [MemberRole] { try await call("list_roles") }

    public func grantEditor(member: String) async throws {
        try await callVoid("grant_editor", ["member": .string(member)])
    }
    public func revokeEditor(member: String) async throws {
        try await callVoid("revoke_editor", ["member": .string(member)])
    }
    public func transferOwnership(to member: String) async throws {
        try await callVoid("transfer_ownership", ["new_owner": .string(member)])
    }
    public func renameRoom(_ name: String) async throws {
        try await callVoid("rename_room", ["name": .string(name)])
    }

    // ── Membership ────────────────────────────────────────────────────────────
    /// Enter the room. The contract derives the member id from the signer, so
    /// only a display name goes over the wire.
    public func join(username: String) async throws {
        try await callVoid("join", [
            "username": .string(username),
            "avatar": .null,
            "timestamp": .number(Double(ms())),
        ])
    }

    public func updateUsername(_ username: String) async throws {
        try await callVoid("update_member_username", ["username": .string(username)])
    }

    // ── Objects ─────────────────────────────────────────────────────────────────
    @discardableResult
    public func addObject(_ object: SceneObject) async throws -> String {
        try await call("add_object", ["object": try JSONValue(encoding: object)])
    }

    public func updateTransform(id: String, transform: Transform) async throws {
        try await callVoid("update_transform", [
            "id": .string(id),
            "transform": try JSONValue(encoding: transform),
            "updated_at": .number(Double(ms())),
        ])
    }

    public func updateColor(id: String, color: String) async throws {
        try await callVoid("update_color", [
            "id": .string(id),
            "color": .string(color),
            "updated_at": .number(Double(ms())),
        ])
    }

    public func lock(id: String) async throws {
        try await callVoid("lock_object", ["id": .string(id)])
    }
    public func unlock(id: String) async throws {
        try await callVoid("unlock_object", ["id": .string(id)])
    }
    public func deleteObject(id: String) async throws {
        try await callVoid("delete_object", ["id": .string(id)])
    }
    public func clearObjects() async throws {
        try await callVoid("clear_objects")
    }

    // ── Comments ──────────────────────────────────────────────────────────────
    public func addComment(text: String, position: Vec3) async throws {
        try await callVoid("add_comment", [
            "id": .string(UUID().uuidString),
            "text": .string(text),
            "position": try JSONValue(encoding: position),
            "created_at": .number(Double(ms())),
        ])
    }

    public func deleteComment(id: String) async throws {
        try await callVoid("delete_comment", ["id": .string(id)])
    }

    // ── Presence ──────────────────────────────────────────────────────────────
    public func updatePresence(position: Vec3, rotation: Quat) async throws {
        try await callVoid("update_presence", [
            "camera_position": try JSONValue(encoding: position),
            "camera_rotation": try JSONValue(encoding: rotation),
            "updated_at": .number(Double(ms())),
        ])
    }

    // ── World map (ARWorldMap relocalization) ─────────────────────────────────
    /// Upload a serialized `ARWorldMap`, then point the room at the new blob.
    /// `contextId` on the upload makes the node announce the blob so peers can
    /// fetch it before the contract call even lands.
    @discardableResult
    public func publishWorldMap(_ data: Data) async throws -> String {
        let info = try await mero.admin.uploadBlob(
            UploadBlobRequest(data: data, contextId: contextId))
        try await callVoid("set_world_map", ["blob_id": .string(info.blobId)])
        return info.blobId
    }

    public func downloadWorldMap(blobId: String) async throws -> Data {
        try await mero.admin.getBlob(blobId)
    }

    // ── Live events ─────────────────────────────────────────────────────────────
    /// Contract events for this room, flattened out of the node's `StateMutation`
    /// envelope. The SSE stream reconnects itself; cancel the consuming task to
    /// close it.
    public func events() -> AsyncStream<ARSceneEvent> {
        let raw = mero.events(contextIds: [contextId])
        return AsyncStream { continuation in
            let task = Task {
                do {
                    for try await event in raw {
                        for decoded in ARSceneEvent.from(event) { continuation.yield(decoded) }
                    }
                } catch {
                    // The SDK's stream only throws once it has given up; the
                    // store falls back to polling on refresh.
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // ── RPC plumbing ──────────────────────────────────────────────────────────

    private func call<T: Decodable>(_ method: String, _ args: [String: JSONValue] = [:]) async throws -> T {
        try await mero.rpc.execute(contextId: contextId, method: method, argsJson: args)
    }

    /// A mutation whose return value we don't need. A contract method returning
    /// `()` (or `Result<()>`) sends no `output`, which the SDK reports as
    /// `emptyResponse` — for a void call that IS success.
    private func callVoid(_ method: String, _ args: [String: JSONValue] = [:]) async throws {
        do {
            let _: JSONValue = try await call(method, args)
        } catch let error as MeroError {
            if case .emptyResponse = error { return }
            throw error
        }
    }

    /// A read whose `Option<T>` result may be absent.
    private func callOptional<T: Decodable>(
        _ method: String, _ args: [String: JSONValue] = [:]
    ) async throws -> T? {
        do {
            return try await call(method, args) as T
        } catch let error as MeroError {
            if case .emptyResponse = error { return nil }
            throw error
        }
    }
}

// ── Errors ────────────────────────────────────────────────────────────────────

public enum MeroARError: LocalizedError {
    case noIdentity

    public var errorDescription: String? {
        switch self {
        case .noIdentity:
            return "This node has no identity in that room yet — check the room id, "
                + "or ask the owner to invite this node."
        }
    }
}

// ── Encodable → JSONValue ─────────────────────────────────────────────────────

extension JSONValue {
    /// Bridge a `Codable` model into the SDK's dynamic JSON type, preserving the
    /// model's own key names (no snake_case conversion) so nested contract
    /// structs stay camelCase.
    init<T: Encodable>(encoding value: T) throws {
        let data = try JSONEncoder().encode(value)
        self = try JSONDecoder().decode(JSONValue.self, from: data)
    }
}
