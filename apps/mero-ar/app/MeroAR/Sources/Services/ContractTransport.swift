import Foundation
import MeroKit

/// How contract calls reach a room: through the account's Cloud relay, or
/// straight to a node the person runs (signed in with its admin username and
/// password).
public protocol ContractTransport: Sendable {
    /// A view call. `nil` for `()` / `None`.
    func query(contextId: String, method: String, args: [String: JSONValue]) async throws -> JSONValue?
    /// A write.
    func execute(contextId: String, method: String, args: [String: JSONValue]) async throws
    /// Throws when the room is not served here.
    func describe(contextId: String) async throws
    /// Where calls go, for the technical details.
    var endpoint: String { get }
}

extension ContractTransport {
    func query<T: Decodable>(_ type: T.Type, contextId: String, method: String, args: [String: JSONValue] = [:])
        async throws -> T
    {
        let value = try await query(contextId: contextId, method: method, args: args) ?? .null
        return try MeroJSON.decode(T.self, from: try MeroJSON.encode(value))
    }
}

/// Cloud: reads are relay queries, writes are warranted intents the relay runs
/// as the account.
public struct RelayTransport: ContractTransport {
    public let relay: RelayClient

    public init(relay: RelayClient) { self.relay = relay }

    public func query(contextId: String, method: String, args: [String: JSONValue]) async throws -> JSONValue? {
        try await relay.query(contextId: contextId, method: method, argsJson: .object(args))
    }

    public func execute(contextId: String, method: String, args: [String: JSONValue]) async throws {
        _ = try await relay.execute(contextId: contextId, method: method, argsJson: .object(args))
    }

    public func describe(contextId: String) async throws { _ = try await relay.describe(contextId) }

    public var endpoint: String { relay.relayURL }
}

/// A node signed in to directly: JSON-RPC `execute` against it, as the node's
/// own identity.
///
/// The JSON-RPC envelope is sent on the SDK's transport (auth, refresh) and
/// unwrapped here, so a method returning `()` — `output: null`, or no output at
/// all — is a success rather than an "empty response".
public struct NodeTransport: ContractTransport {
    public let mero: Mero
    public let nodeURL: String

    public init(mero: Mero, nodeURL: String) {
        self.mero = mero
        self.nodeURL = nodeURL
    }

    private struct Envelope: Decodable {
        struct Result: Decodable { let output: JSONValue? }
        struct Failure: Decodable {
            let code: Int?
            let message: String?
            let type: String?
            let data: JSONValue?
        }
        let result: Result?
        let error: Failure?
    }

    func call(contextId: String, method: String, args: [String: JSONValue]) async throws -> JSONValue? {
        let body: JSONValue = [
            "jsonrpc": "2.0", "id": 1, "method": "execute",
            "params": ["contextId": .string(contextId), "method": .string(method), "argsJson": .object(args)],
        ]
        let (data, _) = try await mero.http.sendRaw(
            HttpRequest(path: "/jsonrpc", method: .post, body: .json(try MeroJSON.encode(body))))
        let envelope = try MeroJSON.decode(Envelope.self, from: data)
        if let error = envelope.error {
            throw MeroError.rpc(
                RpcError(
                    code: error.code ?? -1, message: error.message ?? Self.describe(error.type, error.data),
                    type: error.type, data: error.data))
        }
        guard let output = envelope.result?.output, output != .null else { return nil }
        return output
    }

    /// The node's own sentence for a contract failure: `data` carries it.
    static func describe(_ type: String?, _ data: JSONValue?) -> String {
        if case .string(let text)? = data { return text }
        if let data, let encoded = try? MeroJSON.encode(data), let text = String(data: encoded, encoding: .utf8) {
            return [type, text].compactMap { $0 }.joined(separator: ": ")
        }
        return type ?? "The node refused the call."
    }

    public func query(contextId: String, method: String, args: [String: JSONValue]) async throws -> JSONValue? {
        try await call(contextId: contextId, method: method, args: args)
    }

    public func execute(contextId: String, method: String, args: [String: JSONValue]) async throws {
        _ = try await call(contextId: contextId, method: method, args: args)
    }

    public func describe(contextId: String) async throws { _ = try await mero.admin.getContext(contextId) }

    public var endpoint: String { nodeURL }
}
