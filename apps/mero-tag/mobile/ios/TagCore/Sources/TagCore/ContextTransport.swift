import Foundation
import MeroKit

/// How the app reaches a space's contract: the SDK's ``ContextContract`` (a
/// view is `POST /apps/{app}/views`, a write `POST /apps/{app}/intents`, both
/// over the sealed channel as the signed-in account) plus the app instance's
/// server-sent events. In production that is the cluster, through
/// ``CloudTransport``; tests substitute a fake.
///
/// The contract's methods are called through ``TagClient``, which
/// `scripts/mobile-codegen.sh` generates from `logic/res/abi.json`.
public protocol ContextTransport: ContextContract {
    /// The app instance's events, or `nil` when the caller should poll instead.
    func events(appId: String) -> AsyncThrowingStream<CloudEvent, Error>?
}

/// Calls, views and events on a Calimero 1.0 cluster as the signed-in account:
/// the SDK's ``CloudContextContract``, and the client's event stream.
public struct CloudTransport: ContextTransport {
    public let client: CalimeroClient
    private let contract: CloudContextContract

    public init(client: CalimeroClient) {
        self.client = client
        contract = CloudContextContract(client: client)
    }

    public func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try await contract.query(contextId: contextId, method: method, args: args)
    }

    public func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try await contract.execute(contextId: contextId, method: method, args: args)
    }

    public func query(contextId: String, method: String, argsJSON: Data) async throws -> Data {
        try await contract.query(contextId: contextId, method: method, argsJSON: argsJSON)
    }

    public func execute(contextId: String, method: String, argsJSON: Data) async throws -> Data {
        try await contract.execute(contextId: contextId, method: method, argsJSON: argsJSON)
    }

    public func events(appId: String) -> AsyncThrowingStream<CloudEvent, Error>? {
        client.events(appId)
    }
}

enum ContractCoding {
    /// A generated method's answer for a type the ABI names without its shape
    /// (`JSONValue`), read into the app model.
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
