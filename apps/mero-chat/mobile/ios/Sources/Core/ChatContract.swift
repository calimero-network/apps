import Foundation
import MeroKit

/// The two ways the app reaches the chat contract in an app instance.
///
/// There is no third: the phone holds no node, so there is no JSON-RPC. A
/// read is a view, a write is an intent, both as the signed-in account.
protocol ChatContract: Sendable {
    /// Run a view (`#[app::view]`): `POST /apps/{app}/views`.
    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue?
    /// Run a mutation as the account: `POST /apps/{app}/intents`.
    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue?
}

/// ``ChatContract`` over the swift-sdk's `ContextContract`: on 1.0
/// `CloudContextContract`, so `query` is `POST /apps/{app}/views` and
/// `execute` is `POST /apps/{app}/intents`, both over the sealed channel.
struct AppChatContract: ChatContract {
    let inner: any ContextContract

    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try await inner.query(contextId: contextId, method: method, args: args)
    }

    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try await inner.execute(contextId: contextId, method: method, args: args)
    }
}

/// A contract for a session that isn't connected: every call says so.
struct NoRelayChatContract: ChatContract {
    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        throw ChatError.noRelay
    }

    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        throw ChatError.noRelay
    }
}
