import Foundation
import MeroKit

// The board's types, as the contract (`../../../logic/res/abi.json`) answers them. The calls are the
// generated `DesignClient` (`Generated/`, `scripts/mobile-codegen.sh` at the repo root); until the
// logic derives `AbiType` the ABI names these types without their shape, so the client takes and
// answers their JSON and they read and write it (`JSONValue.decoded(as:)`, `JSONValue(encoding:)`).

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

/// Board summary: name, description, counts and owner.
public struct BoardInfo: Codable, Sendable, Equatable {
    /// The board's name.
    public var name: String
    /// The board's description; may be empty.
    public var description: String
    /// How many elements are on the canvas.
    public var elementCount: UInt32
    /// How many members have joined.
    public var memberCount: UInt32
    /// The owner's member id (account id).
    public var owner: String?

    public init(name: String, description: String, elementCount: UInt32, memberCount: UInt32, owner: String? = nil) {
        self.name = name
        self.description = description
        self.elementCount = elementCount
        self.memberCount = memberCount
        self.owner = owner
    }
}

/// A comment pinned at a canvas point, with its replies.
public struct Comment: Codable, Sendable, Equatable {
    /// Comment id, chosen by the caller.
    public var id: String
    /// Pin position, canvas pixels.
    public var x: Int64
    /// Pin position, canvas pixels.
    public var y: Int64
    /// The comment text.
    public var content: String
    /// The writer's member id, set by the contract.
    public var author: String
    /// Unix milliseconds.
    public var createdAt: UInt64
    /// The thread, oldest first.
    public var replies: [CommentReply]

    public init(id: String, x: Int64, y: Int64, content: String, author: String, createdAt: UInt64, replies: [CommentReply]) {
        self.id = id
        self.x = x
        self.y = y
        self.content = content
        self.author = author
        self.createdAt = createdAt
        self.replies = replies
    }
}

/// A reply in a comment thread.
public struct CommentReply: Codable, Sendable, Equatable {
    /// Reply id, chosen by the caller.
    public var id: String
    /// The reply text.
    public var content: String
    /// The writer's member id, set by the contract.
    public var author: String
    /// Unix milliseconds; replies are listed in this order.
    public var createdAt: UInt64

    public init(id: String, content: String, author: String, createdAt: UInt64) {
        self.id = id
        self.content = content
        self.author = author
        self.createdAt = createdAt
    }
}

/// A pointer's last reported position.
public struct CursorState: Codable, Sendable, Equatable {
    /// The device (context identity) this pointer belongs to.
    public var identity: String
    /// The member id (account) behind that device.
    public var account: String
    /// Canvas pixels.
    public var x: Int64
    /// Canvas pixels.
    public var y: Int64
    /// Unix milliseconds of the last move.
    public var updatedAt: UInt64

    public init(identity: String, account: String, x: Int64, y: Int64, updatedAt: UInt64) {
        self.identity = identity
        self.account = account
        self.x = x
        self.y = y
        self.updatedAt = updatedAt
    }
}

/// One element on the canvas.
public struct Element: Codable, Sendable, Equatable {
    /// Chosen by the caller; use a fresh UUID. Writing an existing id replaces that element.
    public var id: String
    /// What the element is, tagged by `kind`.
    public var data: ElementData
    /// Left edge, canvas pixels.
    public var x: Int64
    /// Top edge, canvas pixels.
    public var y: Int64
    /// Width in pixels.
    public var width: UInt32
    /// Height in pixels.
    public var height: UInt32
    /// Clockwise rotation in degrees.
    public var rotation: Int32
    /// Fill colour as a CSS colour (`"#ef4444"`, `"transparent"`); on a plain text
    /// element, the text colour.
    public var fill: String
    /// Outline colour as a CSS colour.
    public var stroke: String
    /// Outline width in pixels; 0 for none.
    public var strokeWidth: UInt32
    /// Opacity in percent, 0 to 100.
    public var opacity: UInt32
    /// Paint order; higher paints on top.
    public var layerIndex: UInt32
    /// The creator's member id, set by the contract; the value sent is ignored.
    public var createdBy: String
    /// Creation time, unix milliseconds.
    public var createdAt: UInt64
    /// Last change, unix milliseconds. Between concurrent writes to one element the
    /// larger value wins, so every write must carry a newer one.
    public var updatedAt: UInt64
    /// Drop shadow colour as a CSS colour; `null` for no shadow.
    public var shadowColor: String?
    /// Drop shadow horizontal offset in pixels.
    public var shadowOffsetX: Int32?
    /// Drop shadow vertical offset in pixels.
    public var shadowOffsetY: Int32?
    /// Drop shadow blur radius in pixels; `null` or 0 for no shadow.
    public var shadowBlur: UInt32?
    /// Layer name, a `/`-separated path: the groups, then the name. May carry client
    /// extras after a U+001F character; keep them when renaming.
    public var label: String?
    /// Corner radius in pixels for a `rect`, drawn at most half the shorter side; 0 or
    /// omitted means square corners.
    public var cornerRadius: UInt32?

