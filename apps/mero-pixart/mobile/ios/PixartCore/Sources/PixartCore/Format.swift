import Foundation
import MeroKit

/// Copy, links and formatting shared by every screen. (Kotlin `PixartFormat`.)
public enum PixartFormat {
    /// The app's registry package, deep-link slug and invitation path (`APP_SLUG` in the web app).
    public static let packageName = "com.calimero.mero-pixart"

    /// `ab12…ef90`: an id short enough to show.
    public static func shortId(_ id: String) -> String {
        id.count <= 12 ? id : "\(id.prefix(4))…\(id.suffix(4))"
    }

    /// Initials for an avatar: the first letters of the first two words.
    public static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0 == " " || $0 == "_" || $0 == "-" || $0 == "." })
        let out = String(words.prefix(2).compactMap(\.first)).uppercased()
        return out.isEmpty ? "?" : out
    }

    /// "1920 × 1080".
    public static func size(_ w: UInt32, _ h: UInt32) -> String { "\(w) × \(h)" }

    public static func count(_ n: Int, _ one: String, _ many: String) -> String { n == 1 ? "1 \(one)" : "\(n) \(many)" }

    /// The link to a project, in the platform's deep-link form
    /// (`https://links.calimero.network/<package>/<action>?…`, as `createLink` builds).
    public static func projectLink(teamId: String, contextId: String) -> String {
        "https://links.calimero.network/\(packageName)/project?team=\(teamId)&project=\(contextId)"
    }

    /// The team and project a project link names, from its https or
    /// `calimero://<package>/project` form; `nil` for any other link.
    public static func parseProjectLink(_ raw: String) -> (teamId: String, contextId: String)? {
        guard let comps = URLComponents(string: raw.trimmingCharacters(in: .whitespaces)) else { return nil }
        let path = comps.path.split(separator: "/").map(String.init)
        let segments = comps.scheme == "calimero" ? [comps.host ?? ""] + path : path
        guard segments.count >= 2, segments[segments.count - 2] == packageName, segments.last == "project" else {
            return nil
        }
        let items = comps.queryItems ?? []
        guard let team = items.first(where: { $0.name == "team" })?.value, !team.isEmpty,
            let project = items.first(where: { $0.name == "project" })?.value, !project.isEmpty
        else { return nil }
        return (team, project)
    }

    /// A file name for an export: the project's name, made safe.
    public static func fileName(_ name: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " -_"))
        let cleaned = String(name.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" })
            .trimmingCharacters(in: .whitespaces)
        return (cleaned.isEmpty ? "artwork" : cleaned) + ".png"
    }

    /// Words a person can act on, from an error.
    public static func errorText(_ error: Error) -> String {
        let text = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        if text.contains("noRelay") || text.lowercased().contains("no relay") {
            return "Your account has no relay yet. Join a team from an invitation link, or try again shortly."
        }
        if let url = error as? URLError, url.code == .notConnectedToInternet {
            return "You're offline. Check your connection and try again."
        }
        return text
    }
}

/// Bytes stored as blobs on a project's context. `MeroAppBackend` has no blob
/// call yet, so the app reads them through the signed-in client's admin
/// surface (`getBlob(_:contextId:)`, which the account's relay serves).
public protocol BlobLoading: Sendable {
    func blob(id: String, contextId: String) async throws -> Data
}

/// No blobs: rasters are left out.
public struct NoBlobs: BlobLoading {
    public init() {}
    public func blob(id: String, contextId: String) async throws -> Data { throw URLError(.resourceUnavailable) }
}

/// Decoded blobs by id, shared by the gallery thumbnails and the artwork, so a
/// layer is downloaded once. A blob id names its bytes, so entries never go stale.
public actor BlobStore {
    let loader: any BlobLoading
    private var cache: [String: Bitmap] = [:]
    private var order: [String] = []
    private let limit: Int

    public init(loader: any BlobLoading, limit: Int = 96) {
        self.loader = loader
        self.limit = limit
    }

    /// The decoded image, or `nil` when it cannot be read or is not an image.
    public func bitmap(id: String, contextId: String) async -> Bitmap? {
        if let hit = cache[id] { return hit }
        guard let data = try? await loader.blob(id: id, contextId: contextId), let bmp = Renderer.decode(data) else {
            return nil
        }
        cache[id] = bmp
        order.append(id)
        if order.count > limit { cache.removeValue(forKey: order.removeFirst()) }
        return bmp
    }

    /// Several at once, four in flight.
    public func bitmaps(_ ids: [String], contextId: String) async -> [String: Bitmap] {
        var out: [String: Bitmap] = [:]
        var pending = ids.filter { id in
            if let hit = cache[id] {
                out[id] = hit
                return false
            }
            return true
        }
        while !pending.isEmpty {
            let batch = Array(pending.prefix(4))
            pending.removeFirst(batch.count)
            let loader = loader
            let got = await withTaskGroup(of: (String, Data?).self) { group in
                for id in batch { group.addTask { (id, try? await loader.blob(id: id, contextId: contextId)) } }
                var r: [(String, Data?)] = []
                for await x in group { r.append(x) }
                return r
            }
            for (id, data) in got {
                guard let data, let bmp = Renderer.decode(data) else { continue }
                cache[id] = bmp
                order.append(id)
                out[id] = bmp
            }
            while order.count > limit { cache.removeValue(forKey: order.removeFirst()) }
        }
        return out
    }
}

extension MeroAppBackend {
    /// The generated client over this backend's contract, bound to `contextId`.
    public func pixartClient(_ contextId: String) -> PixartClient {
        PixartClient(transport: contract.bound(to: contextId))
    }
}

/// Pan and zoom of the artwork view: a document point `p` is drawn at
/// `p * scale + offset` in view points. (Kotlin `Viewport`.)
public struct Viewport: Equatable, Sendable {
    public var scale: Double
    public var offsetX: Double
    public var offsetY: Double

    public static let minScale = 0.02
    public static let maxScale = 16.0

    public init(scale: Double = 1, offsetX: Double = 0, offsetY: Double = 0) {
        self.scale = scale
        self.offsetX = offsetX
        self.offsetY = offsetY
    }

    /// A `w`×`h` document centred in the view with `padding` around it.
    public static func fit(width w: Double, height h: Double, viewW: Double, viewH: Double, padding: Double = 20) -> Viewport {
        guard w > 0, h > 0, viewW > 0, viewH > 0 else { return Viewport(scale: 1, offsetX: 0, offsetY: 0) }
        let scale = clampScale(min(max(1, viewW - padding * 2) / w, max(1, viewH - padding * 2) / h))
        return Viewport(scale: scale, offsetX: (viewW - w * scale) / 2, offsetY: (viewH - h * scale) / 2)
    }

    public static func clampScale(_ s: Double) -> Double { min(maxScale, max(minScale, s)) }

    /// Zoomed by `factor` about the view point (`ax`, `ay`), which stays put.
    public func zoomed(by factor: Double, aboutX ax: Double, y ay: Double) -> Viewport {
        let next = Viewport.clampScale(scale * factor)
        let k = next / scale
        return Viewport(scale: next, offsetX: ax - (ax - offsetX) * k, offsetY: ay - (ay - offsetY) * k)
    }

    public func panned(dx: Double, dy: Double) -> Viewport {
        Viewport(scale: scale, offsetX: offsetX + dx, offsetY: offsetY + dy)
    }
}
