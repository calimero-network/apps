import Foundation

/// A point in document or layer pixels.
public struct Point: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public init(_ x: Double, _ y: Double) {
        self.x = x
        self.y = y
    }
}

/// A 2D affine matrix in canvas `setTransform` field order: a point maps to
/// `(a·x + c·y + e, b·x + d·y + f)`. (Kotlin `Affine`; web `utils/transform.ts`.)
public struct Affine: Equatable, Sendable {
    public var a, b, c, d, e, f: Double

    public init(a: Double, b: Double, c: Double, d: Double, e: Double, f: Double) {
        self.a = a
        self.b = b
        self.c = c
        self.d = d
        self.e = e
        self.f = f
    }

    public static let identity = Affine(a: 1, b: 0, c: 0, d: 1, e: 0, f: 0)

    /// `self` then `n`: `self` is applied to the point first.
    public func then(_ n: Affine) -> Affine {
        Affine(
            a: a * n.a + b * n.c, b: a * n.b + b * n.d,
            c: c * n.a + d * n.c, d: c * n.b + d * n.d,
            e: e * n.a + f * n.c + n.e, f: e * n.b + f * n.d + n.f)
    }

    public func apply(_ p: Point) -> Point { Point(a * p.x + c * p.y + e, b * p.x + d * p.y + f) }

    public var inverted: Affine? {
        let det = a * d - b * c
        guard det != 0, det.isFinite else { return nil }
        return Affine(
            a: d / det, b: -b / det, c: -c / det, d: a / det,
            e: (c * f - d * e) / det, f: (b * e - a * f) / det)
    }
}

/// Where a layer's pixels land in the document: the web's one definition
/// (`layerMatrix`), in the same order: centre, mirror, shear, scale, rotate,
/// then place at the box centre.
public enum LayerGeometry {
    public static func scale(_ layer: Layer) -> (sx: Double, sy: Double) {
        (Double(layer.scaleX == 0 ? 100 : layer.scaleX) / 100, Double(layer.scaleY == 0 ? 100 : layer.scaleY) / 100)
    }

    public static func matrix(_ layer: Layer) -> Affine {
        let (sx, sy) = scale(layer)
        let clamp = { (v: Int32) -> Double in max(-80, min(80, Double(v))) * .pi / 180 }
        let tx = tan(clamp(layer.skewX))
        let ty = tan(clamp(layer.skewY))
        let w = Double(layer.width)
        let h = Double(layer.height)
        let cx = Double(layer.x) + w * abs(sx) / 2
        let cy = Double(layer.y) + h * abs(sy) / 2
        let rad = Double(layer.rotation) * .pi / 180
        let cosR = cos(rad)
        let sinR = sin(rad)
        let mx: Double = layer.flipH ? -1 : 1
        let my: Double = layer.flipV ? -1 : 1
        return Affine(a: 1, b: 0, c: 0, d: 1, e: -w / 2, f: -h / 2)
            .then(Affine(a: mx, b: 0, c: 0, d: my, e: 0, f: 0))
            .then(Affine(a: 1, b: ty, c: tx, d: 1, e: 0, f: 0))
            .then(Affine(a: abs(sx), b: 0, c: 0, d: abs(sy), e: 0, f: 0))
            .then(Affine(a: cosR, b: sinR, c: -sinR, d: cosR, e: 0, f: 0))
            .then(Affine(a: 1, b: 0, c: 0, d: 1, e: cx, f: cy))
    }
}

/// A corner-pin warp: each corner's offset in the layer's own pixels.
public struct Warp: Equatable, Sendable {
    public var tl, tr, br, bl: Point

    public init(tl: Point, tr: Point, br: Point, bl: Point) {
        self.tl = tl
        self.tr = tr
        self.br = br
        self.bl = bl
    }

    /// `{"tl":[dx,dy],…}`; `nil` for empty, garbage or all-zero (the web's `parseWarp`).
    public static func parse(_ json: String) -> Warp? {
        guard !json.isEmpty, let data = json.data(using: .utf8),
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        func corner(_ key: String) -> Point {
            guard let arr = obj[key] as? [Any], arr.count >= 2 else { return Point(0, 0) }
            let num = { (v: Any) -> Double in
                let d = (v as? NSNumber)?.doubleValue ?? Double("\(v)") ?? 0
                return d.isFinite ? d : 0
            }
            return Point(num(arr[0]), num(arr[1]))
        }
        let w = Warp(tl: corner("tl"), tr: corner("tr"), br: corner("br"), bl: corner("bl"))
        let zero = Point(0, 0)
        return (w.tl == zero && w.tr == zero && w.br == zero && w.bl == zero) ? nil : w
    }

