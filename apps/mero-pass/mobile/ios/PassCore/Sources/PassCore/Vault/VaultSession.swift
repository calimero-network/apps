import Foundation

// One unlocked vault: the native twin of the web's
// `packages/mero-pass/src/vaultSession.ts`, with the same rules. Registering
// this device, opening the vault keys wrapped to it, bootstrapping a key for a
// new vault, handing keys on to entitled devices, approving or denying
// devices, rotating, recovery keys, and sealing or opening every field.
//
// It talks to the contract through `VaultAPI`, so the logic is tested against
// an in-memory fake (`Tests/PassCoreTests/FakeVault.swift`).

public enum Role: String, Sendable {
    case admin, editor, viewer, pending, removed

    var holdsKey: Bool { self == .admin || self == .editor || self == .viewer }
}

/// What a device's key is: a phone or browser used day to day, a recovery
/// key kept as a printed code, or an agent (mero-bot). A phone registers as
/// `browser`: the contract knows these three kinds, and a phone is the same
/// thing as far as the vault is concerned.
public enum DeviceKind: String, Sendable { case browser, recovery, agent }

public struct VaultInfoRecord: Equatable, Sendable {
    public var name: String
    public var currentKey: String
    public var defaultRole: String
    public var myAccount: String
    public var myRole: Role

    public init(name: String, currentKey: String, defaultRole: String, myAccount: String, myRole: Role) {
        self.name = name
        self.currentKey = currentKey
        self.defaultRole = defaultRole
        self.myAccount = myAccount
        self.myRole = myRole
    }
}

public struct SecretRecord: Equatable, Sendable {
    public var id: String
    public var kind: String
    public var name: String
    public var tags: String
    public var fields: [String: String]
    public var createdAt: UInt64
    public var createdBy: String
    public var updatedAt: UInt64
    public var updatedBy: String
    public var trashed: Bool
    public var trashedAt: UInt64

    public init(
        id: String, kind: String, name: String, tags: String, fields: [String: String], createdAt: UInt64 = 0,
        createdBy: String = "", updatedAt: UInt64 = 0, updatedBy: String = "", trashed: Bool = false,
        trashedAt: UInt64 = 0
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.tags = tags
        self.fields = fields
        self.createdAt = createdAt
        self.createdBy = createdBy
        self.updatedAt = updatedAt
        self.updatedBy = updatedBy
        self.trashed = trashed
        self.trashedAt = trashedAt
    }
}

public struct RevisionRecord: Equatable, Sendable {
    public var field: String
    public var previous: String
    public var replacedAt: UInt64
    public var replacedBy: String

    public init(field: String, previous: String, replacedAt: UInt64, replacedBy: String) {
        self.field = field
        self.previous = previous
        self.replacedAt = replacedAt
        self.replacedBy = replacedBy
    }
}

public struct DeviceRecord: Identifiable, Hashable, Sendable {
    public var fingerprint: String
    /// Base64 of the raw public key.
    public var publicKey: String
    public var label: String
    public var kind: String
    /// The account that registered it: the entry's owner stamp.
    public var account: String
    public var addedAt: UInt64
    public var revoked: Bool

    public var id: String { fingerprint }

    public init(
        fingerprint: String, publicKey: String, label: String, kind: String, account: String, addedAt: UInt64 = 0,
        revoked: Bool = false
    ) {
        self.fingerprint = fingerprint
        self.publicKey = publicKey
        self.label = label
        self.kind = kind
        self.account = account
        self.addedAt = addedAt
        self.revoked = revoked
    }
}

public struct MemberRecord: Identifiable, Hashable, Sendable {
    public var account: String
    public var role: Role
    public var devices: Int

    public var id: String { account }

    public init(account: String, role: Role, devices: Int) {
        self.account = account
        self.role = role
        self.devices = devices
    }
}

public struct WrapRecord: Equatable, Sendable {
    public var keyId: String
    public var recipient: String
    public var wrapper: String
    public var envelope: String

    public init(keyId: String, recipient: String, wrapper: String, envelope: String) {
        self.keyId = keyId
        self.recipient = recipient
        self.wrapper = wrapper
        self.envelope = envelope
    }
}

