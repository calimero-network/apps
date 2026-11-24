import Foundation
import MeroKit

/// A space's contract, as the app uses it: ``TagClient`` (generated from the
/// component ABI by `scripts/mobile-codegen.sh`) over the space's
/// ``ContextTransport``, with its answers read into the app models.
///
/// The ABI names the contract's records without their shape, so the generated
/// client answers their JSON, which this reads into ``Tracker``, ``Member``
/// and the rest. On core 1.0 the contract takes every owner, author and member
/// id from the caller's account and stamps records with the leader's clock, so
/// nothing here sends one. `memberId` is what the contract's `whoami` answered.
public final class MeroService: Sendable {
    public let transport: any ContextTransport
    public let appId: String
    public let memberId: String
    let contract: TagClient

    public init(transport: any ContextTransport, appId: String, memberId: String) {
        self.transport = transport
        self.appId = appId
        self.memberId = memberId
        contract = TagClient(contract: transport.bound(to: appId))
    }

    /// Ask the space who the signed-in account is, which is also the check
    /// that the account can reach it, and make a service for it.
    public static func open(transport: any ContextTransport, appId: String) async throws -> MeroService {
        let contract = TagClient(contract: transport.bound(to: appId))
        let me = try ContractCoding.decode(Me.self, from: try await contract.whoami(), method: "whoami")
        return MeroService(transport: transport, appId: appId, memberId: me.memberId)
    }

    private func read<T: Decodable>(_ method: String, _ answer: JSONValue) throws -> T {
        try ContractCoding.decode(T.self, from: answer, method: method)
    }

    private func read<T: Decodable>(_ method: String, _ answer: [JSONValue]) throws -> [T] {
        try ContractCoding.decode([T].self, from: .array(answer), method: method)
    }

    // MARK: Reads

    public func whoami() async throws -> Me { try read("whoami", try await contract.whoami()) }
    public func getSpace() async throws -> SpaceInfo { try read("getSpace", try await contract.getSpace()) }
    public func getTrackers() async throws -> [Tracker] { try read("getTrackers", try await contract.getTrackers()) }
    public func getMembers() async throws -> [Member] { try read("getMembers", try await contract.getMembers()) }
    public func getGroups() async throws -> [TagGroup] { try read("getGroups", try await contract.getGroups()) }
    public func getGeofences() async throws -> [Geofence] { try read("getGeofences", try await contract.getGeofences()) }
    public func getPresence() async throws -> [Presence] { try read("getPresence", try await contract.getPresence()) }

    public func getHistory(trackerId: String, since: UInt64 = 0) async throws -> [LocationSample] {
        try read("getHistory", try await contract.getHistory(trackerId: trackerId, since: since))
    }

    // MARK: Members

    public func join(username: String) async throws {
        try await contract.join(username: username)
    }

    // MARK: Trackers

    @discardableResult
    public func createTracker(id: String, name: String) async throws -> String {
        try await contract.createTracker(id: id, name: name)
    }

    public func renameTracker(id: String, name: String) async throws {
        try await contract.renameTracker(id: id, name: name)
    }

    public func deleteTracker(id: String) async throws {
        try await contract.deleteTracker(id: id)
    }

    public func shareTracker(trackerId: String, userId: String) async throws {
        try await contract.shareTracker(trackerId: trackerId, userId: userId)
    }

    public func unshareTracker(trackerId: String, userId: String) async throws {
        try await contract.unshareTracker(trackerId: trackerId, userId: userId)
    }

    public func updateLocation(trackerId: String, _ loc: Location) async throws {
        try await contract.updateLocation(
            trackerId: trackerId, latitude: loc.latitude, longitude: loc.longitude, altitude: loc.altitude,
            speed: loc.speed, heading: loc.heading, battery: UInt8(clamping: loc.battery), timestamp: loc.timestamp)
    }

    // MARK: Geofences

    @discardableResult
    public func createGeofence(id: String, name: String, lat: Double, lng: Double, radius: Double) async throws
        -> String
    {
        try await contract.createGeofence(id: id, name: name, centerLat: lat, centerLng: lng, radius: radius)
    }

    public func reportGeofenceEvent(geofenceId: String, kind: String) async throws {
        try await contract.reportGeofenceEvent(geofenceId: geofenceId, kind: kind)
    }

    // MARK: Presence

    public func updatePresence(online: Bool) async throws {
        try await contract.updatePresence(online: online)
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
