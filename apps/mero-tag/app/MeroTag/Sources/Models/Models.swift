import Foundation

// Decodable mirrors of the WASM contract types. The contract serializes with
// `rename_all = "camelCase"`, so default `JSONDecoder` key handling matches.

public struct Location: Codable, Equatable, Hashable {
    public var latitude: Double
    public var longitude: Double
    public var altitude: Double
    public var speed: Double
    public var heading: Double
    public var battery: Int
    public var timestamp: UInt64
}

public struct Tracker: Codable, Identifiable, Equatable, Hashable {
    public let id: String
    public var name: String
    public var ownerId: String
    public var viewers: [String]
    public var latest: Location?
    public var createdAt: UInt64
    public var updatedAt: UInt64
}

public struct LocationSample: Codable, Equatable {
    public var latitude: Double
    public var longitude: Double
    public var timestamp: UInt64
}

public struct TagGroup: Codable, Identifiable, Equatable {
    public let id: String
    public var name: String
    public var ownerId: String
    public var memberIds: [String]
    public var trackerIds: [String]
    public var updatedAt: UInt64
}

public struct Geofence: Codable, Identifiable, Equatable {
    public let id: String
    public var name: String
    public var centerLat: Double
    public var centerLng: Double
    public var radius: Double
    public var createdBy: String
    public var createdAt: UInt64
}

public struct Presence: Codable, Equatable {
    public var userId: String
    public var online: Bool
    public var lastSeen: UInt64
}

public struct Member: Codable, Identifiable, Equatable {
    public let id: String
    public var username: String
    public var joinedAt: UInt64
}

public struct SpaceInfo: Codable, Equatable {
    public var name: String
    public var trackerCount: Int
    public var memberCount: Int
    public var groupCount: Int
}

/// A contract event over SSE. The WASM `#[app::event]` enum serializes as
/// `{ "VariantName": "payloadString" }`, so we decode the single key.
public enum TagEvent {
    case trackerCreated(String)
    case trackerUpdated(String)
    case trackerRenamed(String)
    case trackerDeleted(String)
    case trackerShared(String)
    case groupChanged(String)
    case geofenceEntered(String)
    case geofenceExited(String)
    case presenceUpdated(String)
    case memberJoined(String)
    case other(String, String)

    public init?(data: Data) {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let (key, value) = obj.first else { return nil }
        let id = (value as? String) ?? ""
        switch key {
        case "TrackerCreated":   self = .trackerCreated(id)
        case "TrackerUpdated":   self = .trackerUpdated(id)
        case "TrackerRenamed":   self = .trackerRenamed(id)
        case "TrackerDeleted":   self = .trackerDeleted(id)
        case "TrackerShared":    self = .trackerShared(id)
        case "GroupCreated", "GroupUpdated", "GroupDeleted": self = .groupChanged(id)
        case "GeofenceEntered":  self = .geofenceEntered(id)
        case "GeofenceExited":   self = .geofenceExited(id)
        case "PresenceUpdated":  self = .presenceUpdated(id)
        case "MemberJoined":     self = .memberJoined(id)
        default:                 self = .other(key, id)
        }
    }
}
