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
//   Like the web adapter, the screens show them in nanoseconds
//   (`DocsFormat.nanos(millis:)`).
// - A read is a view (`query`), a write a call (`execute`).
//
// The `Encodable` side writes the same wire shape, so the in-app demo answers
// exactly what a node would.

// MARK: - Shapes

// The shapes the ABI describes are the generated client's (`Generated/DocsClient.swift`). Their
// timestamps are the wire's milliseconds; the screens, written for nanoseconds like the web
// adapter's, convert where they show one (`DocsFormat.nanos(millis:)`).

/// A run of consecutive character ids (`replica` is always `"0"` on 1.0).
public typealias Run = DocsClient.Run
/// A document's header (`DocView`). Timestamps in milliseconds.
public typealias DocDto = DocsClient.DocView
/// A comment (`CommentView`). `createdAt` in milliseconds.
public typealias CommentDto = DocsClient.CommentView
/// One document `searchDocs` found; `snippet` has the matched words in `<b>`.
public typealias DocSearchHit = DocsClient.DocSearchHit
/// A page of `searchDocs`.
public typealias DocSearchPage = DocsClient.DocSearchPage


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
/// this is the shape the demo writes. (The ABI leaves a span's `attributes` `unknown`, so
/// `Span` and `Block` stay here.)
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

// MARK: - Client

extension DocsClient {
    /// Every method the app calls: the ABI test checks each against `abi.json`.
    public static let methods = ["listDocs", "getDoc", "searchDocs", "getDocument", "listComments", "addComment"]
}
