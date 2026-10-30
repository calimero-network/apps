import Foundation
import MeroKit
import MeroKitUI

/// Which Calimero 1.0 cluster the app talks to, read from the Info.plist keys
/// `project.yml` sets: `MeroNodeURL` (a node of your Cloud cluster; empty = the
/// sign-in screen asks) and `MeroDevNodeURL` (the development node it offers).
enum AppConfig {
    /// The registry package: what workspaces are founded with and links carry.
    static let packageName = "com.calimero.mero-crm"

    /// Where the node's consent page returns: `mero-crm://consent`, or a verified https host.
    static var callback: CloudCallback {
        if let host = string("CrmCallbackHost") {
            return .https(host: host, path: string("CrmCallbackPath") ?? "/consent")
        }
        return .scheme(string("CrmCallbackScheme") ?? "mero-crm", path: "consent")
    }

    static var config: MeroProviderConfig {
        MeroProviderConfig(nodeURL: CloudSettings.clusterURL, packageName: packageName)
    }

    /// The Keychain service the session and the development passkey live under.
    static let keychainService = "network.calimero.crm"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
