import Foundation

/// Holds the node URL + JWTs. The web client reads these from
/// `localStorage["mero-tokens"]` + `getNodeUrl()`; on iOS we back them with the
/// Keychain (or memory, for tests).
public protocol TokenStore: AnyObject {
    var nodeUrl: String? { get set }
    var accessToken: String? { get set }
    var refreshToken: String? { get set }
    func clear()
}

/// In-memory store — used by unit tests and previews.
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    public var nodeUrl: String?
    public var accessToken: String?
    public var refreshToken: String?

    public init(nodeUrl: String? = nil, accessToken: String? = nil, refreshToken: String? = nil) {
        self.nodeUrl = nodeUrl
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }

    public func clear() {
        nodeUrl = nil; accessToken = nil; refreshToken = nil
    }
}

/// Keychain-backed store for the shipping app. Values are stored as generic
/// passwords under a single service so they survive reinstalls per keychain policy.
public final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let service: String

    public init(service: String = "network.calimero.merotag") {
        self.service = service
    }

    public var nodeUrl: String? {
        get { read("nodeUrl") }      set { write("nodeUrl", newValue) }
    }
    public var accessToken: String? {
        get { read("accessToken") }  set { write("accessToken", newValue) }
    }
    public var refreshToken: String? {
        get { read("refreshToken") } set { write("refreshToken", newValue) }
    }

    public func clear() {
        for key in ["nodeUrl", "accessToken", "refreshToken"] { write(key, nil) }
    }

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key]
    }

    private func read(_ key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func write(_ key: String, _ value: String?) {
        SecItemDelete(query(key) as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        var q = query(key)
        q[kSecValueData as String] = data
        SecItemAdd(q as CFDictionary, nil)
    }
}
