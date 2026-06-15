import Foundation
import simd

// Decodable mirrors of the WASM contract types (serde `camelCase`).

public struct Vec3: Codable, Equatable {
    public var x: Double, y: Double, z: Double
    public init(_ x: Double, _ y: Double, _ z: Double) { self.x = x; self.y = y; self.z = z }
    public init(_ v: SIMD3<Float>) { x = Double(v.x); y = Double(v.y); z = Double(v.z) }
    public var simd: SIMD3<Float> { SIMD3(Float(x), Float(y), Float(z)) }
}

public struct Quat: Codable, Equatable {
    public var x: Double, y: Double, z: Double, w: Double
    public init(_ x: Double, _ y: Double, _ z: Double, _ w: Double) { self.x = x; self.y = y; self.z = z; self.w = w }
    public init(_ q: simd_quatf) {
        x = Double(q.imag.x); y = Double(q.imag.y); z = Double(q.imag.z); w = Double(q.real)
    }
    public var simd: simd_quatf { simd_quatf(ix: Float(x), iy: Float(y), iz: Float(z), r: Float(w)) }
}

public struct Transform: Codable, Equatable {
    public var position: Vec3
    public var rotation: Quat
    public var scale: Vec3

    public init(position: Vec3, rotation: Quat, scale: Vec3) {
        self.position = position; self.rotation = rotation; self.scale = scale
    }

    /// Build from a RealityKit 4x4 matrix (decompose — never ship raw matrices).
    public init(matrix m: simd_float4x4) {
        let t = m.columns.3
        position = Vec3(Double(t.x), Double(t.y), Double(t.z))
        // Scale = length of each basis column.
        let sx = simd_length(SIMD3(m.columns.0.x, m.columns.0.y, m.columns.0.z))
        let sy = simd_length(SIMD3(m.columns.1.x, m.columns.1.y, m.columns.1.z))
        let sz = simd_length(SIMD3(m.columns.2.x, m.columns.2.y, m.columns.2.z))
        scale = Vec3(Double(sx), Double(sy), Double(sz))
        // Remove scale before extracting rotation.
        var r = m
        r.columns.0 /= sx; r.columns.1 /= sy; r.columns.2 /= sz
        rotation = Quat(simd_quatf(r))
    }

    /// Recompose into a RealityKit matrix.
    public var matrix: simd_float4x4 {
        var m = simd_float4x4(rotation.simd)
        m.columns.0 *= scale.simd.x
        m.columns.1 *= scale.simd.y
        m.columns.2 *= scale.simd.z
        m.columns.3 = SIMD4(position.simd, 1)
        return m
    }
}

/// kind-tagged object data. Optional fields are omitted when nil (matches the
/// contract's per-variant fields: cube/sphere/arrow/marker carry none).
public struct ObjectData: Codable, Equatable {
    public var kind: String                 // cube | sphere | arrow | marker | text | image
    public var content: String?             // text
    public var blobId: String?              // image
    public var naturalWidth: Int?           // image
    public var naturalHeight: Int?          // image

    public init(kind: String, content: String? = nil, blobId: String? = nil,
                naturalWidth: Int? = nil, naturalHeight: Int? = nil) {
        self.kind = kind; self.content = content; self.blobId = blobId
        self.naturalWidth = naturalWidth; self.naturalHeight = naturalHeight
    }
}

public struct SceneObject: Codable, Identifiable, Equatable {
    public let id: String
    public var data: ObjectData
    public var transform: Transform
    public var color: String
    public var lockedBy: String?
    public var createdBy: String
    public var createdAt: UInt64
    public var updatedAt: UInt64
    public var version: UInt64
}

public struct Member: Codable, Identifiable, Equatable {
    public let id: String
    public var username: String
    public var avatar: String?
    public var joinedAt: UInt64
}

public struct Presence: Codable, Equatable {
    public var identity: String
    public var cameraPosition: Vec3
    public var cameraRotation: Quat
    public var updatedAt: UInt64
}

public struct SpatialComment: Codable, Identifiable, Equatable {
    public let id: String
    public var text: String
    public var position: Vec3
    public var author: String
    public var createdAt: UInt64
}

public struct RoomInfo: Codable, Equatable {
    public var name: String
    public var objectCount: Int
    public var memberCount: Int
    public var worldMapBlob: String
    public var version: UInt64
}

/// Contract event over SSE — `{ "VariantName": "payload" }`.
public enum ARSceneEvent {
    case objectAdded(String), objectUpdated(String), objectDeleted(String)
    case objectLocked(String), objectUnlocked(String)
    case commentAdded(String), commentDeleted(String)
    case presenceUpdated(String), memberJoined(String)
    case anchorsUpdated, roomUpdated
    case other(String, String)

    public init?(data: Data) {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let (key, value) = obj.first else { return nil }
        let id = (value as? String) ?? ""
        switch key {
        case "ObjectAdded":     self = .objectAdded(id)
        case "ObjectUpdated":   self = .objectUpdated(id)
        case "ObjectDeleted":   self = .objectDeleted(id)
        case "ObjectLocked":    self = .objectLocked(id)
        case "ObjectUnlocked":  self = .objectUnlocked(id)
        case "CommentAdded":    self = .commentAdded(id)
        case "CommentDeleted":  self = .commentDeleted(id)
        case "PresenceUpdated": self = .presenceUpdated(id)
        case "MemberJoined":    self = .memberJoined(id)
        case "AnchorsUpdated":  self = .anchorsUpdated
        case "RoomUpdated":     self = .roomUpdated
        default:                self = .other(key, id)
        }
    }
}
