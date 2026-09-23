import Foundation

/// Why the node refused a credential, read from its `X-Auth-Error` header.
///
/// The header is the whole contract. Core's auth middleware decides the status
/// code from the error *type* and always names the reason in the header, and the
/// two do not line up the way a client would guess:
///
/// | reason              | status | meaning                                    |
/// |---------------------|--------|--------------------------------------------|
/// | `token_expired`     | 401    | refresh and retry — the only recoverable one |
/// | `token_reuse`       | 401    | a consumed refresh token was replayed; the whole family is revoked |
/// | `invalid_token`     | 401    | signature/shape rejected                    |
/// | `token_revoked`     | **403**| the family was revoked out from under us    |
/// | `permission_denied` | 403    | the token was minted without a grant this route requires |
/// | `invalid_node`      | 403    | the token is bound to a different node      |
/// | `invalid_request`   | 400    | malformed request, not an auth problem      |
///
/// ⚠️ `token_revoked` is a **403**, not a 401. A client that only watches 401 —
/// which is what this one did — sees a revoked token as an ordinary forbidden
/// response, keeps the dead credential, and retries it forever. On a stream that
/// is an infinite reconnect loop against a token that can never be accepted
/// again.
public enum AuthFailure: String, Sendable, Equatable {
    case tokenExpired = "token_expired"
    case tokenReuse = "token_reuse"
    case invalidToken = "invalid_token"
    case tokenRevoked = "token_revoked"
    case permissionDenied = "permission_denied"
    case invalidNode = "invalid_node"
    case invalidRequest = "invalid_request"

    /// Can a refresh plausibly fix this? Only the expiry can.
    public var isRefreshable: Bool { self == .tokenExpired }

    /// Is the session dead? Every retry re-sends the same dead credential, so
    /// the only way forward is a new login.
    public var isTerminal: Bool {
        switch self {
        case .tokenExpired, .invalidRequest: return false
        case .tokenReuse, .invalidToken, .tokenRevoked, .permissionDenied, .invalidNode: return true
        }
    }

    /// A message worth putting in front of a human.
    public var userFacingReason: String {
        switch self {
        case .tokenExpired:     return "Your session expired."
        case .tokenReuse:       return "Your session was used from somewhere else and has been revoked."
        case .invalidToken:     return "Your session is no longer valid."
        case .tokenRevoked:     return "Your session was revoked on the node."
        case .permissionDenied: return "This session was not granted the access this app needs."
        case .invalidNode:      return "This session belongs to a different node."
        case .invalidRequest:   return "The node rejected the request."
        }
    }

    /// Classify a response.
    ///
    /// The header is preferred, because it is exact. When it is absent the status
    /// alone decides, and the fallbacks are deliberately pessimistic:
    ///
    /// - a **403** with no header is treated as terminal. On the SSE routes core
    ///   answers a revoked family with an EMPTY body and, behind a proxy that
    ///   drops unknown headers, nothing else. The alternatives on those routes
    ///   (`permission_denied`, "not the session owner") are terminal too, so
    ///   there is no 403 on an authenticated route that retrying the same token
    ///   fixes.
    /// - a **401** with no header is treated as expiry, which costs one refresh
    ///   attempt; if that fails the refresh itself reports the terminal reason.
    public static func classify(status: Int, headers: @autoclosure () -> [AnyHashable: Any]) -> AuthFailure? {
        let named = (headers()
            .first { ($0.key as? String)?.lowercased() == "x-auth-error" }?
            .value as? String)?
            .trimmingCharacters(in: .whitespaces)
            .lowercased()
        if let named, let parsed = AuthFailure(rawValue: named) { return parsed }
        switch status {
        case 401: return .tokenExpired
        case 403: return .tokenRevoked
        default:  return nil
        }
    }
}

extension HTTPURLResponse {
    /// `nil` unless this response is an auth refusal.
    ///
    /// Public so an app can tell a dead session from an ordinary refusal
    /// without re-deriving the status/reason table.
    public var authFailure: AuthFailure? {
        guard statusCode == 401 || statusCode == 403 else { return nil }
        return AuthFailure.classify(status: statusCode, headers: allHeaderFields)
    }
}
