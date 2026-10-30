import Foundation
import ForumGenerated
import MeroKit

/// Constants shared with the web app (`app/src/lib/inviteLink.ts`) and the contract.
public enum ForumConstants {
    /// The registry package and invitation-link slug (`APP_SLUG` on the web).
    public static let packageName = "com.calimero.mero-forum"
    /// One page of the feed or of a thread, as on the web.
    public static let pageSize: UInt32 = 20
    /// How often an open forum is re-read when the node's event stream is down.
    public static let pollInterval: Duration = .seconds(10)
    /// The contract's limits (`MAX_TITLE`, `MAX_BODY`, `MAX_NICKNAME`).
    public static let maxTitle = 300
    public static let maxBody = 10_000
    public static let maxName = 64
}

/// MeroKit's bound contract, as the generated client's transport. The two
/// protocols have the same requirements (JSON bytes in and out); they are
/// separate types only because the generated file declares its own.
public struct ForumTransport: ForumGenerated.ContextContractCalling {
    public let bound: BoundContextContract

    public init(_ bound: BoundContextContract) { self.bound = bound }

    public func query(method: String, argsJSON: Data) async throws -> Data {
        try await bound.query(method: method, argsJSON: argsJSON)
    }

    public func execute(method: String, argsJSON: Data) async throws -> Data {
        try await bound.execute(method: method, argsJSON: argsJSON)
    }
}

extension ForumClient {
    /// The forum client for one app instance, over the account's sealed session.
    public static func make(contract: any ContextContract, contextId: String) -> ForumClient {
        ForumClient(transport: ForumTransport(contract.bound(to: contextId)))
    }
}

/// Where a forum lives: the space (org), the forum (team) and its app instance.
public struct ForumRef: Hashable, Sendable {
    public let namespaceId: String
    public let spaceName: String
    public let forumId: String
    public let forumName: String
    public let contextId: String

    public init(namespaceId: String, spaceName: String, forumId: String, forumName: String, contextId: String) {
        self.namespaceId = namespaceId
        self.spaceName = spaceName
        self.forumId = forumId
        self.forumName = forumName
        self.contextId = contextId
    }
}

/// Feed order: the contract's `sort` argument.
public enum FeedSort: String, CaseIterable, Sendable {
    case new
    case top

    public var label: String { self == .new ? "Latest" : "Top" }
}

/// Where a screen's first load stands.
public enum LoadPhase: Equatable, Sendable {
    case loading
    case loaded
    case failed(String)
}

/// The name this person posts under, kept on the device and pushed to each
/// forum's contract (`set_nickname`), as the web app keeps it in localStorage.
public protocol NameStore: AnyObject, Sendable {
    var name: String { get set }
}

/// ``NameStore`` in `UserDefaults`.
public final class DefaultsNameStore: NameStore, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = "forum.displayName") {
        self.defaults = defaults
        self.key = key
    }

    public var name: String {
        get { defaults.string(forKey: key) ?? "" }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: key) }
    }
}

/// ``NameStore`` in memory, for tests and previews.
public final class MemoryNameStore: NameStore, @unchecked Sendable {
    public var name: String
    public init(_ name: String = "") { self.name = name }
}

/// A failure, in words a person can act on.
public enum ForumErrorText {
    public static func describe(_ error: Error) -> String {
        if let account = error as? AccountError, case .noRelay = account {
            return "You're not connected to your cluster. Sign in again."
        }
        if let text = cluster(error) { return text }
        if let url = error as? URLError {
            switch url.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
                return "You're offline. Check your connection and try again."
            case .timedOut:
                return "Your cluster took too long to answer. Try again."
            default:
                return "Couldn't reach your cluster. Try again."
            }
        }
        if error is DecodingError {
            return "The forum answered in a shape this app doesn't understand. Update the app and try again."
        }
        let text = String(describing: (error as? LocalizedError)?.errorDescription ?? "\(error)")
        if text.localizedCaseInsensitiveContains("only a moderator") {
            return "Only a moderator can do that."
        }
        if text.localizedCaseInsensitiveContains("needs at least one moderator") {
            return "A forum needs at least one moderator."
        }
        return text.isEmpty ? "Something went wrong. Try again." : text
    }

    /// The Calimero 1.0 node's typed errors, in words.
    static func cluster(_ error: Error) -> String? {
        switch error {
        case is ConfirmCancelled: return "The passkey prompt was cancelled."
        case is LoginRequired: return "Your session ended. Sign in again."
        case is ReleaseDeadlineError:
            return "A newer node release needs approval before anything can change. Review it under Spaces."
        case is ConsentStale: return "That approval request is out of date. Try again."
        case is NotFound: return "This isn't available to you (yet)."
        case let error as UnavailableError:
            return "Your cluster is unavailable right now (\(error.reason)). Try again shortly."
        default: return nil
        }
    }
}
