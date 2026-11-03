import Foundation
import MeroKit

/// Names and fixed values shared with the web app (`app/src/config.ts`).
public enum MeroSheets {
    /// The registry package: what workspaces are founded with and invitation links carry.
    public static let packageName = "com.calimero.mero-sheets"
    /// How often to re-read while the node's event stream is not available.
    public static let pollInterval: TimeInterval = 5
    /// The tab a new spreadsheet starts with, as on the web.
    public static let firstSheetName = "Sheet 1"
}

/// Pure presentation helpers, the twins of `app/src/lib/time.ts` and friends.
public enum SheetsFormat {
    /// "just now", "5 min ago", "3 h ago", "2 d ago", then a date, from a node
    /// timestamp in nanoseconds (`app/src/lib/time.ts`).
    public static func ago(ns: UInt64, now: Date = Date()) -> String {
        guard ns > 0 else { return "" }
        let ms = Double(ns / 1_000_000)
        let s = max(0, Int(((now.timeIntervalSince1970 * 1000 - ms) / 1000).rounded()))
        if s < 45 { return "just now" }
        let m = Int((Double(s) / 60).rounded())
        if m < 60 { return "\(m) min ago" }
        let h = Int((Double(m) / 60).rounded())
        if h < 24 { return "\(h) h ago" }
        let d = Int((Double(h) / 24).rounded())
        if d < 7 { return "\(d) d ago" }
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy"
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    /// `4f8a…c2e1` for a hex key; anything that is not one passes through.
    public static func truncateKey(_ key: String) -> String {
        guard key.count >= 32, !key.contains(" ") else { return key }
        return "\(key.prefix(4))…\(key.suffix(4))"
    }

    /// Index into the eight avatar swatches, stable per seed (the web's `avatarColor`).
    public static func swatch(seed: String) -> Int {
        var h: Int32 = 0
        for unit in seed.utf16 { h = h &* 31 &+ Int32(unit) }
        return Int(h.magnitude % 8)
    }

    /// Plain words for a failure: Calimero 1.0's errors and the contract's own
    /// (`422 APP_ERROR` with `NotFound` / `Invalid` / `Forbidden` and `fields.message`).
    public static func errorText(_ error: Error) -> String {
        let text = String(describing: error)
        if error is SignedOutError || text.contains("noRelay") { return "You're signed out. Sign in again." }
        if error is PasskeyCancelled || error is ConfirmCancelled { return "You cancelled the passkey prompt, so nothing changed." }
        if error is ConfirmRequired { return "This needs your passkey. Open the app again and retry." }
        if error is LoginRequired { return "Your session ended. Sign in again." }
        if error is WrongNode { return "This node can't serve your account right now. Try again." }
        if let busy = error as? UnavailableError { return "The cluster is busy (\(busy.reason)). Try again in a moment." }
        if let stall = error as? ReleaseDeadlineError {
            let release = stall.release.isEmpty ? "a node release" : "node release \(stall.release)"
            return "Your workspace has to approve \(release) first. Open Workspace, then Approvals."
        }
        if error is ConsentStale { return "That approval expired. Start it again." }
        if let app = error as? AppError { return appErrorText(code: app.appCode, fields: app.fields, message: app.message) }
        if let node = error as? CalimeroError, !node.message.isEmpty { return node.message }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost:
                return "You are offline. Check your connection and try again."
            case .timedOut:
                return "The cluster took too long to answer. Try again."
            default:
                break
            }
        }
        let described = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        return described.isEmpty ? "Something went wrong. Try again." : described
    }

    /// The contract's refusal (`APP_ERROR {code, fields}`) in plain words: its
    /// own `fields.message` when it gave one, else a sentence for the code.
    public static func appErrorText(code: String, fields: [String: JSONValue], message: String) -> String {
        if let own = fields["message"]?.stringValue?.trimmingCharacters(in: .whitespaces), !own.isEmpty { return own }
        switch code {
        case "NotFound": return "That is no longer in the spreadsheet. Pull to refresh."
        case "Forbidden": return "Your role in this spreadsheet doesn't allow that."
        case "Invalid": return "That value isn't accepted here."
        default: return message.isEmpty ? (code.isEmpty ? "The spreadsheet refused that change." : code) : message
        }
    }
}
