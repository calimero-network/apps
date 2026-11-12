import Foundation
import MeroKit

// The document's types, as the contract (`../../logic/res/abi.json`) answers them. The calls are
// the generated `PixartClient` (`Generated/`, `scripts/mobile-codegen.sh` at the repo root); until
// the logic derives `AbiType` the ABI names these types without their shape, so the client answers
// their JSON and they read it (`JSONValue.decoded(as:)`).

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

public struct Adjustments: Codable, Sendable, Equatable {
    /// -100..=100, 0 = neutral
    public var brightness: Int32
    /// -100..=100, 0 = neutral
    public var contrast: Int32
    /// -100..=100, 0 = neutral
    public var saturation: Int32
    /// -180..=180 degrees, 0 = neutral
    public var hue: Int32
    /// -100..=100, 0 = neutral
    public var exposure: Int32
    /// 0..=100 blur radius in px (filter), 0 = none
    public var blur: UInt32
    /// invert colors
    public var invert: Bool
    /// JSON-encoded curve control points (per-channel splines). Opaque to the
    /// contract; the frontend interprets it. Empty = identity curve.
    public var curves: String

    public init(brightness: Int32, contrast: Int32, saturation: Int32, hue: Int32, exposure: Int32, blur: UInt32, invert: Bool, curves: String) {
        self.brightness = brightness
        self.contrast = contrast
        self.saturation = saturation
        self.hue = hue
        self.exposure = exposure
        self.blur = blur
        self.invert = invert
        self.curves = curves
    }
}

/// The owner-gated canvas settings: size and background.
public struct Canvas: Codable, Sendable, Equatable {
    public var width: UInt32
    public var height: UInt32
    public var background: String

    public init(width: UInt32, height: UInt32, background: String) {
        self.width = width
        self.height = height
        self.background = background
    }
}

public struct CursorState: Codable, Sendable, Equatable {
    /// The device this pointer belongs to (hex context key) — unique per open
    /// installation, so it is what the map is keyed by.
    public var identity: String
    /// The member (account) behind that device, so the overlay can label the
    /// pointer with a username without a second lookup table. Filled from the
    /// entry's owner stamp on read, so nobody can put a pointer under someone
    /// else's name.
    public var account: String
    public var x: Int64
    public var y: Int64
    public var updatedAt: UInt64

    public init(identity: String, account: String, x: Int64, y: Int64, updatedAt: UInt64) {
        self.identity = identity
        self.account = account
        self.x = x
        self.y = y
        self.updatedAt = updatedAt
    }
}

public struct DocumentInfo: Codable, Sendable, Equatable {
    public var name: String
    public var description: String
    public var width: UInt32
    public var height: UInt32
    public var background: String
    public var layerCount: UInt32
    public var memberCount: UInt32
    public var owner: String?

    public init(name: String, description: String, width: UInt32, height: UInt32, background: String, layerCount: UInt32, memberCount: UInt32, owner: String? = nil) {
        self.name = name
        self.description = description
        self.width = width
        self.height = height
        self.background = background
        self.layerCount = layerCount
        self.memberCount = memberCount
        self.owner = owner
    }
}

