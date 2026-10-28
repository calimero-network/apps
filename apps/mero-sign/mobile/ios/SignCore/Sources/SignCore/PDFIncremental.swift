import CoreGraphics
import Foundation
import ImageIO

/// Draws a signature into a PDF the way the web's `pdf-lib` `page.drawImage`
/// does — an image XObject added to the page's resources and painted by a new
/// content stream (`q w 0 0 h x y cm /Name Do Q`), the page's existing content
/// wrapped in `q … Q` first — but written as an INCREMENTAL UPDATE: the
/// original file's bytes are kept verbatim and the changed page plus the new
/// objects are appended after them with a new cross-reference section. Every
/// other object (form fields, links, annotations, fonts, metadata) is untouched.
///
/// Reads classic cross-reference tables, cross-reference streams (with PNG
/// predictors) and object streams. Encrypted files are refused
/// (``PDFIncrementalError/unsupported(_:)``).
enum PDFIncremental {
    // MARK: Values

    /// A parsed PDF object. Scalars keep their source bytes, so what is not
    /// changed is written back exactly as it was.
    indirect enum Value {
        case atom([UInt8])  // number, true, false, null
        case name(String)  // as written, without the slash
        case string([UInt8])  // as written, with its delimiters
        case array([Value])
        case dict([(String, Value)])
        case ref(Int, Int)
        case stream([(String, Value)], [UInt8])

        subscript(key: String) -> Value? {
            switch self {
            case .dict(let pairs), .stream(let pairs, _): return pairs.last { $0.0 == key }?.1
            default: return nil
            }
        }

        var int: Int? {
            if case .atom(let raw) = self { return Int(String(decoding: raw, as: UTF8.self)) }
            return nil
        }

        var double: Double? {
            if case .atom(let raw) = self { return Double(String(decoding: raw, as: UTF8.self)) }
            return nil
        }

        var nameValue: String? {
            if case .name(let n) = self { return n }
            return nil
        }

        var pairs: [(String, Value)]? {
            switch self {
            case .dict(let p), .stream(let p, _): return p
            default: return nil
            }
        }
    }

    // MARK: Lexing and parsing

    struct Parser {
        let b: [UInt8]
        var i: Int

        static func isWhite(_ c: UInt8) -> Bool { c == 0 || c == 9 || c == 10 || c == 12 || c == 13 || c == 32 }
        static func isDelim(_ c: UInt8) -> Bool { "()<>[]{}/%".utf8.contains(c) }

        mutating func skip() {
            while i < b.count {
                if Self.isWhite(b[i]) {
                    i += 1
                } else if b[i] == UInt8(ascii: "%") {
                    while i < b.count, b[i] != 10, b[i] != 13 { i += 1 }
                } else {
                    break
                }
            }
        }

        mutating func regular() -> [UInt8] {
            let start = i
            while i < b.count, !Self.isWhite(b[i]), !Self.isDelim(b[i]) { i += 1 }
            return Array(b[start..<i])
        }

        func peekKeyword(_ word: String) -> Bool {
            let w = Array(word.utf8)
            guard i + w.count <= b.count, Array(b[i..<(i + w.count)]) == w else { return false }
            return i + w.count == b.count || Self.isWhite(b[i + w.count]) || Self.isDelim(b[i + w.count])
        }

        mutating func value(resolveLength: (Value) -> Int?) throws -> Value {
            skip()
            guard i < b.count else { throw PDFIncrementalError.malformed("unexpected end") }
            let c = b[i]
            switch c {
            case UInt8(ascii: "/"):
                i += 1
                return .name(String(decoding: regular(), as: UTF8.self))
            case UInt8(ascii: "("):
                let start = i
                var depth = 0
                while i < b.count {
                    let ch = b[i]
                    if ch == UInt8(ascii: "\\") {
                        i += 2
                        continue
                    }
                    if ch == UInt8(ascii: "(") { depth += 1 }
                    if ch == UInt8(ascii: ")") {
                        depth -= 1
                        if depth == 0 {
                            i += 1
                            break
                        }
                    }
                    i += 1
                }
                return .string(Array(b[start..<i]))
            case UInt8(ascii: "<"):
                if i + 1 < b.count, b[i + 1] == UInt8(ascii: "<") {
                    i += 2
                    var pairs: [(String, Value)] = []
                    while true {
                        skip()
                        guard i < b.count else { throw PDFIncrementalError.malformed("open dictionary") }
                        if b[i] == UInt8(ascii: ">") {
                            i += 2
                            break
                        }
                        guard case .name(let key) = try value(resolveLength: resolveLength) else {
                            throw PDFIncrementalError.malformed("dictionary key")
                        }
                        pairs.append((key, try value(resolveLength: resolveLength)))
                    }
                    var probe = self
                    probe.skip()
                    if probe.peekKeyword("stream") {
                        i = probe.i + 6
                        if i < b.count, b[i] == 13 { i += 1 }
                        if i < b.count, b[i] == 10 { i += 1 }
                        let length = pairs.last { $0.0 == "Length" }.flatMap { resolveLength($0.1) } ?? 0
                        guard length >= 0, i + length <= b.count else { throw PDFIncrementalError.malformed("stream length") }
                        let data = Array(b[i..<(i + length)])
                        i += length
                        skip()
                        if peekKeyword("endstream") { i += 9 }
                        return .stream(pairs, data)
                    }
                    return .dict(pairs)
                }
                let start = i
                while i < b.count, b[i] != UInt8(ascii: ">") { i += 1 }
                i += 1
                return .string(Array(b[start..<i]))
            case UInt8(ascii: "["):
                i += 1
                var items: [Value] = []
                while true {
                    skip()
                    guard i < b.count else { throw PDFIncrementalError.malformed("open array") }
                    if b[i] == UInt8(ascii: "]") {
                        i += 1
                        break
                    }
                    items.append(try value(resolveLength: resolveLength))
                }
                return .array(items)
            default:
                let token = regular()
                guard !token.isEmpty else { throw PDFIncrementalError.malformed("unexpected byte \(c)") }
                // `n g R`: an indirect reference.
                if let first = Int(String(decoding: token, as: UTF8.self)), first >= 0 {
                    var probe = self
                    probe.skip()
                    let second = probe.regular()
                    if let gen = Int(String(decoding: second, as: UTF8.self)) {
                        probe.skip()
                        if probe.i < b.count, b[probe.i] == UInt8(ascii: "R"), probe.peekKeyword("R") {
                            i = probe.i + 1
                            return .ref(first, gen)
                        }
                    }
                }
                return .atom(token)
            }
        }
    }

    // MARK: The document

    enum Location {
        case offset(Int)
        case compressed(stream: Int, index: Int)
    }

    final class Document {
        let bytes: [UInt8]
        var xref: [Int: (Location, Int)] = [:]  // object → (where, generation)
        var trailer: [(String, Value)] = []
        let startxref: Int
        private(set) var usesXrefStream = false
        private var cache: [Int: Value] = [:]
        private var objectStreams: [Int: [Int: Value]] = [:]

        init(_ data: Data) throws {
            bytes = [UInt8](data)
            guard let start = Self.lastStartxref(bytes) else { throw PDFIncrementalError.malformed("no startxref") }
            startxref = start
            var next: Int? = start
            var first = true
            var stream = false
            var seen = Set<Int>()
            while let offset = next, !seen.contains(offset) {
                seen.insert(offset)
                let (section, isStream) = try readSection(at: offset)
                if first {
                    trailer = section
                    stream = isStream
                    first = false
                }
                if let hybrid = section.last(where: { $0.0 == "XRefStm" })?.1.int {
                    _ = try readSection(at: hybrid)
                }
                next = section.last { $0.0 == "Prev" }?.1.int
            }
            usesXrefStream = stream
            if trailer.contains(where: { $0.0 == "Encrypt" }) {
                throw PDFIncrementalError.unsupported("encrypted")
            }
        }

        static func lastStartxref(_ b: [UInt8]) -> Int? {
            let key = Array("startxref".utf8)
            var i = b.count - key.count
            while i >= max(0, b.count - 2048) {
                if Array(b[i..<(i + key.count)]) == key {
                    var p = Parser(b: b, i: i + key.count)
                    p.skip()
                    return Int(String(decoding: p.regular(), as: UTF8.self))
                }
                i -= 1
            }
            return nil
        }