    public init(id: String, data: ElementData, x: Int64, y: Int64, width: UInt32, height: UInt32, rotation: Int32, fill: String, stroke: String, strokeWidth: UInt32, opacity: UInt32, layerIndex: UInt32, createdBy: String, createdAt: UInt64, updatedAt: UInt64, shadowColor: String? = nil, shadowOffsetX: Int32? = nil, shadowOffsetY: Int32? = nil, shadowBlur: UInt32? = nil, label: String? = nil, cornerRadius: UInt32? = nil) {
        self.id = id
        self.data = data
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.rotation = rotation
        self.fill = fill
        self.stroke = stroke
        self.strokeWidth = strokeWidth
        self.opacity = opacity
        self.layerIndex = layerIndex
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.shadowColor = shadowColor
        self.shadowOffsetX = shadowOffsetX
        self.shadowOffsetY = shadowOffsetY
        self.shadowBlur = shadowBlur
        self.label = label
        self.cornerRadius = cornerRadius
    }
}

/// What an element is, as a JSON object tagged by `kind`: `rect`, `circle`, `line`,
/// `arrow`, `path`, `text`, `image` or `svg`, plus that kind's own fields.
public indirect enum ElementData: Codable, Sendable, Equatable {
    /// A rectangle filling the element's box; `cornerRadius` rounds its corners.
    case rect
    /// An ellipse filling the element's box.
    case circle
    /// A straight line.
    case line(ElementData_Line)
    /// A straight line with an arrowhead at its second point.
    case arrow(ElementData_Arrow)
    /// A freehand stroke or a closed outline.
    case path(ElementData_Path)
    /// Text in the element's box.
    case text(ElementData_Text)
    /// A raster image stored as a blob on the node.
    case image(ElementData_Image)
    /// An SVG image stored as a blob on the node.
    case svg(ElementData_Svg)

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: ContractCodingKey.self)
        let tag = try container.decode(String.self, forKey: ContractCodingKey("kind"))
        switch tag {
        case "rect": self = .rect
        case "circle": self = .circle
        case "line": self = .line(try ElementData_Line(from: decoder))
        case "arrow": self = .arrow(try ElementData_Arrow(from: decoder))
        case "path": self = .path(try ElementData_Path(from: decoder))
        case "text": self = .text(try ElementData_Text(from: decoder))
        case "image": self = .image(try ElementData_Image(from: decoder))
        case "svg": self = .svg(try ElementData_Svg(from: decoder))
        default: throw contractUnknownVariant("ElementData", tag, decoder.codingPath)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: ContractCodingKey.self)
        switch self {
        case .rect:
            try container.encode("rect", forKey: ContractCodingKey("kind"))
        case .circle:
            try container.encode("circle", forKey: ContractCodingKey("kind"))
        case .line(let value):
            try value.encode(to: encoder)
            try container.encode("line", forKey: ContractCodingKey("kind"))
        case .arrow(let value):
            try value.encode(to: encoder)
            try container.encode("arrow", forKey: ContractCodingKey("kind"))
        case .path(let value):
            try value.encode(to: encoder)
            try container.encode("path", forKey: ContractCodingKey("kind"))
        case .text(let value):
            try value.encode(to: encoder)
            try container.encode("text", forKey: ContractCodingKey("kind"))
        case .image(let value):
            try value.encode(to: encoder)
            try container.encode("image", forKey: ContractCodingKey("kind"))
        case .svg(let value):
            try value.encode(to: encoder)
            try container.encode("svg", forKey: ContractCodingKey("kind"))
        }
    }
}

