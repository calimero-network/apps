import Foundation

/// A point in canvas pixels.
public struct Point: Equatable, Hashable, Sendable {
    public var x: Double
    public var y: Double
    public init(_ x: Double, _ y: Double) {
        self.x = x
        self.y = y
    }
}

/// One absolute drawing command; every SVG path command reduces to these.
public enum PathCommand: Equatable, Sendable {
    case move(Point)
    case line(Point)
    case quad(control: Point, to: Point)
    case cubic(c1: Point, c2: Point, to: Point)
    case close
}

/// SVG path data (`M 0 0 L 40 40 Z`, what Fabric's pencil and the shape tools
/// store) to absolute commands. Handles M L H V C S Q T Z, absolute and
/// relative. An arc (A) is drawn as a straight segment to its end point: the
/// web app never writes one.
public enum PathData {
    public static func parse(_ d: String) -> [PathCommand] {
        var tokens = Tokenizer(d)
        var out: [PathCommand] = []
        var current = Point(0, 0)
        var start = Point(0, 0)
        var lastCubic: Point?
        var lastQuad: Point?
        var command: Character?

        while let next = tokens.peek() {
            if case .command(let c) = next {
                command = c
                _ = tokens.next()
                if c == "Z" || c == "z" {
                    out.append(.close)
                    current = start
                    lastCubic = nil
                    lastQuad = nil
                    continue
                }
            }
            guard let cmd = command else { _ = tokens.next(); continue }
            let relative = cmd.isLowercase
            func pt(_ x: Double, _ y: Double) -> Point { relative ? Point(current.x + x, current.y + y) : Point(x, y) }

            switch cmd.uppercased() {
            case "M":
                guard let x = tokens.number(), let y = tokens.number() else { return out }
                current = pt(x, y)
                start = current
                out.append(.move(current))
                // Further pairs after a moveto are implicit linetos.
                command = relative ? "l" : "L"
                lastCubic = nil
                lastQuad = nil
            case "L":
                guard let x = tokens.number(), let y = tokens.number() else { return out }
                current = pt(x, y)
                out.append(.line(current))
                lastCubic = nil
                lastQuad = nil
            case "H":
                guard let x = tokens.number() else { return out }
                current = Point(relative ? current.x + x : x, current.y)
                out.append(.line(current))
                lastCubic = nil
                lastQuad = nil
            case "V":
                guard let y = tokens.number() else { return out }
                current = Point(current.x, relative ? current.y + y : y)
                out.append(.line(current))
                lastCubic = nil
                lastQuad = nil
            case "C":
                guard let x1 = tokens.number(), let y1 = tokens.number(), let x2 = tokens.number(),
                    let y2 = tokens.number(), let x = tokens.number(), let y = tokens.number()
                else { return out }
                let c1 = pt(x1, y1)
                let c2 = pt(x2, y2)
                current = pt(x, y)
                out.append(.cubic(c1: c1, c2: c2, to: current))
                lastCubic = c2
                lastQuad = nil
            case "S":
                guard let x2 = tokens.number(), let y2 = tokens.number(), let x = tokens.number(), let y = tokens.number()
                else { return out }
                let c1 = lastCubic.map { Point(2 * current.x - $0.x, 2 * current.y - $0.y) } ?? current
                let c2 = pt(x2, y2)
                current = pt(x, y)
                out.append(.cubic(c1: c1, c2: c2, to: current))
                lastCubic = c2
                lastQuad = nil
            case "Q":
                guard let x1 = tokens.number(), let y1 = tokens.number(), let x = tokens.number(), let y = tokens.number()
                else { return out }
                let c = pt(x1, y1)
                current = pt(x, y)
                out.append(.quad(control: c, to: current))
                lastQuad = c
                lastCubic = nil
            case "T":
                guard let x = tokens.number(), let y = tokens.number() else { return out }
                let c = lastQuad.map { Point(2 * current.x - $0.x, 2 * current.y - $0.y) } ?? current
                current = pt(x, y)
                out.append(.quad(control: c, to: current))
                lastQuad = c
                lastCubic = nil
            case "A":
                guard tokens.number() != nil, tokens.number() != nil, tokens.number() != nil,
                    tokens.number() != nil, tokens.number() != nil,
                    let x = tokens.number(), let y = tokens.number()
                else { return out }
                current = pt(x, y)
                out.append(.line(current))
                lastCubic = nil
                lastQuad = nil
            default:
                _ = tokens.next()
            }
        }
        return out
    }

    /// Closed polygon through `points` (`closedPath` in shapes.ts).
    public static func polygon(_ points: [Point]) -> [PathCommand] {
        guard let first = points.first else { return [] }
        return [.move(first)] + points.dropFirst().map { .line($0) } + [.close]
    }

    private enum Token: Equatable {
        case command(Character)
        case number(Double)
    }

    private struct Tokenizer {
        let chars: [Character]
        var i = 0
        var peeked: Token??

        init(_ s: String) { chars = Array(s) }

        mutating func peek() -> Token? {
            if let peeked { return peeked }
            let t = read()
            peeked = .some(t)
            return t
        }

        mutating func next() -> Token? {
            if let p = peeked {
                peeked = nil
                return p
            }
            return read()
        }

        mutating func number() -> Double? {
            guard case .number(let n)? = peek() else { return nil }
            _ = next()
            return n
        }

        private mutating func read() -> Token? {
            while i < chars.count, chars[i] == " " || chars[i] == "," || chars[i].isNewline || chars[i] == "\t" { i += 1 }
            guard i < chars.count else { return nil }
            let c = chars[i]
            if c.isLetter, c != "e", c != "E" {
                i += 1
                return .command(c)
            }
            var s = ""
            if c == "-" || c == "+" {
                s.append(c)
                i += 1
            }
            var seenDot = false
            var seenExp = false
            while i < chars.count {
                let ch = chars[i]
                if ch.isNumber {
                    s.append(ch)
                } else if ch == ".", !seenDot, !seenExp {
                    seenDot = true
                    s.append(ch)
                } else if ch == "e" || ch == "E", !seenExp {
                    seenExp = true
                    s.append(ch)
                    if i + 1 < chars.count, chars[i + 1] == "-" || chars[i + 1] == "+" {
                        i += 1
                        s.append(chars[i])
                    }
                } else {
                    break
                }
                i += 1
            }
            if let n = Double(s) { return .number(n) }
            // Not a number and not a command: skip the character.
            if s.isEmpty { i += 1 }
            return read()
        }
    }
}
