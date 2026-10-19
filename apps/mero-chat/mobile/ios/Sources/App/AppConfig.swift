import Foundation
import MeroKit
import MeroKitUI

/// Where the app signs in and which cloud it routes through, read from the
/// Info.plist keys `project.yml` sets. An empty value means the SDK's default
/// (the hosted Calimero wallet and Cloud manager).
enum AppConfig {
    /// The app scheme the wallet returns to (`mero-chat://enrol#credential=…`).
    static var callbackScheme: String {
        string("MeroChatCallbackScheme") ?? "mero-chat"
    }

    /// An https host the wallet returns to instead (a verified Associated
    /// Domain, iOS 17.4+). Unset by default.
    static var callbackHost: String? { string("MeroChatCallbackHost") }
    static var callbackPath: String { string("MeroChatCallbackPath") ?? "/enrol" }

    /// The wallet callback to use.
    static var callback: CloudCallback {
        if let host = callbackHost { return .https(host: host, path: callbackPath) }
        return .scheme(callbackScheme)
    }

    /// The Calimero Cloud manager (relay discovery, routing, HA).
    static var cloudBaseURL: URL {
        string("MeroCloudBaseURL").flatMap { URL(string: $0) } ?? CloudClient.defaultBaseURL
    }

    /// The Calimero wallet's enrolment page.
    static var walletURL: URL {
        string("MeroWalletURL").flatMap { URL(string: $0) } ?? DeviceEnrolment.defaultWalletURL
    }

    /// The registry the chat package resolves from.
    static var registryURL: String {
        string("MeroRegistryURL") ?? ApplicationRegistry.defaultURL
    }

    /// The Keychain service the device key, the account session and the
    /// relay tokens are stored under.
    static let keychainService = "network.calimero.chat"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