/// `parent_id` and `layer_index` are indexed, so a group's children and the
/// top or bottom of the stack are seeks rather than scans.
public struct Layer: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    /// "raster" | "group" | "text" | "adjustment" | "fill"
    public var kind: String
    /// Parent group layer id (folder nesting); None = top level.
    public var parentId: String?
    /// Order within the parent (ascending = bottom→top).
    public var layerIndex: UInt32
    public var visible: Bool
    public var locked: Bool
    /// 0..=100
    public var opacity: UInt32
    /// "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | …
    public var blendMode: String
    public var x: Int64
    public var y: Int64
    public var width: UInt32
    public var height: UInt32
    public var rotation: Int32
    /// percent, 100 = 1:1
    public var scaleX: Int32
    public var scaleY: Int32
    /// Horizontal shear in degrees (-80..=80), 0 = none.
    public var skewX: Int32
    /// Vertical shear in degrees (-80..=80), 0 = none.
    public var skewY: Int32
    /// Mirror across the layer's vertical centre line.
    public var flipH: Bool
    /// Mirror across the layer's horizontal centre line.
    public var flipV: Bool
    /// Corner-pin warp: JSON `{"tl":[dx,dy],"tr":[…],"br":[…],"bl":[…]}` in the
    /// layer's own pixel units. Opaque to the contract (like `adjustments.curves`)
    /// — the renderer subdivides the quad into a triangle mesh. Empty = no warp.
    public var warp: String
    /// PNG pixel data for raster layers (blob id). Empty for non-raster kinds.
    public var blobId: String
    /// Grayscale PNG layer mask (blob id). None = no mask.
    public var maskBlobId: String?
    /// Solid color for `fill` layers (and a tint reference otherwise).
    public var fill: String
    public var adjustments: Adjustments
    public var text: TextProps?
    public var createdBy: String
    public var createdAt: UInt64
    public var updatedAt: UInt64

    public init(id: String, name: String, kind: String, parentId: String? = nil, layerIndex: UInt32, visible: Bool, locked: Bool, opacity: UInt32, blendMode: String, x: Int64, y: Int64, width: UInt32, height: UInt32, rotation: Int32, scaleX: Int32, scaleY: Int32, skewX: Int32, skewY: Int32, flipH: Bool, flipV: Bool, warp: String, blobId: String, maskBlobId: String? = nil, fill: String, adjustments: Adjustments, text: TextProps? = nil, createdBy: String, createdAt: UInt64, updatedAt: UInt64) {
        self.id = id
        self.name = name
        self.kind = kind
        self.parentId = parentId
        self.layerIndex = layerIndex
        self.visible = visible
        self.locked = locked
        self.opacity = opacity
        self.blendMode = blendMode
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.rotation = rotation
        self.scaleX = scaleX
        self.scaleY = scaleY
        self.skewX = skewX
        self.skewY = skewY
        self.flipH = flipH
        self.flipV = flipV
        self.warp = warp
        self.blobId = blobId
        self.maskBlobId = maskBlobId
        self.fill = fill
        self.adjustments = adjustments
        self.text = text
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct Member: Codable, Sendable, Equatable {
    public var id: String
    public var username: String
    public var avatar: String?
    public var joinedAt: UInt64
    /// Dedicated LWW clock for username/avatar edits (joined_at never changes,
    /// so merging on it would freeze a member's username at its first value).
    public var usernameUpdatedAt: UInt64

    public init(id: String, username: String, avatar: String? = nil, joinedAt: UInt64, usernameUpdatedAt: UInt64) {
        self.id = id
        self.username = username
        self.avatar = avatar
        self.joinedAt = joinedAt
        self.usernameUpdatedAt = usernameUpdatedAt
    }
}

/// A member paired with their effective role, for the settings/members UI.
public struct MemberRole: Codable, Sendable, Equatable {
    public var member: String
    public var role: String

    public init(member: String, role: String) {
        self.member = member
        self.role = role
    }
}

public struct MeroPixArt: Codable, Sendable, Equatable {
    public var docName: String
    public var docDescription: String
    /// `None` until the owner first resizes or recolours; `initial_canvas`
    /// answers until then.
    public var canvas: Canvas
    /// What `init` was given. The `Ownable` cells above cannot be seeded at init
    /// on rc.20 (the value is silently dropped — see `init`), so the opening
    /// values live here and the owner-gated cells take over from the first
    /// owner edit onwards. `Frozen`: written once at init, changeable by nobody,
    /// so a member cannot rename the document by rewriting the fallback. Read
    /// through `doc_name_str` / `canvas_now`.
    public var initialName: String
    public var initialDescription: String
    public var initialCanvas: Canvas
    /// Writer-set guarded: only accounts holding a role mask projected from
    /// `roles` (editors, admins) may write an entry, on every node.
    public var layers: [String: Layer]
    /// One slot per account, written only by that account.
    public var members: [String: Member]
    /// Keyed by DEVICE, not by member — see `CursorState`. The only map here
    /// that is. Each entry is owned by the account that wrote it.
    public var cursors: [String: CursorState]
    public var roles: [String: Bool]

    public init(docName: String, docDescription: String, canvas: Canvas, initialName: String, initialDescription: String, initialCanvas: Canvas, layers: [String: Layer], members: [String: Member], cursors: [String: CursorState], roles: [String: Bool]) {
        self.docName = docName
        self.docDescription = docDescription
        self.canvas = canvas
        self.initialName = initialName
        self.initialDescription = initialDescription
        self.initialCanvas = initialCanvas
        self.layers = layers
        self.members = members
        self.cursors = cursors
        self.roles = roles
    }

    enum CodingKeys: String, CodingKey {
        case docName = "doc_name"
        case docDescription = "doc_description"
        case canvas
        case initialName = "initial_name"
        case initialDescription = "initial_description"
        case initialCanvas = "initial_canvas"
        case layers
        case members
        case cursors
        case roles
    }
}

public struct TextProps: Codable, Sendable, Equatable {
    public var content: String
    public var fontFamily: String
    public var fontSize: UInt32
    public var color: String
    public var bold: Bool
    public var italic: Bool
    public var align: String?

    public init(content: String, fontFamily: String, fontSize: UInt32, color: String, bold: Bool, italic: Bool, align: String? = nil) {
        self.content = content
        self.fontFamily = fontFamily
        self.fontSize = fontSize
        self.color = color
        self.bold = bold
        self.italic = italic
        self.align = align
    }
}

// MARK: - Wire helpers

/// A 2-element tuple, a JSON array on the wire.
public struct ContractTuple2<A: Codable & Sendable & Equatable, B: Codable & Sendable & Equatable>: Codable, Sendable, Equatable {
    public var first: A
    public var second: B

    public init(_ first: A, _ second: B) {
        self.first = first
        self.second = second
    }

    public init(from decoder: any Decoder) throws {
        var container = try decoder.unkeyedContainer()
        first = try container.decode(A.self)
        second = try container.decode(B.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(first)
        try container.encode(second)
    }
}
