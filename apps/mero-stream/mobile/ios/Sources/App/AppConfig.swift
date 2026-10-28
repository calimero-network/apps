import Foundation
import MeroKit
import MeroKitUI
import StreamCore

/// Where the app signs in and which cloud it routes through, read from the
/// Info.plist keys `project.yml` sets. Empty means the SDK's default (the
/// hosted Calimero wallet, Cloud manager and registry).
enum AppConfig {
    /// The registry package: what streams are founded with and links carry.
    static let packageName = StreamInvitation.packageName

    /// The wallet callback: `mero-stream://enrol`, or a verified https host.
    static var callback: CloudCallback {
        if let host = string("StreamCallbackHost") { return .https(host: host, path: string("StreamCallbackPath") ?? "/enrol") }
        return .scheme(string("StreamCallbackScheme") ?? "mero-stream")
    }

    static var config: MeroProviderConfig {
        var config = MeroProviderConfig()
        if let cloud = string("MeroCloudBaseURL").flatMap(URL.init(string:)) { config.cloudBaseURL = cloud }
        if let registry = string("MeroRegistryURL") { config.registryURL = registry }
        return config
    }

    static var walletURL: URL? { string("MeroWalletURL").flatMap(URL.init(string:)) }

    /// The Keychain service the device key and the account session live under.
    static let keychainService = "network.calimero.stream"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
