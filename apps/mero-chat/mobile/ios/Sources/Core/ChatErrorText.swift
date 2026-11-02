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
        case is ConfirmCancelled, is PasskeyCancelled:
            return "You dismissed the passkey prompt, so nothing changed."
        case is LoginRequired:
            return "Your session ended. Sign in again."
        case is ReleaseDeadlineError:
            return "A newer node release needs approval before anything can change. Review it under Approvals."
        case is ConsentStale:
            return "That approval request is out of date. Try again."
        case is NotFound:
            return "This isn't available to you (yet)."
        case is WrongNode:
            return "This node runs a release your account hasn't approved. Try another node of the cluster."
        case is UnavailableError:
            return "Your cluster can't be reached right now. Try again shortly."
        case let error as AppError:
            return appError(code: error.appCode, message: error.fields["message"]?.stringValue ?? error.message)
        case let error as CalimeroError:
            return error.message.isEmpty ? error.code : "\(error.message) (\(error.status))"
        case is SignedOutError, AccountError.notSignedIn:
            return ChatError.noRelay.errorDescription ?? "You're signed out."
        case let error as AccountError:
            return error.errorDescription ?? "\(error)"
        case let error as URLError:
            return "Your cluster can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case let error as TeeTrustError:
            return "The node could not be verified: \(error.message)"
        case let error as DirectoryError:
            return "No cluster called \"\(error.cluster)\" was found. Check the name, or paste a node address."
        default:
            return (error as? LocalizedError)?.errorDescription ?? "\(error)"
        }
    }

    /// The contract's refusals (`logic/res/abi.json`: `Invalid`, `Forbidden`,
    /// `NotFound`, `Banned`, each carrying v1's text in `message`): its own
    /// words when it sent them, else words for the code.
    static func appError(code: String, message: String?) -> String {
        if let message, !message.isEmpty, code.isEmpty || message != "app error" { return message }
        switch code {
        case "Forbidden": return "You can't do that in this channel."
        case "Banned": return "You've been removed from this channel."
        case "NotFound": return "That message no longer exists."
        case "Invalid": return "The channel refused that request."
        default: return code.isEmpty ? "The channel refused that request." : code
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
