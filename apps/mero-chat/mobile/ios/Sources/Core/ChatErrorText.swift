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
        if let outdated = outdatedRelay(in: rawText(error)) { return outdated }
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

    /// A relay too old for the chat it is asked to run says so in words that
    /// only make sense to its operator: an install refused for its runtime
    /// (`bundle requires runtime version 0.12.0-rc.1 but current runtime is
    /// 0.11.0-rc.90`), or a channel's `init` failing on an older chat build
    /// installed there (`unknown field \`context_type\``). Both need the relay
    /// upgraded; nothing on the phone fixes them, so say that.
    static func outdatedRelay(in text: String) -> String? {
        if text.contains("current runtime is") {
            let runtime = ApplicationRegistry.runtimeVersion(fromInstallError: text)
            let needed = text.range(of: #"requires runtime version [0-9A-Za-z.+-]+"#, options: .regularExpression)
                .map { String(text[$0].split(separator: " ").last ?? "") }
            let runs = runtime.map { "Calimero \($0)" } ?? "an older Calimero"
            let needs = needed.map { " Mero Chat needs \($0) or newer." } ?? ""
            return "Your relay runs \(runs), which can't install this version of Mero Chat.\(needs) "
                + "The relay has to be upgraded before a workspace can be created on it."
        }
        if text.contains("unknown field `context_type`") || text.contains("failed to deserialize arguments") {
            return "This workspace's relay runs an older Mero Chat that can't create channels from this app. "
                + "The relay has to be upgraded to the current Mero Chat."
        }
        return nil
    }

    /// The words inside an error, whatever wraps them.
    private static func rawText(_ error: Error) -> String {
        switch error {
        case AccountError.intentRefused(let reason, _, _): return reason
        case let failure as BootstrapFailure: return failure.reason
        default: return "\(error)"
        }
    }
}
