import Foundation
import MeroKit

// The generated client declares its own `ContextContractCalling` (it imports
// nothing); MeroKit's bound contract has exactly its two methods.
extension BoundContextContract: ContextContractCalling {}

extension StandupClient {
    /// The client for one team, over the account's relay.
    public init(backend: any MeroAppBackend, contextId: String) {
        self.init(transport: backend.contract.bound(to: contextId))
    }
}

extension UpdateView: Identifiable {
    /// One update per author per day.
    public var id: String { "\(day)|\(author)" }
}

/// Words a person can act on, for any failure the app sees.
public enum ErrorText {
    public static func describe(_ error: Error) -> String {
        switch error {
        case AccountError.noRelay:
            return "No relay serves your account yet. Join a team with an invitation link first."
        case AccountError.intentRefused(let reason, _, let status):
            return "The relay refused this (\(status)): \(reason)"
        case let error as URLError:
            return "The relay can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case MeroError.network(let message):
            return "The relay can't be reached: \(message)"
        case MeroError.authRevoked:
            return "Your session was revoked. Sign out and sign in again."
        case is DecodingError:
            return "The team answered in a shape this app does not read. It may run a different version of Mero Standup."
        case let error as LocalizedError:
            return error.errorDescription ?? "\(error)"
        default:
            return "\(error)"
        }
    }
}