        private func add(_ number: Int, _ location: Location, _ gen: Int) {
            if xref[number] == nil { xref[number] = (location, gen) }
        }

        /// One cross-reference section; returns its trailer dictionary.
        private func readSection(at offset: Int) throws -> ([(String, Value)], Bool) {
            var p = Parser(b: bytes, i: offset)
            p.skip()
            if p.peekKeyword("xref") {
                p.i += 4
                while true {
                    p.skip()
                    if p.peekKeyword("trailer") {
                        p.i += 7
                        guard case .dict(let pairs) = try p.value(resolveLength: { _ in nil }) else {
                            throw PDFIncrementalError.malformed("trailer")
                        }
                        return (pairs, false)
                    }
                    guard let start = Int(String(decoding: p.regular(), as: UTF8.self)) else {
                        throw PDFIncrementalError.malformed("xref subsection")
                    }
                    p.skip()
                    guard let count = Int(String(decoding: p.regular(), as: UTF8.self)) else {
                        throw PDFIncrementalError.malformed("xref count")
                    }
                    for k in 0..<count {
                        p.skip()
                        let off = Int(String(decoding: p.regular(), as: UTF8.self)) ?? 0
                        p.skip()
                        let gen = Int(String(decoding: p.regular(), as: UTF8.self)) ?? 0
                        p.skip()
                        let kind = p.regular()
                        if kind == Array("n".utf8) { add(start + k, .offset(off), gen) }
                    }
                }
            }
            // A cross-reference stream: `n g obj << /Type /XRef … >> stream`.
            guard case .stream(let dict, let raw) = try objectAt(offset) else {
                throw PDFIncrementalError.malformed("xref stream")
            }
            let data = try Self.decode(dict, raw, resolve: { self.resolveInt($0) })
            guard case .array(let wv)? = dict.last(where: { $0.0 == "W" })?.1 else { throw PDFIncrementalError.malformed("W") }
            let w = wv.compactMap(\.int)
            guard w.count == 3 else { throw PDFIncrementalError.malformed("W") }
            var index: [Int] = []
            if case .array(let iv)? = dict.last(where: { $0.0 == "Index" })?.1 { index = iv.compactMap(\.int) }
            if index.isEmpty { index = [0, dict.last { $0.0 == "Size" }?.1.int ?? 0] }
            let rowLength = w.reduce(0, +)
            var pos = 0
            func field(_ width: Int, default value: Int) -> Int {
                guard width > 0 else { return value }
                var v = 0
                for _ in 0..<width {
                    v = (v << 8) | Int(data[pos])
                    pos += 1
                }
                return v
            }
            var k = 0
            while k + 1 < index.count {
                for n in index[k]..<(index[k] + index[k + 1]) {
                    guard pos + rowLength <= data.count else { break }
                    let type = field(w[0], default: 1)
                    let a = field(w[1], default: 0)
                    let c = field(w[2], default: 0)
                    if type == 1 { add(n, .offset(a), c) }
                    if type == 2 { add(n, .compressed(stream: a, index: c), 0) }
                }
                k += 2
            }
            return (dict, true)
        }

        /// `n g obj <value> endobj` at a byte offset.
        func objectAt(_ offset: Int) throws -> Value {
            var p = Parser(b: bytes, i: offset)
            p.skip()
            _ = p.regular()
            p.skip()
            _ = p.regular()
            p.skip()
            guard p.peekKeyword("obj") else { throw PDFIncrementalError.malformed("obj at \(offset)") }
            p.i += 3
            return try p.value(resolveLength: { self.resolveInt($0) })
        }

        func resolveInt(_ v: Value) -> Int? {
            if case .ref = v { return (try? resolve(v))?.int }
            return v.int
        }

        func object(_ number: Int) throws -> Value {
            if let hit = cache[number] { return hit }
            guard let (location, _) = xref[number] else { return .atom(Array("null".utf8)) }
            let value: Value
            switch location {
            case .offset(let off):
                value = try objectAt(off)
            case .compressed(let streamNumber, let index):
                if objectStreams[streamNumber] == nil { try loadObjectStream(streamNumber) }
                value = objectStreams[streamNumber]?[index] ?? .atom(Array("null".utf8))
            }
            cache[number] = value
            return value
        }

