import Foundation
import MeroKit

/// Words a person can act on, for any failure the chat layer sees.
///
/// The SDK's refusals already carry the reason (a relay's refusal of an
/// intent, the step an invitation stopped at, why HA was refused), so this
/// mostly passes them through, and turns transport failures into "the relay
/// can't be reached".
enum ChatErrorText {
    static func describe(_ error: Error) -> String {
        switch error {
        case let error as ChatError:
            return error.errorDescription ?? "\(error)"
        case let failure as BootstrapFailure:
            return failure.reason
        case AccountError.intentRefused(let reason, _, let status):
            return "The relay refused this (\(status)): \(reason)"
        case AccountError.noRelay:
            return ChatError.noRelay.errorDescription ?? "No relay."
        case let error as AccountError:
            return error.errorDescription ?? "\(error)"
        case let error as URLError:
            return "The relay can't be reached (\(error.code.rawValue)). Check your connection and try again."
        case MeroError.network(let message):
            return "The relay can't be reached: \(message)"
        case MeroError.authRevoked:
            return "Your session was revoked. Sign out and sign in again."
        default:
            let classified = classifyError(error)
            if classified.status == 0 {
                return "The relay can't be reached: \(classified.message)"
            }
            return classified.message
        }
    }
}
