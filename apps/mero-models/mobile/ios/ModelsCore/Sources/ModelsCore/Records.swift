import Foundation
import MeroKit

// The scene's types, as the contract (`../../logic/res/abi.json`) answers them: v1's snake_case
// fields and JSON numbers. The calls are the generated `ModelsClient` (`Generated/`,
// `scripts/mobile-codegen.sh` at the repo root). The ABI describes these types too (their u64
// fields are JSON numbers, `#[abi(plain)]`), but the screens still use the ones here, which read
// each answer's JSON.

extension Encodable {
    /// This answer as the app type `T` (one of the types below).
    public func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
    }

    /// This value as the generated client's type `T` (an argument), through its JSON.
    public func converted<T: Decodable>() throws -> T {
        try MeroJSON.decode(T.self, from: MeroJSON.encode(self))
    }
}

// MARK: - Types

/// What surrounds the scene: its name, the background and the ambient light.
public struct Environment: Codable, Sendable, Equatable {
    /// The scene's name; `""` shows the name it was created with.
    public var name: String
    /// Viewport background, `#rrggbb`.
    public var background: String
    /// Ambient light colour, `#rrggbb`.
    public var ambientColor: String
    /// Ambient light strength, 0 to 10.
    public var ambientIntensity: Double
    /// Set by the contract.
    public var updatedAt: UInt64

    public init(name: String, background: String, ambientColor: String, ambientIntensity: Double, updatedAt: UInt64) {
        self.name = name
        self.background = background
        self.ambientColor = ambientColor
        self.ambientIntensity = ambientIntensity
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case name
        case background
        case ambientColor = "ambient_color"
        case ambientIntensity = "ambient_intensity"
        case updatedAt = "updated_at"
    }
}

/// A check-out: one editor holding an asset until they check it in or it lapses.
public struct Lock: Codable, Sendable, Equatable {
    public var assetId: String
    /// Set by the contract.
    public var holder: String
    public var since: UInt64
    /// After this (the holder's clock, unix milliseconds) the lock no longer holds.
    public var expiresAt: UInt64
    public var updatedAt: UInt64

    public init(assetId: String, holder: String, since: UInt64, expiresAt: UInt64, updatedAt: UInt64) {
        self.assetId = assetId
        self.holder = holder
        self.since = since
        self.expiresAt = expiresAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case assetId = "asset_id"
        case holder
        case since
        case expiresAt = "expires_at"
        case updatedAt = "updated_at"
    }
}

/// A live check-out.
public struct LockView: Codable, Sendable, Equatable {
    public var assetId: String
    public var holder: String
    public var since: UInt64
    public var expiresAt: UInt64
    /// Whether the caller holds it.
    public var mine: Bool

    public init(assetId: String, holder: String, since: UInt64, expiresAt: UInt64, mine: Bool) {
        self.assetId = assetId
        self.holder = holder
        self.since = since
        self.expiresAt = expiresAt
        self.mine = mine
    }

    enum CodingKeys: String, CodingKey {
        case assetId = "asset_id"
        case holder
        case since
        case expiresAt = "expires_at"
        case mine
    }
}

/// How an object's surface looks. A light reads `color` as its light colour.
public struct Material: Codable, Sendable, Equatable {
    /// Base colour, `#rrggbb`.
    public var color: String
    /// 0 (dielectric) to 1 (metal).
    public var metalness: Double
    /// 0 (mirror) to 1 (matte).
    public var roughness: Double
    /// 0 (invisible) to 1 (opaque).
    public var opacity: Double
    /// Emitted colour, `#rrggbb`; `#000000` for none.
    public var emissive: String
    /// Draw the edges only.
    public var wireframe: Bool
    /// Faceted normals instead of smooth ones.
    public var flatShading: Bool
    /// Texture id for the base colour (sRGB), or `""`.
    public var baseColorMap: String
    /// Texture id for the tangent-space normal map (OpenGL, +Y up), or `""`.
    public var normalMap: String
    /// Strength of the normal map, 0 to 10.
    public var normalScale: Double
    /// Texture id packing occlusion (R), roughness (G) and metalness (B) — glTF's and
    /// Unreal's layout — or `""`.
    public var ormMap: String
    /// Texture id for emission, or `""`.
    public var emissiveMap: String

