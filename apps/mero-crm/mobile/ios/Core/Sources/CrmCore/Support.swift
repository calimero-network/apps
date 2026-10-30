@_exported import CrmGenerated
import Foundation
import MeroKit

/// The generated client declares its own `ContextContractCalling` (it imports
/// nothing); MeroKit's bound contract has exactly its two methods. This is the
/// bridge between the two.
public struct CrmTransport: CrmGenerated.ContextContractCalling {
    public let inner: any MeroKit.ContextContractCalling

    public init(_ inner: any MeroKit.ContextContractCalling) {
        self.inner = inner
    }

    public func query(method: String, argsJSON: Data) async throws -> Data {
        try await inner.query(method: method, argsJSON: argsJSON)
    }

    public func execute(method: String, argsJSON: Data) async throws -> Data {
        try await inner.execute(method: method, argsJSON: argsJSON)
    }
}

extension CrmClient {
    /// The client for one pipeline (one context), over the account's node session.
    public init(backend: any MeroAppBackend, contextId: String) {
        self.init(transport: CrmTransport(backend.contract.bound(to: contextId)))
    }
}

extension DealView: Identifiable {}
extension ContactView: Identifiable {}
extension ActivityView: Identifiable {}
extension AutomationView: Identifiable {}
extension StageView: Identifiable {}
extension NoteView: Identifiable {}

/// Accounts as the app sees them. The session names an account in hex, a
/// contract stamps `created_by` / `author` in base58, and the web app stores a
/// deal's `owner` as whichever its node reported; every comparison goes
/// through ``canonical(_:)`` (the web's `canonicalAccount`).
public enum Account {
    /// 64 lowercase hex for either spelling of a 32-byte account, else nil.
    public static func canonical(_ id: String?) -> String? {
        guard let s = id?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        if s.count == 64, s.allSatisfy(\.isHexDigit) { return s.lowercased() }
        guard let data = InviteCodec.base58Decode(s), data.count == 32 else { return nil }
        return data.map { String(format: "%02x", $0) }.joined()
    }

    /// Whether two ids name the same account, whichever encoding each is in.
    public static func same(_ a: String?, _ b: String?) -> Bool {
        guard let ca = canonical(a) else { return false }
        return ca == canonical(b)
    }

    /// `5926f2…1334`: an id shortened for display when nothing names it.
    public static func short(_ id: String) -> String {
        let s = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.count > 11 else { return s }
        return "\(s.prefix(6))…\(s.suffix(4))"
    }
}

/// Errors the app raises itself.
public enum CrmError: LocalizedError, Equatable {
    case noApplication
    case notAnInvitation
    case invalidValue
    case invalidCurrency
    case pipelineNotReady

    public var errorDescription: String? {
        switch self {
        case .noApplication: return "Mero CRM is not installed for your account yet. Try again in a moment."
        case .notAnInvitation: return "That is not a Mero CRM invitation link."
        case .invalidValue: return "Value must be a number, e.g. 12000 or 12k."
        case .invalidCurrency: return "Use a three-letter currency code, e.g. USD or EUR."
        case .pipelineNotReady: return "This pipeline isn't ready yet. Try again in a moment."
        }
    }
}

/// Words a person can act on, for any failure the app sees.
public enum ErrorText {
    public static func describe(_ error: Error) -> String {
        switch error {
        case AccountError.noRelay, AccountError.notSignedIn:
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
            return "The pipeline answered in a shape this app does not read. It may run a different version of Mero CRM."
        case let error as LocalizedError:
            return error.errorDescription ?? "\(error)"
        default:
            return "\(error)"
        }
    }

    /// The two transient failures a context reports while its state is still
    /// replicating to this account (the web's `isContextWarmingUp`): show
    /// "syncing", not an error, and try again.
    public static func isWarmingUp(_ error: Error) -> Bool {
        let text = (describe(error) + " " + String(describing: error)).lowercased()
        return [
            "context state not initialized", "awaiting state sync", "group key not yet delivered",
            "uninitialized", "groupkeypending",
        ].contains { text.contains($0) }
    }
}
