import Foundation

/// Where the sign-in screen connects: a Calimero Cloud cluster by its name
/// (`eu-shared-1`, its nodes read from the node directory), or one of its
/// nodes by URL. A bare host (`node.example.com`) is read as https.
/// (Kotlin `ClusterTarget`.)
enum ClusterTarget: Equatable, Sendable {
    case name(String)
    case url(String)

    /// What the person typed, or `nil` when it is neither a name nor an address.
    static func parse(_ input: String) -> ClusterTarget? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains(" ") else { return nil }
        if trimmed.contains("://") {
            guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(),
                scheme == "https" || scheme == "http", url.host?.isEmpty == false
            else { return nil }
            return .url(trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed)
        }
        if trimmed.contains(".") || trimmed.contains(":") {
            return parse("https://\(trimmed)")
        }
        let allowed = CharacterSet.lowercaseLetters.union(.decimalDigits).union(CharacterSet(charactersIn: "-_"))
        let lower = trimmed.lowercased()
        guard lower.unicodeScalars.allSatisfy(allowed.contains) else { return nil }
        return .name(lower)
    }

    /// What the screen says it signs in to.
    var label: String {
        switch self {
        case .name(let name): return name
        case .url(let url): return URL(string: url)?.host ?? url
        }
    }
}
