import Foundation
import MeroKit

/// Errors in words a person can act on.
public enum ErrorText {
    /// `error` while trying to `doing` ("load your teams").
    public static func describe(_ error: Error, doing: String) -> String {
        if let error = error as? LocalizedError, let text = error.errorDescription, !text.isEmpty,
            error is CalendarError || error is DraftError
        {
            return text
        }
        if let error = error as? AppError { return app(error) }
        if let text = cluster(error) { return text }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost:
                return "You're offline. Couldn't \(doing)."
            default: break
            }
        }
        let raw = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        let lower = raw.lowercased()
        if lower.contains("not signed in") {
            return "You're signed out. Sign in again to \(doing)."
        }
        if lower.contains("not the owner") || lower.contains("only the owner") || lower.contains("forbidden") {
            return "Only the event's owner can change it."
        }
        let trimmed = raw.count > 160 ? String(raw.prefix(160)) + "…" : raw
        return "Couldn't \(doing). \(trimmed)"
    }

    /// The calendar contract's refusals (`APP_ERROR` with its `{ code, fields }`).
    static func app(_ error: AppError) -> String {
        switch CalendarAppCode(rawValue: error.appCode) {
        case .notFound: return "That event no longer exists. It may have been deleted."
        case .forbidden: return "Only the event's owner can change it."
        case .invalid:
            let detail = error.fields["message"]?.stringValue ?? ""
            return detail.isEmpty ? "That isn't valid." : "That isn't valid: \(detail)."
        case .linkExists: return "A booking link already exists for this token."
        case .alreadyBooked: return "This link already booked a meeting. Reschedule it instead."
        case .linkCancelled: return "This link's meeting was cancelled. Ask for a new link."
        case .linkExpired: return "This booking link has expired."
        case .notBooked: return "This link has no booked meeting."
        case .slotUnavailable: return "That time isn't available."
        case nil: return error.message.isEmpty ? "The calendar refused that." : error.message
        }
    }

    /// The Calimero 1.0 node's typed errors, in words.
    static func cluster(_ error: Error) -> String? {
        switch error {
        case is SignedOutError: return "You're signed out. Sign in again."
        case is WrongNode: return "This node can't serve your account right now. Try again shortly."
        case is ConfirmCancelled: return "The passkey prompt was cancelled."
        case is LoginRequired: return "Your session ended. Sign in again."
        case is ReleaseDeadlineError:
            return "A newer node release needs approval before anything can change. Review it under Your Teams."
        case is ConsentStale: return "That approval request is out of date. Try again."
        case is NotFound: return "This isn't available to you (yet)."
        case let error as UnavailableError:
            return "Your cluster is unavailable right now (\(error.reason)). Try again shortly."
        default:
            // MeroKitUI's `PasskeyRequired` (a member or invite change made without the passkey at hand).
            if String(describing: type(of: error)) == "PasskeyRequired" {
                return "This needs your passkey. Sign in again and retry."
            }
            return nil
        }
    }
}
