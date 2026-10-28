import Foundation
import Security

/// Where this phone's device key lives at rest. The Keychain in the app; memory in tests.
public protocol DeviceKeyStore: Sendable {
    func load() throws -> Data?
    func save(_ scalar: Data) throws
    func clear() throws
}

/// The device key's private scalar in the Keychain: this device only, readable
/// only while the phone is unlocked, never synced or backed up.
public struct KeychainDeviceKeyStore: DeviceKeyStore {
    public let service: String
    public let account: String

    public init(service: String = "network.calimero.pass", account: String = "device-key") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: account]
    }

    public func load() throws -> Data? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        return out as? Data
    }

    public func save(_ scalar: Data) throws {
        SecItemDelete(query as CFDictionary)
        var q = query
        q[kSecValueData as String] = scalar
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    public func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
}

public struct KeychainError: Error, LocalizedError {
    public let status: OSStatus
    public var errorDescription: String? { "The Keychain refused (\(status))." }
}

public final class MemoryDeviceKeyStore: DeviceKeyStore, @unchecked Sendable {
    private var value: Data?
    private let lock = NSLock()

    public init(_ value: Data? = nil) { self.value = value }

    public func load() throws -> Data? { lock.withLock { value } }
    public func save(_ scalar: Data) throws { lock.withLock { value = scalar } }
    public func clear() throws { lock.withLock { value = nil } }
}

/// This phone's device key, and whether it is unlocked in memory (the web's
/// `DeviceKeeper`). The first unlock makes the key. Locking drops it, and with
/// it every open vault's keyring: the screens are rebuilt on each unlock.
///
/// The web seals its key under a passphrase or a passkey. A phone keeps it in
/// the Keychain (this device only, never backed up) and asks for Face ID,
/// Touch ID or the passcode before ``unlock()`` is called: the platform's own
/// passkey-grade gate, with nothing for the person to remember.
@MainActor
public final class DeviceKeeper: ObservableObject {
    @Published public private(set) var device: DeviceKeyPair?
    /// Moves on every unlock and lock, so screens holding a session can rebuild.
    @Published public private(set) var generation = 0

    private let store: DeviceKeyStore

    public init(store: DeviceKeyStore) { self.store = store }

    public var isUnlocked: Bool { device != nil }
    public var fingerprint: String? { device.map { PassCrypto.fingerprint(of: $0.publicRaw) } }

    /// Whether a key exists yet (a first unlock creates one).
    public var hasKey: Bool { ((try? store.load()) ?? nil) != nil }

    /// Load the key into memory, creating it on first use. Call after the
    /// biometric / passcode check.
    @discardableResult
    public func unlock() throws -> DeviceKeyPair {
        if let device { return device }
        let pair: DeviceKeyPair
        if let scalar = try store.load() {
            pair = try DeviceKeyPair(scalar: scalar)
        } else {
            pair = .generate()
            try store.save(pair.scalar)
        }
        device = pair
        generation += 1
        return pair
    }

    /// Drop the key from memory.
    public func lock() {
        guard device != nil else { return }
        device = nil
        generation += 1
    }

    /// Forget this phone's key, for signing out with "forget this device". A
    /// new key made later has to be approved, or restored with a recovery key.
    public func reset() throws {
        try store.clear()
        lock()
    }
}
