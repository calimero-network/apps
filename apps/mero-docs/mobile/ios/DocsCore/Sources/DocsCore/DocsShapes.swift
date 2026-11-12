import Foundation
import MeroKit

// The shapes of the contract's answers the phone reads: the read and comment half of
// the web's adapter (`app/src/lib/docsApi.ts`), over the component ABI in
// `../logic/res/abi.json`. The calls are `DocsClient`, generated from the ABI into
// `Generated/` (`scripts/mobile-codegen.sh` at the repo root). (== Kotlin `DocsShapes.kt`.)
//
// - Method and argument names are camelCase (`listDocs { includeArchived }`),
//   results' fields too.
// - 64-bit integers arrive as decimal strings, timestamps in milliseconds.
//   Like the web adapter, this converts them back to the nanoseconds the
//   screens were written for (`createdAt`, `updatedAt`), and `total` to a number.
// - A read is a view (`query`), a write a call (`execute`).
//
// The `Encodable` side writes the same wire shape, so the in-app demo answers
// exactly what a node would.

// MARK: - Shapes

/// A run of consecutive character ids (`replica` is always `"0"` on 1.0).
public struct Run: Codable, Sendable, Equatable {
    public var replica: String
    public var counter: UInt32
    public var len: UInt32

    public init(replica: String, counter: UInt32, len: UInt32) {
        self.replica = replica
        self.counter = counter
        self.len = len
    }
}

/// A run of text and its marks, as `getDocument` writes it.
public struct Span: Codable, Sendable, Equatable {
    public var text: String
    public var attributes: [String: String]

    public init(text: String, attributes: [String: String]) {
        self.text = text
        self.attributes = attributes
    }
}

/// One block of `getDocument`. The phone reads it leniently as ``WireBlock``;
/// this is the shape the demo writes.
public struct Block: Codable, Sendable, Equatable {
    public var id: String
    public var kind: String
    public var depth: UInt32
    public var attrs: [String: String]
    public var spans: [Span]
    public var ids: [Run]

    public init(id: String, kind: String, depth: UInt32, attrs: [String: String], spans: [Span], ids: [Run]) {
        self.id = id
        self.kind = kind
        self.depth = depth
        self.attrs = attrs
        self.spans = spans
        self.ids = ids
    }
}

/// A document's header (`DocView`). Timestamps in nanoseconds, as the web adapter hands them on.
public struct DocDto: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var tags: [String]
    public var archived: Bool
    public var createdAt: UInt64
    public var updatedAt: UInt64
    public var createdBy: String
    public var updatedBy: String
    public var canDelete: Bool

    public init(
        id: String, title: String, tags: [String], archived: Bool, createdAt: UInt64, updatedAt: UInt64,
        createdBy: String, updatedBy: String, canDelete: Bool
    ) {
        self.id = id
        self.title = title
        self.tags = tags
        self.archived = archived
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.createdBy = createdBy
        self.updatedBy = updatedBy
        self.canDelete = canDelete
    }

    enum CodingKeys: String, CodingKey {
        case id, title, tags, archived, createdAt, updatedAt, createdBy, updatedBy, canDelete
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        archived = try c.decodeIfPresent(Bool.self, forKey: .archived) ?? false
        createdAt = Wire.nanos(try c.decodeIfPresent(Wire.U64.self, forKey: .createdAt))
        updatedAt = Wire.nanos(try c.decodeIfPresent(Wire.U64.self, forKey: .updatedAt))
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy) ?? ""
        updatedBy = try c.decodeIfPresent(String.self, forKey: .updatedBy) ?? ""
        canDelete = try c.decodeIfPresent(Bool.self, forKey: .canDelete) ?? false
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(tags, forKey: .tags)
        try c.encode(archived, forKey: .archived)
        try c.encode(Wire.millis(createdAt), forKey: .createdAt)
        try c.encode(Wire.millis(updatedAt), forKey: .updatedAt)
        try c.encode(createdBy, forKey: .createdBy)
        try c.encode(updatedBy, forKey: .updatedBy)
        try c.encode(canDelete, forKey: .canDelete)
    }
}

