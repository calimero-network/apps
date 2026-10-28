import Foundation
import MeroKit

/// Constants shared with the web app (`app/src/constants/config.ts`,
/// `app/src/lib/agreements.ts`) and the contract.
public enum SignConstants {
    /// The registry package and invitation-link slug (`PACKAGE_NAME` on the web).
    public static let packageName = "com.calimero.mero-sign"
    /// The metadata marker on the namespace that holds this account's private
    /// store (`PERSONAL_KIND`). Found by marker, never by name.
    public static let personalKind = "mero-sign:personal"
    /// The personal namespace's name (`PERSONAL_WORKSPACE_NAME`).
    public static let personalWorkspaceName = "Personal"
    /// The restricted subgroup the private context is bound to (`PERSONAL_GROUP_NAME`).
    public static let personalGroupName = "Private"
    /// The private context's `context_name` (`is_default_private_context` answers on it).
    public static let privateContextName = "default"
    /// How often an open agreement is re-read when the relay cannot stream events.
    public static let pollInterval: Duration = .seconds(10)
}

// MARK: - The contract client

extension SignClient {
    /// The contract client for one context, over the account's relay. The
    /// generated client takes MeroKit's `ContextContractCalling` directly.
    public static func make(contract: any ContextContract, contextId: String) -> SignClient {
        SignClient(transport: contract.bound(to: contextId))
    }
}

/// `[u8; 32]` ids as the contract hands them back: text (hex, or the base58 a
/// previous web build wrote) or a byte array. Either way, the lowercase hex
/// the contract's parsers take back (the web's `toHexId` / `toBlobIdHex`).
extension ContractBytes {
    public var hex: String {
        switch self {
        case .raw(let bytes): return Hex.encode(bytes)
        case .text(let text):
            let blob = SignIds.blobHex(text)
            return blob.isEmpty ? SignIds.hex(text) : blob
        }
    }
}

// MARK: - Ids

/// Ids as the contract takes them back: 32 bytes, lowercase hex.
public enum SignIds {
    /// An account or context id, trimmed and lowercased.
    public static func hex(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    public static func hex(_ value: ContractBytes) -> String { value.hex }

    public static func same(_ a: ContractBytes, _ b: String) -> Bool { same(a.hex, b) }

    public static func same(_ a: ContractBytes, _ b: ContractBytes) -> Bool { same(a.hex, b.hex) }

    public static func blobHex(_ value: ContractBytes) -> String { value.hex.count == 64 ? value.hex : "" }

    /// Whether two ids name the same thing.
    public static func same(_ a: String, _ b: String) -> Bool {
        let x = hex(a)
        return !x.isEmpty && x == hex(b)
    }

    /// A blob id as hex, also accepting the base58 a previous web build wrote
    /// (`toBlobIdHex`). Empty when it is neither.
    public static func blobHex(_ value: String) -> String {
        var trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("0x") { trimmed.removeFirst(2) }
        if trimmed.count == 64, trimmed.allSatisfy(\.isHexDigit) { return trimmed.lowercased() }
        if let bytes = InviteCodec.base58Decode(trimmed), bytes.count == 32 { return Hex.encode(bytes) }
        return ""
    }

    /// Shortened for display, keeping both ends (`shortId` on the web).
    public static func short(_ value: String) -> String {
        let id = hex(value)
        return id.count > 14 ? "\(id.prefix(8))…\(id.suffix(6))" : id
    }
}

// MARK: - Phases and errors

/// Where a screen's first load stands.
public enum LoadPhase: Equatable, Sendable {
    case loading
    case loaded
    case failed(String)
}

/// An error already in words to show.
public enum SignModelError: Error, LocalizedError, Equatable {
    case message(String)

    public var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

/// A failure, in words a person can act on.
public enum SignErrorText {
    public static func describe(_ error: Error) -> String {
        if let model = error as? SignModelError { return model.errorDescription ?? "" }
        if let account = error as? AccountError, case .noRelay = account {
            return "No relay serves your account yet. Open an invitation link to get one."
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
            return "The agreement answered in a shape this app doesn't understand. Update the app and try again."
        }
        let text = message(error)
        if isSyncing(text) { return "This agreement is still syncing to your account. Give it a moment and try again." }
        return text.isEmpty ? "Something went wrong. Try again." : text
    }

    /// The raw message of an error, for matching the contract's own words.
    public static func message(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? "\(error)"
    }

    /// A freshly joined context answers "Uninitialized" until its first sync.
    public static func isSyncing(_ text: String) -> Bool {
        text.localizedCaseInsensitiveContains("uninitialized") || text.localizedCaseInsensitiveContains("syncing state")
    }

    public static func isSyncing(_ error: Error) -> Bool { isSyncing(message(error)) }
}
