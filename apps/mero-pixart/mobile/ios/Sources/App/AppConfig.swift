import PixartCore
import Foundation
import MeroKit
import MeroKitUI

/// Which Calimero 1.0 cluster the app talks to and where the consent page
/// returns to, read from the Info.plist keys `project.yml` sets. An empty
/// value means "not set": with no node URL, sign-in asks for one.
enum AppConfig {
    /// The app scheme the node's consent page returns to (`mero-pixart://consent?request_id=…&result=…`).
    static var callbackScheme: String { string("MeroPixartCallbackScheme") ?? "mero-pixart" }

    /// An https host the consent page returns to instead (a verified Associated Domain). Unset by default.
    static var callbackHost: String? { string("MeroPixartCallbackHost") }
    static var callbackPath: String { string("MeroPixartCallbackPath") ?? "/consent" }

    static var callback: CloudCallback {
        if let host = callbackHost { return .https(host: host, path: callbackPath) }
        return .scheme(callbackScheme, path: callbackPath.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }

    /// A node of the app's cluster (Calimero Cloud's console lists them), the
    /// rest of the cluster for failover, and how far to trust it: production
    /// attestation, or mock attestation for a `merod local` cluster.
    static var config: MeroProviderConfig {
        let allowMock = string("MeroAllowMock").map { ["1", "yes", "true"].contains($0.lowercased()) } ?? false
        let policy: CloudPolicy = allowMock ? .development : .production
        return MeroProviderConfig(
            nodeURL: string("MeroNodeURL"),
            nodes: (string("MeroNodes") ?? "").split(separator: ",").map {
                $0.trimmingCharacters(in: .whitespaces)
            }.filter { !$0.isEmpty },
            policy: policy, packageVersion: string("MeroPackageVersion"))
    }

    /// The Keychain service the account session (and a development cluster's soft passkey) live under.
    static let keychainService = "network.calimero.pixart"

    @MainActor
    static func makeSession() -> MeroAppSession {
        MeroAppSession(
            packageName: PixartFormat.packageName, callback: callback, config: config, keychainService: keychainService)
    }

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// Image bytes: blobs of the project's app instance
/// (`GET /apps/{app}/blobs/{blob}` through the signed-in backend).
struct SessionBlobs: BlobLoading {
    let backend: any MeroAppBackend

    func blob(id: String, contextId: String) async throws -> Data {
        try await backend.getBlob(blobId: id, contextId: contextId)
    }
}
