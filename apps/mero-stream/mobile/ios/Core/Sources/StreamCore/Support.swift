import Foundation
import MeroKit

/// Words a person can act on, for any failure the app sees.
public enum ErrorText {
    public static func describe(_ error: Error) -> String {
        switch error {
        case is ConfirmCancelled, is PasskeyCancelled:
            return "The passkey prompt was cancelled. Nothing changed."
        case is ConfirmRequired:
            return "This needs your passkey. Try again and approve it when asked."
        case is ConsentStale:
            return "That approval is out of date. Refresh and review it again."
        case let error as ReleaseDeadlineError:
            let release = error.release.isEmpty ? "a node release" : "node release \(error.release)"
            return "Your cluster takes no new work until \(release) is approved. Review it under Needs your approval."
        case is NotFound:
            return "This isn't shared with you, or it was deleted."
        case is LoginRequired, is SignedOutError:
            return "Your session ended. Sign in again."
        case is WrongNode:
            return "This node doesn't serve your stream. Try another node of the cluster."
        case let error as UnavailableError:
            return "Your cluster is busy (\(error.reason)). Try again shortly."
        case let error as AppError:
            return appError(error)
        case let error as CalimeroError:
            return error.message.isEmpty ? error.code : error.message
        case let error as URLError:
            return "Your cluster can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case is DecodingError:
            return "The room answered in a shape this app does not read. It may run a different version of Mero Stream."
        case let error as LocalizedError:
            return error.errorDescription ?? "\(error)"
        default:
            return "\(error)"
        }
    }
}

extension ErrorText {
    /// The room contract's typed refusals (`#[app::error]` in `logic`), in words.
    static func appError(_ error: AppError) -> String {
        func field(_ name: String) -> String {
            error.fields[name].flatMap { $0.stringValue ?? $0.intValue.map(String.init) } ?? "?"
        }
        switch error.appCode {
        case "NotJoined": return "Join the room before you take part in its call."
        case "NotOwner": return "Only the person who created this room can do that."
        case "ZeroDimension", "DimensionTooLarge": return "The camera picture has a size the room does not take."
        case "RawTooLarge", "ChunkTooLarge": return "A frame was too large for the room (limit \(field("max")) bytes)."
        case "RawLengthMismatch", "EmptyChunk": return "The room refused a frame of the wrong length."
        case "BadBase64", "CodecRequired": return "The room refused a malformed frame."
        case "": return error.message.isEmpty ? "The room refused this." : error.message
        default: return error.message.isEmpty ? error.appCode : error.message
        }
    }
}

public enum StreamError: LocalizedError, Equatable {
    case noApplication
    case notAnInvitation
    case noRoomContext(String)
    case noPresence

    public var errorDescription: String? {
        switch self {
        case .noApplication:
            return "Mero Stream is not installed for your account yet. Try again in a moment."
        case .notAnInvitation:
            return "That is not a Mero Stream invitation link."
        case .noRoomContext(let name):
            return "“\(name)” has no call yet. It may still be replicating; refresh in a moment."
        case .noPresence:
            return "This session can't carry live media yet: it is not connected to the cluster. Sign out and in again."
        }
    }
}

/// Wall clock in unix milliseconds.
public func nowMillis() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }
