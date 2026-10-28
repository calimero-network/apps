import Foundation

/// An outline: colour, width, dash pattern and cap.
public struct Stroke: Equatable, Sendable {
    public var color: RGBA
    public var width: Double
    public var dash: [Double]?
    public var roundCap: Bool
    public var roundJoin: Bool
}

public struct Shadow: Equatable, Sendable {
    public var color: RGBA
    public var dx: Double
    public var dy: Double
    public var blur: Double
}

/// How the words in a text node are set.
public struct TextStyle: Equatable, Hashable, Sendable {
    public enum Design: String, Sendable { case sans, serif, mono }
    public enum Align: String, Sendable { case left, center, right }
    public var size: Double
    public var bold: Bool
    public var italic: Bool
    public var design: Design
    public var align: Align

    /// `sans-serif`, `serif`, `monospace` and the web's named fonts, mapped to
    /// the platform's own three designs.
    public static func design(for family: String) -> Design {
        let f = family.lowercased()
        if f.contains("mono") || f.contains("courier") { return .mono }
        if f == "serif" || f.contains("georgia") || f.contains("times") { return .serif }
        return .sans
    }
}

/// One line of text, positioned in the node's own coordinates: `x` is the
/// anchor (left edge, centre or right edge per the style's alignment), `y`
/// the top of the line.
public struct TextLine: Equatable, Sendable {
    public var text: String
    public var x: Double
    public var y: Double
}

/// One drawable thing, in its own coordinates: the renderer translates to
/// (`x`, `y`), rotates by `rotation` degrees clockwise about that corner
/// (the web canvas's origin), and draws the shape within `width`×`height`.
public struct SceneNode: Identifiable, Equatable, Sendable {
    public enum Shape: Equatable, Sendable {
        case rect(fill: RGBA?, stroke: Stroke?, cornerRadius: Double)
        /// The web canvas draws a circle of radius `width / 2`.
        case ellipse(fill: RGBA?, stroke: Stroke?)
        case path([PathCommand], fill: RGBA?, stroke: Stroke?)
        case line(from: Point, to: Point, stroke: Stroke, arrowHead: [Point]?)
        /// `clip` keeps a box's words inside it.
        case text([TextLine], style: TextStyle, color: RGBA, clip: Bool)
        /// Bytes from the blob store; until then (and always for SVG, which
        /// neither platform rasterises) a placeholder box.
        case image(blobId: String, svg: Bool)
    }

    public let id: String
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double
    public var rotation: Double
    public var opacity: Double
    public var shadow: Shadow?
    public var shape: Shape
}

/// A text measurer for one style: the width of a string in pixels.
public typealias Measure = (String) -> Double
/// Measurers per style; the app passes the platform's font metrics.
public typealias MeasureFactory = (TextStyle) -> Measure

/// The average-glyph estimate the web uses where it has no canvas (tests).
public let estimateMeasure: MeasureFactory = { style in { s in Double(s.count) * style.size * 0.55 } }

/// A board drawn read-only: contract elements to nodes, back to front.
public struct BoardScene: Equatable, Sendable {
    public var nodes: [SceneNode]
    /// The content box, rotation and stroke included; `nil` for an empty board.
    public var bounds: Rect?
    public var screens: [Screen]

    public static let empty = BoardScene(nodes: [], bounds: nil, screens: [])

    public init(nodes: [SceneNode], bounds: Rect?, screens: [Screen]) {
        self.nodes = nodes
        self.bounds = bounds
        self.screens = screens
    }

    /// Hidden layers are left out, as in every web export.
    public init(elements: [Element], measure: MeasureFactory = estimateMeasure) {
        let visible = elements.filter { !$0.meta.hidden }.sorted { $0.layerIndex < $1.layerIndex }
        nodes = visible.flatMap { SceneBuilder.nodes(for: $0, measure: measure) }
        bounds = SceneBuilder.bounds(of: visible)
        screens = Screens.list(elements)
    }

    /// The nodes painted at least partly inside `rect` (a screen's slide).
    public func nodes(in rect: Rect) -> [SceneNode] {
        nodes.filter { SceneBuilder.box(of: $0).intersects(rect) }
    }
}

