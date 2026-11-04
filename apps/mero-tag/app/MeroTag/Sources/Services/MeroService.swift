import Foundation
import MeroKit

/// Typed wrapper around the contract's methods. Method names and argument keys
/// are camelCase, as the component ABI names them (the node maps `args` onto
/// method params by name). A `u64` argument (`timestamp`, `since`) is a decimal
/// string; inside a record it stays a JSON number.
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
    public func getSpace() async throws -> SpaceInfo { try await read("getSpace", SpaceInfo.self) }
    public func getTrackers() async throws -> [Tracker] { try await read("getTrackers", [Tracker].self) }
    public func getMembers() async throws -> [Member] { try await read("getMembers", [Member].self) }
    public func getGroups() async throws -> [TagGroup] { try await read("getGroups", [TagGroup].self) }
    public func getGeofences() async throws -> [Geofence] { try await read("getGeofences", [Geofence].self) }
    public func getPresence() async throws -> [Presence] { try await read("getPresence", [Presence].self) }

    public func getHistory(trackerId: String, since: UInt64 = 0) async throws -> [LocationSample] {
        struct Args: Encodable { let trackerId: String; let since: String }
        return try await read("getHistory", Args(trackerId: trackerId, since: String(since)), [LocationSample].self)
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
        let returned = try await write("createTracker", Args(id: id, name: name))
        return returned?.stringValue ?? id
    }

    public func renameTracker(id: String, name: String) async throws {
        struct Args: Encodable { let id: String; let name: String }
        try await write("renameTracker", Args(id: id, name: name))
    }

    public func deleteTracker(id: String) async throws {
        struct Args: Encodable { let id: String }
        try await write("deleteTracker", Args(id: id))
    }

    public func shareTracker(trackerId: String, userId: String) async throws {
        struct Args: Encodable { let trackerId: String; let userId: String }
        try await write("shareTracker", Args(trackerId: trackerId, userId: userId))
    }

    public func unshareTracker(trackerId: String, userId: String) async throws {
        struct Args: Encodable { let trackerId: String; let userId: String }
        try await write("unshareTracker", Args(trackerId: trackerId, userId: userId))
    }

    public func updateLocation(trackerId: String, _ loc: Location) async throws {
        struct Args: Encodable {
            let trackerId: String
            let latitude: Double; let longitude: Double; let altitude: Double
            let speed: Double; let heading: Double; let battery: Int; let timestamp: String
        }
        try await write(
            "updateLocation",
            Args(
                trackerId: trackerId, latitude: loc.latitude, longitude: loc.longitude,
                altitude: loc.altitude, speed: loc.speed, heading: loc.heading,
                battery: loc.battery, timestamp: String(loc.timestamp)))
    }

    // MARK: Geofences

    @discardableResult
    public func createGeofence(id: String, name: String, lat: Double, lng: Double, radius: Double) async throws
        -> String
    {
        struct Args: Encodable {
            let id: String; let name: String; let centerLat: Double; let centerLng: Double; let radius: Double
        }
        let returned = try await write(
            "createGeofence", Args(id: id, name: name, centerLat: lat, centerLng: lng, radius: radius))
        return returned?.stringValue ?? id
    }

    public func reportGeofenceEvent(geofenceId: String, kind: String) async throws {
        struct Args: Encodable { let geofenceId: String; let kind: String }
        try await write("reportGeofenceEvent", Args(geofenceId: geofenceId, kind: kind))
    }

    // MARK: Presence

    public func updatePresence(online: Bool) async throws {
        struct Args: Encodable { let online: Bool }
        try await write("updatePresence", Args(online: online))
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
