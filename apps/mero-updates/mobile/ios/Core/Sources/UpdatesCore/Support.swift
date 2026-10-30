import Foundation
import MeroKit

// The generated client declares its own `ContextContractCalling` (it imports
// nothing); MeroKit's bound contract has exactly its two methods.
extension BoundContextContract: ContextContractCalling {}

extension UpdatesClient {
    /// The client for one audience, over the account's node session.
    public init(backend: any MeroAppBackend, contextId: String) {
        self.init(transport: backend.contract.bound(to: contextId))
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
        case let error as URLError:
            return "The cluster can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case let error as UnavailableError:
            return "The cluster is busy (\(error.reason)). Try again in a moment."
        case let error as AppError:
            return error.message.isEmpty ? error.appCode : error.message
        case let error as CalimeroError:
            return error.message.isEmpty ? "The node refused this (\(error.code))." : error.message
        case is DecodingError:
            return "The audience answered in a shape this app does not read. It may run a different version of Mero Updates."
        case let error as LocalizedError:
            return error.errorDescription ?? "\(error)"
        default:
            return "\(error)"
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
