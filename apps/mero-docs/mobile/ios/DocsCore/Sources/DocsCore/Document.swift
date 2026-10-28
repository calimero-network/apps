import Foundation

// The read path of the web editor, ported. The contract keeps a document as a
// flat list of blocks (kind, depth, string attrs) whose text is runs of equally
// formatted characters; `get_document` hands that list back already merged, so
// no CRDT runs on the phone. The web turns the same rows into BlockNote blocks
// (`lib/rich/blocknote.ts`: `toBlockNote`, `spansToInline`, `attrsToStyles`);
// this turns them into blocks a native view draws. (== Kotlin `Document.kt`.)

// MARK: - Wire

/// One row of `get_document`, decoded leniently (see ``DocsAPI/readDocument(_:)``).
public struct WireBlock: Decodable, Equatable, Sendable {
    public var id: String
    public var kind: String
    public var depth: Int
    public var attrs: [String: String]
    public var spans: [WireSpan]

    public init(id: String, kind: String, depth: Int = 0, attrs: [String: String] = [:], spans: [WireSpan] = []) {
        self.id = id
        self.kind = kind
        self.depth = depth
        self.attrs = attrs
        self.spans = spans
    }

    enum CodingKeys: String, CodingKey { case id, kind, depth, attrs, spans }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(String.self, forKey: .kind)
        depth = try c.decodeIfPresent(Int.self, forKey: .depth) ?? 0
        attrs = try c.decodeIfPresent(LenientStrings.self, forKey: .attrs)?.values ?? [:]
        spans = try c.decodeIfPresent([WireSpan].self, forKey: .spans) ?? []
    }
}

/// A run of text and its marks. `attributes` is absent on a plain run, and a
/// boolean mark arrives as JSON `true`; both read as strings here, as the web's
/// `canonicalAttrs` reads them.
public struct WireSpan: Decodable, Equatable, Sendable {
    public var text: String
    public var attributes: [String: String]

    public init(text: String, attributes: [String: String] = [:]) {
        self.text = text
        self.attributes = attributes
    }

    enum CodingKeys: String, CodingKey { case text, attributes }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        attributes = try c.decodeIfPresent(LenientStrings.self, forKey: .attributes)?.values ?? [:]
    }
}

/// A JSON object whose values are strings, booleans or numbers, as strings.
/// `false`, `null` and `""` mean the key is not set, and are left out.
struct LenientStrings: Decodable {
    var values: [String: String] = [:]

    struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        for key in c.allKeys {
            if let s = try? c.decode(String.self, forKey: key) {
                if !s.isEmpty { values[key.stringValue] = s }
            } else if let b = try? c.decode(Bool.self, forKey: key) {
                if b { values[key.stringValue] = "true" }
            } else if let n = try? c.decode(Double.self, forKey: key) {
                values[key.stringValue] = n.rounded() == n ? String(Int64(n)) : String(n)
            }
        }
    }
}

// MARK: - Model

/// A run of text drawn with one set of marks.
public struct InlineRun: Equatable, Sendable {
    public var text: String
    public var bold = false
    public var italic = false
    public var underline = false
    public var strike = false
    public var code = false
    /// The href of the link the run sits in.
    public var link: String?
    /// A BlockNote colour name (`red`, `blue`, …).
    public var textColor: String?
    public var backgroundColor: String?

    public init(
        text: String, bold: Bool = false, italic: Bool = false, underline: Bool = false, strike: Bool = false,
        code: Bool = false, link: String? = nil, textColor: String? = nil, backgroundColor: String? = nil
    ) {
        self.text = text
        self.bold = bold
        self.italic = italic
        self.underline = underline
        self.strike = strike
        self.code = code
        self.link = link
        self.textColor = textColor
        self.backgroundColor = backgroundColor
    }

    /// The run a span is, by the web's mark keys (`lib/rich/attributes.ts`).
    public init(_ span: WireSpan) {
        let a = span.attributes
        let on: (String) -> Bool = { a[$0].map { $0 != "false" } ?? false }
        let color: (String) -> String? = { a[$0].flatMap { $0 == "default" ? nil : $0 } }
        self.init(
            text: span.text, bold: on("bold"), italic: on("italic"), underline: on("underline"), strike: on("strike"),
            code: on("code"), link: a["link"], textColor: color("textColor"), backgroundColor: color("backgroundColor"))
    }

    func sameMarks(_ o: InlineRun) -> Bool {
        bold == o.bold && italic == o.italic && underline == o.underline && strike == o.strike && code == o.code
            && link == o.link && textColor == o.textColor && backgroundColor == o.backgroundColor
    }
}

/// What a block is, with what drawing it needs.
public enum BlockKind: Equatable, Sendable {
    case paragraph
    /// Level 1 to 3.
    case heading(level: Int)
    case bullet
    /// Its number in its list.
    case numbered(index: Int)
    case check(checked: Bool)
    case quote
    case code(language: String?)
    /// `blobId` is nil when the url names no blob (the web shows it as broken).
    case image(blobId: String?, caption: String, name: String, width: Double?)
    case divider
    /// A kind this version does not draw; the web shows the same notice.
    case unsupported(kind: String)
}

/// Text alignment, BlockNote's `textAlignment` prop.
public enum BlockAlignment: String, Equatable, Sendable {
    case left, center, right, justify
}

