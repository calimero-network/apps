import Foundation
import MeroKit

/// High-level wrapper around the contract methods. All arg structs use
/// snake_case keys to match the Rust function parameter names (the node maps
/// `argsJson` onto method params by name).
public final class MeroService {
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

    public func getSpace() async throws -> SpaceInfo {
        try await client.rpc.execute(contextId: contextId, method: "get_space", args: RpcClient.NoArgs())
    }
    public func getTrackers() async throws -> [Tracker] {
        try await client.rpc.execute(contextId: contextId, method: "get_trackers", args: RpcClient.NoArgs())
    }
    public func getMembers() async throws -> [Member] {
        try await client.rpc.execute(contextId: contextId, method: "get_members", args: RpcClient.NoArgs())
    }
    public func getGroups() async throws -> [TagGroup] {
        try await client.rpc.execute(contextId: contextId, method: "get_groups", args: RpcClient.NoArgs())
    }
    public func getGeofences() async throws -> [Geofence] {
        try await client.rpc.execute(contextId: contextId, method: "get_geofences", args: RpcClient.NoArgs())
    }
    public func getPresence() async throws -> [Presence] {
        try await client.rpc.execute(contextId: contextId, method: "get_presence", args: RpcClient.NoArgs())
    }
    public func getHistory(trackerId: String, since: UInt64 = 0) async throws -> [LocationSample] {
        struct Args: Encodable { let tracker_id: String; let since: UInt64 }
        return try await client.rpc.execute(contextId: contextId, method: "get_history",
                                            args: Args(tracker_id: trackerId, since: since))
    }

    // ── Members ─────────────────────────────────────────────────────────────

    public func join(username: String) async throws {
        struct Args: Encodable { let member_id: String; let username: String; let timestamp: UInt64 }
        try await client.rpc.executeVoid(contextId: contextId, method: "join",
                                         args: Args(member_id: memberId, username: username, timestamp: ms()))
    }

    // ── Trackers ────────────────────────────────────────────────────────────

    @discardableResult
    public func createTracker(id: String, name: String) async throws -> String {
        struct Args: Encodable { let id: String; let name: String; let owner_id: String; let created_at: UInt64 }
        return try await client.rpc.execute(contextId: contextId, method: "create_tracker",
                                            args: Args(id: id, name: name, owner_id: memberId, created_at: ms()))
    }

    public func renameTracker(id: String, name: String) async throws {
        struct Args: Encodable { let id: String; let name: String; let updated_at: UInt64 }
        try await client.rpc.executeVoid(contextId: contextId, method: "rename_tracker",
                                         args: Args(id: id, name: name, updated_at: ms()))
    }

    public func deleteTracker(id: String) async throws {
        struct Args: Encodable { let id: String }
        try await client.rpc.executeVoid(contextId: contextId, method: "delete_tracker", args: Args(id: id))
    }

    public func shareTracker(trackerId: String, userId: String) async throws {
        struct Args: Encodable { let tracker_id: String; let user_id: String; let updated_at: UInt64 }
        try await client.rpc.executeVoid(contextId: contextId, method: "share_tracker",
                                         args: Args(tracker_id: trackerId, user_id: userId, updated_at: ms()))
    }

    public func updateLocation(trackerId: String, _ loc: Location) async throws {
        struct Args: Encodable {
            let tracker_id: String
            let latitude: Double; let longitude: Double; let altitude: Double
            let speed: Double; let heading: Double; let battery: Int; let timestamp: UInt64
        }
        try await client.rpc.executeVoid(contextId: contextId, method: "update_location",
            args: Args(tracker_id: trackerId, latitude: loc.latitude, longitude: loc.longitude,
                       altitude: loc.altitude, speed: loc.speed, heading: loc.heading,
                       battery: loc.battery, timestamp: loc.timestamp))
    }

    // ── Geofences ───────────────────────────────────────────────────────────

    @discardableResult
    public func createGeofence(id: String, name: String, lat: Double, lng: Double, radius: Double) async throws -> String {
        struct Args: Encodable {
            let id: String; let name: String; let center_lat: Double; let center_lng: Double
            let radius: Double; let created_by: String; let created_at: UInt64
        }
        return try await client.rpc.execute(contextId: contextId, method: "create_geofence",
            args: Args(id: id, name: name, center_lat: lat, center_lng: lng,
                       radius: radius, created_by: memberId, created_at: ms()))
    }

    public func reportGeofenceEvent(geofenceId: String, kind: String) async throws {
        struct Args: Encodable { let geofence_id: String; let kind: String }
        try await client.rpc.executeVoid(contextId: contextId, method: "report_geofence_event",
                                         args: Args(geofence_id: geofenceId, kind: kind))
    }

    // ── Presence ────────────────────────────────────────────────────────────

    public func updatePresence(online: Bool) async throws {
        struct Args: Encodable { let user_id: String; let online: Bool; let last_seen: UInt64 }
        try await client.rpc.executeVoid(contextId: contextId, method: "update_presence",
                                         args: Args(user_id: memberId, online: online, last_seen: ms()))
    }

    // ── Live events ─────────────────────────────────────────────────────────

    public func events() -> AsyncStream<TagEvent> {
        let raw = client.sse.events(contexts: [contextId])
        return AsyncStream { continuation in
            let task = Task {
                for await ev in raw {
                    if let event = TagEvent(data: ev.data) { continuation.yield(event) }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