/// The contract surface a session needs (the web's `VaultApi`).
public protocol VaultAPI: Sendable {
    func vaultInfo() async throws -> VaultInfoRecord
    func registerDevice(fingerprint: String, publicKey: String, label: String, kind: DeviceKind) async throws
    func revokeDevice(fingerprint: String) async throws
    func listDevices() async throws -> [DeviceRecord]
    func listMembers() async throws -> [MemberRecord]
    func keyWrapsFor(recipient: String) async throws -> [WrapRecord]
    func wrappedPairs() async throws -> [String]
    @discardableResult func addKeyWraps(_ wraps: [WrapRecord]) async throws -> Int
    func rotateKey(keyId: String) async throws
    func setRole(account: String, role: Role) async throws
    func removeMember(account: String) async throws
    func listSecrets() async throws -> [SecretRecord]
    @discardableResult func addSecret(
        id: String, kind: String, name: String, tags: String, fields: [String: String]
    ) async throws -> String
    func updateSecret(id: String, name: String?, tags: String?, fields: [String: String], rekey: Bool) async throws
    func secretHistory(id: String) async throws -> [RevisionRecord]
}

/// One line of the vault's activity trail.
public struct AuditRecord: Hashable, Sendable {
    public var action: String
    public var target: String
    public var account: String
    public var device: String
    public var timestamp: UInt64
    public var redacted: Bool

    public init(action: String, target: String, account: String, device: String, timestamp: UInt64, redacted: Bool) {
        self.action = action
        self.target = target
        self.account = account
        self.device = device
        self.timestamp = timestamp
        self.redacted = redacted
    }
}

/// The calls the vault screens make beside the session's: the trash, the
/// activity trail and the default role.
public protocol VaultScreenAPI: VaultAPI {
    func trashSecret(id: String) async throws
    func restoreSecret(id: String) async throws
    func purgeSecret(id: String) async throws
    func auditLogs() async throws -> [AuditRecord]
    func setDefaultRole(_ role: Role) async throws
}

// MARK: - Plaintext shapes

public struct Secret: Identifiable, Equatable, Sendable {
    public var id: String
    public var kind: String
    public var name: String
    public var tags: [String]
    public var fields: [String: String]
    public var createdAt: UInt64
    public var createdBy: String
    public var updatedAt: UInt64
    public var updatedBy: String
    public var trashed: Bool
    public var trashedAt: UInt64
    /// Some envelope did not open on this device.
    public var unreadable: Bool

    public init(
        id: String, kind: String, name: String, tags: [String], fields: [String: String], createdAt: UInt64 = 0,
        createdBy: String = "", updatedAt: UInt64 = 0, updatedBy: String = "", trashed: Bool = false,
        trashedAt: UInt64 = 0, unreadable: Bool = false
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.tags = tags
        self.fields = fields
        self.createdAt = createdAt
        self.createdBy = createdBy
        self.updatedAt = updatedAt
        self.updatedBy = updatedBy
        self.trashed = trashed
        self.trashedAt = trashedAt
        self.unreadable = unreadable
    }
}

public struct Revision: Equatable, Sendable {
    public var field: String
    public var previous: String
    public var replacedAt: UInt64
    public var replacedBy: String
    public var unreadable: Bool
}

public struct SecretDraft: Equatable, Sendable {
    public var kind: String
    public var name: String
    public var tags: [String]
    public var fields: [String: String]

    public init(kind: String, name: String, tags: [String], fields: [String: String]) {
        self.kind = kind
        self.name = name
        self.tags = tags
        self.fields = fields
    }
}

public enum SessionState: String, Sendable {
    /// Holds the current key: can read and (role permitting) write.
    case ready
    /// Registered, but nobody holding the key has wrapped it to this device yet.
    case waiting
    /// A fresh vault whose admin has not opened it yet, so there is no key.
    case uninitialised
}

public struct Holders: Equatable, Sendable {
    public var browsers: Int
    public var recovery: Int
    public var agents: Int

    public init(browsers: Int, recovery: Int, agents: Int) {
        self.browsers = browsers
        self.recovery = recovery
        self.agents = agents
    }
}

public struct Chores: Equatable, Sendable {
    public var admitted: Int
    public var wrapped: Int
    public var removed: Int

    public init(admitted: Int, wrapped: Int, removed: Int) {
        self.admitted = admitted
        self.wrapped = wrapped
        self.removed = removed
    }
}

public enum VaultSessionError: Error, Equatable, LocalizedError {
    case noKey
    case adminOnly(String)
    case agent(String)

