import Foundation

@testable import PassCore

/// A shared in-memory vault, and one ``VaultAPI`` handle per account: the
/// web's `FakeVault` from `vaultSession.test.ts`, with the contract's rules
/// (roles, the device registry, wraps that land only on registered unrevoked
/// devices, wraps that approve only when a role holder wrote them, field-level
/// updates). Android's `FakeVault.kt` is the same.
final class FakeVault: @unchecked Sendable {
    struct StoredWrap {
        var wrap: WrapRecord
        var by: String
    }

    private let lock = NSLock()
    var name = "Team vault"
    var currentKey = ""
    var defaultRole = "editor"
    var roles: [String: Role] = [:]
    var devices: [String: DeviceRecord] = [:]
    var deviceOrder: [String] = []
    var wraps: [String: StoredWrap] = [:]
    var secrets: [String: SecretRecord] = [:]
    var secretOrder: [String] = []
    var history: [(id: String, field: String, previous: String)] = []

    init(creator: String) { roles[creator] = .admin }

    func sync<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    var audit: [AuditRecord] = []

    func api(_ account: String) -> Handle { Handle(vault: self, account: account) }

    struct Handle: VaultScreenAPI {
        let vault: FakeVault
        let account: String

        private func role() -> Role { vault.roles[account] ?? .pending }
        private func mustWrite() throws {
            if role() != .admin && role() != .editor { throw FakeError.denied("view-only") }
        }

        func vaultInfo() async throws -> VaultInfoRecord {
            vault.sync {
                VaultInfoRecord(
                    name: vault.name, currentKey: vault.currentKey, defaultRole: vault.defaultRole, myAccount: account,
                    myRole: role())
            }
        }

        func registerDevice(fingerprint: String, publicKey: String, label: String, kind: DeviceKind) async throws {
            vault.sync {
                if vault.devices[fingerprint] == nil {
                    vault.devices[fingerprint] = DeviceRecord(
                        fingerprint: fingerprint, publicKey: publicKey, label: label, kind: kind.rawValue,
                        account: account)
                    vault.deviceOrder.append(fingerprint)
                }
            }
        }

        func revokeDevice(fingerprint: String) async throws {
            try vault.sync {
                guard let d = vault.devices[fingerprint] else { throw FakeError.denied("no such device") }
                if d.account == account {
                    vault.devices[fingerprint] = nil
                    vault.deviceOrder.removeAll { $0 == fingerprint }
                } else if role() == .admin {
                    vault.devices[fingerprint]?.revoked = true
                } else {
                    throw FakeError.denied("owner or admin only")
                }
            }
        }

        func listDevices() async throws -> [DeviceRecord] {
            vault.sync { vault.deviceOrder.compactMap { vault.devices[$0] } }
        }

        func listMembers() async throws -> [MemberRecord] {
            vault.sync {
                var out = vault.roles.map { MemberRecord(account: $0.key, role: $0.value, devices: 0) }
                for fp in vault.deviceOrder {
                    guard let d = vault.devices[fp] else { continue }
                    if !out.contains(where: { $0.account == d.account }) {
                        out.append(MemberRecord(account: d.account, role: .pending, devices: 0))
                    }
                }
                return out
            }
        }

        func keyWrapsFor(recipient: String) async throws -> [WrapRecord] {
            vault.sync { vault.wraps.values.map(\.wrap).filter { $0.recipient == recipient } }
        }

        func wrappedPairs() async throws -> [String] {
            vault.sync {
                vault.wraps.values.filter { w in
                    let by = vault.roles[w.by]
                    if vault.devices[w.wrap.recipient]?.kind == DeviceKind.agent.rawValue { return by == .admin }
                    return by?.holdsKey ?? false
                }
                .map { "\($0.wrap.keyId):\($0.wrap.recipient)" }
            }
        }

        func addKeyWraps(_ wraps: [WrapRecord]) async throws -> Int {
            vault.sync {
                var n = 0
                for w in wraps {
                    guard let d = vault.devices[w.recipient], !d.revoked else { continue }
                    if d.kind == DeviceKind.agent.rawValue && role() != .admin { continue }
                    let slot = "\(w.keyId):\(w.recipient):\(w.wrapper)"
                    if vault.wraps[slot] != nil { continue }
                    vault.wraps[slot] = StoredWrap(wrap: w, by: account)
                    n += 1
                }
                return n
            }
        }