enum SceneBuilder {
    static func nodes(for el: Element, measure: MeasureFactory) -> [SceneNode] {
        let meta = el.meta
        let w = Double(el.width)
        let h = Double(el.height)
        let opacity = min(1, max(0, Double(el.opacity) / 100))
        let shadow: Shadow? = {
            guard let blur = el.shadowBlur, blur > 0 else { return nil }
            return Shadow(
                color: CSSColor.parse(el.shadowColor) ?? RGBA(0, 0, 0, 0.3),
                dx: Double(el.shadowOffsetX ?? 0), dy: Double(el.shadowOffsetY ?? 4), blur: Double(blur))
        }()
        func node(_ shape: SceneNode.Shape, id: String? = nil) -> SceneNode {
            SceneNode(
                id: id ?? el.id, x: Double(el.x), y: Double(el.y), width: w, height: h,
                rotation: Double(el.rotation), opacity: opacity, shadow: shadow, shape: shape)
        }
        let fill = CSSColor.parse(el.fill)
        let outline = shapeStroke(el, meta)
        let radius = max(0, min(Double(el.cornerRadius ?? 0), min(w, h) / 2))

        switch el.data {
        case .rect:
            return [node(.rect(fill: fill, stroke: outline, cornerRadius: radius))]
        case .circle:
            return [node(.ellipse(fill: fill, stroke: outline))]
        case .line(let d):
            return [node(lineShape(el, meta, points: d.points, arrow: false))]
        case .arrow(let d):
            return [node(lineShape(el, meta, points: d.points, arrow: true))]
        case .path(let d):
            if let kind = meta.shape, let commands = Shapes.outline(kind, width: w, height: h) {
                var s = outline
                s?.roundJoin = true
                return [node(.path(commands, fill: fill, stroke: s))]
            }
            let commands = PathData.parse(d.points)
            guard !commands.isEmpty else { return [] }
            let width = max(1, el.strokeWidth == 0 ? 2 : Double(el.strokeWidth))
            let stroke = Stroke(
                color: CSSColor.parse(el.stroke) ?? .defaultInk, width: width,
                dash: Shapes.dash(meta.strokeStyle, strokeWidth: width), roundCap: true, roundJoin: true)
            return [node(.path(commands, fill: nil, stroke: stroke))]
        case .text(let t):
            if meta.box == "box" || meta.box == "sticky" {
                var out = [node(.rect(fill: fill, stroke: outline, cornerRadius: radius))]
                if !t.content.isEmpty {
                    let style = style(of: t, defaultSize: 16)
                    let pad = TextLayout.padding(box: meta.box)
                    let lineHeight = style.size * TextLayout.boxLineHeight
                    let lines = TextLayout.wrap(t.content, maxWidth: w - pad * 2, measure: measure(style))
                    let block = Double(lines.count) * lineHeight
                    let top: Double
                    switch t.verticalAlign ?? "top" {
                    case "middle": top = (h - block) / 2
                    case "bottom": top = h - pad - block
                    default: top = pad
                    }
                    let anchorX: Double = style.align == .center ? w / 2 : style.align == .right ? w - pad : pad
                    let color = meta.textColor.flatMap(CSSColor.parse) ?? CSSColor.ink(on: el.fill)
                    let set = lines.enumerated().map { i, line in
                        TextLine(text: line, x: anchorX, y: top + Double(i) * lineHeight + (lineHeight - style.size) / 2)
                    }
                    var words = node(.text(set, style: style, color: color, clip: true), id: el.id + "#text")
                    words.shadow = nil
                    out.append(words)
                }
                return out
            }
            let style = style(of: t, defaultSize: 24)
            let lineHeight = style.size * TextLayout.plainLineHeight
            let lines = t.content.components(separatedBy: "\n")
            let m = measure(style)
            let boxWidth = style.align == .left ? w : max(w, lines.map(m).max() ?? 0)
            let x: Double = style.align == .center ? boxWidth / 2 : style.align == .right ? boxWidth : 0
            let block = Double(lines.count) * lineHeight
            let offset: Double
            switch t.verticalAlign ?? "top" {
            case "middle": offset = max(0, (h - block) / 2)
            case "bottom": offset = max(0, h - block)
            default: offset = 0
            }
            let set = lines.enumerated().map { i, line in
                TextLine(text: line, x: x, y: offset + lineHeight * Double(i) + (lineHeight - style.size) / 2)
            }
            return [node(.text(set, style: style, color: fill ?? .defaultInk, clip: false))]
        case .image(let d):
            return [node(.image(blobId: d.blobId, svg: false))]
        case .svg(let d):
            return [node(.image(blobId: d.blobId, svg: true))]
        }
    }