        private func loadObjectStream(_ number: Int) throws {
            guard case .stream(let dict, let raw) = try object(number) else { throw PDFIncrementalError.malformed("objstm") }
            let data = try Self.decode(dict, raw, resolve: { self.resolveInt($0) })
            let n = dict.last { $0.0 == "N" }?.1.int ?? 0
            let first = dict.last { $0.0 == "First" }?.1.int ?? 0
            var p = Parser(b: data, i: 0)
            var offsets: [Int] = []
            for _ in 0..<n {
                p.skip()
                _ = p.regular()
                p.skip()
                offsets.append(Int(String(decoding: p.regular(), as: UTF8.self)) ?? 0)
            }
            var out: [Int: Value] = [:]
            for (k, off) in offsets.enumerated() {
                var q = Parser(b: data, i: first + off)
                out[k] = try q.value(resolveLength: { _ in nil })
            }
            objectStreams[number] = out
        }

        func resolve(_ v: Value) throws -> Value {
            if case .ref(let n, _) = v { return try object(n) }
            return v
        }

        /// A stream's bytes through `/FlateDecode` (and a PNG predictor).
        static func decode(_ dict: [(String, Value)], _ raw: [UInt8], resolve: (Value) -> Int?) throws -> [UInt8] {
            let filter = dict.last { $0.0 == "Filter" }?.1
            var filters: [String] = []
            if case .name(let n)? = filter { filters = [n] }
            if case .array(let a)? = filter { filters = a.compactMap(\.nameValue) }
            var data = raw
            for f in filters {
                guard f == "FlateDecode" else { throw PDFIncrementalError.unsupported("filter \(f)") }
                data = try Flate.inflate(data)
            }
            var parms = dict.last { $0.0 == "DecodeParms" }?.1
            if case .array(let a)? = parms { parms = a.first }
            if let predictor = parms?["Predictor"]?.int, predictor >= 10 {
                let columns = parms?["Columns"]?.int ?? 1
                data = try Flate.unpredictPNG(data, columns: columns)
            }
            return data
        }
    }

    // MARK: Writing

    static func write(_ v: Value, into out: inout [UInt8]) {
        switch v {
        case .atom(let raw): out += raw
        case .name(let n): out += Array("/\(n)".utf8)
        case .string(let raw): out += raw
        case .ref(let n, let g): out += Array("\(n) \(g) R".utf8)
        case .array(let items):
            out += Array("[".utf8)
            for (k, item) in items.enumerated() {
                if k > 0 { out.append(32) }
                write(item, into: &out)
            }
            out += Array("]".utf8)
        case .dict(let pairs):
            out += Array("<<".utf8)
            for (key, value) in pairs {
                out += Array("/\(key) ".utf8)
                write(value, into: &out)
                out.append(32)
            }
            out += Array(">>".utf8)
        case .stream(let pairs, let data):
            var withLength = pairs.filter { $0.0 != "Length" }
            withLength.append(("Length", .atom(Array("\(data.count)".utf8))))
            write(.dict(withLength), into: &out)
            out += Array("\nstream\n".utf8)
            out += data
            out += Array("\nendstream".utf8)
        }
    }

    static func number(_ x: CGFloat) -> Value {
        var text = String(format: "%.4f", Double(x))
        while text.contains("."), text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        if text == "-0" { text = "0" }
        return .atom(Array(text.utf8))
    }

    /// The page at `index` (0-based): its object number and generation, its
    /// dictionary, and what it inherits (Resources, MediaBox, CropBox, Rotate).
    struct PageInfo {
        let number: Int
        let generation: Int
        let dict: [(String, Value)]
        let inherited: [String: Value]
    }

