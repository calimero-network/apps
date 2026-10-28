import CoreGraphics
import ImageIO
import Foundation

/// A drawn signature: strokes of timed points, smoothed into quadratic curves
/// whose width follows the pen's speed, like the web's `signature_pad`
/// (`minWidth: 2`, `maxWidth: 4`, black on white). Undo removes the last
/// stroke; clear removes all. Android `SignatureInk.kt` is the same model.
public struct SignatureInk: Equatable, Sendable {
    public struct Point: Equatable, Sendable {
        public var x: CGFloat
        public var y: CGFloat
        /// Seconds.
        public var time: TimeInterval

        public init(x: CGFloat, y: CGFloat, time: TimeInterval) {
            self.x = x
            self.y = y
            self.time = time
        }

        var cg: CGPoint { CGPoint(x: x, y: y) }
    }

    /// One piece of a stroke: a quadratic curve and the width to draw it at.
    public struct Segment: Equatable, Sendable {
        public let from: CGPoint
        public let control: CGPoint
        public let to: CGPoint
        public let width: CGFloat
    }

    public static let minWidth: CGFloat = 2
    public static let maxWidth: CGFloat = 4
    /// How much of the previous speed carries over (`velocityFilterWeight`).
    static let velocityWeight: CGFloat = 0.7
    /// Points closer than this to the last one are dropped (`minDistance`).
    static let minDistance: CGFloat = 1.5

    public private(set) var strokes: [[Point]] = []

    public init() {}

    public var isEmpty: Bool { strokes.allSatisfy(\.isEmpty) }

    public mutating func begin(_ point: Point) { strokes.append([point]) }

    public mutating func add(_ point: Point) {
        guard var stroke = strokes.popLast() else {
            begin(point)
            return
        }
        if let last = stroke.last, hypot(point.x - last.x, point.y - last.y) < Self.minDistance {
            strokes.append(stroke)
            return
        }
        stroke.append(point)
        strokes.append(stroke)
    }

    public mutating func undo() { _ = strokes.popLast() }

    public mutating func clear() { strokes.removeAll() }

    /// The curves to draw for one stroke. A single tap is a dot.
    public static func segments(_ stroke: [Point]) -> [Segment] {
        guard let first = stroke.first else { return [] }
        if stroke.count == 1 {
            return [Segment(from: first.cg, control: first.cg, to: first.cg, width: (minWidth + maxWidth) / 2)]
        }
        let widths = self.widths(stroke)
        var out: [Segment] = []
        var start = first.cg
        for i in 1..<stroke.count {
            let control = stroke[i].cg
            let end: CGPoint
            if i == stroke.count - 1 {
                end = control
            } else {
                let next = stroke[i + 1].cg
                end = CGPoint(x: (control.x + next.x) / 2, y: (control.y + next.y) / 2)
            }
            out.append(Segment(from: start, control: control, to: end, width: widths[i]))
            start = end
        }
        return out
    }

    /// A width per point: slow is thick, fast is thin, smoothed.
    static func widths(_ stroke: [Point]) -> [CGFloat] {
        var widths: [CGFloat] = [maxWidth]
        var velocity: CGFloat = 0
        var width = (minWidth + maxWidth) / 2
        for i in 1..<stroke.count {
            let a = stroke[i - 1]
            let b = stroke[i]
            let ms = max(CGFloat((b.time - a.time) * 1000), 1)
            let speed = hypot(b.x - a.x, b.y - a.y) / ms
            velocity = velocityWeight * speed + (1 - velocityWeight) * velocity
            let target = max(maxWidth / (velocity + 1), minWidth)
            width = (width + target) / 2
            widths.append(width)
        }
        return widths
    }
}

// MARK: - The image the library stores

extension SignatureInk {
    /// The signature as the web stores it: a PNG of the whole pad, opaque
    /// white with black ink (`signaturePad.toDataURL('image/png')` on a
    /// `#ffffff` background), at `scale` pixels per point like the web's
    /// device-pixel ratio. Nil when there is nothing drawn.
    public func renderPNG(size: CGSize, scale: CGFloat) -> Data? {
        guard !isEmpty, size.width > 0, size.height > 0 else { return nil }
        let width = Int((size.width * scale).rounded())
        let height = Int((size.height * scale).rounded())
        guard
            let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return nil }
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        // Points are top-left; a bitmap context's origin is bottom-left.
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: scale, y: -scale)
        draw(in: context)
        guard let image = context.makeImage() else { return nil }
        let out = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(out as CFMutableData, "public.png" as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return out as Data
    }

    /// Draw the ink, black, into a context whose units are the pad's points.
    public func draw(in context: CGContext) {
        context.setStrokeColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
        context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
        context.setLineCap(.round)
        context.setLineJoin(.round)
        for stroke in strokes {
            for segment in Self.segments(stroke) {
                if segment.from == segment.to, segment.from == segment.control {
                    let r = segment.width / 2
                    context.fillEllipse(in: CGRect(x: segment.from.x - r, y: segment.from.y - r, width: r * 2, height: r * 2))
                    continue
                }
                context.setLineWidth(segment.width)
                context.beginPath()
                context.move(to: segment.from)
                context.addQuadCurve(to: segment.to, control: segment.control)
                context.strokePath()
            }
        }
    }
}
