#if DEBUG
import Foundation
import MeroKit

/// One contract call the demo answers: which context, which method, its
/// arguments (decoded JSON object), and whether it was a write (`execute`).
struct DemoCall: @unchecked Sendable {
    let contextId: String
    let method: String
    let args: [String: Any]
    let isWrite: Bool

    func string(_ key: String) -> String? { args[key] as? String }
    func int(_ key: String) -> Int? { (args[key] as? NSNumber)?.intValue }
    func strings(_ key: String) -> [String]? { args[key] as? [String] }
}

/// A contract error, in the words the relay would use.
struct DemoContractError: LocalizedError {
    let errorDescription: String?
    init(_ text: String) { errorDescription = text }
}

/// The relay and contract of a signed-in account, in memory: namespaces,
/// subgroups, contexts and membership, plus a handler that answers contract
/// calls with the return value's JSON bytes. Same idea as MeroKitTestSupport's
/// `InMemoryAppBackend` + `RecordingContextContract`, without linking test
/// support into the app.
final class DemoBackend: MeroAppBackend, ContextContract, @unchecked Sendable {
    typealias Handler = @Sendable (DemoCall) throws -> Data

    let account: String
    let applicationId: String
    private let handler: Handler
    private let latency: Duration
    private let lock = NSLock()
    private var namespaces: [AppNamespace]
    private var subgroups: [String: [AppSubgroup]]
    private var members: Set<String>
    private var next = 0

    init(
        account: String, applicationId: String, namespaces: [AppNamespace], subgroups: [String: [AppSubgroup]],
        members: Set<String>, latency: Duration = .milliseconds(120), handler: @escaping Handler
    ) {
        self.account = account
        self.applicationId = applicationId
        self.namespaces = namespaces
        self.subgroups = subgroups
        self.members = members
        self.latency = latency
        self.handler = handler
    }

    // MARK: MeroAppBackend

    var contract: any ContextContract { self }
    var hasRelay: Bool { true }
    var canSubscribe: Bool { true }

    func listNamespaces() async throws -> [AppNamespace] {
        try await pause()
        return locked { namespaces }
    }

    func listSubgroups(namespaceId: String) async throws -> [AppSubgroup] {
        try await pause()
        return locked { subgroups[namespaceId] ?? [] }
    }

    func listContexts(groupId: String) async throws -> [String] {
        locked { subgroups.values.joined().first { $0.groupId == groupId }?.contextIds ?? [] }
    }

    func isMember(contextId: String) async throws -> Bool { locked { members.contains(contextId) } }

    func joinContext(contextId: String) async throws {
        try await pause()
        locked { _ = members.insert(contextId) }
    }

    func foundNamespace(name: String) async throws -> AppFoundedNamespace {
        try await pause()
        return locked {
            let id = mint()
            namespaces.append(AppNamespace(id: id, name: name, applicationId: applicationId, memberCount: 1))
            return AppFoundedNamespace(namespaceId: id, haEnabled: true)
        }
    }

    func createSubgroup(namespaceId: String, name: String, isPublic: Bool) async throws -> String {
        locked {
            let id = mint()
            subgroups[namespaceId, default: []].append(AppSubgroup(groupId: id, name: name, contextIds: []))
            return id
        }
    }

    func createContext(groupId: String, applicationId: String, name: String, initArgs: JSONValue) async throws -> String {
        locked {
            let id = mint()
            for (namespace, list) in subgroups {
                guard let index = list.firstIndex(where: { $0.groupId == groupId }) else { continue }
                let old = list[index]
                subgroups[namespace]?[index] = AppSubgroup(groupId: old.groupId, name: old.name, contextIds: old.contextIds + [id])
            }
            members.insert(id)
            return id
        }
    }

    func createInvitation(namespaceId: String) async throws -> SignedGroupOpenInvitation {
        try await pause()
        let group = (try? Hex.decode(namespaceId, label: "namespaceId", bytes: 32)).map { $0.map(Int.init) }
        return SignedGroupOpenInvitation(
            invitation: GroupInvitationFromAdmin(
                inviterIdentity: Array(repeating: 7, count: 32), groupId: group ?? Array(repeating: 0, count: 32),
                expirationTimestamp: 4_102_444_800, secretSalt: Array(repeating: 3, count: 32)),
            inviterSignature: String(repeating: "5a", count: 64))
    }

    func joinNamespace(namespaceId: String, invitation: SignedGroupOpenInvitation) async throws -> AppJoinedNamespace {
        try await pause()
        locked {
            if !namespaces.contains(where: { $0.id == namespaceId }) {
                namespaces.append(AppNamespace(id: namespaceId, name: nil, applicationId: applicationId))
            }
        }
        return AppJoinedNamespace(namespaceId: namespaceId, published: true, relayURL: "https://relay.demo")
    }

    /// Open, never yields: every screen reloads after its own writes, so nothing needs pushing.
    func events(contextId: String) -> AsyncThrowingStream<AppContextEvent, Error> {
        AsyncThrowingStream { _ in }
    }

    // MARK: ContextContract

    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        let data = try await call(contextId, method, CanonicalJSON.data(args), write: false)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        let data = try await call(contextId, method, CanonicalJSON.data(args), write: true)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    func query(contextId: String, method: String, argsJSON: Data) async throws -> Data {
        try await call(contextId, method, argsJSON, write: false)
    }

    func execute(contextId: String, method: String, argsJSON: Data) async throws -> Data {
        try await call(contextId, method, argsJSON, write: true)
    }

    private func call(_ contextId: String, _ method: String, _ argsJSON: Data, write: Bool) async throws -> Data {
        try await pause()
        let args = (try? JSONSerialization.jsonObject(with: argsJSON.isEmpty ? Data("{}".utf8) : argsJSON)) as? [String: Any]
        return try handler(DemoCall(contextId: contextId, method: method, args: args ?? [:], isWrite: write))
    }

    // MARK: Plumbing

    private func pause() async throws { try await Task.sleep(for: latency) }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    private func mint() -> String {
        next += 1
        let digits = String(next, radix: 16)
        return "d0" + String(repeating: "0", count: 62 - digits.count) + digits
    }
}

/// The JSON bytes of a return value, for a ``DemoBackend`` handler.
enum DemoReply {
    static let null = Data("null".utf8)

    static func json<T: Encodable>(_ value: T) throws -> Data { try JSONEncoder().encode(value) }
}

/// Stable 64-hex ids from names, so fixtures read like real accounts and contexts.
enum DemoIds {
    static func hex(_ seed: String) -> String {
        var out = ""
        var state: UInt64 = 1469598103934665603
        for byte in seed.utf8 { state = (state ^ UInt64(byte)) &* 1099511628211 }
        while out.count < 64 {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            out += String(format: "%016llx", state)
        }
        return String(out.prefix(64))
    }

    /// A contract timestamp (nanoseconds since 1970) `seconds` before now.
    static func stamp(ago seconds: TimeInterval, from now: Date = Date()) -> UInt64 {
        UInt64((now.timeIntervalSince1970 - seconds) * 1_000_000_000)
    }
}
#endif
