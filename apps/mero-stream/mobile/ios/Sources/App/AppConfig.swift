import Foundation
import MeroKit
import MeroKitUI
import StreamCore

/// Which Calimero 1.0 cluster the app talks to and where the node's consent
/// page returns to, read from the Info.plist keys `project.yml` sets. Empty
/// means "not set": with no node URL, sign-in asks for one.
enum AppConfig {
    /// The registry package: what streams are founded with and links carry.
    static let packageName = StreamInvitation.packageName

    /// Where the consent page returns: `mero-stream://consent`, or a verified https host.
    static var callback: CloudCallback {
        if let host = string("StreamCallbackHost") {
            return .https(host: host, path: string("StreamCallbackPath") ?? "/consent")
        }
        return .scheme(string("StreamCallbackScheme") ?? "mero-stream", path: "consent")
    }

    /// A node of the cluster (Calimero Cloud's console lists them), the rest of
    /// the cluster for failover, and how far to trust it: production
    /// attestation, or mock attestation for a `merod local` cluster.
    static var config: MeroProviderConfig {
        let allowMock = string("MeroAllowMock").map { ["1", "yes", "true"].contains($0.lowercased()) } ?? false
        return MeroProviderConfig(
            nodeURL: string("MeroNodeURL"),
            nodes: (string("MeroNodes") ?? "").split(separator: ",").map {
                $0.trimmingCharacters(in: .whitespaces)
            }.filter { !$0.isEmpty },
            policy: allowMock ? .development : .production, packageVersion: string("MeroPackageVersion"))
    }

    /// The Keychain service the account session (and a development cluster's soft passkey) live under.
    static let keychainService = "network.calimero.stream"

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
