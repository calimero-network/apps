import Foundation
import MeroKit

/// Every vault this account has joined, across its teams (the web's
/// `forEachJoinedVault`).
public struct VaultDirectory: Sendable {
    public let backend: any MeroAppBackend
    public let apiFor: @Sendable (String) -> any VaultAPI

    public init(backend: any MeroAppBackend, apiFor: (@Sendable (String) -> any VaultAPI)? = nil) {
        self.backend = backend
        let contract = backend.contract
        self.apiFor = apiFor ?? { PassVaultAPI(contract: contract, contextId: $0) }
    }

    /// The context ids of every joined vault, with a label for progress.
    public func joinedVaults() async throws -> [(contextId: String, label: String)] {
        var out: [(String, String)] = []
        for ns in try await backend.listNamespaces() {
            let subgroups = (try? await backend.listSubgroups(namespaceId: ns.id)) ?? []
            for group in subgroups {
                guard let contextId = group.contextIds.first,
                    (try? await backend.isMember(contextId: contextId)) == true
                else { continue }
                out.append((contextId, displayName([group.name], id: group.groupId, fallback: "Vault")))
            }
        }
        return out
    }
}

/// The Security tab (the web's `SecurityPage`): auto-lock, the recovery key
/// (create it, or restore this phone with one). (Kotlin `SecurityModel`.)
@MainActor
public final class SecurityModel: ObservableObject {
    /// What a long action is doing, or what it came to.
    @Published public private(set) var status: String?
    @Published public var error: String?
    @Published public private(set) var busy = false
    /// The recovery code just made: shown once, then dropped.
    @Published public private(set) var shownCode: String?
    @Published public private(set) var recovery: RecoveryPublic?
    @Published public var autoLockMinutes: Int {
        didSet { preferences.autoLockMinutes = autoLockMinutes }
    }

    private let preferences: PassPreferences

    public init(preferences: PassPreferences) {
        self.preferences = preferences
        recovery = preferences.recoveryKey
        autoLockMinutes = preferences.autoLockMinutes
    }

    /// Make a recovery key and give it every vault key this phone holds, in
    /// every joined vault, replacing this account's previous one in each.
    public func createRecoveryKey(directory: VaultDirectory, device: DeviceKeyPair, label: String) async {
        busy = true
        error = nil
        defer { busy = false }
        let made = RecoveryCode.create()
        var covered = 0
        do {
            for vault in try await directory.joinedVaults() {
                status = "Giving the recovery key to \(vault.label)…"
                let session = VaultSession(
                    api: directory.apiFor(vault.contextId), device: device,
                    fingerprint: PassCrypto.fingerprint(of: device.publicRaw), label: label)
                guard (try? await session.open()) == .ready else { continue }
                if (try? await session.adoptRecoveryKey(made.key, replace: true)) ?? 0 > 0 { covered += 1 }
            }
            preferences.recoveryKey = made.key
            recovery = made.key
            shownCode = made.code
            status = "Recovery key created for \(covered) vault\(covered == 1 ? "" : "s")."
        } catch {
            status = nil
            self.error = PassErrorText.describe(error)
        }
    }

    /// The code was written down: forget it.
    public func dismissCode() { shownCode = nil }

    /// From a phone that holds nothing yet: rebuild the recovery key from
    /// `code` and hand every vault key it opens to this phone.
    @discardableResult
    public func restore(code: String, directory: VaultDirectory, device: DeviceKeyPair, label: String) async -> Int {
        busy = true
        error = nil
        defer { busy = false }
        do {
            _ = try RecoveryCode.decode(code)
            var found: RecoveryPublic?
            var restored = 0
            let phoneFp = PassCrypto.fingerprint(of: device.publicRaw)
            for vault in try await directory.joinedVaults() {
                status = "Restoring \(vault.label)…"
                let api = directory.apiFor(vault.contextId)
                let candidates = try await api.listDevices().filter { !$0.revoked }
                guard let pair = try RecoveryCode.pair(from: code, candidates: candidates) else { continue }
                found = RecoveryPublic(publicRaw: pair.device.publicRaw, fingerprint: pair.fingerprint)
                let recoverySession = VaultSession(api: api, device: pair.device, fingerprint: pair.fingerprint, label: "")
                guard try await recoverySession.refreshKeys() == .ready else { continue }
                try await recoverySession.handOver(publicRaw: device.publicRaw, fingerprint: phoneFp, label: label)
                restored += 1
            }
            guard let found else { throw RecoveryCode.Failure.noMatch }
            guard restored > 0 else { throw RecoveryCode.Failure.nothingOpened }
            preferences.recoveryKey = found
            recovery = found
            status =
                "\(restored) vault\(restored == 1 ? "" : "s") restored to this phone. Revoke the device you lost in each vault's People screen."
            return restored
        } catch {
            status = nil
            self.error = PassErrorText.describe(error)
            return 0
        }
    }
}
