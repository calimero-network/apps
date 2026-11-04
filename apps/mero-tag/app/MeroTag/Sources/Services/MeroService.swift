import Foundation
import MeroKit

/// Typed wrapper around the contract's methods. Arg structs use snake_case
/// keys to match the Rust parameter names (the node maps `args` onto method
/// params by name).
///
/// On core 1.0 the contract takes every owner, author and member id from the
/// caller's account and stamps records with the leader's clock, so nothing
/// here sends one. `memberId` is what the contract's `whoami` answered.
public final class MeroService: Sendable {
    public let transport: any ContextTransport
    public let appId: String
    public let memberId: String

    public init(transport: any ContextTransport, appId: String, memberId: String) {
        self.transport = transport
        self.appId = appId
        self.memberId = memberId
    }

    /// Ask the space who the signed-in account is, which is also the check
    /// that the account can reach it, and make a service for it.
    public static func open(transport: any ContextTransport, appId: String) async throws -> MeroService {
        let value = try await transport.query(appId: appId, method: "whoami", args: [:])
        let me = try ContractCoding.decode(Me.self, from: value, method: "whoami")
        return MeroService(transport: transport, appId: appId, memberId: me.memberId)
    }

    // MARK: Plumbing

    private func read<T: Decodable>(_ method: String, _ type: T.Type) async throws -> T {
        let value = try await transport.query(appId: appId, method: method, args: [:])
        return try ContractCoding.decode(type, from: value, method: method)
    }

    private func read<T: Decodable, A: Encodable>(_ method: String, _ args: A, _ type: T.Type) async throws -> T {
        let value = try await transport.query(appId: appId, method: method, args: try ContractCoding.args(args))
        return try ContractCoding.decode(type, from: value, method: method)
    }

    @discardableResult
    private func write<A: Encodable>(_ method: String, _ args: A) async throws -> JSONValue? {
        try await transport.execute(appId: appId, method: method, args: try ContractCoding.args(args))
    }

    // MARK: Reads

    public func whoami() async throws -> Me { try await read("whoami", Me.self) }
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
        struct Args: Encodable { let username: String }
        try await write("join", Args(username: username))
    }

    // MARK: Trackers

    @discardableResult
    public func createTracker(id: String, name: String) async throws -> String {
        struct Args: Encodable { let id: String; let name: String }
        let returned = try await write("create_tracker", Args(id: id, name: name))
        return returned?.stringValue ?? id
    }

    public func renameTracker(id: String, name: String) async throws {
        struct Args: Encodable { let id: String; let name: String }
        try await write("rename_tracker", Args(id: id, name: name))
    }

    public func deleteTracker(id: String) async throws {
        struct Args: Encodable { let id: String }
        try await write("delete_tracker", Args(id: id))
    }

    public func shareTracker(trackerId: String, userId: String) async throws {
        struct Args: Encodable { let tracker_id: String; let user_id: String }
        try await write("share_tracker", Args(tracker_id: trackerId, user_id: userId))
    }

    public func unshareTracker(trackerId: String, userId: String) async throws {
        struct Args: Encodable { let tracker_id: String; let user_id: String }
        try await write("unshare_tracker", Args(tracker_id: trackerId, user_id: userId))
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
            let id: String; let name: String; let center_lat: Double; let center_lng: Double; let radius: Double
        }
        let returned = try await write(
            "create_geofence", Args(id: id, name: name, center_lat: lat, center_lng: lng, radius: radius))
        return returned?.stringValue ?? id
    }

    public func reportGeofenceEvent(geofenceId: String, kind: String) async throws {
        struct Args: Encodable { let geofence_id: String; let kind: String }
        try await write("report_geofence_event", Args(geofence_id: geofenceId, kind: kind))
    }

    // MARK: Presence

    public func updatePresence(online: Bool) async throws {
        struct Args: Encodable { let online: Bool }
        try await write("update_presence", Args(online: online))
    }

    // MARK: Live events

    /// Contract events for this space, or `nil` when there is no event stream
    /// (the store polls instead).
    public func events() -> AsyncThrowingStream<[TagEvent], Error>? {
        guard let frames = transport.events(appId: appId) else { return nil }
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await frame in frames {
                        if let event = TagEvent(frame) { continuation.yield([event]) }
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
