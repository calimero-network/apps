import Foundation
import MeroKitUI

/// Where Mero AR signs in and where its pages send the person back, read from
/// the Info.plist keys `project.yml` sets. An empty value means the default.
enum AppConfig {
    /// The app scheme Mero AR's served page returns to.
    static var callbackScheme: String { string("MeroARCallbackScheme") ?? "mero-ar" }

    /// A Calimero Cloud cluster to sign in on (`MeroARCluster`); unset: Mero
    /// AR's own address, which routes to its primary cluster.
    static var cluster: String? { string("MeroARCluster") }

    /// Where the sign-in page sends the session back (`mero-ar://signed-in#…`).
    static var signInCallback: CloudCallback { .scheme(callbackScheme, path: "signed-in") }

    /// Where the served page sends a passkey approval back (`mero-ar://approved#…`).
    static var approveCallback: CloudCallback { .scheme(callbackScheme, path: "approved") }

    /// Where the node's consent page's answer comes back, through Mero AR's
    /// served page (`mero-ar://consent?request_id=…&result=…`).
    static var consentCallback: CloudCallback { .scheme(callbackScheme, path: "consent") }

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
