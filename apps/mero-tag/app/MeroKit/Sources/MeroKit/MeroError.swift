import Foundation

/// Errors surfaced by MeroKit. `rpc` carries the human-readable reason extracted
/// from a JSON-RPC error body (WASM `error.data` → `error.message` → raw), the
/// same precedence the web client uses.
public enum MeroError: Error, LocalizedError, Equatable {
    case notConfigured
    case http(status: Int, body: String)
    case rpc(message: String)
    case decoding(String)
    case transport(String)
    case emptyResult
    /// The session is dead and no retry can revive it — see `AuthFailure`.
    /// Raised INSTEAD of `.http(401/403, …)` so a caller cannot mistake a
    /// revoked credential for an ordinary forbidden response and keep retrying.
    case authRevoked(AuthFailure)
    /// The node accepted the subscribe call but silently dropped contexts the
    /// caller may not observe. Core answers `200 {"status":"subscribed",
    /// "contexts":[…]}` listing only what it actually subscribed, so a stream
    /// that will never carry an event is otherwise indistinguishable from a
    /// quiet one.
    case notSubscribed(contexts: [String])

    public var errorDescription: String? {
        switch self {
        case .notConfigured:          return "Mero client is not configured (missing node URL or token)."
        case .http(let s, let body):  return "HTTP \(s): \(body)"
        case .rpc(let m):             return m
        case .decoding(let m):        return "Decoding failed: \(m)"
        case .transport(let m):       return "Transport error: \(m)"
        case .emptyResult:            return "RPC returned an empty result."
        case .authRevoked(let r):     return "\(r.userFacingReason) Please sign in again."
        case .notSubscribed(let c):
            return "The node did not subscribe this session to \(c.joined(separator: ", ")) — "
                 + "no event from it will ever arrive."
        }
    }

    /// Map a JSON-RPC `error` value (String or `{message, data}`) to a `MeroError`.
    /// Mirrors web `rpc.ts`: prefer `error.data` (WASM reason), then `message`, then raw.
    public static func fromRpcError(_ error: Any) -> MeroError {
        if let s = error as? String { return .rpc(message: s) }
        if let dict = error as? [String: Any] {
            if let data = dict["data"] as? String, !data.isEmpty {
                return .rpc(message: data)
            }
            if let message = dict["message"] as? String {
                return .rpc(message: message)
            }
        }
        return .rpc(message: String(describing: error))
    }
}
