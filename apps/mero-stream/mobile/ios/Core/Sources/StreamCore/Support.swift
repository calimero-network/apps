import Foundation
import MeroKit

extension StreamClient {
    /// The client for one room's call context, over the account's relay.
    public init(backend: any MeroAppBackend, contextId: String) {
        self.init(transport: backend.contract.bound(to: contextId))
    }
}

/// Words a person can act on, for any failure the app sees.
public enum ErrorText {
    public static func describe(_ error: Error) -> String {
        switch error {
        case AccountError.noRelay:
            return "No relay serves your account yet. Join a stream with an invitation link first."
        case AccountError.intentRefused(let reason, _, let status):
            return "The relay refused this (\(status)): \(reason)"
        case let error as URLError:
            return "The relay can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case MeroError.network(let message):
            return "The relay can't be reached: \(message)"
        case MeroError.authRevoked:
            return "Your session was revoked. Sign out and sign in again."
        case is DecodingError:
            return "The room answered in a shape this app does not read. It may run a different version of Mero Stream."
        case let error as LocalizedError:
            return error.errorDescription ?? "\(error)"
        default:
            return "\(error)"
        }
    }
}

public enum StreamError: LocalizedError, Equatable {
    case noApplication
    case notAnInvitation
    case noRoomContext(String)
    case noPresence

    public var errorDescription: String? {
        switch self {
        case .noApplication:
            return "Mero Stream is not installed for your account yet. Try again in a moment."
        case .notAnInvitation:
            return "That is not a Mero Stream invitation link."
        case .noRoomContext(let name):
            return "“\(name)” has no call yet. It may still be replicating; refresh in a moment."
        case .noPresence:
            return "This session can't carry live media yet: your relay has no event connection. Sign out and in again."
        }
    }
}

/// Wall clock in unix milliseconds.
public func nowMillis() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }
