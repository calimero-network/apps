import Foundation

/// The bundled web game (`mobile/game/www`, built by `scripts/build-game.sh`): which file a
/// request names, and what it is. The iOS app serves it to the web view from the app bundle; nothing
/// is fetched from the network.
public enum GameAssets {
    /// The folder the game is bundled as.
    public static let folder = "www"
    /// The page the apps open: the web app in its game-only mode (`app/src/native/host.ts`).
    public static let entry = "index.html?host=native"

    /// The file inside `root` that a request for `path` names, or nil when there is none (or the
    /// path tries to leave `root`).
    public static func resolve(path: String, in root: URL) -> URL? {
        var relative = path.removingPercentEncoding ?? path
        while relative.hasPrefix("/") { relative.removeFirst() }
        if relative.isEmpty { relative = "index.html" }
        let rootPath = root.standardizedFileURL.path
        let file = root.appendingPathComponent(relative).standardizedFileURL
        guard file.path.hasPrefix(rootPath + "/") else { return nil }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory), !isDirectory.boolValue
        else { return nil }
        return file
    }

    public static func mimeType(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }

    /// The local files `index.html` loads (`./…` script, stylesheet and icon references).
    public static func referencedFiles(indexHTML: String) -> [String] {
        let pattern = #"(?:src|href)="\./([^"]+)""#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(indexHTML.startIndex..., in: indexHTML)
        return regex.matches(in: indexHTML, range: range).compactMap { match in
            Range(match.range(at: 1), in: indexHTML).map { String(indexHTML[$0]) }
        }
    }
}
