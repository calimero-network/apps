import DesignCore
import Foundation
import MeroKit
import MeroKitUI

/// Where the app signs in and which cloud it routes through, read from the
/// Info.plist keys `project.yml` sets. An empty value means the SDK's default
/// (the hosted Calimero wallet and Cloud manager).
enum AppConfig {
    /// The app scheme the wallet returns to (`mero-design://enrol#credential=…`).
    static var callbackScheme: String { string("MeroDesignCallbackScheme") ?? "mero-design" }

    /// An https host the wallet returns to instead (a verified Associated Domain). Unset by default.
    static var callbackHost: String? { string("MeroDesignCallbackHost") }
    static var callbackPath: String { string("MeroDesignCallbackPath") ?? "/enrol" }

    static var callback: CloudCallback {
        if let host = callbackHost { return .https(host: host, path: callbackPath) }
        return .scheme(callbackScheme)
    }

    static var config: MeroProviderConfig {
        var config = MeroProviderConfig()
        if let cloud = string("MeroCloudBaseURL").flatMap(URL.init(string:)) { config.cloudBaseURL = cloud }
        if let registry = string("MeroRegistryURL") { config.registryURL = registry }
        return config
    }

    static var walletURL: URL? { string("MeroWalletURL").flatMap(URL.init(string:)) }

    /// The Keychain service the device key, the account session and the relay tokens live under.
    static let keychainService = "network.calimero.design"

    @MainActor
    static func makeSession() -> MeroAppSession {
        MeroAppSession(
            packageName: DesignFormat.packageName, callback: callback, config: config, walletURL: walletURL,
            keychainService: keychainService)
    }

    private static func string(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// Image bytes through the signed-in client's admin surface: the account's
/// relay serves a blob of a context the account is in.
struct SessionBlobs: BlobLoading {
    let admin: (any AdminSurface)?

    func blob(id: String, contextId: String) async throws -> Data {
        guard let admin else { throw URLError(.userAuthenticationRequired) }
        return try await admin.getBlob(id, contextId: contextId)
    }
}