    static func page(_ doc: Document, index: Int) throws -> PageInfo {
        guard let root = try doc.trailer.last(where: { $0.0 == "Root" }).map({ try doc.resolve($0.1) }),
            let pagesRef = root["Pages"]
        else { throw PDFIncrementalError.malformed("no page tree") }
        var remaining = index
        var visited = Set<Int>()
        func walk(_ ref: Value, inherited: [String: Value]) throws -> PageInfo? {
            guard case .ref(let n, let g) = ref, !visited.contains(n) else { return nil }
            visited.insert(n)
            let node = try doc.object(n)
            guard let pairs = node.pairs else { return nil }
            var carried = inherited
            for key in ["Resources", "MediaBox", "CropBox", "Rotate"] {
                if let v = node[key] { carried[key] = v }
            }
            if node["Type"]?.nameValue == "Pages" || node["Kids"] != nil, node["Type"]?.nameValue != "Page" {
                let count = (try? doc.resolve(node["Count"] ?? .atom([])))?.int
                if let count, count <= remaining {
                    remaining -= count
                    return nil
                }
                guard case .array(let kids)? = try node["Kids"].map({ try doc.resolve($0) }) else { return nil }
                for kid in kids {
                    if let found = try walk(kid, inherited: carried) { return found }
                }
                return nil
            }
            if remaining == 0 { return PageInfo(number: n, generation: g, dict: pairs, inherited: carried) }
            remaining -= 1
            return nil
        }
        guard let found = try walk(pagesRef, inherited: [:]) else { throw PDFIncrementalError.unsupported("page \(index)") }
        return found
    }

    static func box(_ doc: Document, _ v: Value?) -> CGRect? {
        guard let v, case .array(let items) = (try? doc.resolve(v)) ?? v else { return nil }
        let n = items.compactMap { ((try? doc.resolve($0)) ?? $0).double }
        guard n.count == 4 else { return nil }
        return CGRect(x: min(n[0], n[2]), y: min(n[1], n[3]), width: abs(n[2] - n[0]), height: abs(n[3] - n[1]))
    }

