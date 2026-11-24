import CalendarCore
import Foundation
import MeroKit
import MeroKitUI

// A staging build is a Debug build (project.yml's Staging configuration); a
// Release build, the one people install from the App Store, never is.
#if MERO_STAGING && !DEBUG
#error("MERO_STAGING is set only by the Staging configuration, never in a Release build")
#endif

/// Which Calimero 1.0 cluster the app signs in to, from the Info.plist keys
/// `project.yml` sets. An empty value means "ask on the sign-in screen".
enum AppConfig {
    /// Where the node's consent page sends the person back
    /// (`mero-calendar://consent?request_id=…&result=…`).
    static var callback: CloudCallback {
        if let host = string("MeroCalendarCallbackHost") {
            return .https(host: host, path: string("MeroCalendarCallbackPath") ?? "/consent")
        }
        return .scheme(string("MeroCalendarCallbackScheme") ?? "mero-calendar", path: "consent")
    }

    /// The Calimero Cloud this build reaches: staging only in the Staging
    /// configuration (`MERO_STAGING`, see project.yml), production otherwise,
    /// Release always. Fixed by the build, never by what a person types: a
    /// staging cluster's name or node URL in a production build is refused
    /// (its debug images are not trusted, and production's directory does not
    /// list it).
    static var cloud: CloudEnvironment {
        #if MERO_STAGING
        return .staging
        #else
        return .production
        #endif
    }

    /// The Calimero Cloud cluster: a node URL from the console. Signing in
    /// verifies the node's attestation (``cloud``'s policy).
    static var clusterURL: String? { string("CalimeroClusterURL") }

    /// The development cluster (`merod local`) the sign-in screen prefills.
    static var devNodeURL: String { string("DefaultNodeURL") ?? "http://localhost:2501" }

    static var providerConfig: MeroProviderConfig {
        MeroProviderConfig(
            nodeURL: clusterURL, policy: cloud.policy(), packageName: CalendarConstants.packageName,
            packageVersion: string("MeroPackageVersion"))
    }

    /// The Keychain service the session (and a development cluster's soft passkey) live under.
    static let keychainService = "network.calimero.calendar"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