    static func style(of t: ElementData_Text, defaultSize: Double) -> TextStyle {
        let align: TextStyle.Align
        switch t.textAlign ?? "left" {
        case "center": align = .center
        case "right": align = .right
        default: align = .left
        }
        return TextStyle(
            size: t.fontSize > 0 ? Double(t.fontSize) : defaultSize, bold: t.bold, italic: t.italic,
            design: TextStyle.design(for: t.fontFamily), align: align)
    }

    /// The outline of a filled shape: only when its colour is painted and its width is not 0.
    static func shapeStroke(_ el: Element, _ meta: ElementMeta) -> Stroke? {
        guard CSSColor.isPainted(el.stroke), el.strokeWidth > 0, let color = CSSColor.parse(el.stroke) else { return nil }
        let width = Double(el.strokeWidth)
        return Stroke(
            color: color, width: width, dash: Shapes.dash(meta.strokeStyle, strokeWidth: width),
            roundCap: Shapes.roundCap(meta.strokeStyle), roundJoin: false)
    }

    /// A line or arrow: its stroke is the shape, so it always has one.
    static func lineShape(_ el: Element, _ meta: ElementMeta, points: String, arrow: Bool) -> SceneNode.Shape {
        let (a, b) = endpoints(points, width: Double(el.width), height: Double(el.height))
        let width = max(1, el.strokeWidth == 0 ? 2 : Double(el.strokeWidth))
        let stroke = Stroke(
            color: CSSColor.parse(el.stroke) ?? .defaultInk, width: width,
            dash: Shapes.dash(meta.strokeStyle, strokeWidth: width), roundCap: true, roundJoin: false)
        guard arrow else { return .line(from: a, to: b, stroke: stroke, arrowHead: nil) }
        let size = max(8, width * 3.5)
        let angle = atan2(b.y - a.y, b.x - a.x)
        func tip(_ len: Double, _ spread: Double) -> Point {
            Point(
                b.x - len * cos(angle) + spread * cos(angle + .pi / 2),
                b.y - len * sin(angle) + spread * sin(angle + .pi / 2))
        }
        return .line(from: a, to: b, stroke: stroke, arrowHead: [b, tip(size, size * 0.42), tip(size, -size * 0.42)])
    }

    /// `"x1,y1 x2,y2"` relative to the element; the box's diagonal when unreadable.
    static func endpoints(_ raw: String, width: Double, height: Double) -> (Point, Point) {
        let nums = raw.split(whereSeparator: { $0 == "," || $0 == " " || $0.isNewline }).compactMap { Double($0) }
        if nums.count >= 4 { return (Point(nums[0], nums[1]), Point(nums[2], nums[3])) }
        return (Point(0, 0), Point(width, height))
    }

    /// The four corners of a `w`×`h` box at (`x`, `y`) rotated about that corner.
    static func corners(x: Double, y: Double, w: Double, h: Double, rotation: Double) -> [Point] {
        let rad = rotation * .pi / 180
        let c = cos(rad)
        let s = sin(rad)
        return [(0.0, 0.0), (w, 0), (w, h), (0, h)].map { dx, dy in Point(x + dx * c - dy * s, y + dx * s + dy * c) }
    }

    /// The board's content box (`boundsOf`): rotation and half the stroke included.
    static func bounds(of elements: [Element]) -> Rect? {
        guard !elements.isEmpty else { return nil }
        var minX = Double.infinity
        var minY = Double.infinity
        var maxX = -Double.infinity
        var maxY = -Double.infinity
        for el in elements {
            let pad = CSSColor.isPainted(el.stroke) ? Double(el.strokeWidth) / 2 : 0
            for p in corners(
                x: Double(el.x), y: Double(el.y), w: Double(el.width), h: Double(el.height),
                rotation: Double(el.rotation))
            {
                minX = min(minX, p.x - pad)
                minY = min(minY, p.y - pad)
                maxX = max(maxX, p.x + pad)
                maxY = max(maxY, p.y + pad)
            }
        }
        return Rect(x: minX, y: minY, width: max(1, maxX - minX), height: max(1, maxY - minY))
    }

    /// A node's axis-aligned box on the board.
    static func box(of n: SceneNode) -> Rect {
        let pts = corners(x: n.x, y: n.y, w: n.width, h: n.height, rotation: n.rotation)
        let xs = pts.map(\.x)
        let ys = pts.map(\.y)
        let minX = xs.min()!
        let minY = ys.min()!
        return Rect(x: minX, y: minY, width: xs.max()! - minX, height: ys.max()! - minY)
    }
}
