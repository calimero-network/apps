import Foundation

/// Geometry ported from the web's `utils/shapes.ts`, so a board looks the same here.
public enum Shapes {
    /// The outline of a triangle, diamond, star or cloud filling `w`×`h`
    /// exactly, regenerated at the element's size like the canvas does.
    public static func outline(_ kind: String, width w: Double, height h: Double) -> [PathCommand]? {
        let W = max(1, w)
        let H = max(1, h)
        switch kind {
        case "triangle": return PathData.polygon([Point(W / 2, 0), Point(W, H), Point(0, H)])
        case "diamond": return PathData.polygon([Point(W / 2, 0), Point(W, H / 2), Point(W / 2, H), Point(0, H / 2)])
        case "star": return PathData.polygon(fit(starPoints(), W, H))
        case "cloud": return PathData.polygon(fit(cloudPoints(), W, H))
        default: return nil
        }
    }

    /// The dash pattern for a stroke style, scaled by the stroke width (`dashArray`).
    public static func dash(_ style: String?, strokeWidth: Double) -> [Double]? {
        let w = max(1, strokeWidth)
        switch style {
        case "dashed": return [w * 3, w * 2]
        case "dotted": return [0, w * 2]
        case "dashdot": return [w * 4, w * 2, 0, w * 2]
        case "dotted3": return [0, w * 1.8, 0, w * 1.8, 0, w * 4.5]
        case "long": return [w * 7, w * 3]
        default: return nil
        }
    }

    /// Dot patterns need a round cap or their zero-length dashes vanish (`strokeCap`).
    public static func roundCap(_ style: String?) -> Bool {
        style == "dotted" || style == "dashdot" || style == "dotted3"
    }

    private static func r1(_ n: Double) -> Double { (n * 10).rounded() / 10 }

    private static func fit(_ points: [Point], _ w: Double, _ h: Double) -> [Point] {
        let xs = points.map(\.x)
        let ys = points.map(\.y)
        let minX = xs.min() ?? 0
        let maxX = xs.max() ?? 0
        let minY = ys.min() ?? 0
        let maxY = ys.max() ?? 0
        let sx = maxX - minX == 0 ? 1 : maxX - minX
        let sy = maxY - minY == 0 ? 1 : maxY - minY
        return points.map { Point(r1((($0.x - minX) / sx) * w), r1((($0.y - minY) / sy) * h)) }
    }

    private static func starPoints() -> [Point] {
        let inner = 0.47
        return (0..<10).map { i in
            let a = -Double.pi / 2 + Double(i) * Double.pi / 5
            let r = i % 2 == 0 ? 1 : inner
            return Point(cos(a) * r, sin(a) * r)
        }
    }

    private static func cloudPoints() -> [Point] {
        let amp = [0.2, 0.26, 0.18, 0.24, 0.28, 0.2, 0.25, 0.22]
        let lobes = Double(amp.count)
        let samples = 160
        return (0..<samples).map { i in
            let t = Double(i) / Double(samples) * Double.pi * 2
            let phase = t * lobes / 2
            let lobe = Int(floor(t / (Double.pi * 2) * lobes)) % amp.count
            let r = 0.78 + amp[lobe] * sqrt(abs(sin(phase)))
            return Point(cos(t) * r * 1.35, sin(t) * r)
        }
    }
}

/// Word wrap and box layout from the web's `utils/boxText.ts`.
public enum TextLayout {
    /// Line height of words in a box or sticky, in font sizes.
    public static let boxLineHeight = 1.25
    /// Line height of plain text (Fabric's default), in font sizes.
    public static let plainLineHeight = 1.16

    /// Inner padding of a box; a sticky breathes more.
    public static func padding(box: String?) -> Double { box == "sticky" ? 16 : 10 }

    /// Wrap `text` into lines no wider than `maxWidth`. Newlines are kept, and
    /// a word wider than the box is broken by character (`wrapLines`).
    public static func wrap(_ text: String, maxWidth: Double, measure: (String) -> Double) -> [String] {
        let width = max(1, maxWidth)
        var out: [String] = []

        func breakWord(_ word: String) -> [String] {
            var chunks: [String] = []
            var chunk = ""
            for ch in word {
                if !chunk.isEmpty, measure(chunk + String(ch)) > width {
                    chunks.append(chunk)
                    chunk = ""
                }
                chunk.append(ch)
            }
            chunks.append(chunk)
            return chunks
        }

        for para in text.components(separatedBy: "\n") {
            var line = ""
            for token in tokens(para) {
                if token.allSatisfy(\.isWhitespace) {
                    line += token
                    continue
                }
                if measure(line + token) <= width {
                    line += token
                    continue
                }
                if !line.trimmingCharacters(in: .whitespaces).isEmpty { out.append(trimEnd(line)) }
                line = ""
                if measure(token) <= width {
                    line = token
                    continue
                }
                let chunks = breakWord(token)
                out.append(contentsOf: chunks.dropLast())
                line = chunks.last ?? ""
            }
            out.append(trimEnd(line))
        }
        return out
    }

    /// `para.split(/(\s+)/)`: words and the runs of whitespace between them, in order.
    static func tokens(_ s: String) -> [String] {
        var out: [String] = []
        var current = ""
        var inSpace: Bool?
        for ch in s {
            let space = ch.isWhitespace
            if let inSpace, inSpace != space {
                out.append(current)
                current = ""
            }
            inSpace = space
            current.append(ch)
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    static func trimEnd(_ s: String) -> String {
        var s = s
        while let last = s.last, last.isWhitespace { s.removeLast() }
        return s
    }
}
