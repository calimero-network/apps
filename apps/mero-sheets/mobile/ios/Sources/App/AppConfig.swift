import Foundation
import MeroKit
import MeroKitUI
import SheetsCore

/// Which Calimero 1.0 cluster the app talks to, read from the Info.plist keys
/// `project.yml` sets: `MeroNodeURL` (a node of your Cloud cluster; empty = the
/// sign-in screen asks) and `MeroDevNodeURL` (the development node it offers).
enum AppConfig {
    /// Where the node's consent page returns: `mero-sheets://consent`, or a verified https host.
    static var callback: CloudCallback {
        if let host = string("SheetsCallbackHost") {
            return .https(host: host, path: string("SheetsCallbackPath") ?? "/consent")
        }
        return .scheme(string("SheetsCallbackScheme") ?? "mero-sheets", path: "consent")
    }

    static var providerConfig: MeroProviderConfig {
        MeroProviderConfig(nodeURL: CloudSettings.clusterURL, packageName: MeroSheets.packageName)
    }

    static let keychainService = "network.calimero.sheets"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
