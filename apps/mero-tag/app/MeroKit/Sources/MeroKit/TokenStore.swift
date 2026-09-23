import Foundation

/// Holds the node URL + JWTs. The web client reads these from
/// `localStorage["mero-tokens"]` + `getNodeUrl()`; on iOS we back them with the
/// Keychain (or memory, for tests).
/// `Sendable` because the credentials are now read and written from more than
/// one place at once: the SSE task refreshes on its own while a location write
/// is in flight. Both implementations below serialise their accesses.
public protocol TokenStore: AnyObject, Sendable {
    var nodeUrl: String? { get set }
    var accessToken: String? { get set }
    var refreshToken: String? { get set }
    func clear()
}

/// In-memory store — used by unit tests and previews.
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var _nodeUrl: String?
    private var _accessToken: String?
    private var _refreshToken: String?

    public var nodeUrl: String? {
        get { lock.withLock { _nodeUrl } }      set { lock.withLock { _nodeUrl = newValue } }
    }
    public var accessToken: String? {
        get { lock.withLock { _accessToken } }  set { lock.withLock { _accessToken = newValue } }
    }
    public var refreshToken: String? {
        get { lock.withLock { _refreshToken } } set { lock.withLock { _refreshToken = newValue } }
    }

    public init(nodeUrl: String? = nil, accessToken: String? = nil, refreshToken: String? = nil) {
        self._nodeUrl = nodeUrl
        self._accessToken = accessToken
        self._refreshToken = refreshToken
    }

    public func clear() {
        lock.withLock { _nodeUrl = nil; _accessToken = nil; _refreshToken = nil }
    }
}

/// Keychain-backed store for the shipping app. Values are stored as generic
/// passwords under a single service so they survive reinstalls per keychain policy.
public final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let service: String
    /// `SecItemDelete` + `SecItemAdd` is a two-step write. Without this, the
    /// refresh task rotating the pair while a request reads it can observe the
    /// gap between them and send no Authorization header at all.
    private let lock = NSLock()

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
        lock.lock(); defer { lock.unlock() }
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func write(_ key: String, _ value: String?) {
        lock.lock(); defer { lock.unlock() }
        SecItemDelete(query(key) as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        var q = query(key)
        q[kSecValueData as String] = data
        SecItemAdd(q as CFDictionary, nil)
    }
}
