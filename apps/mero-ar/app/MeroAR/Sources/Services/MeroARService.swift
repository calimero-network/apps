import Foundation
import MeroKit

/// High-level wrapper over the Mero AR contract. Top-level argsJson keys are
/// snake_case (Rust param names); nested structs (transform, vec3) use the
/// camelCase encoding the contract expects.
public final class MeroARService {
    public let client: MeroClient
    public let contextId: String
    public let memberId: String

    public init(client: MeroClient, contextId: String, memberId: String) {
        self.client = client
        self.contextId = contextId
        self.memberId = memberId
    }

    private func ms() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }

    // ── Reads ───────────────────────────────────────────────────────────────
    public func getRoom() async throws -> RoomInfo {
        try await client.rpc.execute(contextId: contextId, method: "get_room", args: RpcClient.NoArgs())
    }
    public func getObjects() async throws -> [SceneObject] {
        try await client.rpc.execute(contextId: contextId, method: "get_objects", args: RpcClient.NoArgs())
    }
    public func getMembers() async throws -> [Member] {
        try await client.rpc.execute(contextId: contextId, method: "get_members", args: RpcClient.NoArgs())
    }
    public func getPresence() async throws -> [Presence] {
        try await client.rpc.execute(contextId: contextId, method: "get_presence", args: RpcClient.NoArgs())
    }
    public func getComments() async throws -> [SpatialComment] {
        try await client.rpc.execute(contextId: contextId, method: "get_comments", args: RpcClient.NoArgs())
    }

    // ── Membership ────────────────────────────────────────────────────────────
    public func join(username: String) async throws {
        struct Args: Encodable { let member_id: String; let username: String; let avatar: String?; let timestamp: UInt64 }
        try await client.rpc.executeVoid(contextId: contextId, method: "join",
            args: Args(member_id: memberId, username: username, avatar: nil, timestamp: ms()))
    }

    // ── Objects ─────────────────────────────────────────────────────────────────
    @discardableResult
    public func addObject(_ object: SceneObject) async throws -> String {
        struct Args: Encodable { let object: SceneObject }
        return try await client.rpc.execute(contextId: contextId, method: "add_object", args: Args(object: object))
    }

    public func updateTransform(id: String, transform: Transform) async throws {
        struct Args: Encodable { let id: String; let transform: Transform; let editor: String; let updated_at: UInt64 }
        try await client.rpc.executeVoid(contextId: contextId, method: "update_transform",
            args: Args(id: id, transform: transform, editor: memberId, updated_at: ms()))
    }

    public func updateColor(id: String, color: String) async throws {
        struct Args: Encodable { let id: String; let color: String; let updated_at: UInt64 }
        try await client.rpc.executeVoid(contextId: contextId, method: "update_color",
            args: Args(id: id, color: color, updated_at: ms()))
    }

    public func lock(id: String) async throws {
        struct Args: Encodable { let id: String; let by: String }
        try await client.rpc.executeVoid(contextId: contextId, method: "lock_object", args: Args(id: id, by: memberId))
    }
    public func unlock(id: String) async throws {
        struct Args: Encodable { let id: String; let by: String }
        try await client.rpc.executeVoid(contextId: contextId, method: "unlock_object", args: Args(id: id, by: memberId))
    }
    public func deleteObject(id: String) async throws {
        struct Args: Encodable { let id: String }
        try await client.rpc.executeVoid(contextId: contextId, method: "delete_object", args: Args(id: id))
    }

    // ── Comments ──────────────────────────────────────────────────────────────
    public func addComment(text: String, position: Vec3) async throws {
        struct Args: Encodable { let id: String; let text: String; let position: Vec3; let author: String; let created_at: UInt64 }
        try await client.rpc.executeVoid(contextId: contextId, method: "add_comment",
            args: Args(id: UUID().uuidString, text: text, position: position, author: memberId, created_at: ms()))
    }

    // ── Presence ──────────────────────────────────────────────────────────────
    public func updatePresence(position: Vec3, rotation: Quat) async throws {
        struct Args: Encodable { let identity: String; let camera_position: Vec3; let camera_rotation: Quat; let updated_at: UInt64 }
        try await client.rpc.executeVoid(contextId: contextId, method: "update_presence",
            args: Args(identity: memberId, camera_position: position, camera_rotation: rotation, updated_at: ms()))
    }

    // ── World map (ARWorldMap relocalization) ─────────────────────────────────
    /// Upload a serialized ARWorldMap, then point the room at the new blob.
    public func publishWorldMap(_ data: Data) async throws -> String {
        let blobId = try await client.blobs.upload(data, contextId: contextId)
        struct Args: Encodable { let blob_id: String }
        try await client.rpc.executeVoid(contextId: contextId, method: "set_world_map", args: Args(blob_id: blobId))
        return blobId
    }
    public func downloadWorldMap(blobId: String) async throws -> Data {
        try await client.blobs.download(blobId)
    }

    // ── Live events ─────────────────────────────────────────────────────────────
    public func events() -> AsyncStream<ARSceneEvent> {
        let raw = client.sse.events(contexts: [contextId])
        return AsyncStream { continuation in
            let task = Task {
                for await ev in raw {
                    if let event = ARSceneEvent(data: ev.data) { continuation.yield(event) }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
