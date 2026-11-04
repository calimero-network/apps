import Foundation
import MeroKit

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

/// Who the caller is in the space, as the contract's `whoami` answers.
public struct Me: Codable, Equatable {
    /// The caller's account (64 hex): every member, owner and author id.
    public var memberId: String
    /// The organization the space belongs to.
    public var org: String?
    /// `guest`, `member`, `admin` or `owner` in that organization.
    public var orgRole: String?

    /// An admin of the space's organization may moderate the space.
    public var isOrgAdmin: Bool { orgRole == "admin" || orgRole == "owner" }
}

/// A contract event. The cluster streams each one as a server-sent event
/// whose `event:` is the variant (`TrackerUpdated`) and whose `data:` is the
/// payload, `{"id":"<the affected record>"}`.
public enum TagEvent: Equatable {
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
    /// The space changed in a way no single event names. Worth a full refresh.
    case stateChanged
    case other(String, String)

    public init(kind: String, id: String) {
        switch kind {
        case "TrackerCreated": self = .trackerCreated(id)
        case "TrackerUpdated": self = .trackerUpdated(id)
        case "TrackerRenamed": self = .trackerRenamed(id)
        case "TrackerDeleted": self = .trackerDeleted(id)
        case "TrackerShared": self = .trackerShared(id)
        case "GroupCreated", "GroupUpdated", "GroupDeleted": self = .groupChanged(id)
        case "GeofenceEntered": self = .geofenceEntered(id)
        case "GeofenceExited": self = .geofenceExited(id)
        case "PresenceUpdated": self = .presenceUpdated(id)
        case "MemberJoined": self = .memberJoined(id)
        default: self = .other(kind, id)
        }
    }

    /// One server-sent event from the app instance. A frame with no kind
    /// (a keep-alive) is nothing; one the app doesn't know is ``other(_:_:)``.
    public init?(_ event: CloudEvent) {
        guard !event.kind.isEmpty else { return nil }
        self.init(kind: event.kind, id: Self.payloadId(event.data))
    }

    /// The `id` in an event's payload: `{"id": "…"}`, or a bare string.
    static func payloadId(_ value: JSONValue) -> String {
        if let id = value["id"]?.stringValue { return id }
        if let s = value.stringValue { return s }
        return ""
    }
}
