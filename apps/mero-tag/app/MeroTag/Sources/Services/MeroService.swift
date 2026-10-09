import Foundation
import MeroKit

/// Typed wrapper around the contract's methods. Arg structs use snake_case
/// keys to match the Rust parameter names (the node maps `argsJson` onto
/// method params by name). `memberId` is the signed-in Calimero account.
public final class MeroService: Sendable {
    public let transport: any ContextTransport
    public let contextId: String
    public let memberId: String
    private let now: @Sendable () -> UInt64

    public init(
        transport: any ContextTransport, contextId: String, memberId: String,
        now: @escaping @Sendable () -> UInt64 = { UInt64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.transport = transport
        self.contextId = contextId
        self.memberId = memberId
        self.now = now
    }

    // MARK: Plumbing

    private func read<T: Decodable>(_ method: String, _ type: T.Type) async throws -> T {
        let value = try await transport.query(contextId: contextId, method: method, args: [:])
        return try ContractCoding.decode(type, from: value, method: method)
    }

    private func read<T: Decodable, A: Encodable>(_ method: String, _ args: A, _ type: T.Type) async throws -> T {
        let value = try await transport.query(
            contextId: contextId, method: method, args: try ContractCoding.args(args))
        return try ContractCoding.decode(type, from: value, method: method)
    }

    @discardableResult
    private func write<A: Encodable>(_ method: String, _ args: A) async throws -> JSONValue? {
        try await transport.execute(contextId: contextId, method: method, args: try ContractCoding.args(args))
    }

    // MARK: Reads

    public func getSpace() async throws -> SpaceInfo { try await read("get_space", SpaceInfo.self) }
    public func getTrackers() async throws -> [Tracker] { try await read("get_trackers", [Tracker].self) }
    public func getMembers() async throws -> [Member] { try await read("get_members", [Member].self) }
    public func getGroups() async throws -> [TagGroup] { try await read("get_groups", [TagGroup].self) }
    public func getGeofences() async throws -> [Geofence] { try await read("get_geofences", [Geofence].self) }
    public func getPresence() async throws -> [Presence] { try await read("get_presence", [Presence].self) }

    public func getHistory(trackerId: String, since: UInt64 = 0) async throws -> [LocationSample] {
        struct Args: Encodable { let tracker_id: String; let since: UInt64 }
        return try await read("get_history", Args(tracker_id: trackerId, since: since), [LocationSample].self)
    }

    // MARK: Members

    public func join(username: String) async throws {
        struct Args: Encodable { let member_id: String; let username: String; let timestamp: UInt64 }
        try await write("join", Args(member_id: memberId, username: username, timestamp: now()))
    }

    // MARK: Trackers

    @discardableResult
    public func createTracker(id: String, name: String) async throws -> String {
        struct Args: Encodable { let id: String; let name: String; let owner_id: String; let created_at: UInt64 }
        let returned = try await write("create_tracker", Args(id: id, name: name, owner_id: memberId, created_at: now()))
        return returned?.stringValue ?? id
    }

    public func renameTracker(id: String, name: String) async throws {
        struct Args: Encodable { let id: String; let name: String; let updated_at: UInt64 }
        try await write("rename_tracker", Args(id: id, name: name, updated_at: now()))
    }

    public func deleteTracker(id: String) async throws {
        struct Args: Encodable { let id: String }
        try await write("delete_tracker", Args(id: id))
    }

    public func shareTracker(trackerId: String, userId: String) async throws {
        struct Args: Encodable { let tracker_id: String; let user_id: String; let updated_at: UInt64 }
        try await write("share_tracker", Args(tracker_id: trackerId, user_id: userId, updated_at: now()))
    }

    public func unshareTracker(trackerId: String, userId: String) async throws {
        struct Args: Encodable { let tracker_id: String; let user_id: String; let updated_at: UInt64 }
        try await write("unshare_tracker", Args(tracker_id: trackerId, user_id: userId, updated_at: now()))
    }

    public func updateLocation(trackerId: String, _ loc: Location) async throws {
        struct Args: Encodable {
            let tracker_id: String
            let latitude: Double; let longitude: Double; let altitude: Double
            let speed: Double; let heading: Double; let battery: Int; let timestamp: UInt64
        }
        try await write(
            "update_location",
            Args(
                tracker_id: trackerId, latitude: loc.latitude, longitude: loc.longitude,
                altitude: loc.altitude, speed: loc.speed, heading: loc.heading,
                battery: loc.battery, timestamp: loc.timestamp))
    }

    // MARK: Geofences

    @discardableResult
    public func createGeofence(id: String, name: String, lat: Double, lng: Double, radius: Double) async throws
        -> String
    {
        struct Args: Encodable {
            let id: String; let name: String; let center_lat: Double; let center_lng: Double
            let radius: Double; let created_by: String; let created_at: UInt64
        }
        let returned = try await write(
            "create_geofence",
            Args(
                id: id, name: name, center_lat: lat, center_lng: lng,
                radius: radius, created_by: memberId, created_at: now()))
        return returned?.stringValue ?? id
    }

    public func reportGeofenceEvent(geofenceId: String, kind: String) async throws {
        struct Args: Encodable { let geofence_id: String; let kind: String }
        try await write("report_geofence_event", Args(geofence_id: geofenceId, kind: kind))
    }

    // MARK: Presence

    public func updatePresence(online: Bool) async throws {
        struct Args: Encodable { let user_id: String; let online: Bool; let last_seen: UInt64 }
        try await write("update_presence", Args(user_id: memberId, online: online, last_seen: now()))
    }

    // MARK: Live events

    /// Contract events for this context, or `nil` when the relay session that
    /// carries them is unavailable (the store polls instead).
    public func events() -> AsyncThrowingStream<[TagEvent], Error>? {
        guard let frames = transport.events(contextId: contextId) else { return nil }
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await frame in frames {
                        let events = TagEvent.events(inFrame: frame)
                        if !events.isEmpty { continuation.yield(events) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