public struct ElementData_Arrow: Codable, Sendable, Equatable {
    /// The two end points, `"x1,y1 x2,y2"`, in pixels from the element's `x` and `y`;
    /// the arrowhead is at the second.
    public var points: String

    public init(points: String) {
        self.points = points
    }
}

public struct ElementData_Image: Codable, Sendable, Equatable {
    /// The image's own width in pixels, before any scaling to the element's box.
    public var naturalWidth: UInt32
    /// The image's own height in pixels.
    public var naturalHeight: UInt32
    /// Id of the uploaded blob holding the image; the contract announces it to the
    /// board's members so their nodes fetch it.
    public var blobId: String

    public init(naturalWidth: UInt32, naturalHeight: UInt32, blobId: String) {
        self.naturalWidth = naturalWidth
        self.naturalHeight = naturalHeight
        self.blobId = blobId
    }
}

public struct ElementData_Line: Codable, Sendable, Equatable {
    /// The two end points, `"x1,y1 x2,y2"`, in pixels from the element's `x` and `y`.
    public var points: String

    public init(points: String) {
        self.points = points
    }
}

public struct ElementData_Path: Codable, Sendable, Equatable {
    /// SVG path data in pixels from the element's `x` and `y`, e.g. `"M 0 0 L 40 40 Z"`.
    public var points: String

    public init(points: String) {
        self.points = points
    }
}

public struct ElementData_Svg: Codable, Sendable, Equatable {
    /// The SVG's own width in pixels.
    public var naturalWidth: UInt32
    /// The SVG's own height in pixels.
    public var naturalHeight: UInt32
    /// Id of the uploaded blob holding the SVG markup; announced like an image's.
    public var blobId: String

    public init(naturalWidth: UInt32, naturalHeight: UInt32, blobId: String) {
        self.naturalWidth = naturalWidth
        self.naturalHeight = naturalHeight
        self.blobId = blobId
    }
}

public struct ElementData_Text: Codable, Sendable, Equatable {
    /// The text itself; may be empty.
    public var content: String
    /// Font size in pixels.
    public var fontSize: UInt32
    /// A CSS font family, e.g. `"sans-serif"`.
    public var fontFamily: String
    /// Bold weight.
    public var bold: Bool
    /// Italic style.
    public var italic: Bool
    /// Horizontal alignment: `"left"`, `"center"` or `"right"`; omitted means left.
    public var textAlign: String?
    /// Vertical alignment inside the box: `"top"`, `"middle"` or `"bottom"`.
    public var verticalAlign: String?

    public init(content: String, fontSize: UInt32, fontFamily: String, bold: Bool, italic: Bool, textAlign: String? = nil, verticalAlign: String? = nil) {
        self.content = content
        self.fontSize = fontSize
        self.fontFamily = fontFamily
        self.bold = bold
        self.italic = italic
        self.textAlign = textAlign
        self.verticalAlign = verticalAlign
    }

    enum CodingKeys: String, CodingKey {
        case content
        case fontSize
        case fontFamily
        case bold
        case italic
        case textAlign = "text_align"
        case verticalAlign = "vertical_align"
    }
}

/// One element's change in an `update_elements` call. Fields match `update_element`'s
/// arguments; an omitted or `null` field is left unchanged.
public struct ElementPatch: Codable, Sendable, Equatable {
    /// The element to change; an unknown id is skipped.
    public var id: String
    /// New left edge, canvas pixels.
    public var x: Int64?
    /// New top edge, canvas pixels.
    public var y: Int64?
    /// New width in pixels.
    public var width: UInt32?
    /// New height in pixels.
    public var height: UInt32?
    /// New rotation in degrees.
    public var rotation: Int32?
    /// New fill colour.
    public var fill: String?
    /// New outline colour.
    public var stroke: String?
    /// New outline width in pixels.
    public var strokeWidth: UInt32?
    /// New opacity in percent, 0 to 100.
    public var opacity: UInt32?
    /// New corner radius in pixels; 0 squares the corners.
    public var cornerRadius: UInt32?