/// A comment (`CommentView`). `createdAt` in nanoseconds.
public struct CommentDto: Codable, Sendable, Equatable {
    public var id: String
    public var author: String
    public var docId: String
    public var body: String
    public var createdAt: UInt64

    public init(id: String, author: String, docId: String, body: String, createdAt: UInt64) {
        self.id = id
        self.author = author
        self.docId = docId
        self.body = body
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey { case id, author, docId, body, createdAt }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        author = try c.decodeIfPresent(String.self, forKey: .author) ?? ""
        docId = try c.decodeIfPresent(String.self, forKey: .docId) ?? ""
        body = try c.decodeIfPresent(String.self, forKey: .body) ?? ""
        createdAt = Wire.nanos(try c.decodeIfPresent(Wire.U64.self, forKey: .createdAt))
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(author, forKey: .author)
        try c.encode(docId, forKey: .docId)
        try c.encode(body, forKey: .body)
        try c.encode(Wire.millis(createdAt), forKey: .createdAt)
    }
}

/// One document `searchDocs` found; `snippet` has the matched words in `<b>`.
public struct DocSearchHit: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var snippet: String
    public var score: Float
    public var archived: Bool

    public init(id: String, title: String, snippet: String, score: Float, archived: Bool) {
        self.id = id
        self.title = title
        self.snippet = snippet
        self.score = score
        self.archived = archived
    }
}

/// A page of `searchDocs`.
public struct DocSearchPage: Codable, Sendable, Equatable {
    public var hits: [DocSearchHit]
    public var total: UInt64
    public var nextCursor: UInt32?

    public init(hits: [DocSearchHit], total: UInt64, nextCursor: UInt32? = nil) {
        self.hits = hits
        self.total = total
        self.nextCursor = nextCursor
    }

    enum CodingKeys: String, CodingKey { case hits, total, nextCursor }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        hits = try c.decodeIfPresent([DocSearchHit].self, forKey: .hits) ?? []
        total = try c.decodeIfPresent(Wire.U64.self, forKey: .total)?.value ?? 0
        nextCursor = try c.decodeIfPresent(UInt32.self, forKey: .nextCursor)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(hits, forKey: .hits)
        try c.encode(String(total), forKey: .total)
        try c.encode(nextCursor, forKey: .nextCursor)
    }
}

/// The contract's `u64` encoding: a decimal string (a number is taken too).
enum Wire {
    struct U64: Decodable {
        let value: UInt64

        init(from decoder: any Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let s = try? c.decode(String.self) {
                value = UInt64(s) ?? 0
            } else {
                value = (try? c.decode(UInt64.self)) ?? 0
            }
        }
    }

    static let nanosPerMilli: UInt64 = 1_000_000

    /// Milliseconds on the wire as nanoseconds (`msToNs` in the web adapter).
    static func nanos(_ ms: U64?) -> UInt64 {
        let (out, overflow) = (ms?.value ?? 0).multipliedReportingOverflow(by: nanosPerMilli)
        return overflow ? 0 : out
    }

    /// Nanoseconds as the wire's milliseconds.
    static func millis(_ nanos: UInt64) -> String { String(nanos / nanosPerMilli) }
}

// MARK: - Client

extension DocsClient {
    /// Every method the app calls: the ABI test checks each against `abi.json`.
    public static let methods = ["listDocs", "getDoc", "searchDocs", "getDocument", "listComments", "addComment"]
}

extension JSONValue {
    /// This answer as the app type `T` (one of the shapes above). The ABI names them without their
    /// shape until the logic derives `AbiType`, so the generated `DocsClient` (`Generated/`) answers
    /// their JSON.
    func decoded<T: Decodable>(as type: T.Type) throws -> T {
        try MeroJSON.decode(type, from: MeroJSON.encode(self))
    }
}