    /// The signed file: the original bytes, then the update.
    static func stamp(pdf: Data, image: CGImage, placement: SignaturePlacement) throws -> Data {
        let doc = try Document(pdf)
        let page = try page(doc, index: placement.pageIndex)
        let media = box(doc, page.inherited["MediaBox"]) ?? CGRect(x: 0, y: 0, width: 612, height: 792)
        let crop = (box(doc, page.inherited["CropBox"]) ?? media).intersection(media)
        let rotation = (try? doc.resolve(page.inherited["Rotate"] ?? .atom([])))?.int ?? 0
        guard var size = doc.trailer.last(where: { $0.0 == "Size" })?.1.int else { throw PDFIncrementalError.malformed("Size") }

        func next() -> Int {
            defer { size += 1 }
            return size
        }
        let imageNumber = next()
        let openNumber = next()
        let drawNumber = next()

        // Resources: the effective dictionary (pdf-lib's `normalize()` copies
        // inherited ones onto the page too), plus the image under a free name.
        var resources = (try doc.resolve(page.inherited["Resources"] ?? .dict([]))).pairs ?? []
        var xobjects = (try resources.last { $0.0 == "XObject" }.map { try doc.resolve($0.1) })?.pairs ?? []
        var name = "MeroSignature1"
        var k = 1
        while xobjects.contains(where: { $0.0 == name }) {
            k += 1
            name = "MeroSignature\(k)"
        }
        xobjects.append((name, .ref(imageNumber, 0)))
        resources.removeAll { $0.0 == "XObject" }
        resources.append(("XObject", .dict(xobjects)))

        // Contents: [q, …existing…, Q-and-draw], as pdf-lib wraps them.
        var contents: [Value] = [.ref(openNumber, 0)]
        switch page.dict.last(where: { $0.0 == "Contents" })?.1 {
        case .array(let items)?: contents += items
        case .ref(let n, let g)?:
            if case .array(let items) = try doc.object(n) { contents += items } else { contents.append(.ref(n, g)) }
        default: break
        }
        contents.append(.ref(drawNumber, 0))

        var pageDict = page.dict.filter { $0.0 != "Contents" && $0.0 != "Resources" }
        pageDict.append(("Resources", .dict(resources)))
        pageDict.append(("Contents", .array(contents)))

        let m = SignaturePlacement.imageMatrix(
            placement.rect, cropBox: crop, rotation: rotation)
        var draw: [UInt8] = Array("\nQ\nq\n".utf8)
        for value in m {
            write(number(value), into: &draw)
            draw.append(32)
        }
        draw += Array("cm\n/\(name) Do\nQ\n".utf8)

        // The new objects, appended.
        var out = doc.bytes
        if out.last != 10 { out.append(10) }
        var offsets: [(Int, Int, Int)] = []  // number, generation, offset
        func emit(_ n: Int, _ g: Int, _ v: Value) {
            offsets.append((n, g, out.count))
            out += Array("\(n) \(g) obj\n".utf8)
            write(v, into: &out)
            out += Array("\nendobj\n".utf8)
        }
        emit(imageNumber, 0, try imageXObject(image))
        emit(openNumber, 0, .stream([], Array("q\n".utf8)))
        emit(drawNumber, 0, .stream([("Filter", .name("FlateDecode"))], try Flate.deflate(draw)))
        emit(page.number, page.generation, .dict(pageDict))

        var trailer = doc.trailer.filter { ["Root", "Info", "ID"].contains($0.0) }
        trailer.append(("Prev", .atom(Array("\(doc.startxref)".utf8))))
        let xrefOffset: Int
        if doc.usesXrefStream {
            let streamNumber = next()
            xrefOffset = out.count
            offsets.append((streamNumber, 0, xrefOffset))
            offsets.sort { $0.0 < $1.0 }
            var rows: [UInt8] = []
            var index: [Value] = []
            for o in offsets {
                index += [.atom(Array("\(o.0) 1".utf8))]
                rows.append(1)
                for shift in stride(from: 56, through: 0, by: -8) { rows.append(UInt8((o.2 >> shift) & 0xFF)) }
                rows += [UInt8((o.1 >> 8) & 0xFF), UInt8(o.1 & 0xFF)]
            }
            var dict = trailer
            dict += [
                ("Type", .name("XRef")), ("Size", .atom(Array("\(size)".utf8))),
                ("W", .array([.atom(Array("1".utf8)), .atom(Array("8".utf8)), .atom(Array("2".utf8))])),
                ("Index", .array(index)),
            ]
            out += Array("\(streamNumber) 0 obj\n".utf8)
            write(.stream(dict, rows), into: &out)
            out += Array("\nendobj\n".utf8)
        } else {
            offsets.sort { $0.0 < $1.0 }
            xrefOffset = out.count
            out += Array("xref\n".utf8)
            for o in offsets {
                out += Array("\(o.0) 1\n".utf8)
                out += Array(String(format: "%010d %05d n\r\n", o.2, o.1).utf8)
            }
            var dict = trailer
            dict.append(("Size", .atom(Array("\(size)".utf8))))
            out += Array("trailer\n".utf8)
            write(.dict(dict), into: &out)
            out.append(10)
        }
        out += Array("startxref\n\(xrefOffset)\n%%EOF\n".utf8)
        return Data(out)
    }

    /// The PNG as an RGB image XObject (Flate), composited on white as the
    /// web's opaque signature PNGs already are.
    static func imageXObject(_ image: CGImage) throws -> Value {
        let w = image.width
        let h = image.height
        guard
            let ctx = CGContext(
                data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw PDFStampError.unreadableImage }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let base = ctx.data else { throw PDFStampError.unreadableImage }
        let rgba = base.bindMemory(to: UInt8.self, capacity: w * h * 4)
        var rgb = [UInt8](repeating: 0, count: w * h * 3)
        for p in 0..<(w * h) {
            rgb[p * 3] = rgba[p * 4]
            rgb[p * 3 + 1] = rgba[p * 4 + 1]
            rgb[p * 3 + 2] = rgba[p * 4 + 2]
        }
        return .stream(
            [
                ("Type", .name("XObject")), ("Subtype", .name("Image")),
                ("Width", .atom(Array("\(w)".utf8))), ("Height", .atom(Array("\(h)".utf8))),
                ("ColorSpace", .name("DeviceRGB")), ("BitsPerComponent", .atom(Array("8".utf8))),
                ("Filter", .name("FlateDecode")),
            ], try Flate.deflate(rgb))
    }
}

