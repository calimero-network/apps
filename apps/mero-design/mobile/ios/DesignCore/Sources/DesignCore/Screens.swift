import Foundation

/// A screen: one slide of Present. A rect labelled directly in the top-level
/// `screen` group (`screen/01 Sign in`); its area is the slide
/// (`app/src/utils/screens.ts`).
public struct Screen: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    /// Explicit place (`screen/Home @3`), or `nil` for reading order.
    public let order: Int?
    public let frame: Rect
}

/// An axis-aligned rectangle in canvas pixels.
public struct Rect: Equatable, Hashable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var maxX: Double { x + width }
    public var maxY: Double { y + height }
    public var center: Point { Point(x + width / 2, y + height / 2) }

    public func intersects(_ o: Rect) -> Bool {
        x < o.maxX && maxX > o.x && y < o.maxY && maxY > o.y
    }

    public func contains(_ p: Point) -> Bool { p.x >= x && p.x <= maxX && p.y >= y && p.y <= maxY }
}

public enum Screens {
    /// The name to show and the explicit order of a screen's label segment.
    public static func parseName(_ segment: String) -> (name: String, order: Int?) {
        guard let range = segment.range(of: #"\s*@(\d+)$"#, options: .regularExpression) else { return (segment, nil) }
        let name = segment[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
        let digits = segment[range].filter(\.isNumber)
        return name.isEmpty ? (segment, nil) : (name, Int(digits))
    }

    /// Every visible screen on the board, in presentation order: numbered
    /// screens by number first, then the rest in reading order (`listScreens`).
    public static func list(_ elements: [Element]) -> [Screen] {
        var found: [Screen] = []
        for el in elements {
            let (label, meta) = ElementMeta.unpack(el.label)
            guard !meta.hidden, case .rect = el.data else { continue }
            let segments = splitLabelPath(label)
            guard segments.count == 2, segments[0].lowercased() == "screen" else { continue }
            let (name, order) = parseName(segments[1])
            found.append(
                Screen(
                    id: el.id, name: name, order: order,
                    frame: Rect(
                        x: Double(el.x), y: Double(el.y), width: max(1, Double(el.width)),
                        height: max(1, Double(el.height)))))
        }
        let reading = readingOrder(found)
        let rank = Dictionary(uniqueKeysWithValues: reading.enumerated().map { ($1.id, $0) })
        return reading.sorted { a, b in
            if let ao = a.order, let bo = b.order, ao != bo { return ao < bo }
            if (a.order == nil) != (b.order == nil) { return a.order != nil }
            return rank[a.id]! < rank[b.id]!
        }
    }

    /// Rows top to bottom, left to right inside a row; a screen joins a row
    /// when its top is above the middle of the row's first screen.
    static func readingOrder(_ screens: [Screen]) -> [Screen] {
        let byTop = screens.sorted { ($0.frame.y, $0.frame.x) < ($1.frame.y, $1.frame.x) }
        var rows: [[Screen]] = []
        for s in byTop {
            if let first = rows.last?.first, s.frame.y < first.frame.y + first.frame.height / 2 {
                rows[rows.count - 1].append(s)
            } else {
                rows.append([s])
            }
        }
        return rows.flatMap { $0.sorted { ($0.frame.x, $0.frame.y) < ($1.frame.x, $1.frame.y) } }
    }

    /// How big to draw a `width`×`height` screen in a `viewW`×`viewH`
    /// viewport (`fitScreen`, mode `fit`): all of it, unless that shrinks a
    /// long page below half its readable width; then fill the width and scroll.
    public static func fit(width: Double, height: Double, viewW: Double, viewH: Double) -> (scale: Double, scrolls: Bool) {
        let w = max(1, width)
        let h = max(1, height)
        let vw = max(1, viewW)
        let vh = max(1, viewH)
        let widthScale = vw / w
        let whole = min(widthScale, vh / h)
        let readable = min(widthScale, 1)
        let scale = whole >= readable / 2 ? whole : readable
        return (scale, h * scale > vh + 0.5)
    }
}
