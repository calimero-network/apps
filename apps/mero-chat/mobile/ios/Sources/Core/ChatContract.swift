import Foundation
import MeroKit

/// The two ways the app reaches the chat contract in a context.
///
/// There is no third: the phone holds no node, so there is no JSON-RPC. A
/// read is the relay's account-scoped query, a write is a signed warrant.
protocol ChatContract: Sendable {
    /// Run a view (`#[app::view]`) through the relay's query path.
    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue?
    /// Run a mutation as the account: a warrant posted to the relay's intents route.
    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue?
}

/// ``ChatContract`` over the account's ``RelayClient``.
///
/// - `query` is `POST /admin-api/contexts/{id}/query` with the relay session's
///   Bearer token (``RelayClient/query(contextId:method:argsJson:)``). Without a
///   session, or when the relay says the method is a write, the SDK falls back
///   to a warrant, which reads too.
/// - `execute` is `POST /admin-api/contexts/{id}/intents` carrying a warrant the
///   device key signs (``RelayClient/execute(contextId:method:argsJson:)``).
struct RelayChatContract: ChatContract {
    let relay: RelayClient

    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try await relay.query(contextId: contextId, method: method, argsJson: args)
    }

    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        try await relay.execute(contextId: contextId, method: method, argsJson: args).returns
    }
}

/// A contract for a session with no relay: every call says so.
struct NoRelayChatContract: ChatContract {
    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        throw ChatError.noRelay
    }

    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        throw ChatError.noRelay
    }
}
