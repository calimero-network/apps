import Foundation
import MeroKit

/// A document a link names. (== Kotlin `DocTarget`.)
public struct DocTarget: Equatable, Hashable, Sendable {
    /// The workspace (namespace) id.
    public let workspaceId: String
    /// The folder's group id.
    public let folderId: String
    public let docId: String
    public let blockId: String?

    public init(workspaceId: String, folderId: String, docId: String, blockId: String? = nil) {
        self.workspaceId = workspaceId
        self.folderId = folderId
        self.docId = docId
        self.blockId = blockId
    }
}

/// What a link inside a document points at.
public enum LinkTarget: Equatable, Sendable {
    /// Another Mero Docs document: opened in the app.
    case doc(DocTarget)
    /// A workspace member, as a mention writes it: shown, not followed.
    case member(account: String)
    /// Anywhere else: opened in the browser.
    case web(URL)
    case none
}

/// Copy, links and formatting shared by every screen. (== Kotlin `DocsFormat`.)
public enum DocsFormat {
    /// The app's registry package (`PACKAGE_NAME` in the web app).
    public static let packageName = "com.calimero.mero-drive-docs"
    /// The web app: share links open there, and its links open here.
    public static let webOrigin = "https://mero-docs.vercel.app"

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

    /// "just now", "5m ago", "3h ago", "2d ago", or a date, from nanoseconds.
    public static func relativeTime(nanos: UInt64, now: Date = Date()) -> String {
        guard nanos > 0 else { return "" }
        let then = Date(timeIntervalSince1970: Double(nanos / 1_000_000) / 1000)
        let seconds = max(0, now.timeIntervalSince(then))
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h ago" }
        if seconds < 7 * 86_400 { return "\(Int(seconds / 86_400))d ago" }
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: then)
    }

    /// The web's link to a document (`docUrl` in `lib/routes.ts`), with
    /// `#b=<block>` when it points at one block.
    public static func docLink(_ t: DocTarget) -> String {
        let base = "\(webOrigin)/app/\(encode(t.workspaceId))/f/\(encode(t.folderId))/d/\(encode(t.docId))"
        guard let block = t.blockId else { return base }
        return "\(base)#b=\(encode(block))"
    }

    /// The document a web link names (`parseAppPath`): any origin, since a
    /// node serves the app under its own, with an optional version prefix.
    public static func parseDocLink(_ raw: String) -> DocTarget? {
        guard let comps = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        let parts = comps.percentEncodedPath.split(separator: "/").map(String.init)
        guard let app = parts.firstIndex(of: "app"), parts.count >= app + 6 else { return nil }
        let p = Array(parts[app...])
        guard p[2] == "f", p[4] == "d" else { return nil }
        guard let ws = p[1].removingPercentEncoding, let folder = p[3].removingPercentEncoding,
            let doc = p[5].removingPercentEncoding, !ws.isEmpty, !folder.isEmpty, !doc.isEmpty
        else { return nil }
        var block: String?
        if let fragment = comps.percentEncodedFragment {
            for pair in fragment.split(separator: "&") where pair.hasPrefix("b=") {
                block = String(pair.dropFirst(2)).removingPercentEncoding
            }
        }
        return DocTarget(workspaceId: ws, folderId: folder, docId: doc, blockId: block?.isEmpty == true ? nil : block)
    }

    /// What tapping a link in a document does.
    public static func linkTarget(_ href: String) -> LinkTarget {
        if let doc = parseDocLink(href) { return .doc(doc) }
        let path = URLComponents(string: href)?.path ?? href
        let parts = path.split(separator: "/").map(String.init)
        if let app = parts.firstIndex(of: "app"), parts.count == app + 4, parts[app + 2] == "m",
            parts[app + 3].count == 64, parts[app + 3].allSatisfy(\.isHexDigit)
        {
            return .member(account: parts[app + 3].lowercased())
        }
        if let url = URL(string: href), let scheme = url.scheme?.lowercased(),
            ["http", "https", "mailto"].contains(scheme)
        {
            return .web(url)
        }
        return .none
    }

    /// A search snippet as plain and bold pieces: the node wraps matched words
    /// in `<b>`; any other tag is dropped and entities decoded.
    public static func snippetPieces(_ snippet: String) -> [(text: String, bold: Bool)] {
        var out: [(String, Bool)] = []
        var bold = false
        var rest = Substring(snippet)
        while !rest.isEmpty {
            if let open = rest.range(of: "<") {
                let before = rest[..<open.lowerBound]
                if !before.isEmpty { out.append((decodeEntities(String(before)), bold)) }
                guard let close = rest[open.upperBound...].range(of: ">") else {
                    out.append((decodeEntities(String(rest[open.lowerBound...])), bold))
                    break
                }
                let tag = rest[open.upperBound..<close.lowerBound].lowercased()
                if tag == "b" { bold = true } else if tag == "/b" { bold = false }
                rest = rest[close.upperBound...]
            } else {
                out.append((decodeEntities(String(rest)), bold))
                break
            }
        }
        return out.filter { !$0.0.isEmpty }.map { (text: $0.0, bold: $0.1) }
    }

    static func decodeEntities(_ s: String) -> String {
        s.replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
    }

    /// Words a person can act on, from an error.
    public static func errorText(_ error: Error) -> String {
        let text = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        let lower = text.lowercased()
        if lower.contains("forbidden") || lower.contains("read-only") || lower.contains("readonly")
            || lower.contains("not allowed")
        {
            return "You can read this folder but not comment in it. Ask a workspace admin for edit access."
        }
        if text.contains("noRelay") || lower.contains("no relay") || error is LoginRequired {
            return "Your session ended. Sign in again."
        }
        if error is UnavailableError { return "The cluster is busy. Try again in a moment." }
        if let app = error as? AppError { return app.message.isEmpty ? app.appCode : app.message }
        if let url = error as? URLError, url.code == .notConnectedToInternet {
            return "You're offline. Check your connection and try again."
        }
        return text
    }

    private static func encode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/#?&=")))
            ?? s
    }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
