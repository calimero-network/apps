import Foundation
import MeroKit

/// Words a person can act on, for any failure the chat layer sees.
///
/// A Calimero 1.0 node answers with typed errors (`CalimeroError` and its
/// subclasses): the ones a person can do something about get words of their
/// own; the contract's own refusals (`AppError`) and anything else keep the
/// node's message.
enum ChatErrorText {
    static func describe(_ error: Error) -> String {
        if let outdated = outdatedChat(in: rawText(error)) { return outdated }
        switch error {
        case let error as ChatError:
            return error.errorDescription ?? "\(error)"
        case is ConfirmCancelled:
            return "The passkey prompt was cancelled."
        case is LoginRequired:
            return "Your session ended. Sign in again."
        case is ReleaseDeadlineError:
            return "A newer node release needs approval before anything can change. Review it under Approvals."
        case is ConsentStale:
            return "That approval request is out of date. Try again."
        case is NotFound:
            return "This isn't available to you (yet)."
        case let error as UnavailableError:
            return "Your cluster is unavailable right now (\(error.reason)). Try again shortly."
        case let error as AppError:
            return error.message.isEmpty ? error.appCode : error.message
        case let error as CalimeroError:
            return error.message.isEmpty ? error.code : "\(error.message) (\(error.status))"
        case AccountError.noRelay, AccountError.notSignedIn:
            return ChatError.noRelay.errorDescription ?? "You're signed out."
        case let error as AccountError:
            return error.errorDescription ?? "\(error)"
        case let error as URLError:
            return "Your cluster can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case let error as TeeTrustError:
            return "The node could not be verified: \(error.message)"
        default:
            return (error as? LocalizedError)?.errorDescription ?? "\(error)"
        }
    }

    /// A channel's `init` failing on an older chat build installed on the
    /// cluster (`unknown field \`context_type\``): nothing on the phone fixes
    /// it; the app instance has to be upgraded.
    static func outdatedChat(in text: String) -> String? {
        if text.contains("unknown field `context_type`") || text.contains("failed to deserialize arguments") {
            return "This workspace runs an older Mero Chat that can't create channels from this app. "
                + "Its app instances have to be upgraded to the current Mero Chat (see Approvals)."
        }
        return nil
    }

    /// The words inside an error, whatever wraps them.
    private static func rawText(_ error: Error) -> String {
        if let error = error as? CalimeroError { return error.message }
        return "\(error)"
    }
}
