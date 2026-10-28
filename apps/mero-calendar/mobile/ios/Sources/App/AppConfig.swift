import CalendarCore
import Foundation
import MeroKit
import MeroKitUI

/// Where the app signs in and which cloud it routes through, from the
/// Info.plist keys `project.yml` sets. An empty value means the SDK's default.
enum AppConfig {
    static var callback: CloudCallback {
        if let host = string("MeroCalendarCallbackHost") {
            return .https(host: host, path: string("MeroCalendarCallbackPath") ?? "/enrol")
        }
        return .scheme(string("MeroCalendarCallbackScheme") ?? "mero-calendar")
    }

    static var providerConfig: MeroProviderConfig {
        MeroProviderConfig(
            packageName: CalendarConstants.packageName,
            registryURL: string("MeroRegistryURL"),
            cloudBaseURL: string("MeroCloudBaseURL").flatMap { URL(string: $0) })
    }

    static var walletURL: URL? { string("MeroWalletURL").flatMap { URL(string: $0) } }

    /// The Keychain service the device key, session and relay tokens live under.
    static let keychainService = "network.calimero.calendar"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
