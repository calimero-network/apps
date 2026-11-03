import Foundation
import MeroKit
import MeroKitUI

/// Which Calimero 1.0 cluster the app signs in to, read from the Info.plist
/// keys `project.yml` sets. An empty value means "ask on the sign-in screen".
enum AppConfig {
    /// The app scheme the node's consent page returns to
    /// (`mero-chat://consent?request_id=…&result=…`).
    static var callbackScheme: String {
        string("MeroChatCallbackScheme") ?? "mero-chat"
    }

    /// An https host the consent page returns to instead (a verified
    /// Associated Domain, iOS 17.4+). Unset by default.
    static var callbackHost: String? { string("MeroChatCallbackHost") }
    static var callbackPath: String { string("MeroChatCallbackPath") ?? "/consent" }

    /// The consent page's return.
    static var callback: CloudCallback {
        if let host = callbackHost { return .https(host: host, path: callbackPath) }
        return .scheme(callbackScheme, path: "consent")
    }

    /// The Calimero Cloud cluster: a node URL from the console. Signing in
    /// verifies the node's attestation (`CloudPolicy.production`).
    static var clusterURL: String? { string("CalimeroClusterURL") }

    /// The development node (`merod local`) the sign-in screen prefills.
    static var devNodeURL: String { string("DefaultNodeURL") ?? "http://localhost:2501" }

    static var providerConfig: MeroProviderConfig {
        MeroProviderConfig(
            nodeURL: clusterURL, policy: .production, packageName: ChatConstants.packageName,
            packageVersion: string("MeroPackageVersion"))
    }

    /// The Keychain service the session (and a development node's soft passkey) live under.
    static let keychainService = "network.calimero.chat"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
