import Foundation
import MeroKit

/// App-wide constants. Same values as the Android app's `MerrariaConstants`.
public enum MerrariaConstants {
    /// The contract's package, which is also the invitation links' slug (`logic/Cargo.toml`).
    public static let packageName = "com.calimero.merraria"
    /// The web app's defaults (`app/src/ui/landing.ts`).
    public static let defaultWorldName = "surface"
    public static let defaultPlayerName = "Player"
    public static let maxWorldName = 24
    public static let maxPlayerName = 16
    /// The game's view scale on a phone: tiles a thumb can hit (the web's 0.6–1.6 range).
    public static let defaultZoom = 1.3
    public static let zoomRange: ClosedRange<Double> = 0.6...1.6

    /// A seed for a new world: positive, small enough for the engine's 32-bit noise.
    public static func randomSeed() -> UInt64 { UInt64.random(in: 1...999_999) }

    /// A seed typed by the player, as the web app reads it: `abs(floor(n))`, else `fallback`.
    public static func seed(from text: String, fallback: UInt64) -> UInt64 {
        guard let value = Double(text.trimmingCharacters(in: .whitespaces)), value.isFinite else { return fallback }
        let whole = abs(value.rounded(.down))
        guard whole >= 1, whole < Double(UInt32.max) else { return fallback }
        return UInt64(whole)
    }
}

/// Seconds since the epoch: every `now` the contract takes (the web app's `nowSecs`).
public func nowSeconds() -> UInt64 { UInt64(Date().timeIntervalSince1970) }

public enum MerrariaError: Error, LocalizedError, Equatable {
    case signedOut
    case noApplication
    case notAnInvitation
    case noWorld
    case noNamespace

    public var errorDescription: String? {
        switch self {
        case .signedOut: return "You're signed out. Sign in again to play."
        case .noApplication: return "Merraria is not published on this cluster yet."
        case .notAnInvitation: return "That is not a Merraria invitation link."
        case .noWorld: return "The invitation does not name a world, and none was found in it yet. Try again in a moment."
        case .noNamespace: return "This world's organization is not known on this device yet. Refresh the list and try again."
        }
    }
}

/// Player-facing copy shared by both platforms.
public enum MerrariaText {
    /// An error as one readable sentence.
    public static func error(_ error: Error) -> String {
        switch error {
        case let error as ReleaseDeadlineError:
            let release = error.release.isEmpty ? "a node release" : "node release \(error.release)"
            return "Your cluster takes no new work until \(release) is approved. Review it under Needs your approval."
        case is NotFound:
            return "This isn't shared with you, or it was deleted."
        case is LoginRequired, is SignedOutError:
            return "Your session ended. Sign in again."
        case is WrongNode:
            return "This node doesn't serve your world. Try another node of the cluster."
        case let error as UnavailableError:
            return "Your cluster is busy (\(error.reason)). Try again shortly."
        case let error as AppError:
            return error.message.isEmpty ? error.appCode : error.message
        case let error as CalimeroError:
            return error.message.isEmpty ? error.code : error.message
        default:
            break
        }
        if let error = error as? LocalizedError, let text = error.errorDescription { return text }
        if let error = error as? URLError { return error.localizedDescription }
        return String(describing: error)
    }

    /// `ab12…cd34` for an id.
    public static func shortId(_ id: String) -> String {
        id.count <= 12 ? id : "\(id.prefix(6))…\(id.suffix(4))"
    }

    public static func players(_ count: Int) -> String {
        count == 1 ? "1 player" : "\(count) players"
    }
}

extension MerrariaClient {
    /// `MerrariaClient` for `contextId` in the account's backend.
    public static func bound(_ backend: any MeroAppBackend, contextId: String) -> MerrariaClient {
        MerrariaClient(transport: backend.contract.bound(to: contextId))
    }
}
