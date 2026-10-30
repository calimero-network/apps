import ChessCore
import Foundation
import MeroKit
import MeroKitUI

/// Which Calimero 1.0 cluster the app signs in to, from the Info.plist keys `project.yml` sets.
/// An empty value means "ask on the sign-in screen".
enum AppConfig {
    /// Where the node's consent page sends the person back
    /// (`mero-chess://consent?request_id=…&result=…`).
    static var callback: CloudCallback {
        if let host = string("MeroChessCallbackHost") {
            return .https(host: host, path: string("MeroChessCallbackPath") ?? "/consent")
        }
        return .scheme(string("MeroChessCallbackScheme") ?? "mero-chess", path: "consent")
    }

    /// The Calimero Cloud cluster: a node URL from the console. Signing in verifies the node's
    /// attestation (`CloudPolicy.production`).
    static var clusterURL: String? { string("CalimeroClusterURL") }

    /// The development cluster (`merod local`) the sign-in screen prefills.
    static var devNodeURL: String { string("DefaultNodeURL") ?? "http://localhost:2501" }

    static var config: MeroProviderConfig {
        MeroProviderConfig(
            nodeURL: clusterURL, policy: .production, packageName: ChessConstants.packageName,
            packageVersion: string("MeroPackageVersion"))
    }

    /// The Keychain service the session (and a development cluster's soft passkey) live under.
    static let keychainService = "network.calimero.chess"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
