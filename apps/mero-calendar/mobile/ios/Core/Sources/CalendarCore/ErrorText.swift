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
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost:
                return "You're offline. Couldn't \(doing)."
            default: break
            }
        }
        let raw = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        let lower = raw.lowercased()
        if lower.contains("norelay") || lower.contains("no relay") {
            return "Your account isn't on a relay yet. Open an invitation link to join a team."
        }
        if lower.contains("not the owner") || lower.contains("only the owner") || lower.contains("forbidden") {
            return "Only the event's owner can change it."
        }
        let trimmed = raw.count > 160 ? String(raw.prefix(160)) + "…" : raw
        return "Couldn't \(doing). \(trimmed)"
    }
}