    public init(color: String, metalness: Double, roughness: Double, opacity: Double, emissive: String, wireframe: Bool, flatShading: Bool, baseColorMap: String, normalMap: String, normalScale: Double, ormMap: String, emissiveMap: String) {
        self.color = color
        self.metalness = metalness
        self.roughness = roughness
        self.opacity = opacity
        self.emissive = emissive
        self.wireframe = wireframe
        self.flatShading = flatShading
        self.baseColorMap = baseColorMap
        self.normalMap = normalMap
        self.normalScale = normalScale
        self.ormMap = ormMap
        self.emissiveMap = emissiveMap
    }

    enum CodingKeys: String, CodingKey {
        case color
        case metalness
        case roughness
        case opacity
        case emissive
        case wireframe
        case flatShading = "flat_shading"
        case baseColorMap = "base_color_map"
        case normalMap = "normal_map"
        case normalScale = "normal_scale"
        case ormMap = "orm_map"
        case emissiveMap = "emissive_map"
    }
}

/// Someone who has opened the scene, as they describe themselves.
public struct Member: Codable, Sendable, Equatable {
    /// The member's account id. Filled in from the slot on read; never trusted from storage.
    public var id: String
    public var name: String
    public var joinedAt: UInt64
    public var updatedAt: UInt64

    public init(id: String, name: String, joinedAt: UInt64, updatedAt: UInt64) {
        self.id = id
        self.name = name
        self.joinedAt = joinedAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case joinedAt = "joined_at"
        case updatedAt = "updated_at"
    }
}

/// A member with their effective role.
public struct MemberView: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    /// `admin`, `editor` or `viewer`.
    public var role: String
    public var joinedAt: UInt64

    public init(id: String, name: String, role: String, joinedAt: UInt64) {
        self.id = id
        self.name = name
        self.role = role
        self.joinedAt = joinedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case role
        case joinedAt = "joined_at"
    }
}

public struct MeroModels: Codable, Sendable, Equatable {
    /// What `init` was given. `Frozen`: nobody rewrites it. The environment's `name`
    /// overrides it once an editor sets one.
    public var initialName: String
    /// Every object, keyed by id. Writable only by accounts the editor role is
    /// projected onto, on every node.
    public var objects: [String: SceneObject]
    /// The current blob of every `mesh` object, keyed by the object's id. Guarded like
    /// `objects`.
    public var meshes: [String: MeshRef]
    /// Every texture, keyed by id. Guarded like `objects`.
    public var textures: [String: TextureRef]
    /// Every version of every mesh and texture, keyed
    /// `"<asset>/<stamp:020>/<author>/<blob>"` so one asset's history is a prefix scan
    /// in order. Guarded like `objects`.
    public var history: [String: VersionRecord]
    /// Live and lapsed check-outs, keyed by asset id. Guarded like `objects`.
    public var locks: [String: Lock]
    /// One entry, under [`ENVIRONMENT_KEY`]. Guarded like `objects`.
    public var environment: [String: Environment]
    /// One profile per account, written only by that account.
    public var members: [String: Member]
    /// Admins (the creator) and editors.
    public var roles: [String: Bool]

    public init(initialName: String, objects: [String: SceneObject], meshes: [String: MeshRef], textures: [String: TextureRef], history: [String: VersionRecord], locks: [String: Lock], environment: [String: Environment], members: [String: Member], roles: [String: Bool]) {
        self.initialName = initialName
        self.objects = objects
        self.meshes = meshes
        self.textures = textures
        self.history = history
        self.locks = locks
        self.environment = environment
        self.members = members
        self.roles = roles
    }

    enum CodingKeys: String, CodingKey {
        case initialName = "initial_name"
        case objects
        case meshes
        case textures
        case history
        case locks
        case environment
        case members
        case roles
    }
}

