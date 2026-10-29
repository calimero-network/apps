import Foundation

/// Where one layer's pixels come from.
public enum LayerSource: Equatable, Sendable {
    /// A PNG blob, drawn at the layer's top-left and clipped to its box.
    case raster(blobId: String)
    /// A solid colour over the whole box (an unpainted fill layer).
    case fill(RGBA)
    /// Lines of text in the box.
    case text(TextProps)
}

/// One draw of the composite: a layer's prepared pixels placed by its matrix
/// (and warp), at its inherited opacity, with its blend mode.
public struct DrawOp: Equatable, Sendable {
    public let layerId: String
    public let source: LayerSource
    public let maskBlobId: String?
    public let width: Int
    public let height: Int
    public let alpha: Double
    public let blend: BlendMode
    public let matrix: Affine
    public let warp: Warp?
    public let filter: ColorFilter?
}

/// The layer stack as the web's compositor reads it (`utils/compositor.ts`):
/// every layer by ascending `layerIndex`, folders contributing only inherited
/// visibility and opacity. `overrides` are this phone's own show/hide choices,
/// which replace a layer's `visible` here and nowhere else. (Kotlin `LayerStack`.)
public enum LayerStack {
    static let maxDepth = 32

    public static func drawOps(_ layers: [Layer], overrides: [String: Bool] = [:]) -> [DrawOp] {
        let map = Dictionary(layers.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return layers
            .enumerated()
            .sorted { ($0.element.layerIndex, $0.offset) < ($1.element.layerIndex, $1.offset) }
            .map(\.element)
            .compactMap { layer -> DrawOp? in
                guard isVisible(layer, map: map, overrides: overrides) else { return nil }
                let alpha = opacity(layer, map: map)
                guard alpha > 0, let source = source(layer) else { return nil }
                return DrawOp(
                    layerId: layer.id, source: source,
                    maskBlobId: layer.maskBlobId.flatMap { $0.isEmpty ? nil : $0 },
                    width: max(1, Int(layer.width)), height: max(1, Int(layer.height)),
                    alpha: alpha, blend: BlendMode(wire: layer.blendMode),
                    matrix: LayerGeometry.matrix(layer), warp: Warp.parse(layer.warp),
                    filter: ColorFilter.from(layer.adjustments))
            }
    }

    /// The pixels a layer draws, or `nil` for folders, adjustment layers and
    /// rasters with nothing painted yet.
    public static func source(_ layer: Layer) -> LayerSource? {
        switch layer.kind {
        case "group", "adjustment":
            return nil
        case "text":
            return layer.text.map { .text($0) }
        case "fill":
            if !layer.blobId.isEmpty { return .raster(blobId: layer.blobId) }
            return .fill(RGBA.parse(layer.fill) ?? RGBA(0, 0, 0))
        default:
            return layer.blobId.isEmpty ? nil : .raster(blobId: layer.blobId)
        }
    }

    public static func visible(_ layer: Layer, overrides: [String: Bool]) -> Bool {
        overrides[layer.id] ?? layer.visible
    }

    /// Visible only if it and every folder above it are.
    public static func isVisible(_ layer: Layer, map: [String: Layer], overrides: [String: Bool]) -> Bool {
        var cur: Layer? = layer
        var seen: Set<String> = []
        while let l = cur, seen.count < maxDepth {
            if !visible(l, overrides: overrides) { return false }
            guard let parent = l.parentId, !seen.contains(l.id) else { break }
            seen.insert(l.id)
            cur = map[parent]
        }
        return true
    }

    /// Opacity multiplied down the folder chain, 0…1.
    public static func opacity(_ layer: Layer, map: [String: Layer]) -> Double {
        var o = Double(layer.opacity) / 100
        var cur = layer.parentId.flatMap { map[$0] }
        var seen: Set<String> = [layer.id]
        while let l = cur, !seen.contains(l.id), seen.count < maxDepth {
            o *= Double(l.opacity) / 100
            seen.insert(l.id)
            cur = l.parentId.flatMap { map[$0] }
        }
        return min(1, max(0, o))
    }

    /// Every blob the composite needs: pixels and masks.
    public static func blobIds(_ ops: [DrawOp]) -> [String] {
        var out: [String] = []
        for op in ops {
            if case .raster(let id) = op.source, !out.contains(id) { out.append(id) }
            if let m = op.maskBlobId, !out.contains(m) { out.append(m) }
        }
        return out
    }
}

/// A row of the layer list: front-most first, folders before their contents.
public struct LayerRow: Identifiable, Equatable, Sendable {
    public var id: String { layer.id }
    public let layer: Layer
    public let depth: Int
    /// This layer's own visibility on this phone.
    public let visible: Bool
    /// A folder above it is hidden, so it is hidden too.
    public let hiddenByFolder: Bool
    /// This phone shows or hides it differently from the document.
    public let overridden: Bool
}

/// The folder tree (the web's `buildTree`): a layer whose parent is missing,
/// not a folder, or would close a cycle sits at the top level.
public enum LayerTree {
    public static func rows(_ layers: [Layer], overrides: [String: Bool] = [:]) -> [LayerRow] {
        let map = Dictionary(layers.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var children: [String: [Layer]] = [:]
        var roots: [Layer] = []
        for l in layers {
            if let p = effectiveParent(l, map: map) { children[p, default: []].append(l) } else { roots.append(l) }
        }
        var out: [LayerRow] = []
        func walk(_ list: [Layer], depth: Int, folderHidden: Bool) {
            for l in list.sorted(by: { $0.layerIndex > $1.layerIndex }) {
                let own = LayerStack.visible(l, overrides: overrides)
                out.append(
                    LayerRow(
                        layer: l, depth: depth, visible: own, hiddenByFolder: folderHidden,
                        overridden: overrides[l.id].map { $0 != l.visible } ?? false))
                if depth < LayerStack.maxDepth, let kids = children[l.id] {
                    walk(kids, depth: depth + 1, folderHidden: folderHidden || !own)
                }
            }
        }
        walk(roots, depth: 0, folderHidden: false)
        return out
    }

    static func effectiveParent(_ layer: Layer, map: [String: Layer]) -> String? {
        guard let pid = layer.parentId, pid != layer.id, let parent = map[pid], parent.kind == "group" else { return nil }
        var cur: Layer? = parent
        for _ in 0..<LayerStack.maxDepth {
            guard let c = cur else { break }
            if c.id == layer.id { return nil }
            cur = c.parentId.flatMap { map[$0] }
        }
        return pid
    }
}
