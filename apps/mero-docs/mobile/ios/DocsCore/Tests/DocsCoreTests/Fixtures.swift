import Foundation
import MeroKit
import MeroKitTestSupport

@testable import DocsCore

/// A scripted docs node behind `InMemoryAppBackend`: raw JSON per method, as
/// the relay returns it (booleans in span marks, nanosecond u64s). (== Kotlin `Fixtures.kt`.)
final class FakeDocs: @unchecked Sendable {
    let backend = InMemoryAppBackend()
    private let lock = NSLock()
    private var answers: [String: (RecordedContractCall) -> String] = [:]

    static let ws = String(repeating: "a1", count: 32)
    static let me = String(repeating: "ab", count: 32)
    static let other = String(repeating: "cd", count: 32)

    init() {
        backend.recording.setRawHandler { [weak self] call in
            guard let self else { return nil }
            self.lock.lock()
            let answer = self.answers["\(call.contextId)/\(call.method)"] ?? self.answers["*/\(call.method)"]
            self.lock.unlock()
            return Data((answer?(call) ?? "null").utf8)
        }
    }

    /// Answer `method` in `context` (or in every context, for `*`).
    func on(_ method: String, in context: String = "*", _ answer: @escaping (RecordedContractCall) -> String) {
        lock.lock()
        answers["\(context)/\(method)"] = answer
        lock.unlock()
    }

    func on(_ method: String, in context: String = "*", json: String) { on(method, in: context) { _ in json } }

    /// A workspace with `Product` (holding `Specs`) and `Notes`.
    func standardWorkspace() {
        backend.namespaces = [AppNamespace(id: Self.ws, name: "Acme", applicationId: backend.applicationId, memberCount: 3)]
        backend.subgroups = [
            Self.ws: [
                AppSubgroup(groupId: "g-product", name: "Product", contextIds: ["c-product"]),
                AppSubgroup(groupId: "g-notes", name: "Notes", contextIds: ["c-notes"]),
            ],
            "g-product": [AppSubgroup(groupId: "g-specs", name: "Specs", contextIds: ["c-specs"])],
        ]
        backend.members = ["c-product", "c-notes"]
        on("list_docs", in: "c-product", json: "[\(Self.doc("d1", "Roadmap", updated: 300))]")
        on("list_docs", in: "c-notes", json: "[\(Self.doc("d2", "Standup notes", updated: 500))]")
        on("list_docs", in: "c-specs", json: "[\(Self.doc("d3", "API spec", updated: 100))]")
    }

    static func doc(_ id: String, _ title: String, updated: UInt64, archived: Bool = false) -> String {
        """
        {"id":"\(id)","title":"\(title)","tags":[],"archived":\(archived),"created_at":1700000000000000000,\
        "updated_at":\(1_700_000_000_000_000_000 + updated),"created_by":"\(other)","updated_by":"\(other)","can_delete":false}
        """
    }

    static func comment(_ id: String, _ body: String, author: String = other, at: UInt64) -> String {
        """
        {"id":"\(id)","author":"\(author)","doc_id":"d1","body":"\(body)","created_at":\(1_700_000_000_000_000_000 + at)}
        """
    }

    /// A body as the node returns it: marks as JSON booleans, plain spans without `attributes`.
    static let body = """
        [
          {"id":"b1","kind":"heading","depth":0,"attrs":{"level":"2"},"spans":[{"text":"Plan"}],"ids":[]},
          {"id":"b2","kind":"paragraph","depth":0,"attrs":{},"spans":[
            {"text":"Ship "},{"text":"fast","attributes":{"bold":true,"italic":true}},
            {"text":" and ","attributes":{}},{"text":"read this","attributes":{"link":"https://example.com"}}],"ids":[]},
          {"id":"b3","kind":"numberedListItem","depth":0,"attrs":{},"spans":[{"text":"One"}],"ids":[]},
          {"id":"b4","kind":"numberedListItem","depth":0,"attrs":{},"spans":[{"text":"Two"}],"ids":[]},
          {"id":"b5","kind":"image","depth":0,"attrs":{"url":"blob:\(String(repeating: "0f", count: 32))","caption":"Chart"},"spans":[],"ids":[]},
          {"id":"b6","kind":"table","depth":0,"attrs":{},"spans":[],"ids":[]}
        ]
        """
}
