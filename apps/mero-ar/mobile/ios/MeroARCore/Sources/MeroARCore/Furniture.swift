import Foundation
import simd

/// The furniture the library offers, as plain data: a real-world size and the
/// simple parts each piece is drawn from. Both renderers (SceneKit in the 3D
/// room, RealityKit in live AR) build the same parts, so a sofa placed on one
/// device looks like the same sofa on every other.
///
/// Conventions: metres, y up, the piece standing on the floor at y = 0 and
/// centred on its origin in x and z, its front facing +z. Wall-mounted pieces
/// (the wall TV, a picture) carry their own height inside the model, so they
/// slide along the floor like everything else and stay at wall height.
public enum FurnitureItem: String, CaseIterable, Identifiable, Codable {
    case sofa, armchair, chair, diningTable, coffeeTable, bed, shelf, lamp, plant, rug, tv, wallTV, picture

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .sofa: return "Sofa"
        case .armchair: return "Armchair"
        case .chair: return "Chair"
        case .diningTable: return "Dining table"
        case .coffeeTable: return "Coffee table"
        case .bed: return "Bed"
        case .shelf: return "Bookcase"
        case .lamp: return "Floor lamp"
        case .plant: return "Plant"
        case .rug: return "Rug"
        case .tv: return "TV"
        case .wallTV: return "Wall TV"
        case .picture: return "Picture"
        }
    }

    public var symbol: String {
        switch self {
        case .sofa: return "sofa.fill"
        case .armchair: return "chair.lounge.fill"
        case .chair: return "chair.fill"
        case .diningTable: return "table.furniture.fill"
        case .coffeeTable: return "rectangle.split.3x1.fill"
        case .bed: return "bed.double.fill"
        case .shelf: return "books.vertical.fill"
        case .lamp: return "lamp.floor.fill"
        case .plant: return "leaf.fill"
        case .rug: return "square.fill"
        case .tv: return "tv.fill"
        case .wallTV: return "tv.inset.filled"
        case .picture: return "photo.artframe"
        }
    }

    /// Mounted on a wall rather than standing on the floor.
    public var isWallMounted: Bool { self == .wallTV || self == .picture }

    /// The default colour a new piece gets (the object colour paints its main parts).
    public var defaultColor: String {
        switch self {
        case .sofa, .armchair: return "6D6A8C"
        case .chair: return "D8CFC4"
        case .bed: return "8B5CF6"
        case .lamp: return "F3E9D2"
        case .plant: return "C46B48"
        case .rug: return "4B5E8C"
        case .shelf: return "F472B6"
        case .tv, .wallTV: return "2B2F36"
        case .picture: return "1F2228"
        case .diningTable, .coffeeTable: return "B08968"
        }
    }

    /// Bounding size at scale 1: (width, height, depth).
    public var size: SIMD3<Float> {
        switch self {
        case .sofa: return SIMD3(2.0, 0.85, 0.9)
        case .armchair: return SIMD3(0.9, 0.9, 0.85)
        case .chair: return SIMD3(0.45, 0.9, 0.45)
        case .diningTable: return SIMD3(1.6, 0.75, 0.9)
        case .coffeeTable: return SIMD3(1.1, 0.42, 0.6)
        case .bed: return SIMD3(1.6, 1.0, 2.1)
        case .shelf: return SIMD3(0.9, 1.8, 0.35)
        case .lamp: return SIMD3(0.4, 1.6, 0.4)
        case .plant: return SIMD3(0.6, 1.15, 0.5)
        case .rug: return SIMD3(2.0, 0.013, 1.4)
        case .tv: return SIMD3(1.6, 1.29, 0.45)
        case .wallTV: return SIMD3(1.45, 1.82, 0.05)
        case .picture: return SIMD3(0.7, 1.7, 0.06)
        }
    }

    public var parts: [FurniturePart] {
        typealias P = FurniturePart
        switch self {
        case .sofa:
            return [
                P(.box, SIMD3(2.0, 0.42, 0.9), at: SIMD3(0, 0.21, 0), .primary),
                P(.box, SIMD3(2.0, 0.45, 0.2), at: SIMD3(0, 0.625, -0.35), .primary),
                P(.box, SIMD3(0.2, 0.62, 0.9), at: SIMD3(-0.9, 0.31, 0), .primary),
                P(.box, SIMD3(0.2, 0.62, 0.9), at: SIMD3(0.9, 0.31, 0), .primary),
                P(.box, SIMD3(0.78, 0.12, 0.62), at: SIMD3(-0.4, 0.48, 0.08), .fabricLight),
                P(.box, SIMD3(0.78, 0.12, 0.62), at: SIMD3(0.4, 0.48, 0.08), .fabricLight),
            ]
        case .armchair:
            return [
                P(.box, SIMD3(0.9, 0.42, 0.85), at: SIMD3(0, 0.21, 0), .primary),
                P(.box, SIMD3(0.9, 0.48, 0.18), at: SIMD3(0, 0.66, -0.335), .primary),
                P(.box, SIMD3(0.15, 0.62, 0.85), at: SIMD3(-0.375, 0.31, 0), .primary),
                P(.box, SIMD3(0.15, 0.62, 0.85), at: SIMD3(0.375, 0.31, 0), .primary),
                P(.box, SIMD3(0.58, 0.1, 0.6), at: SIMD3(0, 0.47, 0.06), .fabricLight),
            ]
        case .chair:
            var parts = [
                P(.box, SIMD3(0.45, 0.05, 0.45), at: SIMD3(0, 0.45, 0), .primary),
                P(.box, SIMD3(0.45, 0.42, 0.04), at: SIMD3(0, 0.69, -0.205), .primary),
            ]
            for x in [-0.19, 0.19] as [Float] {
                for z in [-0.19, 0.19] as [Float] {
                    parts.append(P(.cylinder, SIMD3(0.04, 0.45, 0.04), at: SIMD3(x, 0.225, z), .wood))
                }
            }
            return parts
        case .diningTable:
            var parts = [P(.box, SIMD3(1.6, 0.04, 0.9), at: SIMD3(0, 0.73, 0), .primary)]
            for x in [-0.74, 0.74] as [Float] {
                for z in [-0.39, 0.39] as [Float] {
                    parts.append(P(.box, SIMD3(0.06, 0.71, 0.06), at: SIMD3(x, 0.355, z), .wood))
                }
            }
            return parts
        case .coffeeTable:
            var parts = [
                P(.box, SIMD3(1.1, 0.05, 0.6), at: SIMD3(0, 0.395, 0), .primary),
                P(.box, SIMD3(1.0, 0.03, 0.5), at: SIMD3(0, 0.12, 0), .primary),
            ]
            for x in [-0.51, 0.51] as [Float] {
                for z in [-0.26, 0.26] as [Float] {
                    parts.append(P(.box, SIMD3(0.04, 0.37, 0.04), at: SIMD3(x, 0.185, z), .dark))
                }
            }
            return parts
        case .bed:
            return [
                P(.box, SIMD3(1.6, 0.3, 2.1), at: SIMD3(0, 0.15, 0), .wood),
                P(.box, SIMD3(1.5, 0.22, 1.95), at: SIMD3(0, 0.41, 0.05), .fabricLight),
                P(.box, SIMD3(1.54, 0.06, 1.3), at: SIMD3(0, 0.54, 0.37), .primary),
                P(.box, SIMD3(1.6, 1.0, 0.08), at: SIMD3(0, 0.5, -1.01), .wood),
                P(.box, SIMD3(0.6, 0.12, 0.35), at: SIMD3(-0.38, 0.58, -0.72), .fabricLight),
                P(.box, SIMD3(0.6, 0.12, 0.35), at: SIMD3(0.38, 0.58, -0.72), .fabricLight),
            ]
        case .shelf:
            var parts = [
                P(.box, SIMD3(0.03, 1.8, 0.35), at: SIMD3(-0.435, 0.9, 0), .wood),
                P(.box, SIMD3(0.03, 1.8, 0.35), at: SIMD3(0.435, 0.9, 0), .wood),
                P(.box, SIMD3(0.9, 1.8, 0.02), at: SIMD3(0, 0.9, -0.165), .wood),
            ]
            for y in [0.015, 0.45, 0.9, 1.35, 1.785] as [Float] {
                parts.append(P(.box, SIMD3(0.84, 0.03, 0.33), at: SIMD3(0, y, 0), .wood))
            }
            parts += [
                P(.box, SIMD3(0.5, 0.26, 0.22), at: SIMD3(-0.12, 0.6, 0), .primary),
                P(.box, SIMD3(0.4, 0.28, 0.22), at: SIMD3(0.15, 1.06, 0), .primary),
                P(.box, SIMD3(0.3, 0.24, 0.22), at: SIMD3(-0.2, 1.5, 0), .fabricLight),
            ]
            return parts
        case .lamp:
            return [
                P(.cylinder, SIMD3(0.32, 0.04, 0.32), at: SIMD3(0, 0.02, 0), .dark),
                P(.cylinder, SIMD3(0.03, 1.3, 0.03), at: SIMD3(0, 0.69, 0), .dark),
                P(.cylinder, SIMD3(0.4, 0.3, 0.4), at: SIMD3(0, 1.45, 0), .primary),
            ]
        case .plant:
            return [
                P(.cylinder, SIMD3(0.36, 0.35, 0.36), at: SIMD3(0, 0.175, 0), .primary),
                P(.cylinder, SIMD3(0.34, 0.02, 0.34), at: SIMD3(0, 0.35, 0), .dark),
                P(.sphere, SIMD3(0.5, 0.5, 0.5), at: SIMD3(0, 0.68, 0), .leaf),
                P(.sphere, SIMD3(0.4, 0.4, 0.4), at: SIMD3(0.1, 0.88, 0.05), .leaf),
                P(.sphere, SIMD3(0.36, 0.36, 0.36), at: SIMD3(-0.1, 0.97, -0.05), .leaf),
            ]
        case .rug:
            return [
                P(.box, SIMD3(2.0, 0.006, 1.4), at: SIMD3(0, 0.003, 0), .primary),
                P(.box, SIMD3(1.7, 0.004, 1.1), at: SIMD3(0, 0.008, 0), .fabricLight),
                P(.box, SIMD3(1.5, 0.004, 0.9), at: SIMD3(0, 0.0105, 0), .primary),
            ]
        case .tv:
            return [
                P(.box, SIMD3(1.6, 0.45, 0.45), at: SIMD3(0, 0.225, 0), .wood),
                P(.box, SIMD3(0.3, 0.02, 0.2), at: SIMD3(0, 0.46, 0), .dark),
                P(.box, SIMD3(0.06, 0.12, 0.04), at: SIMD3(0, 0.53, -0.02), .dark),
                P(.box, SIMD3(1.23, 0.72, 0.04), at: SIMD3(0, 0.93, 0), .primary),
                P(.box, SIMD3(1.19, 0.68, 0.005), at: SIMD3(0, 0.93, 0.0225), .screen),
            ]
        case .wallTV:
            return [
                P(.box, SIMD3(1.45, 0.84, 0.04), at: SIMD3(0, 1.4, 0), .primary),
                P(.box, SIMD3(1.41, 0.8, 0.005), at: SIMD3(0, 1.4, 0.0225), .screen),
            ]
        case .picture:
            return Self.pictureParts(aspect: 0.7 / 0.5)
        }
    }

    /// A framed picture `aspect` (width / height) wide, its longest side 0.7 m,
    /// hung with its centre 1.45 m up. The `art` part takes a photo's texture.
    public static func pictureParts(aspect: Float) -> [FurniturePart] {
        let a = aspect.isFinite && aspect > 0 ? min(max(aspect, 0.25), 4) : 1.4
        let w: Float = a >= 1 ? 0.7 : 0.7 * a
        let h: Float = a >= 1 ? 0.7 / a : 0.7
        return [
            FurniturePart(.box, SIMD3(w, h, 0.04), at: SIMD3(0, 1.45, 0), .primary),
            FurniturePart(.box, SIMD3(w - 0.06, h - 0.06, 0.005), at: SIMD3(0, 1.45, 0.0215), .fabricLight),
            FurniturePart(.box, SIMD3(w - 0.14, h - 0.14, 0.005), at: SIMD3(0, 1.45, 0.024), .art),
        ]
    }

    /// Every object category RoomPlan reports (`CapturedRoom.Object.Category`,
    /// as `String(describing:)` spells it).
    public static let scanCategories: [String] = [
        "storage", "refrigerator", "stove", "bed", "sink", "washerDryer", "toilet", "bathtub", "oven",
        "dishwasher", "table", "sofa", "chair", "fireplace", "television", "stairs",
    ]

    /// The categories that are part of the room itself and never become
    /// movable furniture.
    public static let scanFixtures: Set<String> = [
        "refrigerator", "stove", "sink", "washerDryer", "toilet", "bathtub", "oven", "dishwasher", "fireplace",
        "stairs",
    ]

    /// The catalogue piece a RoomPlan category becomes when scanned furniture
    /// is made movable, or nil for fixtures that stay part of the room (sinks,
    /// stairs, a fireplace).
    public static func forScanCategory(_ category: String) -> FurnitureItem? {
        switch category.lowercased() {
        case "sofa": return .sofa
        case "chair": return .chair
        case "table": return .diningTable
        case "bed": return .bed
        case "storage": return .shelf
        case "television": return .wallTV
        default: return nil
        }
    }

    /// A scanned object as a movable scene object: the mapped piece, standing
    /// on the floor where the scan found it, turned the same way and scaled to
    /// the scanned size. Wall-mounted pieces scale only in width, so they stay
    /// at wall height. Nil when the category has no catalogue piece.
    public static func sceneData(fromScanned item: RoomModel.Item) -> (data: ObjectData, transform: Transform)? {
        guard let piece = forScanCategory(item.category), item.dimensions.count == 3 else { return nil }
        let m = RoomModel.matrix(item.transform)
        let yaw = atan2(-m.columns.0.z, m.columns.0.x)
        let rotation = simd_quatf(angle: yaw.isFinite ? yaw : 0, axis: SIMD3(0, 1, 0))
        let clamp = { (v: Float) -> Double in Double(min(max(v.isFinite ? v : 1, 0.2), 6)) }
        let d = item.dimensions
        let scale = piece.isWallMounted
            ? Vec3(clamp(d[0] / piece.size.x), 1, 1)
            : Vec3(clamp(d[0] / piece.size.x), clamp(d[1] / piece.size.y), clamp(d[2] / piece.size.z))
        let transform = Transform(
            position: Vec3(Double(m.columns.3.x), 0, Double(m.columns.3.z)), rotation: Quat(rotation), scale: scale)
        return (ObjectData(furniture: piece), transform)
    }
}

