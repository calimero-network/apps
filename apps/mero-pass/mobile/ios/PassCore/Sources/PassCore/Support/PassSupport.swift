import Foundation
import MeroKit

/// Constants shared with the web app and the contract.
public enum PassConstants {
    /// The registry package and invitation-link slug (`APP_PACKAGE` / `APP_SLUG` on the web).
    public static let packageName = "com.calimero.mero-pass"
    /// How often an open vault is re-read when the relay cannot stream events,
    /// and while this device waits for the vault key (the web's 5 seconds).
    public static let pollInterval: Duration = .seconds(5)
    /// Auto-lock choices in minutes, and the default (the web's `AUTO_LOCK_CHOICES`).
    public static let autoLockChoices = [1, 5, 15, 60]
    public static let defaultAutoLockMinutes = 5
    /// How long a copied secret stays on the clipboard (the web's `CLIPBOARD_CLEAR_MS`).
    public static let clipboardSeconds = 30
    /// Share-link lifetimes (the web's `ShareModal` `EXPIRY`).
    public static let shareExpiries: [(label: String, seconds: Int)] = [
        ("1 hour", 3600), ("1 day", 86_400), ("7 days", 604_800),
    ]
    /// The shortest share passphrase the web accepts.
    public static let minSharePassphrase = 6
}

/// Where a screen's first load stands.
public enum LoadPhase: Equatable, Sendable {
    case loading
    case loaded
    case failed(String)
}

/// An error already in words to show.
public enum PassModelError: Error, LocalizedError, Equatable {
    case message(String)

    public var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

/// A failure, in words a person can act on (the web's `describeError`, for
/// what a phone can hit).
public enum PassErrorText {
    public static func describe(_ error: Error) -> String {
        if let model = error as? PassModelError { return model.errorDescription ?? "Something went wrong." }
        if let session = error as? VaultSessionError { return session.errorDescription ?? "Something went wrong." }
        if let account = error as? AccountError, case .noRelay = account {
            return "No relay serves your account yet. Join a team from an invitation link to get one."
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
            return "The vault answered in a shape this app doesn't understand. Update the app and try again."
        }
        let text = (error as? LocalizedError)?.errorDescription ?? "\(error)"
        for (needles, words) in transient + reworded where needles.contains(where: { text.lowercased().contains($0) }) {
            return words
        }
        return text.isEmpty ? "Something went wrong. Try again." : text
    }

    /// The web's `TRANSIENT`: refusals that clear on their own while a vault
    /// just joined syncs, said in words.
    private static let transient: [([String], String)] = [
        (["not a member of this context"], "Your relay has not finished joining the vault yet."),
        (["awaiting state sync", "uninitialized"], "Your relay is still downloading the vault from its peers."),
        (["group key not yet delivered", "groupkeypending"], "Your relay is still waiting for the team key from a peer."),
        (["no owned identity"], "Your relay has no identity in the vault yet."),
    ]

    private static let reworded: [([String], String)] = [
        (["http 403", "forbidden"], "This session is not allowed to do that."),
        (["view-only"], "Your role in this vault can read, not change, its items."),
        (["only a vault admin", "admin only"], "Only a vault Admin can do that."),
        (["needs at least one admin"], "A vault needs at least one Admin. Promote someone else first."),
    ]

    /// A refusal that clears on its own while a vault just joined syncs.
    public static func isTransient(_ error: Error) -> Bool {
        let text = ((error as? LocalizedError)?.errorDescription ?? "\(error)").lowercased()
        return transient.contains { $0.0.contains { text.contains($0) } }
    }
}

extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// What this phone remembers outside the Keychain: never a secret.
public protocol PassPreferences: AnyObject, Sendable {
    var autoLockMinutes: Int { get set }
    /// The public half of this account's recovery key, once one was made or
    /// used here, so vaults opened later are given it too.
    var recoveryKey: RecoveryPublic? { get set }
}

public final class DefaultsPreferences: PassPreferences, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var autoLockMinutes: Int {
        get {
            let v = defaults.integer(forKey: "pass.autoLockMinutes")
            return PassConstants.autoLockChoices.contains(v) ? v : PassConstants.defaultAutoLockMinutes
        }
        set { defaults.set(newValue, forKey: "pass.autoLockMinutes") }
    }

    public var recoveryKey: RecoveryPublic? {
        get { defaults.data(forKey: "pass.recoveryKey").flatMap { try? JSONDecoder().decode(RecoveryPublic.self, from: $0) } }
        set { defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "pass.recoveryKey") }
    }
}

public final class MemoryPreferences: PassPreferences, @unchecked Sendable {
    public var autoLockMinutes = PassConstants.defaultAutoLockMinutes
    public var recoveryKey: RecoveryPublic?
    public init() {}
}
