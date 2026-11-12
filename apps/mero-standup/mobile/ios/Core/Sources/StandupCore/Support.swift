import Foundation
import MeroKit

extension StandupClient {
    /// The client for one team (app instance), over the account's cluster session.
    public init(backend: any MeroAppBackend, contextId: String) {
        self.init(backend: backend, app: contextId)
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
        case is SignedOutError, AccountError.notSignedIn:
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
            return app(error)
        case is WrongNode:
            return "This node can't serve your account right now. Try again shortly."
        case let error as CalimeroError:
            return "The node refused this (\(error.status)): \(error.message.isEmpty ? error.code : error.message)"
        case let error as URLError:
            return "Your cluster can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case is DecodingError:
            return "The team answered in a shape this app does not read. It may run a different version of Mero Standup."
        case let error as LocalizedError:
            // MeroKitUI's `PasskeyRequired` (a member or invite change made without the passkey at hand).
            if String(describing: type(of: error)) == "PasskeyRequired" {
                return "This needs your passkey. Sign in again and retry."
            }
            return error.errorDescription ?? "\(error)"
        default:
            return "\(error)"
        }
    }

    /// The standup contract's refusals (`APP_ERROR` with its `{ code, fields }`).
    public static func app(_ error: AppError) -> String {
        func field(_ name: String) -> String { error.fields[name]?.stringValue ?? "" }
        let label = { (raw: String) in raw.isEmpty ? "That field" : raw.prefix(1).uppercased() + raw.dropFirst() }
        switch StandupAppCode(rawValue: error.appCode) {
        case .notADate: return "\(field("day").isEmpty ? "That" : field("day")) isn't a day."
        case .tooLong:
            let limit = error.fields["limit"]?.intValue.map(String.init) ?? ""
            return "\(label(field("field"))) is too long\(limit.isEmpty || limit == "0" ? "" : " (at most \(limit) characters)")."
        case .empty: return "\(label(field("field"))) can't be empty."
        case .tooMany: return "Too many \(field("field").isEmpty ? "items" : field("field"))."
        case .noUpdate: return "You haven't posted an update for that day."
        case .noSuchUpdate: return "That update no longer exists."
        case .noBlocker: return "That update has no blocker to help with."
        case .ownBlocker: return "You can't offer help with your own blocker."
        case .noHelp: return "You haven't offered help there."
        case .noSuchDecision: return "That decision no longer exists."
        case .alreadySuperseded: return "That decision was already replaced by a newer one."
        case nil: return error.message.isEmpty ? error.appCode : error.message
        }
    }
}
