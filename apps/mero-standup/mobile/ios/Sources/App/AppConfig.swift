import Foundation
import MeroKit
import MeroKitUI

/// Which Calimero 1.0 cluster the app signs in to, read from the Info.plist
/// keys `project.yml` sets. Empty means "ask on the sign-in screen".
enum AppConfig {
    /// The registry package: what teams are founded with and links carry.
    static let packageName = "com.calimero.mero-standup"

    /// Where the node's consent page sends the person back
    /// (`mero-standup://consent?request_id=…&result=…`), or a verified https host.
    static var callback: CloudCallback {
        if let host = string("StandupCallbackHost") {
            return .https(host: host, path: string("StandupCallbackPath") ?? "/consent")
        }
        return .scheme(string("StandupCallbackScheme") ?? "mero-standup", path: "consent")
    }

    /// The Calimero Cloud cluster: a node URL from the console. Signing in
    /// verifies the node's attestation (`CloudPolicy.production`).
    static var clusterURL: String? { string("CalimeroClusterURL") }

    /// The development cluster (`merod local`) the sign-in screen prefills.
    static var devNodeURL: String { string("DefaultNodeURL") ?? "http://localhost:2501" }

    static var config: MeroProviderConfig {
        MeroProviderConfig(
            nodeURL: clusterURL, policy: .production, packageName: packageName,
            packageVersion: string("MeroPackageVersion"))
    }

    /// The Keychain service the session (and a development node's soft passkey) live under.
    static let keychainService = "network.calimero.standup"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
