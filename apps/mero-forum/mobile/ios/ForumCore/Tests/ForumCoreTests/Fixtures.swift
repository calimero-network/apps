import Foundation
import ForumCore
import ForumGenerated
import MeroKit
import MeroKitTestSupport

let me = String(repeating: "ab", count: 32)
let bob = String(repeating: "b0", count: 32)
let ctx = String(repeating: "cc", count: 32)
let ns = String(repeating: "aa", count: 32)

func forumRef(contextId: String = ctx) -> ForumRef {
    ForumRef(namespaceId: ns, spaceName: "Design", forumId: String(repeating: "bb", count: 32), forumName: "General", contextId: contextId)
}

func post(_ id: String, author: String = bob, name: String = "Bob", score: Int64 = 0, myVote: Int32 = 0, comments: UInt64 = 0) -> PostView {
    PostView(
        id: id, author: author, authorName: name, title: "Title \(id)", body: "Body \(id)",
        createdAt: 1_761_000_000_000_000_000, editedAt: 1_761_000_000_000_000_000, score: score,
        commentCount: comments, myVote: myVote)
}

func comment(_ id: String, author: String = bob, score: Int64 = 0, myVote: Int32 = 0) -> CommentView {
    CommentView(
        id: id, postId: "p1", author: author, authorName: "Bob", body: "Reply \(id)",
        createdAt: 1_761_000_000_000_000_000, editedAt: 1_761_000_000_000_000_000, score: score, myVote: myVote)
}

struct Offline: Error {}

/// A contract scripted per method with Codable answers; `fail` makes a method throw.
final class Script: @unchecked Sendable {
    private let lock = NSLock()
    private var answers: [String: (RecordedContractCall) -> Data] = [:]
    private var failing: Set<String> = []

    func on<T: Encodable>(_ method: String, _ answer: @escaping (RecordedContractCall) -> T) {
        lock.lock(); defer { lock.unlock() }
        answers[method] = { call in try! JSONEncoder().encode(answer(call)) }
    }

    func fail(_ method: String) {
        lock.lock(); defer { lock.unlock() }
        failing.insert(method)
    }

    func install(on backend: InMemoryAppBackend) {
        backend.recording.setRawHandler { [self] call in
            lock.lock()
            let fails = failing.contains(call.method)
            let answer = answers[call.method]
            lock.unlock()
            if fails { throw Offline() }
            return answer?(call)
        }
    }
}

func makeBackend() -> (InMemoryAppBackend, Script) {
    let backend = InMemoryAppBackend(account: me)
    let script = Script()
    script.install(on: backend)
    return (backend, script)
}

extension RecordedContractCall {
    func string(_ key: String) -> String? { args[key]?.stringValue }
}
