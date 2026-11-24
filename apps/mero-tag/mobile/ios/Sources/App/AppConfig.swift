import Foundation
import MeroKit
import MeroKitUI
import TagCore

/// Where Mero Tag signs in and where its served page sends the person back,
/// read from the Info.plist keys `project.yml` sets. An empty value means the
/// default.
enum AppConfig {
    /// The app scheme Mero Tag's served page returns to.
    static let callbackScheme = "mero-tag"

    /// Where the served page sends the session after sign-in (`mero-tag://signed-in#…`).
    static var signInCallback: CloudCallback { .scheme(callbackScheme, path: "signed-in") }

    /// Where the served page sends a passkey approval (`mero-tag://approved#…`).
    static var approveCallback: CloudCallback { .scheme(callbackScheme, path: "approved") }

    /// Where the served page passes the node's consent decision on to
    /// (`mero-tag://consent?request_id=…&result=…`).
    static var consentCallback: CloudCallback { .scheme(callbackScheme, path: "consent") }

    /// A Calimero Cloud cluster to sign in on (`MeroTagCluster`); unset: Mero Tag's primary cluster.
    static var cluster: String? { string("MeroTagCluster") }

    /// The release new spaces run (`MeroTagPackageVersion`); unset: the latest.
    static var packageVersion: String? { string("MeroTagPackageVersion") }

    /// Mero Tag's package: what a space's organization is founded for and its
    /// app instance created from, and whose served page signs the person in.
    static var providerConfig: MeroProviderConfig {
        MeroProviderConfig(packageName: SpaceInvite.appSlug, packageVersion: packageVersion)
    }

    /// The Keychain service the session (and a development cluster's soft passkey) live under.
    static let keychainService = "network.calimero.merotag"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
