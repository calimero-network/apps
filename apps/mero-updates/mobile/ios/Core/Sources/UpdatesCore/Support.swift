import Foundation
import MeroKit

// The generated client declares its own `ContextContractCalling` (it imports
// nothing); MeroKit's bound contract has exactly its two methods.
extension BoundContextContract: ContextContractCalling {}

extension UpdatesClient {
    /// The client for one audience, over the account's relay.
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
        case AccountError.noRelay:
            return "No relay serves your account yet. Join a company with an invitation link first."
        case AccountError.intentRefused(let reason, _, let status):
            return "The relay refused this (\(status)): \(reason)"
        case let error as URLError:
            return "The relay can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case MeroError.network(let message):
            return "The relay can't be reached: \(message)"
        case MeroError.authRevoked:
            return "Your session was revoked. Sign out and sign in again."
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
