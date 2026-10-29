import Foundation
import MeroKit

/// Constants shared with the web app and the contract.
public enum VoteConstants {
    /// The registry package and invitation-link slug (`APP_SLUG` on the web).
    public static let packageName = "com.calimero.mero-vote"
    /// How often an open screen is re-read when the relay cannot stream events.
    public static let pollInterval: Duration = .seconds(10)
    /// The contract's limits.
    public static let maxOptions = 16
    public static let maxTitle = 200
    public static let maxDescription = 4000
    public static let maxOption = 200
    public static let maxName = 64
}

extension VoteClient {
    /// The vote client for one context, over the account's relay.
    public static func make(contract: any ContextContract, contextId: String) -> VoteClient {
        VoteClient(transport: contract.bound(to: contextId))
    }
}

/// A voting group: one context running the contract, in a workspace (namespace).
public struct GroupRef: Hashable, Sendable {
    public let namespaceId: String
    public let workspaceName: String
    public let contextId: String

    public init(namespaceId: String, workspaceName: String, contextId: String) {
        self.namespaceId = namespaceId
        self.workspaceName = workspaceName
        self.contextId = contextId
    }
}

/// A poll opened from a group.
public struct PollRoute: Hashable, Sendable {
    public let group: GroupRef
    public let pollId: String

    public init(group: GroupRef, pollId: String) {
        self.group = group
        self.pollId = pollId
    }
}

/// Where a screen's first load stands.
public enum LoadPhase: Equatable, Sendable {
    case loading
    case loaded
    case failed(String)
}

/// An error already in words to show.
public enum VoteModelError: Error, LocalizedError, Equatable {
    case message(String)

    public var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

/// A failure, in words a person can act on.
public enum VoteErrorText {
    public static func describe(_ error: Error) -> String {
        if let model = error as? VoteModelError, case .message(let text) = model { return text }
        if let account = error as? AccountError, case .noRelay = account {
            return "No relay serves your account yet. Join a voting group from an invitation link to get one."
        }
        if let url = error as? URLError {
            switch url.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
                return "You're offline. Check your connection and try again."
            case .timedOut:
                return "The relay took too long to answer. Try again."
            default:
                return "Couldn't reach the relay. Try again."
            }
        }
        if error is DecodingError {
            return "The voting group answered in a shape this app doesn't understand. Update the app and try again."
        }
        let text = (error as? LocalizedError)?.errorDescription ?? "\(error)"
        return text.isEmpty ? "Something went wrong. Try again." : text
    }
}

/// Words and small numbers shared by the screens (Kotlin `VoteFormat`).
public enum VoteFormat {
    public static func phaseLabel(_ phase: Phase) -> String {
        switch phase {
        case .keyCeremony: return "Key ceremony"
        case .voting: return "Voting"
        case .closing: return "Closing"
        case .closed: return "Closed"
        }
    }

    /// The four steps a poll moves through, as the progress strip labels them.
    public static let steps: [(Phase, String)] = [
        (.keyCeremony, "Key ceremony"), (.voting, "Voting"), (.closing, "Closing"), (.closed, "Tally"),
    ]

    public static func stepIndex(_ phase: Phase) -> Int {
        steps.firstIndex { $0.0 == phase } ?? 0
    }

    /// "Pick exactly one." and the like, from the poll's bounds.
    public static func ruleText(min: UInt32, max: UInt32) -> String {
        if min == 1 && max == 1 { return "Pick exactly one." }
        if min == 0 { return "Pick up to \(max)." }
        return "Pick between \(min) and \(max)."
    }

    public static func isSingleChoice(_ def: PollDefinition) -> Bool { def.minChoices == 1 && def.maxChoices == 1 }

    /// `abcdef…1234`, as the web shortens ids.
    public static func short(_ id: String) -> String {
        id.count > 11 ? "\(id.prefix(6))…\(id.suffix(4))" : id
    }

    public static func initial(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? "?"
    }

    public static func count(_ n: Int, _ one: String, _ many: String) -> String {
        "\(n) \(n == 1 ? one : many)"
    }

    /// A stable avatar tone index for a seed.
    public static func tone(_ seed: String, tones: Int = 6) -> Int {
        var h: UInt32 = 2_166_136_261
        for b in seed.utf8 {
            h ^= UInt32(b)
            h = h &* 16_777_619
        }
        return Int(h % UInt32(tones))
    }

    /// A planned close (milliseconds since the epoch), in the device's words.
    public static func date(ms: UInt64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: date)
    }

    /// A share of the counted ballots, rounded (approval polls can sum past 100%).
    public static func percent(_ count: UInt64, of total: UInt64) -> Int {
        total == 0 ? 0 : Int((100 * Double(count) / Double(total)).rounded())
    }
}

extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
