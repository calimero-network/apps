import Foundation
import simd

/// A scanned room, as the room shares it: the shape of RoomPlan's
/// `CapturedRoom` (walls, doors, windows, openings and detected objects, each
/// with a category, dimensions and a transform) in a small portable JSON that
/// renders anywhere: on a phone without LiDAR, in the Simulator, on the web.
///
/// Apple's own `Codable` encoding of `CapturedRoom` is not used as the wire
/// format: it is internal to RoomPlan, changes between iOS versions and only
/// decodes on Apple platforms. This mirrors its fields instead
/// (`RoomModel(captured:)` builds it on a scanning device), and the full
/// fidelity copy travels next to it as the USDZ RoomPlan exports.
///
/// Coordinates are RoomPlan's: metres, y up, the scan's world origin. Scene
/// objects placed in the room use the same frame.
public struct RoomModel: Codable, Equatable {
    /// `"meroar.room/1"`.
    public var format: String
    /// A built-in sample rather than a real scan.
    public var sample: Bool
    public var name: String?
    public var walls: [Surface]
    public var doors: [Surface]
    public var windows: [Surface]
    public var openings: [Surface]
    public var objects: [Item]

    public static let currentFormat = "meroar.room/1"

    /// A flat rectangle (wall, door, window, opening). `dimensions` is
    /// (width, height, depth); `transform` is column-major, centred on the
    /// surface, with its local x along the width and y up.
    public struct Surface: Codable, Equatable, Identifiable {
        public var id: String
        public var dimensions: [Float]
        public var transform: [Float]
        /// For doors: "door" or "doorOpen". Nil for other surfaces.
        public var category: String?

        public init(id: String, dimensions: [Float], transform: [Float], category: String? = nil) {
            self.id = id; self.dimensions = dimensions; self.transform = transform; self.category = category
        }
    }

    /// A detected piece of furniture or fixture: RoomPlan's object categories
    /// (sofa, table, chair, bed, storage, television…).
    public struct Item: Codable, Equatable, Identifiable {
        public var id: String
        public var category: String
        public var dimensions: [Float]
        public var transform: [Float]

        public init(id: String, category: String, dimensions: [Float], transform: [Float]) {
            self.id = id; self.category = category; self.dimensions = dimensions; self.transform = transform
        }
    }

    public init(
        sample: Bool, name: String? = nil, walls: [Surface], doors: [Surface] = [], windows: [Surface] = [],
        openings: [Surface] = [], objects: [Item] = []
    ) {
        format = Self.currentFormat
        self.sample = sample; self.name = name; self.walls = walls; self.doors = doors
        self.windows = windows; self.openings = openings; self.objects = objects
    }

    // MARK: Decoding

    public enum ModelError: LocalizedError, Equatable {
        case unsupportedFormat(String)
        case noWalls

        public var errorDescription: String? {
            switch self {
            case .unsupportedFormat(let f): return "This room scan is in a format this app doesn't read (\(f))."
            case .noWalls: return "This room scan has no walls."
            }
        }
    }

    /// Decode and check a shared room.
    public static func decode(_ data: Data) throws -> RoomModel {
        let model = try JSONDecoder().decode(RoomModel.self, from: data)
        guard model.format.hasPrefix("meroar.room/") else { throw ModelError.unsupportedFormat(model.format) }
        guard !model.walls.isEmpty else { throw ModelError.noWalls }
        return model
    }

    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }

    /// The built-in sample living room (labelled as a sample everywhere).
    public static func sampleLivingRoom(bundle: Bundle = .main) -> RoomModel? {
        guard let url = bundle.url(forResource: "sample-living-room", withExtension: "json"),
            let data = try? Data(contentsOf: url)
        else { return nil }
        return try? decode(data)
    }

    // MARK: Geometry

    /// The floor's extent: the rectangle (x, z) the walls enclose.
    public var floorBounds: FloorBounds {
        var points: [SIMD2<Float>] = []
        for wall in walls {
            let m = Self.matrix(wall.transform)
            let centre = SIMD3(m.columns.3.x, m.columns.3.y, m.columns.3.z)
            let along = simd_normalize(SIMD3(m.columns.0.x, m.columns.0.y, m.columns.0.z))
            let half = (wall.dimensions.first ?? 0) / 2
            for end in [centre + along * half, centre - along * half] { points.append(SIMD2(end.x, end.z)) }
        }
        guard let first = points.first else { return FloorBounds(minX: 0, maxX: 0, minZ: 0, maxZ: 0) }
        var b = FloorBounds(minX: first.x, maxX: first.x, minZ: first.y, maxZ: first.y)
        for p in points {
            b.minX = min(b.minX, p.x); b.maxX = max(b.maxX, p.x)
            b.minZ = min(b.minZ, p.y); b.maxZ = max(b.maxZ, p.y)
        }
        return b
    }

    /// Wall height (the tallest wall).
    public var height: Float { walls.map { $0.dimensions.count > 1 ? $0.dimensions[1] : 0 }.max() ?? 0 }
    public var width: Float { floorBounds.width }
    public var length: Float { floorBounds.length }

    /// A transform from 16 column-major floats (identity when malformed).
    public static func matrix(_ values: [Float]) -> simd_float4x4 {
        guard values.count == 16 else { return matrix_identity_float4x4 }
        return simd_float4x4(
            SIMD4(values[0], values[1], values[2], values[3]),
            SIMD4(values[4], values[5], values[6], values[7]),
            SIMD4(values[8], values[9], values[10], values[11]),
            SIMD4(values[12], values[13], values[14], values[15]))
    }

    /// 16 column-major floats from a transform.
    public static func values(_ m: simd_float4x4) -> [Float] {
        [m.columns.0, m.columns.1, m.columns.2, m.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
    }
}

/// The floor rectangle of a room, in metres.
public struct FloorBounds: Equatable {
    public var minX: Float, maxX: Float, minZ: Float, maxZ: Float

    public var width: Float { maxX - minX }
    public var length: Float { maxZ - minZ }
    public var centre: SIMD2<Float> { SIMD2((minX + maxX) / 2, (minZ + maxZ) / 2) }

    /// `point` moved inside the room, at least `margin` from every wall, and
    /// onto the floor (y = `floorY`). A room smaller than twice the margin
    /// clamps to its centre.
    public func clamp(_ point: SIMD3<Float>, margin: Float = 0.15, floorY: Float = 0) -> SIMD3<Float> {
        func fit(_ v: Float, _ lo: Float, _ hi: Float) -> Float {
            let a = lo + margin
            let b = hi - margin
            return a > b ? (lo + hi) / 2 : min(max(v, a), b)
        }
        return SIMD3(fit(point.x, minX, maxX), floorY, fit(point.z, minZ, maxZ))
    }

    public func contains(_ point: SIMD3<Float>) -> Bool {
        point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ
    }
}

/// The room's current scan, as the contract records it (`get_room_scan`).
public struct RoomScanRecord: Codable, Equatable {
    public var jsonBlob: String
    public var jsonSize: UInt64
    public var usdzBlob: String?
    public var usdzSize: UInt64?
    public var width: Double
    public var length: Double
    public var height: Double
    public var objectCount: UInt32
    public var sample: Bool
    public var scannedBy: String
    public var scannedAt: UInt64
    public var version: UInt64
}
