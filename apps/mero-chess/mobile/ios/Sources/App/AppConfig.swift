import Foundation
import MeroKit
import MeroKitUI

/// Where the app signs in and which cloud it routes through, read from the Info.plist keys
/// `project.yml` sets. An empty value means the SDK's default (the hosted Calimero wallet, Cloud
/// manager and app registry).
enum AppConfig {
    /// The app scheme the wallet returns to (`mero-chess://enrol#credential=…`).
    static var callbackScheme: String { string("MeroChessCallbackScheme") ?? "mero-chess" }

    /// An https host the wallet returns to instead (a verified Associated Domain, iOS 17.4+).
    static var callbackHost: String? { string("MeroChessCallbackHost") }
    static var callbackPath: String { string("MeroChessCallbackPath") ?? "/enrol" }

    static var callback: CloudCallback {
        if let host = callbackHost { return .https(host: host, path: callbackPath) }
        return .scheme(callbackScheme)
    }

    static var config: MeroProviderConfig {
        MeroProviderConfig(
            registryURL: string("MeroRegistryURL") ?? ApplicationRegistry.defaultURL,
            cloudBaseURL: string("MeroCloudBaseURL").flatMap { URL(string: $0) })
    }

    static var walletURL: URL? { string("MeroWalletURL").flatMap { URL(string: $0) } }

    /// The Keychain service the device key, the account session and the relay tokens live under.
    static let keychainService = "network.calimero.chess"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
