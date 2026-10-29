import Foundation

/// Pan and zoom of the board view: a canvas point `p` is drawn at
/// `p * scale + offset` in view points.
public struct Viewport: Equatable, Sendable {
    public var scale: Double
    public var offsetX: Double
    public var offsetY: Double

    public static let minScale = 0.05
    public static let maxScale = 8.0

    public init(scale: Double = 1, offsetX: Double = 0, offsetY: Double = 0) {
        self.scale = scale
        self.offsetX = offsetX
        self.offsetY = offsetY
    }

    /// The whole of `content` centred in a `viewW`×`viewH` view with `padding`
    /// around it, never enlarged past 100%. An empty board sits at 100%, its
    /// origin in the middle.
    public static func fit(_ content: Rect?, viewW: Double, viewH: Double, padding: Double = 24) -> Viewport {
        guard let content, viewW > 0, viewH > 0 else {
            return Viewport(scale: 1, offsetX: viewW / 2, offsetY: viewH / 2)
        }
        let availW = max(1, viewW - padding * 2)
        let availH = max(1, viewH - padding * 2)
        let scale = clampScale(min(1, min(availW / content.width, availH / content.height)))
        return Viewport(
            scale: scale,
            offsetX: viewW / 2 - content.center.x * scale,
            offsetY: viewH / 2 - content.center.y * scale)
    }

    public static func clampScale(_ s: Double) -> Double { min(maxScale, max(minScale, s)) }

    /// Zoomed by `factor` about the view point (`ax`, `ay`), which stays put.
    public func zoomed(by factor: Double, aboutX ax: Double, y ay: Double) -> Viewport {
        let next = Viewport.clampScale(scale * factor)
        let k = next / scale
        return Viewport(scale: next, offsetX: ax - (ax - offsetX) * k, offsetY: ay - (ay - offsetY) * k)
    }

    public func panned(dx: Double, dy: Double) -> Viewport {
        Viewport(scale: scale, offsetX: offsetX + dx, offsetY: offsetY + dy)
    }

    /// The canvas point under the view point (`vx`, `vy`).
    public func canvasPoint(viewX vx: Double, viewY vy: Double) -> Point {
        Point((vx - offsetX) / scale, (vy - offsetY) / scale)
    }

    /// The view point a canvas point is drawn at.
    public func viewPoint(_ p: Point) -> Point {
        Point(p.x * scale + offsetX, p.y * scale + offsetY)
    }
}