    public init(id: String, x: Int64? = nil, y: Int64? = nil, width: UInt32? = nil, height: UInt32? = nil, rotation: Int32? = nil, fill: String? = nil, stroke: String? = nil, strokeWidth: UInt32? = nil, opacity: UInt32? = nil, cornerRadius: UInt32? = nil) {
        self.id = id
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.rotation = rotation
        self.fill = fill
        self.stroke = stroke
        self.strokeWidth = strokeWidth
        self.opacity = opacity
        self.cornerRadius = cornerRadius
    }

    enum CodingKeys: String, CodingKey {
        case id
        case x
        case y
        case width
        case height
        case rotation
        case fill
        case stroke
        case strokeWidth = "stroke_width"
        case opacity
        case cornerRadius = "corner_radius"
    }
}

/// One element's new label in an `update_element_labels` call.
public struct LabelUpdate: Codable, Sendable, Equatable {
    /// The element to rename; an unknown id is skipped.
    public var id: String
    /// The new label, as for `update_element_label`; `null` clears it.
    public var label: String?

    public init(id: String, label: String? = nil) {
        self.id = id
        self.label = label
    }
}

/// A board member: someone who has called `join`.
public struct Member: Codable, Sendable, Equatable {
    /// Member id: the member's account id (64 hex), the id roles and ownership name.
    public var id: String
    /// Display name the member chose.
    public var username: String
    /// Avatar URL, or `null`.
    public var avatar: String?
    /// When the member joined, unix milliseconds from their own clock.
    public var joinedAt: UInt64
    /// Unix milliseconds of the last profile edit; the newest edit wins.
    public var usernameUpdatedAt: UInt64

    public init(id: String, username: String, avatar: String? = nil, joinedAt: UInt64, usernameUpdatedAt: UInt64) {
        self.id = id
        self.username = username
        self.avatar = avatar
        self.joinedAt = joinedAt
        self.usernameUpdatedAt = usernameUpdatedAt
    }
}

/// A member with their effective role.
public struct MemberRole: Codable, Sendable, Equatable {
    /// Member id (account id).
    public var member: String
    /// `"admin"`, `"editor"` or `"viewer"`.
    public var role: String
    /// The member's account id; always equal to `member`.
    public var account: String?

    public init(member: String, role: String, account: String? = nil) {
        self.member = member
        self.role = role
        self.account = account
    }
}

public struct MeroDesign: Codable, Sendable, Equatable {
    public var boardName: String
    public var boardDescription: String
    public var initialName: String
    public var initialDescription: String
    /// The canvas. Writer-set guarded: only accounts holding a role mask
    /// projected from `roles` (editors, admins) may write an entry, on every
    /// node.
    public var elements: [String: Element]
    /// One slot per account, written only by that account.
    public var members: [String: Member]
    /// Guarded like `elements`.
    public var comments: [String: Comment]
    /// Every reply, keyed `"<comment>/<created_at:020>/<reply>"` so one
    /// comment's thread is a prefix slice in order. Guarded like `elements`.
    public var replies: [String: CommentReply]
    /// Keyed by DEVICE: a pointer belongs to a screen. Each entry is owned by
    /// the account that wrote it.
    public var cursors: [String: CursorState]
    public var roles: [String: Bool]

    public init(boardName: String, boardDescription: String, initialName: String, initialDescription: String, elements: [String: Element], members: [String: Member], comments: [String: Comment], replies: [String: CommentReply], cursors: [String: CursorState], roles: [String: Bool]) {
        self.boardName = boardName
        self.boardDescription = boardDescription
        self.initialName = initialName
        self.initialDescription = initialDescription
        self.elements = elements
        self.members = members
        self.comments = comments
        self.replies = replies
        self.cursors = cursors
        self.roles = roles
    }

    enum CodingKeys: String, CodingKey {
        case boardName = "board_name"
        case boardDescription = "board_description"
        case initialName = "initial_name"
        case initialDescription = "initial_description"
        case elements
        case members
        case comments
        case replies
        case cursors
        case roles
    }
}

// MARK: - Wire helpers

fileprivate struct ContractCodingKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }

    init(_ stringValue: String) { self.stringValue = stringValue }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

fileprivate func contractUnknownVariant(_ type: String, _ name: String, _ codingPath: [any CodingKey]) -> DecodingError {
    DecodingError.dataCorrupted(.init(codingPath: codingPath, debugDescription: "Unknown \(type) variant \"\(name)\""))
}
