import Foundation
import MeroKit

public enum DesignFormat {
    /// The app's registry package, the deep-link slug and the invitation path
    /// (`APP_SLUG` in the web app).
    public static let packageName = "com.calimero.mero-design"

    /// `ab12…ef90`: an id short enough to show.
    public static func shortId(_ id: String) -> String {
        id.count <= 12 ? id : "\(id.prefix(4))…\(id.suffix(4))"
    }

    /// Initials for an avatar: the first letters of the first two words.
    public static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0 == " " || $0 == "_" || $0 == "-" || $0 == "." })
        let letters = words.prefix(2).compactMap(\.first)
        let out = String(letters).uppercased()
        return out.isEmpty ? "?" : out
    }

    /// "now", "5m", "3h", "2d", or a date, from unix milliseconds.
    public static func relativeTime(_ ms: UInt64, now: Date = Date()) -> String {
        let then = Date(timeIntervalSince1970: Double(ms) / 1000)
        let seconds = max(0, now.timeIntervalSince(then))
        if seconds < 60 { return "now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h" }
        if seconds < 7 * 86_400 { return "\(Int(seconds / 86_400))d" }
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: then)
    }

    /// The link to a board, in the platform's deep-link form
    /// (`https://links.calimero.network/<package>/<action>?…`, as `createLink` builds).
    public static func boardLink(teamId: String, contextId: String) -> String {
        "https://links.calimero.network/\(packageName)/board?team=\(teamId)&board=\(contextId)"
    }

    /// The team and board a board link names, from its https or
    /// `calimero://<package>/board` form; `nil` for any other link.
    public static func parseBoardLink(_ raw: String) -> (teamId: String, contextId: String)? {
        guard let comps = URLComponents(string: raw.trimmingCharacters(in: .whitespaces)) else { return nil }
        let path = comps.path.split(separator: "/").map(String.init)
        let segments = comps.scheme == "calimero" ? [comps.host ?? ""] + path : path
        guard segments.count >= 2, segments[segments.count - 2] == packageName, segments.last == "board" else { return nil }
        let items = comps.queryItems ?? []
        guard let team = items.first(where: { $0.name == "team" })?.value, !team.isEmpty,
            let board = items.first(where: { $0.name == "board" })?.value, !board.isEmpty
        else { return nil }
        return (team, board)
    }

    /// Words a person can act on, from an error.
    public static func errorText(_ error: Error) -> String {
        if let cluster = clusterText(error) { return cluster }
        let text = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        if text.contains("view-only") { return "You have view-only access to this board. Ask an admin for edit access to comment." }
        if text.lowercased().contains("signed out") || text.lowercased().contains("not signed in") {
            return "You're signed out. Sign in again to see your boards."
        }
        if let url = error as? URLError, url.code == .notConnectedToInternet { return "You're offline. Check your connection and try again." }
        return text
    }

    /// The Calimero 1.0 node's typed errors, in words.
    static func clusterText(_ error: Error) -> String? {
        switch error {
        case is ConfirmCancelled: return "The passkey prompt was cancelled."
        case is LoginRequired: return "Your session ended. Sign in again."
        case is SignedOutError: return "You're signed out. Sign in again to see your boards."
        case is ReleaseDeadlineError:
            return "A newer node release needs approval before anything can change. Review it on the Teams screen."
        case is ConsentStale: return "That approval request is out of date. Try again."
        case is NotFound: return "This isn't available to you (yet)."
        case let error as UnavailableError:
            return "Your cluster is unavailable right now (\(error.reason)). Try again shortly."
        default: return nil
        }
    }
}
