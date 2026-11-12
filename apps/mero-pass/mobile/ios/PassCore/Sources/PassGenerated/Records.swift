import Foundation
import MeroKit

// The vault's types, in the generated client's module (PassCore has a `Secret` and a `Revision` of
// its own). The calls and the answer types are the generated `PassClient` (`PassClient.swift`,
// `scripts/mobile-codegen.sh` at the repo root); the state types below the answers are kept by hand.

// MARK: - The answers

// The answer types are the generated client's (`PassClient.swift`, from the ABI); u64 fields are
// decimal strings on the wire and `UInt64` here.

public typealias AuditView = PassClient.AuditView
public typealias DeviceView = PassClient.DeviceView
public typealias KeyWrapInput = PassClient.KeyWrapInput
public typealias KeyWrapView = PassClient.KeyWrapView
public typealias MemberView = PassClient.MemberView
public typealias RevisionView = PassClient.RevisionView
public typealias SecretView = PassClient.SecretView
public typealias VaultInfo = PassClient.VaultInfo

// MARK: - The contract's state types


/// One line of the activity trail. Who wrote it is the slot's owner stamp,
/// not a field: an author can claim anything in their own entry.
public struct AuditLogEntry: Codable, Sendable, Equatable {
    public var action: String
    /// The object acted on: a secret id, an account, a device fingerprint.
    /// Never a secret's name — names are ciphertext, and a trail that echoed
    /// them in the clear would undo the encryption.
    public var target: String
    /// The author's node device, as the author's node reported it.
    public var device: String
    public var timestamp: UInt64

    public init(action: String, target: String, device: String, timestamp: UInt64) {
        self.action = action
        self.target = target
        self.device = device
        self.timestamp = timestamp
    }
}

/// A device public key the vault key may be wrapped to.
///
/// Stored in an [`AuthoredMap`], so only the account that registered it can
/// remove it. Its account is the entry's owner stamp, which every node
/// verifies — never a field in the value, which a modified node could fill
/// with anyone's account to be handed the vault key in their name.
///
/// Keys are per owner (core rc.57): two accounts registering one fingerprint
/// hold two entries, each read with its own account (`entries_with_owners`).
/// A key-only `owner_of` would only ever name the caller.
public struct DeviceKey: Codable, Sendable, Equatable {
    /// Base64 of the raw (uncompressed) P-256 ECDH public key.
    public var publicKey: String
    public var label: String
    /// `browser` for a browser's device key; `recovery` for an account's
    /// offline recovery key, whose private half exists only on paper; `agent`
    /// for the key of software acting for its account, admitted by an admin.
    public var kind: String
    public var nodeDevice: String
    public var addedAt: UInt64

    public init(publicKey: String, label: String, kind: String, nodeDevice: String, addedAt: UInt64) {
        self.publicKey = publicKey
        self.label = label
        self.kind = kind
        self.nodeDevice = nodeDevice
        self.addedAt = addedAt
    }

    enum CodingKeys: String, CodingKey {
        case publicKey
        case label
        case kind
        case nodeDevice
        case addedAt
    }
}

public struct Event_SecretChanged: Codable, Sendable, Equatable {
    public var secretId: String

    public init(secretId: String) {
        self.secretId = secretId
    }

    enum CodingKeys: String, CodingKey {
        case secretId
    }
}

/// The vault key, wrapped to one device key by one wrapper.
///
/// Keyed by `recipient:key_id:nonce` in an authored map: the random nonce
/// means nobody can occupy the key a genuine wrap will be written under, and the owner stamp says who wrapped
/// it. A forged wrap is detectable anyway — the recipient checks that the
/// unwrapped key hashes to `key_id` — but it must not be able to displace a
/// genuine one, nor make a device look approved (see `wrapped_pairs`).
public struct KeyWrap: Codable, Sendable, Equatable {
    public var keyId: String
    public var recipient: String
    public var wrapper: String
    /// ECIES envelope: ephemeral public key, IV and ciphertext, base64 JSON.
    public var envelope: String
    public var wrappedAt: UInt64

    public init(keyId: String, recipient: String, wrapper: String, envelope: String, wrappedAt: UInt64) {
        self.keyId = keyId
        self.recipient = recipient
        self.wrapper = wrapper
        self.envelope = envelope
        self.wrappedAt = wrappedAt
    }

