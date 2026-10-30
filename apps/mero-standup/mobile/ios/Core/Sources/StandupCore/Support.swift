import Foundation
import MeroKit

// The generated client declares its own `ContextContractCalling` (it imports
// nothing); MeroKit's bound contract has exactly its two methods.
extension BoundContextContract: ContextContractCalling {}

extension StandupClient {
    /// The client for one team (app instance), over the account's cluster session.
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
        case AccountError.noRelay, AccountError.notSignedIn:
            return "You're signed out. Sign in again to reach your team."
        case is ConfirmCancelled:
            return "The passkey prompt was cancelled."
        case is LoginRequired:
            return "Your session ended. Sign in again."
        case is ReleaseDeadlineError:
            return "A newer node release needs approval before anything can change. Review it under Teams."
        case is ConsentStale:
            return "That approval request is out of date. Try again."
        case is NotFound:
            return "This team isn't available to you (yet)."
        case let error as UnavailableError:
            return "Your cluster is unavailable right now (\(error.reason)). Try again shortly."
        case let error as AppError:
            return error.message.isEmpty ? error.appCode : error.message
        case let error as CalimeroError:
            return "The node refused this (\(error.status)): \(error.message.isEmpty ? error.code : error.message)"
        case let error as URLError:
            return "Your cluster can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case is DecodingError:
            return "The team answered in a shape this app does not read. It may run a different version of Mero Standup."
        case let error as LocalizedError:
            return error.errorDescription ?? "\(error)"
        default:
            return "\(error)"
        }
    }
}
