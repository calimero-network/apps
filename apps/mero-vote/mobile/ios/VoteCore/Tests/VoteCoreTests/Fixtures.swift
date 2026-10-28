import Foundation
import MeroKit
import MeroKitTestSupport
import VoteCore
import VoteCrypto

let me = String(repeating: "ab", count: 32)
let bob = String(repeating: "b0", count: 32)
let ctx = String(repeating: "cc", count: 32)
let ns = String(repeating: "aa", count: 32)
let pollId = String(repeating: "dd", count: 32)

func groupRef() -> GroupRef { GroupRef(namespaceId: ns, workspaceName: "Design", contextId: ctx) }

/// The shared cross-implementation vectors (mobile/test-vectors/vectors.json).
enum Vectors {
    static let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("test-vectors/vectors.json")
    // swiftlint:disable:next force_try force_cast
    static let json = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]

    static func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
        try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
    }
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

    func raw(_ method: String, _ answer: @escaping (RecordedContractCall) -> Data) {
        lock.lock(); defer { lock.unlock() }
        answers[method] = answer
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

func makeBackend(account: String = me) -> (InMemoryAppBackend, Script) {
    let backend = InMemoryAppBackend(account: account)
    let script = Script()
    script.install(on: backend)
    return (backend, script)
}

extension RecordedContractCall {
    func string(_ key: String) -> String? { args[key]?.stringValue }

    func decode<T: Decodable>(_ type: T.Type, _ key: String) throws -> T {
        guard let value = args[key] else { throw Offline() }
        return try JSONDecoder().decode(T.self, from: JSONEncoder().encode(value))
    }
}

func definition(
    title: String = "Lunch?", options: [String] = ["Pizza", "Sushi", "Tacos"], min: UInt32 = 1, max: UInt32 = 1,
    trustees: [String] = [me], threshold: UInt32 = 1, voters: [String] = [], creator: String = me
) -> PollDefinition {
    PollDefinition(
        title: title, description: "", options: options, minChoices: min, maxChoices: max, trustees: trustees,
        threshold: threshold, voters: voters, creator: creator, createdAt: 1_761_000_000_000, closesAt: nil)
}

func trusteeStatus(_ account: String, index: UInt32, transport: Bool = false, dealt: Bool = false, partial: Bool = false)
    -> TrusteeStatus
{
    TrusteeStatus(
        account: account, index: index, transportPublished: transport, dealingPublished: dealt, complaintsAgainst: 0,
        qualified: nil, partialPublished: partial)
}

func pollView(
    _ def: PollDefinition, phase: Phase, election: Election? = nil, trustees: [TrusteeStatus]? = nil,
    myDigest: String? = nil, canVote: Bool = true, closure: Closure? = nil
) -> PollView {
    PollView(
        pollId: pollId, definition: def,
        state: PollState(phase: phase, election: election, closingAt: nil, closure: closure, anchor: nil),
        trustees: trustees ?? def.trustees.enumerated().map { trusteeStatus($1, index: UInt32($0 + 1)) },
        turnout: [], myDigest: myDigest, canVote: canVote)
}