/// One solid in a furniture model.
public struct FurniturePart: Equatable {
    public enum Shape: Equatable { case box, cylinder, sphere }

    /// What colours a part: the object's own colour, or a fixed material.
    public enum Role: Equatable {
        case primary, wood, dark, screen, fabricLight, leaf, art

        /// The fixed colour of a non-primary role (hex).
        public var hex: String? {
            switch self {
            case .primary: return nil
            case .wood: return "B08968"
            case .dark: return "1F2228"
            case .screen: return "0B1020"
            case .fabricLight: return "ECE7DF"
            case .leaf: return "3F8F4E"
            case .art: return "5B7DB1"
            }
        }
    }

    public var shape: Shape
    /// Box: (width, height, depth). Cylinder: (diameter, height, diameter).
    /// Sphere: (diameter, …).
    public var size: SIMD3<Float>
    public var centre: SIMD3<Float>
    public var role: Role

    public init(_ shape: Shape, _ size: SIMD3<Float>, at centre: SIMD3<Float>, _ role: Role) {
        self.shape = shape; self.size = size; self.centre = centre; self.role = role
    }
}

extension ObjectData {
    public init(furniture item: FurnitureItem) { self.init(kind: "furniture", item: item.rawValue) }

    /// The catalogue piece, for a furniture object.
    public var furniture: FurnitureItem? { kind == "furniture" ? item.flatMap(FurnitureItem.init(rawValue:)) : nil }

    /// What the object is called in the inspector.
    public var displayTitle: String {
        switch kind {
        case "text": return content ?? "Text"
        case "image": return "Photo"
        case "furniture": return furniture?.title ?? (item ?? "Furniture").capitalized
        default: return kind.capitalized
        }
    }

    /// The parts a furniture-like object is drawn from (furniture and photos),
    /// or nil for the primitive shapes.
    public var furnitureParts: [FurniturePart]? {
        if kind == "image" {
            let w = Float(naturalWidth ?? 0), h = Float(naturalHeight ?? 0)
            return FurnitureItem.pictureParts(aspect: h > 0 ? w / h : 1.4)
        }
        if kind == "furniture" { return (furniture ?? .shelf).parts }
        return nil
    }
}
