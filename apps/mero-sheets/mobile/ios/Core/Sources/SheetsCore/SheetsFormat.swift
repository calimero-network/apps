import Foundation

/// Names and fixed values shared with the web app (`app/src/config.ts`).
public enum MeroSheets {
    /// The registry package: what workspaces are founded with and invitation links carry.
    public static let packageName = "com.calimero.mero-sheets"
    /// How often to re-read while the relay's event stream is not available.
    public static let pollInterval: TimeInterval = 5
    /// The tab a new spreadsheet starts with, as on the web.
    public static let firstSheetName = "Sheet 1"
}

/// Pure presentation helpers, the twins of `app/src/lib/time.ts` and friends.
public enum SheetsFormat {
    /// "just now", "5 min ago", "3 h ago", "2 d ago", then a date, from a node
    /// timestamp in nanoseconds (`app/src/lib/time.ts`).
    public static func ago(ns: UInt64, now: Date = Date()) -> String {
        guard ns > 0 else { return "" }
        let ms = Double(ns / 1_000_000)
        let s = max(0, Int(((now.timeIntervalSince1970 * 1000 - ms) / 1000).rounded()))
        if s < 45 { return "just now" }
        let m = Int((Double(s) / 60).rounded())
        if m < 60 { return "\(m) min ago" }
        let h = Int((Double(m) / 60).rounded())
        if h < 24 { return "\(h) h ago" }
        let d = Int((Double(h) / 24).rounded())
        if d < 7 { return "\(d) d ago" }
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy"
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    /// `4f8a…c2e1` for a hex key; anything that is not one passes through.
    public static func truncateKey(_ key: String) -> String {
        guard key.count >= 32, !key.contains(" ") else { return key }
        return "\(key.prefix(4))…\(key.suffix(4))"
    }

    /// Index into the eight avatar swatches, stable per seed (the web's `avatarColor`).
    public static func swatch(seed: String) -> Int {
        var h: Int32 = 0
        for unit in seed.utf16 { h = h &* 31 &+ Int32(unit) }
        return Int(h.magnitude % 8)
    }

    /// Plain words for a failure.
    public static func errorText(_ error: Error) -> String {
        let text = String(describing: error)
        if text.contains("noRelay") {
            return "No relay serves this account yet. Join a workspace from an invitation link to get one."
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost:
                return "You are offline. Check your connection and try again."
            case .timedOut:
                return "The relay took too long to answer. Try again."
            default:
                break
            }
        }
        let described = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        return described.isEmpty ? "Something went wrong. Try again." : described
    }
}
