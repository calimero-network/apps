import Foundation
import MeroKit
import PassGenerated

/// MeroKit's bound contract as the generated client's transport. The two
/// protocols have the same requirements (JSON bytes in and out); they are
/// separate types only because the generated file declares its own.
public struct PassTransport: PassGenerated.ContextContractCalling {
    public let bound: BoundContextContract

    public init(_ bound: BoundContextContract) { self.bound = bound }

    public func query(method: String, argsJSON: Data) async throws -> Data {
        try await bound.query(method: method, argsJSON: argsJSON)
    }

    public func execute(method: String, argsJSON: Data) async throws -> Data {
        try await bound.execute(method: method, argsJSON: argsJSON)
    }
}

extension PassClient {
    /// The vault client for one context, over the account's relay.
    public static func make(contract: any ContextContract, contextId: String) -> PassClient {
        PassClient(transport: PassTransport(contract.bound(to: contextId)))
    }
}

/// The generated client, adapted to the narrow ``VaultAPI`` a session needs
/// (the web's `vaultApi.ts`), plus the calls the screens make directly.
public struct PassVaultAPI: VaultScreenAPI {
    public let client: PassClient

    public init(client: PassClient) { self.client = client }

    public init(contract: any ContextContract, contextId: String) {
        client = PassClient.make(contract: contract, contextId: contextId)
    }

    public func vaultInfo() async throws -> VaultInfoRecord {
        let i = try await client.vaultInfo()
        return VaultInfoRecord(
            name: i.name, currentKey: i.currentKey, defaultRole: i.defaultRole, myAccount: i.myAccount,
            myRole: Role(rawValue: i.myRole) ?? .pending)
    }

    public func registerDevice(fingerprint: String, publicKey: String, label: String, kind: DeviceKind) async throws {
        try await client.registerDevice(fingerprint: fingerprint, publicKey: publicKey, label: label, kind: kind.rawValue)
    }

    public func revokeDevice(fingerprint: String) async throws { try await client.revokeDevice(fingerprint: fingerprint) }

    public func listDevices() async throws -> [DeviceRecord] {
        try await client.listDevices().map {
            DeviceRecord(
                fingerprint: $0.fingerprint, publicKey: $0.publicKey, label: $0.label, kind: $0.kind,
                account: $0.account, addedAt: $0.addedAt, revoked: $0.revoked)
        }
    }

    public func listMembers() async throws -> [MemberRecord] {
        try await client.listMembers().map {
            MemberRecord(account: $0.account, role: Role(rawValue: $0.role) ?? .pending, devices: Int($0.devices))
        }
    }

    public func keyWrapsFor(recipient: String) async throws -> [WrapRecord] {
        try await client.keyWrapsFor(recipient: recipient).map {
            WrapRecord(keyId: $0.keyId, recipient: $0.recipient, wrapper: $0.wrapper, envelope: $0.envelope)
        }
    }

    public func wrappedPairs() async throws -> [String] { try await client.wrappedPairs() }

    @discardableResult
    public func addKeyWraps(_ wraps: [WrapRecord]) async throws -> Int {
        Int(
            try await client.addKeyWraps(
                wraps: wraps.map {
                    KeyWrapInput(keyId: $0.keyId, recipient: $0.recipient, wrapper: $0.wrapper, envelope: $0.envelope)
                }))
    }

    public func rotateKey(keyId: String) async throws { try await client.rotateKey(keyId: keyId) }

    public func setRole(account: String, role: Role) async throws {
        try await client.setRole(account: account, role: role.rawValue)
    }

    public func removeMember(account: String) async throws { try await client.removeMember(account: account) }

    public func listSecrets() async throws -> [SecretRecord] {
        try await client.listSecrets().map {
            SecretRecord(
                id: $0.id, kind: $0.kind, name: $0.name, tags: $0.tags, fields: $0.fields, createdAt: $0.createdAt,
                createdBy: $0.createdBy, updatedAt: $0.updatedAt, updatedBy: $0.updatedBy, trashed: $0.trashed,
                trashedAt: $0.trashedAt)
        }
    }

    @discardableResult
    public func addSecret(id: String, kind: String, name: String, tags: String, fields: [String: String]) async throws
        -> String
    {
        try await client.addSecret(id: id, kind: kind, name: name, tags: tags, fields: fields)
    }

    public func updateSecret(id: String, name: String?, tags: String?, fields: [String: String], rekey: Bool)
        async throws
    {
        try await client.updateSecret(id: id, name: name, tags: tags, fields: fields, rekey: rekey)
    }

    public func secretHistory(id: String) async throws -> [RevisionRecord] {
        try await client.secretHistory(id: id).map {
            RevisionRecord(field: $0.field, previous: $0.previous, replacedAt: $0.replacedAt, replacedBy: $0.replacedBy)
        }
    }

    public func trashSecret(id: String) async throws { try await client.trashSecret(id: id) }
    public func restoreSecret(id: String) async throws { try await client.restoreSecret(id: id) }
    public func purgeSecret(id: String) async throws { try await client.purgeSecret(id: id) }

    public func auditLogs() async throws -> [AuditRecord] {
        try await client.getAuditLogs().map {
            AuditRecord(
                action: $0.action, target: $0.target, account: $0.account, device: $0.device, timestamp: $0.timestamp,
                redacted: $0.redacted)
        }
    }

    public func setDefaultRole(_ role: Role) async throws { try await client.setDefaultRole(role: role.rawValue) }
}