/// The shape of a `mesh` object: a reference to the blob holding its vertices.
///
/// The blob is the app's binary mesh format (see the frontend's `meshcodec.ts`).
/// The contract cannot read it; `vertex_count` and friends are what the writer
/// says is inside, and a reader checks them against what it decodes.
public struct MeshRef: Codable, Sendable, Equatable {
    /// The object this is the shape of.
    public var id: String
    /// The blob, as the 64-character hex id the node returned from the upload.
    public var blobId: String
    /// The blob's length in bytes.
    public var size: UInt64
    public var vertexCount: UInt32
    public var triangleCount: UInt32
    /// Whether the mesh carries texture coordinates.
    public var hasUvs: Bool
    /// Who wrote this version. Set by the contract.
    public var author: String
    /// A note for the history ("retopo pass", "Restored v3"); may be empty.
    public var message: String
    /// Set by the contract; only ever grows.
    public var updatedAt: UInt64

    public init(id: String, blobId: String, size: UInt64, vertexCount: UInt32, triangleCount: UInt32, hasUvs: Bool, author: String, message: String, updatedAt: UInt64) {
        self.id = id
        self.blobId = blobId
        self.size = size
        self.vertexCount = vertexCount
        self.triangleCount = triangleCount
        self.hasUvs = hasUvs
        self.author = author
        self.message = message
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case blobId = "blob_id"
        case size
        case vertexCount = "vertex_count"
        case triangleCount = "triangle_count"
        case hasUvs = "has_uvs"
        case author
        case message
        case updatedAt = "updated_at"
    }
}

/// The scene's header: name, environment, counts, and what the caller may do.
public struct SceneInfo: Codable, Sendable, Equatable {
    public var name: String
    public var environment: Environment
    public var objectCount: UInt32
    public var meshCount: UInt32
    public var textureCount: UInt32
    public var memberCount: UInt32
    /// The caller's account id.
    public var me: String
    /// `admin`, `editor` or `viewer`.
    public var myRole: String

    public init(name: String, environment: Environment, objectCount: UInt32, meshCount: UInt32, textureCount: UInt32, memberCount: UInt32, me: String, myRole: String) {
        self.name = name
        self.environment = environment
        self.objectCount = objectCount
        self.meshCount = meshCount
        self.textureCount = textureCount
        self.memberCount = memberCount
        self.me = me
        self.myRole = myRole
    }

    enum CodingKeys: String, CodingKey {
        case name
        case environment
        case objectCount = "object_count"
        case meshCount = "mesh_count"
        case textureCount = "texture_count"
        case memberCount = "member_count"
        case me
        case myRole = "my_role"
    }
}

/// One object in the scene.
public struct SceneObject: Codable, Sendable, Equatable {
    /// Chosen by the caller; use a fresh UUID. Writing an existing id replaces that object.
    public var id: String
    /// Shown in the outliner.
    public var name: String
    /// One of [`OBJECT_KINDS`]. A `mesh` takes its shape from `put_mesh` under the same id.
    public var kind: String
    /// The parent object's id, or `""` for a root object. A parent that does not exist, or
    /// a chain that loops, reads as `""`.
    public var parent: String
    /// Position relative to the parent, scene units.
    public var position: Vec3
    /// Euler rotation (XYZ order) relative to the parent, radians.
    public var rotation: Vec3
    /// Scale relative to the parent. Primitives are unit-sized, so this is their size.
    public var scale: Vec3
    /// Hidden objects (and their children) are not drawn.
    public var visible: Bool
    /// Surface, or light colour for a light.
    public var material: Material
    /// How finely a curved primitive is tessellated, 3 to 128. Ignored by other kinds.
    public var segments: UInt32
    /// A light's strength; ignored by other kinds.
    public var intensity: Double
    /// Who first created it. Set by the contract; the value sent is ignored.
    public var createdBy: String
    /// Creation time, unix milliseconds. Kept from the first write.
    public var createdAt: UInt64
    /// Last change, unix milliseconds. The contract moves it past the stored value, so it
    /// only ever grows; the value sent is a hint.
    public var updatedAt: UInt64

