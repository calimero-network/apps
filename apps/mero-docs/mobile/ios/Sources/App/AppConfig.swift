import DocsCore
import Foundation
import MeroKit
import MeroKitUI

/// Which Calimero 1.0 cluster the app talks to, from the Info.plist keys
/// `project.yml` sets (see ../README.md): `MeroNodeURL` (a node of your Cloud
/// cluster; empty = the sign-in screen asks) and `MeroDevNodeURL` (the
/// development node the sign-in screen offers).
enum AppConfig {
    /// The app scheme the node's consent page returns to (`mero-docs://consent?…`).
    static var callbackScheme: String { string("MeroDocsCallbackScheme") ?? "mero-docs" }

    /// An https host the consent page returns to instead (a verified Associated Domain). Unset by default.
    static var callbackHost: String? { string("MeroDocsCallbackHost") }
    static var callbackPath: String { string("MeroDocsCallbackPath") ?? "/consent" }

    static var callback: CloudCallback {
        if let host = callbackHost { return .https(host: host, path: callbackPath) }
        return .scheme(callbackScheme, path: "consent")
    }

    static var config: MeroProviderConfig {
        MeroProviderConfig(nodeURL: CloudSettings.clusterURL, packageName: DocsFormat.packageName)
    }

    /// The Keychain service the session and the development passkey live under.
    static let keychainService = "network.calimero.docs"

    @MainActor
    static func makeSession() -> MeroAppSession {
        MeroAppSession(
            packageName: DocsFormat.packageName, callback: callback, config: config, keychainService: keychainService)
    }

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// Image bytes through the signed-in backend: a blob of the folder's docs app
/// instance (`GET /apps/{app}/blobs/{id}` on Calimero 1.0).
struct SessionBlobs: BlobLoading {
    let backend: (any MeroAppBackend)?

    func blob(id: String, contextId: String) async throws -> Data {
        guard let backend else { throw URLError(.userAuthenticationRequired) }
        return try await backend.getBlob(blobId: id, contextId: contextId)
    }
}
