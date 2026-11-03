import Foundation
import MeroKit

// The generated client declares its own `ContextContractCalling` (it imports
// nothing); MeroKit's bound contract has exactly its two methods.
extension BoundContextContract: ContextContractCalling {}

extension UpdatesClient {
    /// The client for one audience (an app instance), over the account's
    /// cluster session, speaking the component ABI (``ComponentWire``).
    public init(backend: any MeroAppBackend, contextId: String) {
        self.init(transport: ComponentWire(backend.contract.bound(to: contextId)))
    }
}

extension PostCard: Identifiable {}
extension AskView: Identifiable {}
extension CommentView: Identifiable {}
extension CategoryView: Identifiable {}
extension DraftView: Identifiable {}
extension MetricSeries: Identifiable { public var id: String { name.lowercased() } }
extension PersonView: Identifiable { public var id: String { account } }
extension OfferView: Identifiable { public var id: String { "\(askId)|\(account)" } }
extension ContributionView: Identifiable { public var id: String { "\(askId)|\(account)" } }
extension EngagementRow: Identifiable { public var id: String { postId } }
extension ReaderView: Identifiable { public var id: String { account } }
extension ReactionCount: Identifiable { public var id: String { emoji } }

/// Words a person can act on, for any failure the app sees.
public enum ErrorText {
    public static func describe(_ error: Error) -> String {
        switch error {
        case is SignedOutError, AccountError.notSignedIn:
            return "You're signed out. Sign in again."
        case is LoginRequired:
            return "Your session ended. Sign in again."
        case is ConfirmCancelled:
            return "The passkey prompt was cancelled, so nothing changed."
        case is WrongNode:
            return "That node can't serve your account right now. Sign in again to reach your cluster."
        case is ReleaseDeadlineError:
            return "A newer node release needs approval before anything can change. Review it under Approvals."
        case is ConsentStale:
            return "That approval request is out of date. Try again."
        case let error as URLError:
            return "The cluster can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case let error as UnavailableError:
            return "The cluster is busy (\(error.reason)). Try again in a moment."
        case let error as AppError:
            return appError(code: error.appCode, message: error.fields["message"]?.stringValue ?? "")
        case let error as CalimeroError:
            return error.message.isEmpty ? "The node refused this (\(error.code))." : error.message
        case is DecodingError:
            return "The audience answered in a shape this app does not read. It may run a different version of Mero Updates."
        case let error as LocalizedError:
            // MeroKitUI's step-up guard (no passkey to approve a member or invite change).
            if String(describing: type(of: error)) == "PasskeyRequired" {
                return "This needs your passkey. Sign in again on this device and retry."
            }
            return error.errorDescription ?? "\(error)"
        default:
            return "\(error)"
        }
    }

    /// The contract's refusals (`422 APP_ERROR {code, fields: {message}}`):
    /// `NotFound`, `Invalid` and `Forbidden`, each with the contract's message.
    public static func appError(code: String, message: String) -> String {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            let s = text.prefix(1).uppercased() + text.dropFirst()
            return s.hasSuffix(".") ? s : s + "."
        }
        switch code {
        case "NotFound": return "That is no longer here. It may have been deleted."
        case "Forbidden": return "Only the company's team can do that."
        case "Invalid": return "Check what you entered and try again."
        default: return "Mero Updates refused that (\(code))."
        }
    }
}

public enum UpdatesError: LocalizedError, Equatable {
    case noApplication
    case notAnInvitation
    case noAudienceContext(String)

    public var errorDescription: String? {
        switch self {
        case .noApplication:
            return "Mero Updates is not installed for your account yet. Try again in a moment."
        case .notAnInvitation:
            return "That is not a Mero Updates invitation link."
        case .noAudienceContext(let name):
            return "“\(name)” has no audience context yet. It may still be syncing — refresh in a moment."
        }
    }
}

/// The contract's input limits, mirrored so a field stops where the contract would refuse.
public enum Limits {
    public static let title = 200
    public static let summary = 1000
    public static let name = 64
    public static let categoryName = 80
    public static let emoji = 8
    public static let companyName = 64
    public static let maxAsks = 10
}