    public var errorDescription: String? {
        switch self {
        case .noKey: return "This device has not been given the vault key yet."
        case .adminOnly(let text), .agent(let text): return text
        }
    }
}

/// How a recovery key is listed among a vault's devices.
public let recoveryLabel = "Recovery key"

/// Which devices a key holder may wrap keys to without anyone being asked,
/// and which wait for approval. See the web's `classifyDevices`.
public func classifyDevices(
    _ devices: [DeviceRecord], members: [MemberRecord], pairs: [String], allowed: Set<String>?
) -> (entitled: [DeviceRecord], awaiting: [DeviceRecord]) {
    let role = Dictionary(members.map { ($0.account, $0.role) }, uniquingKeysWith: { first, _ in first })
    let holders = Set(pairs.map { pair -> String in
        guard let colon = pair.firstIndex(of: ":") else { return pair }
        return String(pair[pair.index(after: colon)...])
    })
    let live = devices.filter { d in
        !d.revoked && (role[d.account] ?? .pending).holdsKey && (allowed?.contains(d.account) ?? true)
    }
    let accountsWithApproved = Set(
        live.filter { $0.kind == DeviceKind.browser.rawValue && holders.contains($0.fingerprint) }.map(\.account))
    var entitled: [DeviceRecord] = []
    var awaiting: [DeviceRecord] = []
    for d in live {
        if holders.contains(d.fingerprint) {
            entitled.append(d)
        } else if d.kind == DeviceKind.recovery.rawValue {
            continue
        } else if d.kind == DeviceKind.agent.rawValue {
            awaiting.append(d)
        } else if !accountsWithApproved.contains(d.account) {
            entitled.append(d)
        } else {
            awaiting.append(d)
        }
    }
    return (entitled, awaiting)
}

/// Accounts that registered only agent keys: software, not people.
public func agentOnlyAccounts(_ devices: [DeviceRecord]) -> Set<String> {
    var kinds: [String: Set<String>] = [:]
    for d in devices where !d.revoked { kinds[d.account, default: []].insert(d.kind) }
    return Set(kinds.filter { $0.value == [DeviceKind.agent.rawValue] }.keys)
}

