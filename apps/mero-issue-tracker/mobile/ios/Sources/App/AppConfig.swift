import Foundation
import MeroKit
import MeroKitUI

/// Where the app signs in and which cloud it routes through, read from the
/// Info.plist keys `project.yml` sets. An empty value means the SDK's default
/// (the hosted Calimero wallet and Cloud manager).
enum AppConfig {
    static var callback: CloudCallback {
        if let host = string("IssuesCallbackHost") { return .https(host: host, path: string("IssuesCallbackPath") ?? "/enrol") }
        return .scheme(string("IssuesCallbackScheme") ?? "mero-issues")
    }

    static var providerConfig: MeroProviderConfig {
        var config = MeroProviderConfig()
        if let cloud = string("MeroCloudBaseURL").flatMap(URL.init(string:)) { config.cloudBaseURL = cloud }
        if let registry = string("MeroRegistryURL") { config.registryURL = registry }
        return config
    }

    static var walletURL: URL? { string("MeroWalletURL").flatMap(URL.init(string:)) }

    static let keychainService = "network.calimero.issues"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