    /// The bilinear point at (u, v) in the warped quad over a `width`×`height` box.
    public func point(width: Double, height: Double, u: Double, v: Double) -> Point {
        let p0 = Point(tl.x, tl.y)
        let p1 = Point(width + tr.x, tr.y)
        let p2 = Point(width + br.x, height + br.y)
        let p3 = Point(bl.x, height + bl.y)
        let top = Point(p0.x + (p1.x - p0.x) * u, p0.y + (p1.y - p0.y) * u)
        let bottom = Point(p3.x + (p2.x - p3.x) * u, p3.y + (p2.y - p3.y) * u)
        return Point(top.x + (bottom.x - top.x) * v, top.y + (bottom.y - top.y) * v)
    }

    /// How finely the quad is cut per axis (the web's `WARP_STEPS`).
    public static let steps = 12

    /// The quad as triangles, each with the affine map from its source
    /// triangle onto its destination: the web's `drawWarped` mesh.
    public func mesh(width: Double, height: Double, steps: Int = Warp.steps) -> [WarpTriangle] {
        var out: [WarpTriangle] = []
        out.reserveCapacity(steps * steps * 2)
        let n = Double(steps)
        for i in 0..<steps {
            for j in 0..<steps {
                let u0 = Double(i) / n, u1 = Double(i + 1) / n
                let v0 = Double(j) / n, v1 = Double(j + 1) / n
                let s = [
                    Point(u0 * width, v0 * height), Point(u1 * width, v0 * height),
                    Point(u1 * width, v1 * height), Point(u0 * width, v1 * height),
                ]
                let d = [
                    point(width: width, height: height, u: u0, v: v0), point(width: width, height: height, u: u1, v: v0),
                    point(width: width, height: height, u: u1, v: v1), point(width: width, height: height, u: u0, v: v1),
                ]
                for (a, b, c) in [(0, 1, 2), (0, 2, 3)] {
                    if let m = WarpTriangle.map(from: [s[a], s[b], s[c]], to: [d[a], d[b], d[c]]) {
                        out.append(WarpTriangle(clip: WarpTriangle.grow([d[a], d[b], d[c]], by: 0.5), transform: m))
                    }
                }
            }
        }
        return out
    }
}

/// One cell of a warp mesh: clip to `clip` (layer pixels, grown a hair to hide
/// seams) and draw the source under `transform`.
public struct WarpTriangle: Equatable, Sendable {
    public let clip: [Point]
    public let transform: Affine

    /// The affine map taking triangle `s` onto triangle `d`.
    public static func map(from s: [Point], to d: [Point]) -> Affine? {
        let (x1, y1, x2, y2, x3, y3) = (s[0].x, s[0].y, s[1].x, s[1].y, s[2].x, s[2].y)
        let det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)
        guard det != 0, det.isFinite else { return nil }
        let (u1, v1, u2, v2, u3, v3) = (d[0].x, d[0].y, d[1].x, d[1].y, d[2].x, d[2].y)
        let a = ((u2 - u1) * (y3 - y1) - (u3 - u1) * (y2 - y1)) / det
        let c = ((u3 - u1) * (x2 - x1) - (u2 - u1) * (x3 - x1)) / det
        let b = ((v2 - v1) * (y3 - y1) - (v3 - v1) * (y2 - y1)) / det
        let dd = ((v3 - v1) * (x2 - x1) - (v2 - v1) * (x3 - x1)) / det
        return Affine(a: a, b: b, c: c, d: dd, e: u1 - a * x1 - c * y1, f: v1 - b * x1 - dd * y1)
    }

    static func grow(_ t: [Point], by amount: Double) -> [Point] {
        let cx = (t[0].x + t[1].x + t[2].x) / 3
        let cy = (t[0].y + t[1].y + t[2].y) / 3
        return t.map { p in
            let dx = p.x - cx
            let dy = p.y - cy
            let len = max(hypot(dx, dy), 1e-9)
            return Point(p.x + dx / len * amount, p.y + dy / len * amount)
        }
    }
}
