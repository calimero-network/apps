import Foundation
import MeroKit

/// Constants shared with the web app and the bundle. (Kotlin `Battleships`.)
public enum Battleships {
    /// The registry package and invitation-link slug (`PACKAGE` on the web).
    public static let packageName = "com.calimero.battleships"
    /// How often an open lobby or match is re-read: a safety net beside the event stream (a
    /// dropped event must not stall a match).
    public static let pollInterval: Duration = .seconds(5)
}

/// Why an action was refused before it reached the node, in words a person can act on.
public enum BattleshipsError: Error, Equatable, LocalizedError {
    case invalid(String)

    public var errorDescription: String? {
        switch self {
        case .invalid(let message): return message
        }
    }
}

/// What the screens run on: the session's ``MeroAppBackend`` (Calimero 1.0's
/// `CalimeroAppBackend`), or the demo's. A lobby is an organization with one app instance of the
/// package in it; every match is rows in that instance, keyed by match id.
public typealias BattleshipsBackend = MeroAppBackend

// MARK: - Errors in words

/// Errors as a person reads them: offline, signed out, the cluster busy, or what the contract
/// refused, by its `APP_ERROR` code (the web app's `messageOf`). (Kotlin `ErrorText`.)
public enum ErrorText {
    /// The contract's refusals in words, by error code (`Invalid` and `Forbidden` carry their own
    /// sentence, used when present).
    public static let appErrors: [String: String] = [
        "NotFound": "That match does not exist in this lobby.",
        "Invalid": "That is not allowed here.",
        "Forbidden": "You cannot do that in this match.",
        "Finished": "This match is already finished.",
        "MatchIdCollision": "Match id already exists. Try again.",
        "AlreadyCommitted": "Your fleet is already deployed.",
        "CommitmentMismatch": "That board does not match the fleet you deployed.",
    ]

    public static func describe(_ error: Error, fallback: String = "Something went wrong. Try again.") -> String {
        if let error = error as? BattleshipsError { return error.errorDescription ?? fallback }
        if let error = error as? AppError { return appMessage(code: error.appCode, fields: error.fields) ?? fallback }
        if error is ConfirmCancelled { return "You dismissed the passkey sheet, so nothing changed." }
        if error is ConfirmRequired { return "Approve this with your passkey to continue." }
        if error is SignedOutError || error is LoginRequired { return "Your session ended. Sign in again." }
        if error is WrongNode || error is NotLeader || error is UnavailableError {
            return "The cluster is busy. Try again in a moment."
        }
        if error is ReleaseDeadlineError { return "A node update is waiting for approval. Open Approvals to review it." }
        if error is ConsentStale { return "That approval expired. Start it again." }
        if error is NotFound { return "That's no longer there, or you're not in it." }
        if let error = error as? URLError {
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost, .timedOut:
                return "You're offline. Check your connection and try again."
            default: break
            }
        }
        let raw = "\(error)".lowercased()
        if raw.contains("offline") || raw.contains("timed out") {
            return "You're offline. Check your connection and try again."
        }
        return fallback
    }

    /// One line for an `APP_ERROR`: its `message` field when it carries one, else the code's words.
    public static func appMessage(code: String, fields: [String: JSONValue] = [:]) -> String? {
        if let message = fields["message"]?.stringValue?.trimmingCharacters(in: .whitespaces), !message.isEmpty {
            let sentence = message.prefix(1).uppercased() + message.dropFirst()
            return sentence.hasSuffix(".") ? sentence : sentence + "."
        }
        return appErrors[code]
    }

    /// Whether the contract refused because the match is over.
    public static func isFinished(_ error: Error) -> Bool {
        (error as? AppError)?.appCode == "Finished"
    }

    /// Whether a shot was refused because the opponent has not placed a fleet yet.
    public static func isOpponentNotReady(_ error: Error) -> Bool {
        guard let error = error as? AppError, error.appCode == "Invalid" else { return false }
        return (error.fields["message"]?.stringValue ?? "").lowercased().contains("place ships")
    }
}

/// How a person is shown: a short handle from their key, until a name is known. (Kotlin `Names`.)
public enum Names {
    public static func short(_ key: String) -> String {
        guard key.count > 10 else { return key }
        return "\(key.prefix(6))…\(key.suffix(4))"
    }

    /// "You", the name they set in the lobby's organization, or "Player 3fa2c1".
    public static func player(_ key: String, me: String?, names: [String: String] = [:]) -> String {
        if let me, key.lowercased() == me.lowercased() { return "You" }
        if let name = names[key]?.trimmingCharacters(in: .whitespaces), !name.isEmpty { return name }
        return "Player \(key.prefix(6))"
    }

    public static func lobby(_ namespace: AppNamespace) -> String {
        if let name = namespace.name?.trimmingCharacters(in: .whitespaces), !name.isEmpty { return name }
        return "Lobby \(namespace.id.prefix(6))"
    }
}

/// Where a screen's first load stands.
public enum LoadPhase: Equatable, Sendable {
    case loading
    case loaded
    case failed(String)
}

/// A match as the lobby lists it and the match screen opens it: the lobby's app instance and the
/// match's id in it. (Kotlin `MatchRef`.)
public struct MatchRef: Hashable, Sendable {
    public let namespaceId: String
    public let appId: String
    public let matchId: String
    public let opponent: String

    public init(namespaceId: String, appId: String, matchId: String, opponent: String) {
        self.namespaceId = namespaceId
        self.appId = appId
        self.matchId = matchId
        self.opponent = opponent
    }
}

/// Sleep that a cancelled task wakes from.
func pause(_ duration: Duration) async {
    try? await Task.sleep(for: duration)
}