enum PDFIncrementalError: Error, Equatable {
    case malformed(String)
    case unsupported(String)
}

/// zlib (`/FlateDecode`) through Foundation's raw-deflate codec.
enum Flate {
    static func inflate(_ data: [UInt8]) throws -> [UInt8] {
        guard data.count > 2 else { return [] }
        // A zlib stream: 2-byte header, raw deflate, Adler-32. Foundation wants the raw part.
        let body = (data[0] & 0x0F) == 8 ? Data(data.dropFirst(2)) : Data(data)
        do {
            return [UInt8](try (body as NSData).decompressed(using: .zlib) as Data)
        } catch {
            throw PDFIncrementalError.malformed("flate")
        }
    }

    static func deflate(_ data: [UInt8]) throws -> [UInt8] {
        let raw = [UInt8](try (Data(data) as NSData).compressed(using: .zlib) as Data)
        var a: UInt32 = 1
        var b: UInt32 = 0
        for byte in data {
            a = (a + UInt32(byte)) % 65521
            b = (b + a) % 65521
        }
        let adler = (b << 16) | a
        return [0x78, 0x9C] + raw + [UInt8(adler >> 24), UInt8((adler >> 16) & 0xFF), UInt8((adler >> 8) & 0xFF), UInt8(adler & 0xFF)]
    }

    /// Undo the PNG row filters (`/Predictor` 10–15) a cross-reference stream uses.
    static func unpredictPNG(_ data: [UInt8], columns: Int) throws -> [UInt8] {
        let row = columns + 1
        guard row > 1, data.count % row == 0 else { throw PDFIncrementalError.malformed("predictor") }
        var out: [UInt8] = []
        var previous = [UInt8](repeating: 0, count: columns)
        for r in 0..<(data.count / row) {
            let filter = data[r * row]
            var line = Array(data[(r * row + 1)..<((r + 1) * row)])
            for x in 0..<columns {
                let left: Int = x > 0 ? Int(line[x - 1]) : 0
                let up = Int(previous[x])
                let upLeft: Int = x > 0 ? Int(previous[x - 1]) : 0
                let add: Int
                switch filter {
                case 1: add = left
                case 2: add = up
                case 3: add = (left + up) / 2
                case 4:
                    let p = left + up - upLeft
                    let pa = abs(p - left)
                    let pb = abs(p - up)
                    let pc = abs(p - upLeft)
                    add = pa <= pb && pa <= pc ? left : (pb <= pc ? up : upLeft)
                default: add = 0
                }
                line[x] = UInt8((Int(line[x]) + add) & 0xFF)
            }
            out += line
            previous = line
        }
        return out
    }
}

extension SignaturePlacement {
    /// The `cm` matrix `[a b c d e f]` that paints an image's unit square into
    /// `rect` (shown space: top-left origin, `/Rotate` applied) on a page with
    /// this crop box and rotation, upright as placed. Android's
    /// `SignaturePlacement.imageMatrix` is the same function.
    public static func imageMatrix(_ rect: CGRect, cropBox crop: CGRect, rotation: Int) -> [CGFloat] {
        let r = ((rotation % 360) + 360) % 360
        let (llx, lly, w, h) = (crop.minX, crop.minY, crop.width, crop.height)
        let a: [CGFloat]
        let t: (CGFloat, CGFloat)
        switch r {
        case 90: (a, t) = ([0, 1, 1, 0], (llx, lly))
        case 180: (a, t) = ([-1, 0, 0, 1], (llx + w, lly))
        case 270: (a, t) = ([0, -1, -1, 0], (llx + w, lly + h))
        default: (a, t) = ([1, 0, 0, -1], (llx, lly + h))
        }
        func apply(_ x: CGFloat, _ y: CGFloat) -> (CGFloat, CGFloat) { (a[0] * x + a[1] * y, a[2] * x + a[3] * y) }
        let (sx, sy) = apply(rect.width, 0)
        let (tx, ty) = apply(0, -rect.height)
        let (ox, oy) = apply(rect.minX, rect.minY + rect.height)
        return [sx, sy, tx, ty, ox + t.0, oy + t.1]
    }
}