    public init(id: String, name: String, kind: String, parent: String, position: Vec3, rotation: Vec3, scale: Vec3, visible: Bool, material: Material, segments: UInt32, intensity: Double, createdBy: String, createdAt: UInt64, updatedAt: UInt64) {
        self.id = id
        self.name = name
        self.kind = kind
        self.parent = parent
        self.position = position
        self.rotation = rotation
        self.scale = scale
        self.visible = visible
        self.material = material
        self.segments = segments
        self.intensity = intensity
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case kind
        case parent
        case position
        case rotation
        case scale
        case visible
        case material
        case segments
        case intensity
        case createdBy = "created_by"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// An image a material can use, held in a blob.
public struct TextureRef: Codable, Sendable, Equatable {
    /// Chosen by the caller; use a fresh UUID.
    public var id: String
    public var name: String
    /// The blob, as a 64-character hex id.
    public var blobId: String
    public var size: UInt64
    public var width: UInt32
    public var height: UInt32
    /// `image/png`, `image/jpeg` or `image/webp`.
    public var mime: String
    /// `srgb` for colour, `linear` for data (normal, ORM).
    public var colorSpace: String
    /// Set by the contract.
    public var author: String
    public var message: String
    /// Set by the contract; only ever grows.
    public var updatedAt: UInt64

    public init(id: String, name: String, blobId: String, size: UInt64, width: UInt32, height: UInt32, mime: String, colorSpace: String, author: String, message: String, updatedAt: UInt64) {
        self.id = id
        self.name = name
        self.blobId = blobId
        self.size = size
        self.width = width
        self.height = height
        self.mime = mime
        self.colorSpace = colorSpace
        self.author = author
        self.message = message
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case blobId = "blob_id"
        case size
        case width
        case height
        case mime
        case colorSpace = "color_space"
        case author
        case message
        case updatedAt = "updated_at"
    }
}

/// A point or a direction in scene units, or Euler angles in radians.
public struct Vec3: Codable, Sendable, Equatable {
    public var x: Double
    public var y: Double
    public var z: Double

    public init(x: Double, y: Double, z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }
}

/// One saved version of a mesh or a texture. Written once per write and never
/// changed; restoring writes a new one.
public struct VersionRecord: Codable, Sendable, Equatable {
    /// The mesh's object id or the texture's id.
    public var assetId: String
    /// `mesh` or `texture`.
    public var kind: String
    public var blobId: String
    public var size: UInt64
    /// Vertices and triangles for a mesh; width and height for a texture.
    public var a: UInt32
    public var b: UInt32
    public var author: String
    public var message: String
    public var createdAt: UInt64

    public init(assetId: String, kind: String, blobId: String, size: UInt64, a: UInt32, b: UInt32, author: String, message: String, createdAt: UInt64) {
        self.assetId = assetId
        self.kind = kind
        self.blobId = blobId
        self.size = size
        self.a = a
        self.b = b
        self.author = author
        self.message = message
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case assetId = "asset_id"
        case kind
        case blobId = "blob_id"
        case size
        case a
        case b
        case author
        case message
        case createdAt = "created_at"
    }
}

/// One row of an asset's history, numbered from 1 in the order it was written.
public struct VersionView: Codable, Sendable, Equatable {
    /// 1 for the first version. Derived from the history's order, never stored.
    public var number: UInt32
    public var kind: String
    public var blobId: String
    public var size: UInt64
    /// Vertices (mesh) or width (texture).
    public var a: UInt32
    /// Triangles (mesh) or height (texture).
    public var b: UInt32
    public var author: String
    public var message: String
    public var createdAt: UInt64
    /// Whether this is the blob the asset points at now.
    public var current: Bool

    public init(number: UInt32, kind: String, blobId: String, size: UInt64, a: UInt32, b: UInt32, author: String, message: String, createdAt: UInt64, current: Bool) {
        self.number = number
        self.kind = kind
        self.blobId = blobId
        self.size = size
        self.a = a
        self.b = b
        self.author = author
        self.message = message
        self.createdAt = createdAt
        self.current = current
    }

    enum CodingKeys: String, CodingKey {
        case number
        case kind
        case blobId = "blob_id"
        case size
        case a
        case b
        case author
        case message
        case createdAt = "created_at"
        case current
    }
}