        func rotateKey(keyId: String) async throws {
            try vault.sync {
                guard role() == .admin else { throw FakeError.denied("admin only") }
                vault.currentKey = keyId
            }
        }

        func setRole(account target: String, role newRole: Role) async throws {
            try vault.sync {
                guard role() == .admin else { throw FakeError.denied("admin only") }
                vault.roles[target] = newRole
            }
        }

        func removeMember(account target: String) async throws {
            try vault.sync {
                guard role() == .admin else { throw FakeError.denied("admin only") }
                vault.roles[target] = .removed
                for (fp, d) in vault.devices where d.account == target { vault.devices[fp]?.revoked = true }
            }
        }

        func listSecrets() async throws -> [SecretRecord] {
            vault.sync { vault.secretOrder.compactMap { vault.secrets[$0] } }
        }

        func addSecret(id: String, kind: String, name: String, tags: String, fields: [String: String]) async throws
            -> String
        {
            try vault.sync {
                try mustWrite()
                vault.secrets[id] = SecretRecord(
                    id: id, kind: kind, name: name, tags: tags, fields: fields, createdAt: 1, createdBy: account,
                    updatedAt: 1, updatedBy: account)
                vault.secretOrder.append(id)
                return id
            }
        }

        func updateSecret(id: String, name: String?, tags: String?, fields: [String: String], rekey: Bool) async throws {
            try vault.sync {
                try mustWrite()
                guard var s = vault.secrets[id] else { throw FakeError.denied("secret not found") }
                func note(_ field: String, _ previous: String) {
                    if !rekey && !previous.isEmpty { vault.history.append((id, field, previous)) }
                }
                if let name {
                    note("name", s.name)
                    s.name = name
                }
                if let tags {
                    note("tags", s.tags)
                    s.tags = tags
                }
                for (f, value) in fields {
                    note(f, s.fields[f] ?? "")
                    s.fields[f] = value.isEmpty ? nil : value
                }
                vault.secrets[id] = s
            }
        }

        func trashSecret(id: String) async throws {
            try vault.sync {
                try mustWrite()
                vault.secrets[id]?.trashed = true
                vault.secrets[id]?.trashedAt = 2
                vault.audit.append(AuditRecord(action: "trash", target: id, account: account, device: "", timestamp: 2, redacted: false))
            }
        }

        func restoreSecret(id: String) async throws {
            try vault.sync {
                try mustWrite()
                vault.secrets[id]?.trashed = false
            }
        }

        func purgeSecret(id: String) async throws {
            try vault.sync {
                guard role() == .admin else { throw FakeError.denied("admin only") }
                vault.secrets[id] = nil
                vault.secretOrder.removeAll { $0 == id }
            }
        }

        func auditLogs() async throws -> [AuditRecord] { vault.sync { vault.audit } }

        func setDefaultRole(_ role: Role) async throws {
            try vault.sync {
                guard self.role() == .admin else { throw FakeError.denied("admin only") }
                vault.defaultRole = role.rawValue
            }
        }

        func secretHistory(id: String) async throws -> [RevisionRecord] {
            vault.sync {
                vault.history.filter { $0.id == id }.map {
                    RevisionRecord(field: $0.field, previous: $0.previous, replacedAt: 1, replacedBy: "")
                }
            }
        }
    }
}

enum FakeError: Error, Equatable {
    case denied(String)
}

let alice = String(repeating: "a", count: 64)
let bob = String(repeating: "b", count: 64)

/// A device of `account` in `vault`, with a session over it.
func browser(_ vault: FakeVault, _ account: String) -> (fp: String, device: DeviceKeyPair, session: VaultSession) {
    let device = DeviceKeyPair.generate()
    let fp = PassCrypto.fingerprint(of: device.publicRaw)
    return (fp, device, VaultSession(api: vault.api(account), device: device, fingerprint: fp, label: "test"))
}