    enum CodingKeys: String, CodingKey {
        case keyId
        case recipient
        case wrapper
        case envelope
        case wrappedAt
    }
}

public struct MeroPassApp: Codable, Sendable, Equatable {
    /// The vault's human name as created, readable by every member on every
    /// node. The frontend also writes it to the subgroup's metadata, for
    /// members who have not entered the vault yet; this copy (or a rename in
    /// `settings`) is the authoritative one.
    public var vaultName: String
    public var roles: [String: Bool]
    public var secrets: [String: Secret]
    /// `secret_id/rev_id` → superseded value, so a secret's history is one
    /// prefix read.
    public var history: [String: Revision]
    /// Admin-only settings: `default_role`, `current_key`, `revoked:<fp>`.
    public var admin: [String: String]
    /// Editor-writable settings: the vault's name after a rename.
    public var settings: [String: String]
    /// Device fingerprint → public key. Any member may register their own.
    public var devices: [String: DeviceKey]
    /// `recipient:key_id:nonce` → wrapped vault key.
    public var keyWraps: [String: KeyWrap]
    /// Append-only. Entries can be blanked only by their own author, and a
    /// blanked slot stays visible as a redaction.
    public var audit: [AuditLogEntry]

    public init(vaultName: String, roles: [String: Bool], secrets: [String: Secret], history: [String: Revision], admin: [String: String], settings: [String: String], devices: [String: DeviceKey], keyWraps: [String: KeyWrap], audit: [AuditLogEntry]) {
        self.vaultName = vaultName
        self.roles = roles
        self.secrets = secrets
        self.history = history
        self.admin = admin
        self.settings = settings
        self.devices = devices
        self.keyWraps = keyWraps
        self.audit = audit
    }

    enum CodingKeys: String, CodingKey {
        case vaultName
        case roles
        case secrets
        case history
        case admin
        case settings
        case devices
        case keyWraps
        case audit
    }
}

/// A superseded field value. Written once, never edited.
public struct Revision: Codable, Sendable, Equatable {
    /// The field that changed; `name` and `tags` use those reserved names.
    public var field: String
    /// The value it held before, still encrypted (under whichever vault key it
    /// was written with — the envelope names its key).
    public var previous: String
    public var replacedAt: UInt64
    public var replacedBy: String

    public init(field: String, previous: String, replacedAt: UInt64, replacedBy: String) {
        self.field = field
        self.previous = previous
        self.replacedAt = replacedAt
        self.replacedBy = replacedBy
    }

    enum CodingKeys: String, CodingKey {
        case field
        case previous
        case replacedAt
        case replacedBy
    }
}

/// One secret, as independent registers rather than one record.
///
/// Field-level registers are the point: Alice fixing the URL while Bob rotates
/// the password are writes to two different registers, so BOTH survive the
/// merge. A single last-writer-wins record would keep one edit and silently
/// discard the other. Within one field, last writer wins by HLC — there is no
/// meaningful way to merge two different passwords.
public struct Secret: Codable, Sendable, Equatable {
    /// Cleartext kind — `login`, `totp`, … — so the UI can pick an icon.
    public var kind: String
    /// Encrypted display name.
    public var name: String
    /// Encrypted tag list (one envelope over a JSON array).
    public var tags: String
    /// Field name (`password`, `url`, …) → encrypted value.
    public var fields: [String: String]
    public var createdAt: UInt64
    public var createdBy: String
    public var updatedAt: UInt64
    public var updatedBy: String
    /// Tombstone. Trashing is a flag rather than a `remove`, because the map is
    /// add-wins: a hard remove loses to a concurrent edit and the secret comes
    /// back. The flag resolves edit-vs-trash by HLC instead.
    public var trashed: Bool
    public var trashedAt: UInt64

    public init(kind: String, name: String, tags: String, fields: [String: String], createdAt: UInt64, createdBy: String, updatedAt: UInt64, updatedBy: String, trashed: Bool, trashedAt: UInt64) {
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

    enum CodingKeys: String, CodingKey {
        case kind
        case name
        case tags
        case fields
        case createdAt
        case createdBy
        case updatedAt
        case updatedBy
        case trashed
        case trashedAt
    }
}
