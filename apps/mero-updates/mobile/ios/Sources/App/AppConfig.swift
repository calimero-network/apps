import Foundation
import MeroKit
import MeroKitUI

/// Which Calimero 1.0 cluster the app talks to, read from the Info.plist keys
/// `project.yml` sets: `MeroNodeURL` (a node of your Cloud cluster; empty = the
/// sign-in screen asks) and `MeroDevNodeURL` (the development node it offers).
enum AppConfig {
    /// The registry package: what companies are founded with and links carry.
    static let packageName = "com.calimero.mero-updates"

    /// Where the node's consent page returns: `mero-updates://consent`, or a verified https host.
    static var callback: CloudCallback {
        if let host = string("UpdatesCallbackHost") {
            return .https(host: host, path: string("UpdatesCallbackPath") ?? "/consent")
        }
        return .scheme(string("UpdatesCallbackScheme") ?? "mero-updates", path: "consent")
    }

    static var config: MeroProviderConfig {
        MeroProviderConfig(nodeURL: CloudSettings.clusterURL, packageName: packageName)
    }

    /// The Keychain service the session and the development passkey live under.
    static let keychainService = "network.calimero.updates"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
