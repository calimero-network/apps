import Foundation
import MeroKit
import MeroKitUI

/// Which Calimero 1.0 cluster the app talks to and where the consent page
/// returns to, read from the Info.plist keys `project.yml` sets. An empty
/// value means "not set": with no node URL, sign-in asks for one.
enum AppConfig {
    /// The app scheme the node's consent page returns to (`mero-blocks://consent?request_id=…&result=…`).
    static var callbackScheme: String { string("MeroBlocksCallbackScheme") ?? "mero-blocks" }

    /// An https host the consent page returns to instead (a verified Associated Domain). Unset by default.
    static var callbackHost: String? { string("MeroBlocksCallbackHost") }
    static var callbackPath: String { string("MeroBlocksCallbackPath") ?? "/consent" }

    static var callback: CloudCallback {
        if let host = callbackHost { return .https(host: host, path: callbackPath) }
        return .scheme(callbackScheme, path: callbackPath.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }

    /// A node of the app's cluster (Calimero Cloud's console lists them), the
    /// rest of the cluster for failover, and how far to trust it: production
    /// attestation, or mock attestation for a `merod local` cluster.
    static var config: MeroProviderConfig {
        let allowMock = string("MeroAllowMock").map { ["1", "yes", "true"].contains($0.lowercased()) } ?? false
        let policy: CloudPolicy = allowMock ? .development : .production
        return MeroProviderConfig(
            nodeURL: string("MeroNodeURL"),
            nodes: (string("MeroNodes") ?? "").split(separator: ",").map {
                $0.trimmingCharacters(in: .whitespaces)
            }.filter { !$0.isEmpty },
            policy: policy, packageVersion: string("MeroPackageVersion"))
    }

    /// The Keychain service the account session (and a development cluster's soft passkey) live under.
    static let keychainService = "network.calimero.blocks"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