/// One block as the app draws it.
public struct DocBlock: Identifiable, Equatable, Sendable {
    /// The contract's block id: what a comment and a block link name.
    public let id: String
    public let kind: BlockKind
    /// Nesting depth, 0 for top level.
    public let depth: Int
    public let runs: [InlineRun]
    public let alignment: BlockAlignment
    /// BlockNote colour names applied to the whole block.
    public let textColor: String?
    public let backgroundColor: String?

    public init(
        id: String, kind: BlockKind, depth: Int = 0, runs: [InlineRun] = [], alignment: BlockAlignment = .left,
        textColor: String? = nil, backgroundColor: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.depth = depth
        self.runs = runs
        self.alignment = alignment
        self.textColor = textColor
        self.backgroundColor = backgroundColor
    }

    /// The block's words, without marks.
    public var plainText: String {
        if case .image(_, let caption, let name, _) = kind { return caption.isEmpty ? name : caption }
        return runs.map(\.text).joined()
    }

    /// Whether the block holds no words (an empty paragraph is a blank line).
    public var isBlank: Bool { plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

public enum DocumentReader {
    /// An image block's url names a blob, never an address (`lib/images.ts`).
    public static func blobId(fromURL url: String) -> String? {
        let prefix = "blob:"
        guard url.hasPrefix(prefix) else { return nil }
        let hex = url.dropFirst(prefix.count)
        guard hex.count == 64, hex.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else { return nil }
        return String(hex)
    }

    /// The rows as drawable blocks, numbering ordered lists the way BlockNote
    /// does: a run of numbered items at one depth counts up, and anything else
    /// at that depth or shallower starts the count again.
    public static func blocks(_ rows: [WireBlock]) -> [DocBlock] {
        var counters: [Int: Int] = [:]
        return rows.map { row in
            let depth = max(0, row.depth)
            counters = counters.filter { $0.key <= depth }
            let kind: BlockKind
            switch row.kind {
            case "numberedListItem":
                let start = row.attrs["start"].flatMap(Int.init) ?? 1
                let next = counters[depth].map { $0 + 1 } ?? start
                counters[depth] = next
                kind = .numbered(index: next)
            default:
                counters[depth] = nil
                kind = Self.kind(row)
            }
            let attrs = row.attrs
            let color: (String) -> String? = { attrs[$0].flatMap { $0 == "default" ? nil : $0 } }
            return DocBlock(
                id: row.id, kind: kind, depth: depth, runs: runs(row.spans),
                alignment: BlockAlignment(rawValue: attrs["textAlignment"] ?? "") ?? .left,
                textColor: color("textColor"), backgroundColor: color("backgroundColor"))
        }
    }

    static func kind(_ row: WireBlock) -> BlockKind {
        let a = row.attrs
        switch row.kind {
        case "paragraph": return .paragraph
        case "heading":
            let level = a["level"].flatMap(Int.init) ?? 1
            return .heading(level: min(3, max(1, level)))
        case "bulletListItem", "toggleListItem": return .bullet
        case "checkListItem": return .check(checked: a["checked"] == "true")
        case "quote": return .quote
        case "codeBlock":
            let lang = a["language"].flatMap { $0 == "text" || $0.isEmpty ? nil : $0 }
            return .code(language: lang)
        case "image":
            return .image(
                blobId: blobId(fromURL: a["url"] ?? ""), caption: a["caption"] ?? "", name: a["name"] ?? "",
                width: a["previewWidth"].flatMap(Double.init))
        case "divider": return .divider
        default: return .unsupported(kind: row.kind)
        }
    }

    /// Spans as runs, neighbours with the same marks joined, empty ones dropped.
    public static func runs(_ spans: [WireSpan]) -> [InlineRun] {
        var out: [InlineRun] = []
        for span in spans where !span.text.isEmpty {
            let run = InlineRun(span)
            if let last = out.last, last.sameMarks(run) {
                out[out.count - 1].text += run.text
            } else {
                out.append(run)
            }
        }
        return out
    }

    /// The whole document's words, one block per line: for counts and search.
    public static func plainText(_ blocks: [DocBlock]) -> String {
        blocks.map(\.plainText).filter { !$0.isEmpty }.joined(separator: "\n")
    }

    /// Words in the document, as the web's status bar counts them.
    public static func wordCount(_ blocks: [DocBlock]) -> Int {
        plainText(blocks).split(whereSeparator: { $0.isWhitespace }).count
    }
}

/// BlockNote's default colours, by name: what `textColor` and
/// `backgroundColor` marks hold. (== Kotlin `BlockNoteColors`.)
public enum BlockNoteColors {
    public static let text: [String: UInt32] = [
        "gray": 0x9B9A97, "brown": 0x64473A, "red": 0xE03E3E, "orange": 0xD9730D, "yellow": 0xDFAB01,
        "green": 0x4D6461, "blue": 0x0B6E99, "purple": 0x6940A5, "pink": 0xAD1A72,
    ]
    public static let background: [String: UInt32] = [
        "gray": 0xEBECED, "brown": 0xE9E5E3, "red": 0xFBE4E4, "orange": 0xF6E9D9, "yellow": 0xFBF3DB,
        "green": 0xDDEDEA, "blue": 0xDDEBF1, "purple": 0xEAE4F2, "pink": 0xF4DFEB,
    ]
}
