import Foundation
import MeroKit

/// Copy, names and formatting shared by every screen. (Kotlin `ModelsFormat`.)
public enum ModelsFormat {
    /// The app's registry package, the deep-link slug and the invitation path
    /// (`APP_SLUG` in the web app).
    public static let packageName = "com.calimero.mero-models"

    /// `ab12…ef90`: an id short enough to show (the web's `shortId`).
    public static func shortId(_ id: String) -> String {
        id.count <= 12 ? id : "\(id.prefix(6))…\(id.suffix(4))"
    }

    /// Initials for an avatar: the first letters of the first two words.
    public static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0 == " " || $0 == "_" || $0 == "-" || $0 == "." })
        let out = String(words.prefix(2).compactMap(\.first)).uppercased()
        return out.isEmpty ? "?" : out
    }

    /// The name a member chose for the scene. The web joins an unnamed member
    /// as "Guest", so that placeholder is no name.
    public static func chosenName(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty || trimmed == "Guest" ? nil : trimmed
    }

    /// What the web's Add menu calls each kind.
    public static func kindLabel(_ kind: String) -> String {
        switch kind {
        case "cube": return "Cube"
        case "sphere": return "UV Sphere"
        case "icosphere": return "Ico Sphere"
        case "cylinder": return "Cylinder"
        case "cone": return "Cone"
        case "torus": return "Torus"
        case "plane": return "Plane"
        case "capsule": return "Capsule"
        case "mesh": return "Mesh"
        case "group": return "Empty"
        case "point_light": return "Point light"
        case "spot_light": return "Spot light"
        case "directional_light": return "Sun"
        default: return kind.capitalized
        }
    }

    public static func isLight(_ kind: String) -> Bool {
        kind == "point_light" || kind == "spot_light" || kind == "directional_light"
    }

    /// "now", "5m ago", "3h ago", "2d ago", or a date, from unix milliseconds.
    public static func relativeTime(_ ms: UInt64, now: Date = Date()) -> String {
        let then = Date(timeIntervalSince1970: Double(ms) / 1000)
        let seconds = max(0, now.timeIntervalSince(then))
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h ago" }
        if seconds < 7 * 86_400 { return "\(Int(seconds / 86_400))d ago" }
        return date(ms)
    }

    /// When a check-out lapses: a time today, else a day and a time.
    public static func until(_ ms: UInt64, now: Date = Date(), timeZone: TimeZone = .current) -> String {
        let then = Date(timeIntervalSince1970: Double(ms) / 1000)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = calendar.isDate(then, inSameDayAs: now) ? "HH:mm" : "d MMM, HH:mm"
        return f.string(from: then)
    }

    public static func date(_ ms: UInt64, timeZone: TimeZone = .current) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = "d MMM yyyy"
        return f.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
    }

    /// "1 object", "12 objects".
    public static func count(_ n: Int, _ noun: String) -> String {
        n == 1 ? "1 \(noun)" : "\(n) \(noun)s"
    }

    /// "1.2k", "3.4M": triangle counts.
    public static func compact(_ n: Int) -> String {
        if n < 1000 { return "\(n)" }
        if n < 1_000_000 { return trim(Double(n) / 1000) + "k" }
        return trim(Double(n) / 1_000_000) + "M"
    }

    private static func trim(_ v: Double) -> String {
        let s = String(format: "%.1f", v)
        return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
    }

    /// Words a person can act on, from an error (the node's typed 1.0 errors first).
    public static func errorText(_ error: Error) -> String {
        switch error {
        case let error as ReleaseDeadlineError:
            let release = error.release.isEmpty ? "a node release" : "node release \(error.release)"
            return "Your cluster takes no new work until \(release) is approved. Review it under Needs your approval."
        case is NotFound:
            return "This isn't shared with you, or it was deleted."
        case is LoginRequired:
            return "Your session ended. Sign in again."
        case is WrongNode:
            return "This node doesn't serve your studio. Try another node of the cluster."
        case let error as UnavailableError:
            return "Your cluster is busy (\(error.reason)). Try again shortly."
        case let error as AppError:
            return error.message.isEmpty ? error.appCode : error.message
        case let error as CalimeroError:
            return error.message.isEmpty ? error.code : error.message
        default:
            break
        }
        let text = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        if let url = error as? URLError, url.code == .notConnectedToInternet {
            return "You're offline. Check your connection and try again."
        }
        return text
    }
}
