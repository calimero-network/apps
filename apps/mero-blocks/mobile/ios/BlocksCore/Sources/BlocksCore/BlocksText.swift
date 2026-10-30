import Foundation
import MeroKit

/// The app's fixed values, shared with the web app and the contract's bundle.
public enum BlocksConstants {
    /// The bundle's package id (`logic/Cargo.toml`), which is also the invitation link slug.
    public static let packageName = "com.calimero.mero-blocks"
    /// What a new world is called when the field is left empty (the web app's default).
    public static let defaultWorldName = "overworld"
    /// The web app's limits on the two names.
    public static let worldNameMax = 24
    public static let playerNameMax = 16
    /// What a player is called until they pick a name (the web app's default).
    public static let defaultPlayerName = "Player"
    /// Seeds are read by the clients as unsigned 32-bit integers (`logic` `init` docs).
    public static let seedRange: ClosedRange<UInt64> = 1...4_294_967_295
    /// Look sensitivity: the game multiplies its drag-to-look speed by this.
    public static let sensitivityRange: ClosedRange<Double> = 0.3...3
    public static let defaultSensitivity: Double = 1
}

public enum BlocksError: Error, LocalizedError, Equatable {
    case signedOut
    case noApplication
    case notAnInvitation
    case noWorldInInvitation

    public var errorDescription: String? {
        switch self {
        case .signedOut: return "You're signed out. Sign in again to play."
        case .noApplication: return "Mero Blocks is not published on this cluster yet."
        case .notAnInvitation: return "That doesn't look like a Mero Blocks invitation link."
        case .noWorldInInvitation: return "The invitation does not reference a world."
        }
    }
}

public enum BlocksText {
    /// An error as one sentence. A contract refusal is already written for a player, so it is
    /// shown as it came.
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
        if let described = (error as? LocalizedError)?.errorDescription, !described.isEmpty { return described }
        let text = String(describing: error)
        return text.isEmpty ? "Something went wrong talking to your cluster." : text
    }

    /// A readable short form of an id nobody named.
    public static func shortId(_ id: String) -> String {
        id.count > 12 ? "\(id.prefix(6))…\(id.suffix(4))" : id
    }

    /// "Nobody online", "1 playing", "3 playing".
    public static func online(_ count: Int?) -> String? {
        guard let count else { return nil }
        return count == 0 ? "Nobody playing" : "\(count) playing"
    }

    /// A trimmed player name, never empty, at most the web app's 16 characters.
    public static func playerName(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? BlocksConstants.defaultPlayerName : String(trimmed.prefix(BlocksConstants.playerNameMax))
    }

    /// A trimmed world name, never empty, at most the web app's 24 characters.
    public static func worldName(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? BlocksConstants.defaultWorldName : String(trimmed.prefix(BlocksConstants.worldNameMax))
    }

    /// The seed typed into the field, or nil for "pick one" (empty or not a number in range).
    public static func seed(_ raw: String) -> UInt64? {
        guard let value = UInt64(raw.trimmingCharacters(in: .whitespacesAndNewlines)),
            BlocksConstants.seedRange.contains(value)
        else { return nil }
        return value
    }
}

func nowSeconds() -> UInt64 { UInt64(Date().timeIntervalSince1970) }
