import Foundation
import MeroKit

/// How the app reaches its space's contract. In production that is the
/// cluster, through ``CloudTransport``; tests substitute a fake.
///
/// A space is one app instance on a Calimero 1.0 cluster. Reads are views
/// (`POST /apps/{app}/views`), writes are calls (`POST /apps/{app}/intents`),
/// both over the sealed channel as the signed-in account, and events stream
/// over the app's server-sent events (`GET /apps/{app}/events`).
public protocol ContextTransport: Sendable {
    /// Run a read-only method. `nil` for a method that returns nothing.
    func query(appId: String, method: String, args: JSONValue) async throws -> JSONValue?
    /// Run a method that writes, once, on the app instance's leader.
    func execute(appId: String, method: String, args: JSONValue) async throws -> JSONValue?
    /// The app instance's events, or `nil` when the caller should poll instead.
    func events(appId: String) -> AsyncThrowingStream<CloudEvent, Error>?
}

/// Calls, views and events on a Calimero 1.0 cluster as the signed-in account.
public struct CloudTransport: ContextTransport {
    public let client: CalimeroClient

    public init(client: CalimeroClient) { self.client = client }

    public func query(appId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        Self.unwrap(try await client.view(appId, method, args).result)
    }

    public func execute(appId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        Self.unwrap(try await client.call(appId, method, args).result)
    }

    public func events(appId: String) -> AsyncThrowingStream<CloudEvent, Error>? {
        client.events(appId)
    }

    /// A method returning `()` answers `null`.
    static func unwrap(_ value: JSONValue?) -> JSONValue? {
        guard let value, value != .null else { return nil }
        return value
    }
}

enum ContractCoding {
    /// Encode contract args (snake_case keys, as the Rust params are named).
    static func args<T: Encodable>(_ value: T) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }

    /// Decode a method's result into the app model.
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
