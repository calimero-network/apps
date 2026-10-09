import Foundation
import MeroKit

/// How the app reaches its context. In production that is the account's
/// hosted relay (``RelayTransport``); tests substitute a fake.
///
/// The split mirrors mero-react in Cloud mode: a **write** is a warrant intent
/// the device signs and the relay executes; a **read** is a query over the
/// relay's Bearer session (the SDK falls back to a warrant when the session is
/// unavailable or the node says the method writes).
public protocol ContextTransport: Sendable {
    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue?
    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue?
    /// Raw SSE frames for `contextId`, or `nil` when live events are
    /// unavailable (no relay session) and the caller should poll instead.
    func events(contextId: String) -> AsyncThrowingStream<JSONValue, Error>?
}

/// Writes and reads through the account's relay, as the signed-in account.
public struct RelayTransport: ContextTransport {
    public let relay: RelayClient
    /// The relay's Bearer session: SSE. `nil` when it could not be established.
    public let session: Mero?

    public init(relay: RelayClient, session: Mero?) {
        self.relay = relay
        self.session = session
    }

    public init?(_ connection: CloudConnection) {
        guard let relay = connection.relay else { return nil }
        self.init(relay: relay, session: connection.mero)
    }

    public func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try await relay.query(contextId: contextId, method: method, argsJson: args)
    }

    public func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try await relay.execute(contextId: contextId, method: method, argsJson: args).returns
    }

    public func events(contextId: String) -> AsyncThrowingStream<JSONValue, Error>? {
        guard let session else { return nil }
        let upstream = session.events(contextIds: [contextId])
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in upstream where event.contextId == contextId {
                        continuation.yield(event.payload)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

enum ContractCoding {
    /// Encode contract args (snake_case keys, as the Rust params are named).
    static func args<T: Encodable>(_ value: T) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }

    /// Decode a method's `returns` into the app model.
    static func decode<T: Decodable>(_ type: T.Type, from value: JSONValue?, method: String) throws -> T {
        do {
            let data = try JSONEncoder().encode(value ?? .null)
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ContractError.unexpectedResponse(method: method)
        }
    }
}

public enum ContractError: LocalizedError, Equatable {
    case unexpectedResponse(method: String)

    public var errorDescription: String? {
        switch self {
        case .unexpectedResponse(let method):
            return "The space answered \(method) in a shape this version of Mero Tag does not understand."
        }
    }
}