/// One vault, opened with this device's key.
public actor VaultSession {
    private static let nameField = "name"
    private static let tagsField = "tags"

    public let api: any VaultAPI
    private let device: DeviceKeyPair
    public nonisolated let fingerprint: String
    private let label: String
    public nonisolated let kind: DeviceKind

    public private(set) var keyring = Keyring()
    public private(set) var info: VaultInfoRecord?
    public private(set) var state: SessionState = .waiting

    public init(api: any VaultAPI, device: DeviceKeyPair, fingerprint: String, label: String, kind: DeviceKind = .browser) {
        self.api = api
        self.device = device
        self.fingerprint = fingerprint
        self.label = label
        self.kind = kind
    }

    private var isAgent: Bool { kind == .agent }
    private var current: VaultKey? { info.flatMap { keyring.get($0.currentKey) } }

    public var canWrite: Bool {
        state == .ready && (info?.myRole == .admin || info?.myRole == .editor)
    }

    public var isAdmin: Bool { info?.myRole == .admin }

    /// Register this device, open every key wrapped to it, and bootstrap a key
    /// if this is a new vault this account administers.
    @discardableResult
    public func open() async throws -> SessionState {
        try await api.registerDevice(
            fingerprint: fingerprint, publicKey: Bytes.b64(device.publicRaw), label: label, kind: kind)
        try await refreshKeys()
        if let info, info.currentKey.isEmpty, isAdmin, !isAgent { try await bootstrap() }
        return state
    }

    /// Re-read the vault info and pull in any wraps that arrived since.
    @discardableResult
    public func refreshKeys() async throws -> SessionState {
        let info = try await api.vaultInfo()
        self.info = info
        for wrap in try await api.keyWrapsFor(recipient: fingerprint) where !keyring.has(wrap.keyId) {
            if let key = PassCrypto.unwrapVaultKey(wrap.envelope, keyId: wrap.keyId, device: device) { keyring.add(key) }
        }
        state = info.currentKey.isEmpty ? .uninitialised : keyring.has(info.currentKey) ? .ready : .waiting
        return state
    }

    private func bootstrap() async throws {
        let key = VaultKey.generate()
        try await api.addKeyWraps([
            WrapRecord(
                keyId: key.keyId, recipient: fingerprint, wrapper: fingerprint,
                envelope: try PassCrypto.wrapVaultKey(key, to: device.publicRaw))
        ])
        try await api.rotateKey(keyId: key.keyId)
        keyring.add(key)
        try await refreshKeys()
    }

    private func classify(_ allowed: Set<String>?) async throws -> (
        entitled: [DeviceRecord], awaiting: [DeviceRecord], pairs: [String]
    ) {
        async let devices = api.listDevices()
        async let members = api.listMembers()
        async let pairs = api.wrappedPairs()
        let (d, m, p) = try await (devices, members, pairs)
        let split = classifyDevices(d, members: m, pairs: p, allowed: allowed)
        return (split.entitled, split.awaiting, p)
    }

    private func wrapToEntitled(_ key: VaultKey, allowed: Set<String>?) async throws -> Int {
        let classified = try await classify(allowed)
        let done = Set(classified.pairs)
        var wraps: [WrapRecord] = []
        for d in classified.entitled {
            if done.contains("\(key.keyId):\(d.fingerprint)") { continue }
            // The contract stores only an admin's wrap to an agent.
            if d.kind == DeviceKind.agent.rawValue && !isAdmin { continue }
            guard let publicRaw = try? Bytes.fromB64(d.publicKey) else { continue }
            wraps.append(
                WrapRecord(
                    keyId: key.keyId, recipient: d.fingerprint, wrapper: fingerprint,
                    envelope: try PassCrypto.wrapVaultKey(key, to: publicRaw)))
        }
        return wraps.isEmpty ? 0 : try await api.addKeyWraps(wraps)
    }

    /// The chores a key holder does whenever it opens the vault: admins finish
    /// removals (only against a listing that includes themselves) and admit
    /// pending accounts with the default role; everyone holding the current
    /// key hands it to entitled devices that lack it.
    @discardableResult
    public func housekeep(allowed: Set<String>? = nil) async throws -> Chores {
        var admitted = 0
        var removed = 0
        if isAgent { return Chores(admitted: 0, wrapped: 0, removed: 0) }
        if isAdmin, let info {
            let me = info.myAccount
            let members = try await api.listMembers()
            if let allowed, allowed.contains(me) {
                for m in members where m.role.holdsKey && m.account != me && !allowed.contains(m.account) {
                    try await api.removeMember(account: m.account)
                    removed += 1
                }
                if removed > 0 { _ = try await rotate(allowed: allowed) }
            }
            let role: Role = info.defaultRole == "viewer" ? .viewer : .editor
            let agents = agentOnlyAccounts(try await api.listDevices())
            for m in members where m.role == .pending {
                if let allowed, !allowed.contains(m.account) { continue }
                if agents.contains(m.account) { continue }
                try await api.setRole(account: m.account, role: role)
                admitted += 1
            }
        }
        var wrapped = 0
        if let key = current { wrapped = try await wrapToEntitled(key, allowed: allowed) }
        return Chores(admitted: admitted, wrapped: wrapped, removed: removed)
    }

    /// Mint a new key, give it to everyone still entitled, switch to it and
    /// re-seal every secret under it. Admin only.
    @discardableResult
    public func rotate(allowed: Set<String>?, progress: (@Sendable (Int, Int) -> Void)? = nil) async throws -> Int {
        guard isAdmin, !isAgent else { throw VaultSessionError.adminOnly("Only a vault Admin can rotate the key.") }
        let key = VaultKey.generate()
        keyring.add(key)
        _ = try await wrapToEntitled(key, allowed: allowed)
        try await api.addKeyWraps([
            WrapRecord(
                keyId: key.keyId, recipient: fingerprint, wrapper: fingerprint,
                envelope: try PassCrypto.wrapVaultKey(key, to: device.publicRaw))
        ])
        try await api.rotateKey(keyId: key.keyId)
        try await refreshKeys()

        let records = try await api.listSecrets()
        var done = 0
        for r in records {
            let plain = decrypt(r)
            if plain.unreadable { continue }
            var sealed: [String: String] = [:]
            for (f, v) in plain.fields {
                sealed[f] = try PassCrypto.sealField(key, secretId: r.id, field: f, plaintext: v)
            }
            try await api.updateSecret(
                id: r.id, name: try PassCrypto.sealField(key, secretId: r.id, field: Self.nameField, plaintext: plain.name),
                tags: try PassCrypto.sealField(
                    key, secretId: r.id, field: Self.tagsField, plaintext: Self.tagsJSON(plain.tags)),
                fields: sealed, rekey: true)
            done += 1
            progress?(done, records.count)
        }
        return done
    }

    /// Wrap every key in the keyring, old ones too, to one public key.
    private func grant(_ recipient: String, publicRaw: Data) async throws -> Int {
        var wraps: [WrapRecord] = []
        for keyId in keyring.ids {
            guard let key = keyring.get(keyId) else { continue }
            wraps.append(
                WrapRecord(
                    keyId: keyId, recipient: recipient, wrapper: fingerprint,
                    envelope: try PassCrypto.wrapVaultKey(key, to: publicRaw)))
        }
        if !wraps.isEmpty { try await api.addKeyWraps(wraps) }
        return wraps.count
    }

    /// Register `next` and give it every key this device holds.
    @discardableResult
    public func handOver(
        publicRaw: Data, fingerprint nextFingerprint: String, label: String, kind: DeviceKind = .browser
    ) async throws -> Int {
        try await api.registerDevice(
            fingerprint: nextFingerprint, publicKey: Bytes.b64(publicRaw), label: label, kind: kind)
        return try await grant(nextFingerprint, publicRaw: publicRaw)
    }

    /// Give this account's recovery key every key in this vault. With
    /// `replace`, any other recovery key the account registered here is
    /// withdrawn first; without it, a different one already here wins.
    @discardableResult
    public func adoptRecoveryKey(_ recovery: RecoveryPublic, replace: Bool = false) async throws -> Int {
        guard state == .ready, let info else { return 0 }
        let me = info.myAccount
        let devices = try await api.listDevices()
        let others = devices.filter {
            $0.kind == DeviceKind.recovery.rawValue && $0.account == me && !$0.revoked
                && $0.fingerprint != recovery.fingerprint
        }
        if !others.isEmpty && !replace { return 0 }
        for d in others { try await api.revokeDevice(fingerprint: d.fingerprint) }
        let listed = devices.first { $0.fingerprint == recovery.fingerprint }
        if listed?.revoked == true { return 0 }
        let pairs = Set(try await api.wrappedPairs())
        if listed != nil && pairs.contains("\(info.currentKey):\(recovery.fingerprint)") { return 0 }
        return try await handOver(
            publicRaw: recovery.publicRaw, fingerprint: recovery.fingerprint, label: recoveryLabel, kind: .recovery)
    }

    /// Withdraw this device from the vault.
    public func retire() async throws { try await api.revokeDevice(fingerprint: fingerprint) }

    // MARK: Device approval

    /// Whether this device waits for an approval rather than for any key holder.
    public func awaitingApproval(allowed: Set<String>? = nil) async throws -> Bool {
        try await classify(allowed).awaiting.contains { $0.fingerprint == fingerprint }
    }

    /// Devices this one could approve: its own account's, or everyone's for an admin.
    public func pendingApprovals(allowed: Set<String>? = nil) async throws -> [DeviceRecord] {
        guard state == .ready, let info, !isAgent else { return [] }
        let me = info.myAccount
        return try await classify(allowed).awaiting.filter {
            $0.fingerprint != fingerprint && (isAdmin || ($0.account == me && $0.kind != DeviceKind.agent.rawValue))
        }
    }

    /// Let a waiting device in: hand it every key this device holds.
    @discardableResult
    public func approve(_ request: DeviceRecord) async throws -> Int {
        guard state == .ready else { throw VaultSessionError.noKey }
        if isAgent { throw VaultSessionError.agent("An agent cannot approve devices.") }
        if request.kind == DeviceKind.agent.rawValue && !isAdmin {
            throw VaultSessionError.adminOnly("Only a vault Admin can let an agent in.")
        }
        return try await grant(request.fingerprint, publicRaw: try Bytes.fromB64(request.publicKey))
    }

    /// Turn a request down: an owner's revocation withdraws it, an admin's marks it revoked.
    public func deny(_ request: DeviceRecord) async throws {
        try await api.revokeDevice(fingerprint: request.fingerprint)
    }

    /// How many devices hold the current key.
    public func holders() async throws -> Holders {
        guard let current = info?.currentKey, !current.isEmpty else { return Holders(browsers: 0, recovery: 0, agents: 0) }
        async let devices = api.listDevices()
        async let pairs = api.wrappedPairs()
        let (d, p) = try await (devices, pairs)
        let holding = Set(p.filter { $0.hasPrefix("\(current):") }.map { String($0.dropFirst(current.count + 1)) })
        var out = Holders(browsers: 0, recovery: 0, agents: 0)
        for device in d where !device.revoked && holding.contains(device.fingerprint) {
            switch device.kind {
            case DeviceKind.recovery.rawValue: out.recovery += 1
            case DeviceKind.agent.rawValue: out.agents += 1
            default: out.browsers += 1
            }
        }
        return out
    }

    // MARK: Secrets

    private func open1(_ id: String, _ field: String, _ envelope: String) -> (value: String, ok: Bool) {
        do {
            return (try PassCrypto.openField(keyring, secretId: id, field: field, envelope: envelope), true)
        } catch {
            return ("", false)
        }
    }

    static func tagsJSON(_ tags: [String]) -> String {
        // `JSON.stringify(string[])`: no spaces, `/` not escaped.
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return (try? String(data: encoder.encode(tags), encoding: .utf8) ?? "[]") ?? "[]"
    }

    public func decrypt(_ r: SecretRecord) -> Secret {
        var unreadable = false
        let name = open1(r.id, Self.nameField, r.name)
        let tagsRaw = open1(r.id, Self.tagsField, r.tags)
        unreadable = unreadable || !name.ok || !tagsRaw.ok
        let tags = tagsRaw.value.isEmpty
            ? [] : ((try? JSONDecoder().decode([String].self, from: Data(tagsRaw.value.utf8))) ?? [])
        var fields: [String: String] = [:]
        for (f, env) in r.fields {
            let v = open1(r.id, f, env)
            unreadable = unreadable || !v.ok
            fields[f] = v.value
        }
        return Secret(
            id: r.id, kind: r.kind, name: name.ok ? name.value : "Locked item", tags: tags, fields: fields,
            createdAt: r.createdAt, createdBy: r.createdBy, updatedAt: r.updatedAt, updatedBy: r.updatedBy,
            trashed: r.trashed, trashedAt: r.trashedAt, unreadable: unreadable)
    }

    public func list() async throws -> [Secret] {
        try await api.listSecrets().map { decrypt($0) }
    }

    private func requireKey() throws -> VaultKey {
        guard let key = current else { throw VaultSessionError.noKey }
        return key
    }

    @discardableResult
    public func add(_ draft: SecretDraft) async throws -> String {
        let key = try requireKey()
        let id = PassCrypto.newSecretId()
        var fields: [String: String] = [:]
        for (f, v) in draft.fields where !v.isEmpty {
            fields[f] = try PassCrypto.sealField(key, secretId: id, field: f, plaintext: v)
        }
        return try await api.addSecret(
            id: id, kind: draft.kind,
            name: try PassCrypto.sealField(key, secretId: id, field: Self.nameField, plaintext: draft.name),
            tags: try PassCrypto.sealField(key, secretId: id, field: Self.tagsField, plaintext: Self.tagsJSON(draft.tags)),
            fields: fields)
    }

    /// Write only what changed relative to `before`, so an untouched field
    /// cannot overwrite a concurrent edit made on another device.
    public func update(_ before: Secret, to after: SecretDraft) async throws {
        let key = try requireKey()
        let id = before.id
        var fields: [String: String] = [:]
        for f in Set(before.fields.keys).union(after.fields.keys) {
            let next = after.fields[f] ?? ""
            if next == (before.fields[f] ?? "") { continue }
            fields[f] = try PassCrypto.sealField(key, secretId: id, field: f, plaintext: next)
        }
        let name = after.name != before.name
            ? try PassCrypto.sealField(key, secretId: id, field: Self.nameField, plaintext: after.name) : nil
        let tags = after.tags != before.tags
            ? try PassCrypto.sealField(key, secretId: id, field: Self.tagsField, plaintext: Self.tagsJSON(after.tags))
            : nil
        if name == nil && tags == nil && fields.isEmpty { return }
        try await api.updateSecret(id: id, name: name, tags: tags, fields: fields, rekey: false)
    }

    public func history(_ id: String) async throws -> [Revision] {
        try await api.secretHistory(id: id).map { r in
            let v = open1(id, r.field, r.previous)
            return Revision(
                field: r.field, previous: v.value, replacedAt: r.replacedAt, replacedBy: r.replacedBy,
                unreadable: !v.ok)
        }
    }
}
