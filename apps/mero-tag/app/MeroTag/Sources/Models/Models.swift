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

/// A contract event. The node delivers them inside a `StateMutation` SSE
/// frame as `data.events[] = { kind: "<Variant>", data: [bytes] }`, where the
/// bytes are the JSON-encoded payload (here always the affected id).
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
    /// The context's state moved, but the frame named no contract event
    /// (e.g. a sync from a peer). Worth a full refresh.
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

    /// A serde-shaped event, `{ "VariantName": "id" }`.
    public init?(data: Data) {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              obj.count == 1, let (key, value) = obj.first else { return nil }
        self.init(kind: key, id: (value as? String) ?? "")
    }

    /// Every contract event in one SSE frame (the frame's `result`).
    /// A `StateMutation` without events yields `.stateChanged`; other frame
    /// kinds (`SyncStatus`, …) yield nothing.
    public static func events(inFrame frame: JSONValue) -> [TagEvent] {
        let type = frame["type"]?.stringValue
        let raw = frame["data"]?["events"]?.arrayValue ?? []
        let events: [TagEvent] = raw.compactMap { item in
            guard let kind = item["kind"]?.stringValue else { return nil }
            return TagEvent(kind: kind, id: payloadId(item["data"]))
        }
        if events.isEmpty, type == "StateMutation" { return [.stateChanged] }
        return events
    }

    /// The id inside an event's `data`: a byte array (or base64 / plain
    /// string) holding a JSON string, a one-key object, or the raw id.
    static func payloadId(_ value: JSONValue?) -> String {
        let bytes: Data?
        switch value {
        case .array(let items)?:
            bytes = Data(items.compactMap { $0.intValue.flatMap { UInt8(exactly: $0) } })
        case .string(let s)?:
            // base64 of JSON when it decodes as such; otherwise the id itself.
            if let decoded = Data(base64Encoded: s),
               (try? JSONSerialization.jsonObject(with: decoded, options: .fragmentsAllowed)) != nil {
                bytes = decoded
            } else {
                return s
            }
        default:
            bytes = nil
        }
        guard let bytes, !bytes.isEmpty else { return "" }
        if let decoded = try? JSONSerialization.jsonObject(with: bytes, options: .fragmentsAllowed) {
            if let s = decoded as? String { return s }
            if let obj = decoded as? [String: Any], let first = obj.values.first as? String { return first }
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
