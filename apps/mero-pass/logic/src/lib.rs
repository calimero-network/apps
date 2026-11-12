//! Mero Pass: one vault's state, on core's component SDK (`calimero-sdk`).
//!
//! An app instance IS a vault. It holds what every member of the vault reads:
//! the vault's name, its secrets, who may change them, the device keys the vault
//! key is wrapped to, and an append-only activity trail.
//!
//! # What the node never sees
//!
//! Every secret NAME, FIELD and TAG list arrives here already encrypted by the
//! browser under the vault key (AES-256-GCM, `packages/mero-pass/src/crypto.ts`).
//! The contract stores ciphertext envelopes and never decrypts them; it cannot:
//! the vault key only exists wrapped to device public keys, whose private halves
//! live in each browser. Only a secret's KIND (login, totp, …) and its
//! bookkeeping (who, when) are cleartext, so the UI can draw an icon before the
//! vault is unlocked.
//!
//! # One log, plain data
//!
//! The app runs on its cluster's leader, which applies every write in one
//! replicated log. v1's CRDT plumbing has nothing left to decide, so the state is
//! plain tables and maps:
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `Frozen<String>` name + `settings` rename register | `vaultName: Cell<String>` (set by `renameVault`) |
//! | `AccessControl` (admin tier + `editor`/`viewer` roles) | `members: Table<Member>`, a maintained `perRole` count |
//! | `PermissionedStorage<UnorderedMap<String, Secret>>`, a `Secret` of `LwwRegister`s | `secrets: Table<Secret>` + `secretFields: UnorderedMap<(id, field), String>` (a record cannot hold a map) |
//! | `PermissionedStorage<SortedMap<"id/rev", Revision>>` | `history: UnorderedMap<(id, seq), Revision>`, `seq` from `revisionSeq: Counter` |
//! | `admin` flags `default_role`, `current_key` | `defaultRole`, `currentKey: Cell<String>` |
//! | `admin` flags `revoked:<fp>`, `removed:<account>` | `revoked`, `removed: Set<String>` |
//! | `AuthoredMap<String, DeviceKey>` (owner stamp per entry) | `devices: Table<Device>` keyed `(fingerprint, account)`, the account a field |
//! | `AuthoredMap<String, KeyWrap>` | `keyWraps: Table<KeyWrap>`, `wrappedBy` a field; `byRecipient`, `byKey`, `byAuthor` indexes |
//! | `AuthoredVector<AuditLogEntry>` | `audit: Vector<AuditEntry>`, `account` a field |
//!
//! # Who may do what
//!
//! The organization decides who reaches the app (its owner, admins, members and
//! guests). Inside the vault there are three roles, Admin, Editor and Viewer,
//! plus `pending`: an account that registered a device and was never let in.
//! The account that creates the vault is its first Admin.
//!
//! v1 enforced the write rules in storage (capability masks re-checked by every
//! peer at merge, owner stamps on authored entries). Every write here goes
//! through a method, so they are checks in the method, against `env::caller()`,
//! before anything is written:
//!
//! | rule | methods | refused with |
//! |---|---|---|
//! | Editor or Admin | `addSecret`, `updateSecret`, `trashSecret`, `restoreSecret`, `renameVault` | `Forbidden` |
//! | Admin | `setRole`, `removeMember`, `setDefaultRole`, `rotateKey`, `purgeSecret` | `Forbidden` |
//! | the device's own account, or an Admin | `revokeDevice` | `Forbidden` |
//! | an Admin's wrap only, to an agent's key | `addKeyWraps` (skipped), `wrappedPairs` (not counted) | — |
//! | a role holder's wrap only | `wrappedPairs` (not counted) | — |
//!
//! A device's account, a wrap's author and an audit line's account are the
//! caller's account, written by the method: nobody can write one in someone
//! else's name, which is what v1's owner stamps guaranteed.
//!
//! Everything a client sees differently from v1 is listed in
//! `apps/mero-pass/README.md`, "What changed in the port".

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::env::Caller;
use calimero_sdk::prelude::*;
use calimero_sdk::StorageError;
use serde::Serialize;

/// The most rows one storage read returns.
const PAGE: u32 = 1000;

/// Upper bound on one ciphertext envelope. A 64 KiB note, base64'd and wrapped,
/// fits comfortably; anything larger belongs in a blob.
const MAX_ENVELOPE_LEN: usize = 128 * 1024;

/// Upper bound on the number of fields one secret may carry.
const MAX_FIELDS: usize = 64;

/// The longest field name, account, key id or label, in bytes: they are parts of
/// storage keys, which the node caps at 1 KiB.
const MAX_NAME_LEN: usize = 256;

/// What a registered device key is. A recovery key is shown and handled
/// differently by clients (never prompted for approval, listed separately). An
/// agent key belongs to software acting for its account (mero-bot): clients
/// never let it in by themselves, and only an admin's wrap admits it.
const DEVICE_KINDS: [&str; 3] = ["browser", "recovery", "agent"];
const DEVICE_AGENT: &str = "agent";

/// The secret kinds the UI knows how to render. `api_key` and `oauth2` are the
/// credentials an agent's plugins connect to outside services with.
const SECRET_KINDS: [&str; 8] = [
    "login",
    "secure_note",
    "totp",
    "ssh_key",
    "payment_card",
    "identity",
    "api_key",
    "oauth2",
];

const ROLE_ADMIN: &str = "admin";
const ROLE_EDITOR: &str = "editor";
const ROLE_VIEWER: &str = "viewer";
const ROLE_PENDING: &str = "pending";
const ROLE_REMOVED: &str = "removed";

// ── stored records ───────────────────────────────────────────────────────────

/// A vault role held by one account: `admin`, `editor` or `viewer`. An account
/// with no row is `pending`.
#[derive(Record)]
#[table(key = "account", index(by_role = ["role", "account"]), count(per_role = ["role"]))]
pub struct Member {
    pub account: String,
    pub role: String,
}

/// One secret's cleartext bookkeeping and its encrypted name and tags. Its
/// fields are rows of `secretFields`, keyed `(id, field)`.
#[derive(Record)]
#[table(key = "id")]
pub struct Secret {
    /// `secret_` and 32 hex characters, chosen by the client.
    pub id: String,
    /// Cleartext kind, one of [`SECRET_KINDS`], so the UI can pick an icon.
    pub kind: String,
    /// Encrypted display name.
    pub name: String,
    /// Encrypted tag list (one envelope over a JSON array).
    pub tags: String,
    pub created_at: u64,
    pub created_by: String,
    pub updated_at: u64,
    pub updated_by: String,
    /// In the trash: recoverable until an admin purges it.
    pub trashed: bool,
    pub trashed_at: u64,
}

/// A superseded field value. Written once, never edited.
#[derive(Record)]
#[table(key = ["secret_id", "seq"], index(by_secret = ["secret_id", "seq"]))]
pub struct RevisionRow {
    pub secret_id: String,
    pub seq: u64,
    /// The field that changed; `name` and `tags` use those reserved names.
    pub field: String,
    /// The value it held before, still encrypted (under whichever vault key it
    /// was written with: the envelope names its key).
    pub previous: String,
    pub replaced_at: u64,
    pub replaced_by: String,
}

/// A device public key the vault key may be wrapped to, registered by
/// `account`: the caller of `registerDevice`, never a value the registrant
/// chose. Two accounts registering one fingerprint hold two rows.
#[derive(Record)]
#[table(
    key = ["fingerprint", "account"],
    index(by_fingerprint = ["fingerprint", "account"]),
    index(by_account = ["account", "fingerprint"]),
)]
pub struct Device {
    /// Hex SHA-256 of the raw public key.
    pub fingerprint: String,
    pub account: String,
    /// Base64 of the raw (uncompressed) P-256 ECDH public key.
    pub public_key: String,
    pub label: String,
    /// `browser`, `recovery` or `agent`.
    pub kind: String,
    pub added_at: u64,
}

/// The vault key, wrapped to one device key by one wrapper. `wrappedBy` is the
/// caller of `addKeyWraps`.
#[derive(Record)]
#[table(
    key = "slot",
    index(by_recipient = ["recipient", "key_id"]),
    index(by_key = ["key_id"]),
    index(by_author = ["wrapped_by", "recipient", "key_id"]),
)]
pub struct KeyWrap {
    /// `recipient:key_id:wrap_<32 hex>`.
    pub slot: String,
    pub key_id: String,
    /// The recipient device's fingerprint.
    pub recipient: String,
    /// The wrapping device's fingerprint, as the client reported it.
    pub wrapper: String,
    /// ECIES envelope: ephemeral public key, IV and ciphertext, base64 JSON.
    pub envelope: String,
    pub wrapped_by: String,
    pub wrapped_at: u64,
}

/// One line of the activity trail, written by the method that acted.
#[derive(Record)]
#[table(key = "seq")]
pub struct AuditEntry {
    pub seq: u64,
    pub action: String,
    /// The object acted on: a secret id, an account, a device fingerprint.
    /// Never a secret's name: names are ciphertext, and a trail that echoed
    /// them in the clear would undo the encryption.
    pub target: String,
    pub account: String,
    pub timestamp: u64,
}

// ── results ──────────────────────────────────────────────────────────────────

/// A secret as callers see it, fields included. A plain struct: a `Record`
/// cannot hold a map. Times are decimal strings on the wire.
#[derive(Serialize, AbiType)]
pub struct SecretView {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub tags: String,
    /// Field name → encrypted value; cleared fields are absent.
    pub fields: BTreeMap<String, String>,
    #[serde(rename = "createdAt", with = "calimero_sdk::json::u64_str")]
    pub created_at: u64,
    #[serde(rename = "createdBy")]
    pub created_by: String,
    #[serde(rename = "updatedAt", with = "calimero_sdk::json::u64_str")]
    pub updated_at: u64,
    #[serde(rename = "updatedBy")]
    pub updated_by: String,
    pub trashed: bool,
    #[serde(rename = "trashedAt", with = "calimero_sdk::json::u64_str")]
    pub trashed_at: u64,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct RevisionView {
    pub field: String,
    pub previous: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub replaced_at: u64,
    pub replaced_by: String,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub fingerprint: String,
    pub public_key: String,
    pub label: String,
    pub kind: String,
    /// The account that registered it.
    pub account: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub added_at: u64,
    pub revoked: bool,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct KeyWrapView {
    pub key_id: String,
    pub recipient: String,
    pub wrapper: String,
    pub envelope: String,
    /// The account that stored the wrap.
    pub wrapped_by: String,
}

/// One wrap handed to `addKeyWraps`.
#[derive(serde::Deserialize, AbiType)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyWrapInput {
    pub key_id: String,
    pub recipient: String,
    pub wrapper: String,
    pub envelope: String,
}

#[derive(Serialize, AbiType)]
pub struct MemberView {
    pub account: String,
    /// `admin`, `editor` or `viewer`; `pending` for an account that has
    /// registered a device but was never given a role; `removed` for one an
    /// admin removed, which clients must not auto-admit.
    pub role: String,
    /// Its unrevoked devices.
    pub devices: u32,
}

#[derive(Serialize, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub name: String,
    pub current_key: String,
    pub default_role: String,
    pub my_account: String,
    pub my_role: String,
}

#[derive(Serialize, AbiType)]
pub struct AuditView {
    pub action: String,
    pub target: String,
    pub account: String,
    /// Always empty: a component app has no node device to report (v1's
    /// author node). Kept so the shape is v1's.
    pub device: String,
    #[serde(with = "calimero_sdk::json::u64_str")]
    pub timestamp: u64,
    /// Always false: no method blanks a line. Kept so the shape is v1's.
    pub redacted: bool,
}

// ── state ────────────────────────────────────────────────────────────────────

/// One vault.
#[app::state(version = 1)]
pub struct MeroPass {
    /// The vault's name; empty until the creator's first `renameVault`.
    vault_name: Cell<String>,
    /// `editor` or `viewer`; unset means `editor`.
    default_role: Cell<String>,
    /// The key id new writes use; unset until the first `rotateKey`.
    current_key: Cell<String>,
    members: Table<Member>,
    /// Accounts an admin removed. Clients never auto-admit them again; only an
    /// explicit `setRole` does.
    removed: Set<String>,
    /// Revoked device fingerprints. Clients skip them when wrapping a new key.
    revoked: Set<String>,
    secrets: Table<Secret>,
    /// `(secret id, field name)` → encrypted value.
    secret_fields: UnorderedMap<(String, String), String>,
    /// Superseded values, `(secret id, seq)`, so one secret's history is one
    /// prefix read, newest last.
    history: Table<RevisionRow>,
    revision_seq: Counter,
    devices: Table<Device>,
    key_wraps: Table<KeyWrap>,
    /// Append-only.
    audit: Table<AuditEntry>,
    audit_seq: Counter,
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// The calling account; `LoginRequired` for anyone else.
fn account() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// `prefix_` and 32 random hex characters.
fn fresh_id(prefix: &str) -> String {
    let hex: String = env::random_bytes(16)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{prefix}_{hex}")
}

/// Every row `read` pages through, page by page.
fn all<T>(mut read: impl FnMut(FindOpts) -> Result<Page<T>, StorageError>) -> app::Result<Vec<T>> {
    let mut out = Vec::new();
    let mut opts = FindOpts::default().limit(PAGE);
    loop {
        let page = read(opts)?;
        out.extend(page.items);
        match page.next {
            Some(next) => opts = FindOpts::default().limit(PAGE).cursor(next),
            None => return Ok(out),
        }
    }
}

fn s(v: &str) -> KeyPart {
    KeyPart::Str(v.to_owned())
}

fn forbidden(message: &str) -> AppError {
    Error::Forbidden {
        message: message.to_owned(),
    }
    .into()
}

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

fn not_found(message: &str) -> AppError {
    Error::NotFound {
        message: message.to_owned(),
    }
    .into()
}

fn check_envelope(value: &str) -> app::Result<()> {
    if value.len() > MAX_ENVELOPE_LEN {
        return Err(invalid(format!("value too large: {} bytes", value.len())));
    }
    Ok(())
}

fn check_name(what: &str, value: &str) -> app::Result<()> {
    if value.is_empty() || value.len() > MAX_NAME_LEN {
        return Err(invalid(format!("{what} must be 1 to {MAX_NAME_LEN} bytes")));
    }
    Ok(())
}

#[app::logic]
#[allow(clippy::len_without_is_empty)]
impl MeroPass {
    /// The empty vault, with the account that creates the app instance as its
    /// first Admin. It takes no arguments: the creator names the vault with
    /// `renameVault` (v1 took the name as `init`'s argument).
    #[app::init]
    pub fn init() -> app::Result<Self> {
        let mut state = Self::load();
        let creator = account().unwrap_or_else(|_| env::app_owner());
        state.members.insert(Member {
            account: creator,
            role: ROLE_ADMIN.to_owned(),
        })?;
        Ok(state)
    }

    // ── identity and roles (helpers) ─────────────────────────────────────────

    fn role_of(&self, who: &str) -> app::Result<String> {
        Ok(self
            .members
            .get(who)?
            .map(|m| m.role)
            .unwrap_or_else(|| ROLE_PENDING.to_owned()))
    }

    fn is_admin(&self, who: &str) -> app::Result<bool> {
        Ok(self.role_of(who)? == ROLE_ADMIN)
    }

    /// The caller, when they hold Editor or Admin.
    fn require_editor(&self) -> app::Result<String> {
        let me = account()?;
        match self.role_of(&me)?.as_str() {
            ROLE_ADMIN | ROLE_EDITOR => Ok(me),
            _ => Err(forbidden(
                "view-only: an Editor or Admin role is required to change secrets",
            )),
        }
    }

    /// The caller, when they hold Admin.
    fn require_admin(&self) -> app::Result<String> {
        let me = account()?;
        if self.is_admin(&me)? {
            Ok(me)
        } else {
            Err(forbidden("only a vault Admin can do that"))
        }
    }

    fn admins(&self) -> app::Result<u64> {
        Ok(self.members.count("perRole", &[s(ROLE_ADMIN)])?)
    }

    fn audit(&mut self, action: &str, target: &str, who: &str) -> app::Result<()> {
        let seq = self.audit_seq.increment()?;
        self.audit.insert(AuditEntry {
            seq,
            action: action.to_owned(),
            target: target.to_owned(),
            account: who.to_owned(),
            timestamp: env::time_now(),
        })?;
        Ok(())
    }

    /// Every device row at `fingerprint`, whichever account registered it.
    fn devices_at(&self, fingerprint: &str) -> app::Result<Vec<Device>> {
        all(|o| self.devices.find("byFingerprint", &[s(fingerprint)], o))
    }

    /// Whether every registration at `fingerprint` is an agent's. Only an
    /// admin's wrap admits an agent, so a member cannot hand the vault to
    /// software by opening the vault. "Every", not "any": another account
    /// filing an agent entry at a browser's fingerprint must not stop that
    /// browser being given keys.
    fn is_agent_device(&self, fingerprint: &str) -> app::Result<bool> {
        let holders = self.devices_at(fingerprint)?;
        Ok(!holders.is_empty() && holders.iter().all(|d| d.kind == DEVICE_AGENT))
    }

    fn fields_of(&self, id: &str) -> app::Result<BTreeMap<String, String>> {
        Ok(all(|o| self.secret_fields.prefix(&[s(id)], o))?
            .into_iter()
            .map(|((_, field), value)| (field, value))
            .collect())
    }

    fn view_of(&self, secret: Secret) -> app::Result<SecretView> {
        Ok(SecretView {
            fields: self.fields_of(&secret.id)?,
            id: secret.id,
            kind: secret.kind,
            name: secret.name,
            tags: secret.tags,
            created_at: secret.created_at,
            created_by: secret.created_by,
            updated_at: secret.updated_at,
            updated_by: secret.updated_by,
            trashed: secret.trashed,
            trashed_at: secret.trashed_at,
        })
    }

    // ── the vault ────────────────────────────────────────────────────────────

    /// The vault's name, key, default role, and the caller's account and role.
    /// `defaultRole` is `editor` until an admin sets it; `currentKey` is empty
    /// until the first `rotateKey`.
    #[app::view]
    pub fn vault_info(&self) -> app::Result<VaultInfo> {
        let me = account()?;
        let default_role = match self.default_role.get()? {
            Some(role) if !role.is_empty() => role,
            _ => ROLE_EDITOR.to_owned(),
        };
        Ok(VaultInfo {
            name: self.vault_name()?,
            current_key: self.current_key.get()?.unwrap_or_default(),
            default_role,
            my_role: self.role_of(&me)?,
            my_account: me,
        })
    }

    /// The vault's name; empty until the first `renameVault`.
    #[app::view]
    pub fn vault_name(&self) -> app::Result<String> {
        Ok(self.vault_name.get()?.unwrap_or_default())
    }

    /// Rename the vault. Editors and admins (`Forbidden` for anyone else).
    /// Emits `VaultRenamed`.
    pub fn rename_vault(&mut self, name: String) -> app::Result<()> {
        let me = self.require_editor()?;
        check_envelope(&name)?;
        self.vault_name.set(&name)?;
        self.audit("vault_renamed", "vault", &me)?;
        env::emit(Event::VaultRenamed, Audience::All)?;
        Ok(())
    }

    // ── roles ────────────────────────────────────────────────────────────────

    /// Everyone this vault knows about, by account: each role holder, plus
    /// every account that registered an unrevoked device without being given a
    /// role (`pending`, or `removed` after an admin removed it).
    #[app::view]
    pub fn list_members(&self) -> app::Result<Vec<MemberView>> {
        let mut rows: BTreeMap<String, (String, u32)> = BTreeMap::new();
        for m in all(|o| self.members.scan(o))? {
            let _ = rows.insert(m.account, (m.role, 0));
        }
        let revoked: BTreeSet<String> = all(|o| self.revoked.page(o))?.into_iter().collect();
        for d in all(|o| self.devices.scan(o))? {
            if revoked.contains(&d.fingerprint) {
                continue;
            }
            let row = match rows.get_mut(&d.account) {
                Some(row) => row,
                None => {
                    let fallback = if self.removed.contains(&d.account)? {
                        ROLE_REMOVED
                    } else {
                        ROLE_PENDING
                    };
                    rows.entry(d.account.clone())
                        .or_insert_with(|| (fallback.to_owned(), 0))
                }
            };
            row.1 += 1;
        }
        Ok(rows
            .into_iter()
            .map(|(account, (role, devices))| MemberView {
                account,
                role,
                devices,
            })
            .collect())
    }

    /// Give `account` a role: `admin`, `editor` or `viewer`. Admin only
    /// (`Forbidden`). `NotFound` for an account the organization does not hold;
    /// `Invalid` for another role; `Conflict` for the last Admin stepping down.
    /// An explicit role re-admits a removed account. Emits `MembersChanged`.
    pub fn set_role(&mut self, account: String, role: String) -> app::Result<()> {
        let me = self.require_admin()?;
        check_name("account", &account)?;
        if ![ROLE_ADMIN, ROLE_EDITOR, ROLE_VIEWER].contains(&role.as_str()) {
            return Err(invalid(format!(
                "unknown role '{role}': expected admin, editor or viewer"
            )));
        }
        if env::org().is_some() && env::org_role(&account).is_none() {
            return Err(not_found("not a member of this team"));
        }
        if role != ROLE_ADMIN && self.is_admin(&account)? && self.admins()? <= 1 {
            return Err(Error::Conflict {
                message: "a vault needs at least one Admin — promote someone else first".to_owned(),
            }
            .into());
        }
        self.members.upsert(Member {
            account: account.clone(),
            role: role.clone(),
        })?;
        let _ = self.removed.remove(&account)?;
        self.audit(&format!("role_set:{role}"), &account, &me)?;
        env::emit(Event::MembersChanged, Audience::All)?;
        Ok(())
    }

    /// Remove an account from the vault: drop its role and revoke every device
    /// it registered. Admin only (`Forbidden`); `Invalid` for the caller
    /// themselves. The caller must then rotate the vault key (the client does,
    /// via `rotateKey`) so nothing written afterwards is readable with the key
    /// the removed account already holds. Emits `MembersChanged`.
    pub fn remove_member(&mut self, account: String) -> app::Result<()> {
        let me = self.require_admin()?;
        check_name("account", &account)?;
        if account == me {
            return Err(invalid(
                "you cannot remove yourself — leave the team instead",
            ));
        }
        let _ = self.members.remove(&account)?;
        let _ = self.removed.insert(&account)?;
        let theirs = all(|o| self.devices.find("byAccount", &[s(&account)], o))?;
        for d in theirs {
            let _ = self.revoked.insert(&d.fingerprint)?;
        }
        self.audit("member_removed", &account, &me)?;
        env::emit(Event::MembersChanged, Audience::All)?;
        Ok(())
    }

    /// The role newcomers are admitted with: `editor` or `viewer` (`Invalid`
    /// otherwise). Admin only (`Forbidden`).
    pub fn set_default_role(&mut self, role: String) -> app::Result<()> {
        let me = self.require_admin()?;
        if role != ROLE_EDITOR && role != ROLE_VIEWER {
            return Err(invalid("default role must be editor or viewer"));
        }
        self.default_role.set(&role)?;
        self.audit(&format!("default_role:{role}"), "vault", &me)?;
        Ok(())
    }

    // ── devices and keys ─────────────────────────────────────────────────────

    /// Register this browser's public key under the caller's account, so the
    /// vault key can be wrapped to it. Anyone the organization lets reach the
    /// vault may, including `pending` accounts. `fingerprint` must be 64 hex
    /// characters (the hex SHA-256 of the raw key; the contract checks the
    /// shape, not the hash: a wrong fingerprint only hurts the registrant) and
    /// `kind` `browser`, `recovery` or `agent`; else `Invalid`. A repeat of the
    /// caller's own registration is a no-op. Emits `KeysChanged`.
    pub fn register_device(
        &mut self,
        fingerprint: String,
        public_key: String,
        label: String,
        kind: String,
    ) -> app::Result<()> {
        let me = account()?;
        if fingerprint.len() != 64 || !fingerprint.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(invalid("fingerprint must be 64 hex characters"));
        }
        if !DEVICE_KINDS.contains(&kind.as_str()) {
            return Err(invalid("device kind must be browser, recovery or agent"));
        }
        check_envelope(&public_key)?;
        check_envelope(&label)?;
        if self.devices.contains(&(fingerprint.clone(), me.clone()))? {
            return Ok(());
        }
        self.devices.insert(Device {
            fingerprint: fingerprint.clone(),
            account: me.clone(),
            public_key,
            label,
            kind,
            added_at: env::time_now(),
        })?;
        self.audit("device_registered", &fingerprint, &me)?;
        env::emit(Event::KeysChanged, Audience::All)?;
        Ok(())
    }

    /// Every registered device, by fingerprint, with the account that
    /// registered it. Clients decide whom to wrap the vault key to by this
    /// account, so it is the registrant's own, never a value they wrote.
    #[app::view]
    pub fn list_devices(&self) -> app::Result<Vec<DeviceView>> {
        let revoked: BTreeSet<String> = all(|o| self.revoked.page(o))?.into_iter().collect();
        Ok(all(|o| self.devices.scan(o))?
            .into_iter()
            .map(|d| DeviceView {
                revoked: revoked.contains(&d.fingerprint),
                fingerprint: d.fingerprint,
                public_key: d.public_key,
                label: d.label,
                kind: d.kind,
                account: d.account,
                added_at: d.added_at,
            })
            .collect())
    }

    /// Revoke a device. Your own device you may always revoke (its row is
    /// withdrawn); anyone else's needs an admin (`Forbidden`), whose revocation
    /// marks the fingerprint revoked for every account. `NotFound` for a
    /// fingerprint nobody registered. Follow with `rotateKey`. Emits
    /// `KeysChanged`.
    pub fn revoke_device(&mut self, fingerprint: String) -> app::Result<()> {
        let me = account()?;
        if self.devices_at(&fingerprint)?.is_empty() {
            return Err(not_found("no such device"));
        }
        let key = (fingerprint.clone(), me.clone());
        let owned = self.devices.contains(&key)?;
        let is_admin = self.is_admin(&me)?;
        if !owned && !is_admin {
            return Err(forbidden(
                "only the device's owner or a vault Admin can revoke it",
            ));
        }
        if is_admin {
            let _ = self.revoked.insert(&fingerprint)?;
        } else {
            // An owner revokes by withdrawing the key: nothing will be wrapped
            // to a key that is no longer listed.
            let _ = self.devices.remove(&key)?;
        }
        self.audit("device_revoked", &fingerprint, &me)?;
        env::emit(Event::KeysChanged, Audience::All)?;
        Ok(())
    }

    /// Store wraps of a vault key and answer how many were stored. Any account
    /// that reaches the vault may wrap a key to any registered, unrevoked device;
    /// that is how a newcomer or a new device gets in without the creator being
    /// online. Skipped, not refused: a wrap to an unknown or revoked device, a
    /// `keyId` with `:` in it or longer than 256 bytes, a repeat (one wrap per
    /// author, key, recipient and wrapper), and a non-admin's wrap to an agent's
    /// key. `Invalid` for an envelope over 128 KiB. Emits `KeysChanged` when
    /// anything was stored.
    pub fn add_key_wraps(&mut self, wraps: Vec<KeyWrapInput>) -> app::Result<u32> {
        let me = account()?;
        let is_admin = self.is_admin(&me)?;
        let mut added = 0;
        for w in wraps {
            check_envelope(&w.envelope)?;
            if w.key_id.contains(':')
                || w.key_id.is_empty()
                || w.key_id.len() > MAX_NAME_LEN
                || w.wrapper.len() > MAX_NAME_LEN
                || self.revoked.contains(&w.recipient)?
                || self.devices_at(&w.recipient)?.is_empty()
                || (!is_admin && self.is_agent_device(&w.recipient)?)
            {
                continue;
            }
            let mine = all(|o| {
                self.key_wraps
                    .find("byAuthor", &[s(&me), s(&w.recipient), s(&w.key_id)], o)
            })?;
            if mine.iter().any(|existing| existing.wrapper == w.wrapper) {
                continue;
            }
            self.key_wraps.insert(KeyWrap {
                slot: format!("{}:{}:{}", w.recipient, w.key_id, fresh_id("wrap")),
                key_id: w.key_id,
                recipient: w.recipient,
                wrapper: w.wrapper,
                envelope: w.envelope,
                wrapped_by: me.clone(),
                wrapped_at: env::time_now(),
            })?;
            added += 1;
        }
        if added > 0 {
            env::emit(Event::KeysChanged, Audience::All)?;
        }
        Ok(added)
    }

    /// Every wrap addressed to `recipient`, with the account that stored it.
    #[app::view]
    pub fn key_wraps_for(&self, recipient: String) -> app::Result<Vec<KeyWrapView>> {
        Ok(
            all(|o| self.key_wraps.find("byRecipient", &[s(&recipient)], o))?
                .into_iter()
                .map(|w| KeyWrapView {
                    key_id: w.key_id,
                    recipient: w.recipient,
                    wrapper: w.wrapper,
                    envelope: w.envelope,
                    wrapped_by: w.wrapped_by,
                })
                .collect(),
        )
    }

    /// Which `keyId:recipient` pairs already have a wrap from a member who
    /// holds a role, sorted, so a key holder only wraps what is missing.
    ///
    /// Clients also treat a device in this list as approved, so a wrap from
    /// anyone else (a pending or removed account, which never held the key,
    /// writing a garbage wrap to its own device) does not count. Nor does a wrap
    /// to an agent's key from anyone but an admin.
    #[app::view]
    pub fn wrapped_pairs(&self) -> app::Result<Vec<String>> {
        let mut pairs = BTreeSet::new();
        let mut roles: BTreeMap<String, String> = BTreeMap::new();
        for w in all(|o| self.key_wraps.scan(o))? {
            let role = match roles.get(&w.wrapped_by) {
                Some(role) => role.clone(),
                None => {
                    let role = self.role_of(&w.wrapped_by)?;
                    let _ = roles.insert(w.wrapped_by.clone(), role.clone());
                    role
                }
            };
            let counts = match role.as_str() {
                ROLE_ADMIN => true,
                ROLE_EDITOR | ROLE_VIEWER => !self.is_agent_device(&w.recipient)?,
                _ => false,
            };
            if counts {
                let _ = pairs.insert(format!("{}:{}", w.key_id, w.recipient));
            }
        }
        Ok(pairs.into_iter().collect())
    }

    /// Make `keyId` the key new writes use. The first call bootstraps the
    /// vault (audited `key_created`); every later one is a rotation
    /// (`key_rotated`). Admin only (`Forbidden`). The caller must have stored a
    /// wrap of the new key first (`Invalid` otherwise), or members would be told
    /// to write with a key they cannot open. Emits `KeysChanged`.
    pub fn rotate_key(&mut self, key_id: String) -> app::Result<()> {
        let me = self.require_admin()?;
        let wrapped = self
            .key_wraps
            .find("byKey", &[s(&key_id)], FindOpts::default().limit(1))?;
        if wrapped.items.is_empty() {
            return Err(invalid(
                "wrap the new key to at least one device before switching to it",
            ));
        }
        let first = self.current_key.get()?.unwrap_or_default().is_empty();
        self.current_key.set(&key_id)?;
        self.audit(
            if first { "key_created" } else { "key_rotated" },
            &key_id,
            &me,
        )?;
        env::emit(Event::KeysChanged, Audience::All)?;
        Ok(())
    }

    // ── secrets ──────────────────────────────────────────────────────────────

    /// Add a secret under an id the CLIENT chose, and answer the id. Editors and
    /// admins (`Forbidden`).
    ///
    /// Client-chosen because the id is bound into every field's ciphertext as
    /// associated data, which stops a member from pasting one secret's password
    /// envelope into another secret: the id has to exist before the encryption
    /// does. It must be `secret_` and 32 hex characters (`Invalid`), and an id
    /// already taken is `Conflict`, not an upsert. `kind` is one of the eight
    /// kinds, at most 64 fields with names up to 256 bytes, each envelope at
    /// most 128 KiB (`Invalid`). Emits `SecretChanged`.
    pub fn add_secret(
        &mut self,
        id: String,
        kind: String,
        name: String,
        tags: String,
        fields: BTreeMap<String, String>,
    ) -> app::Result<String> {
        let me = self.require_editor()?;
        if !SECRET_KINDS.contains(&kind.as_str()) {
            return Err(invalid(format!("unknown secret kind '{kind}'")));
        }
        if fields.len() > MAX_FIELDS {
            return Err(invalid("too many fields"));
        }
        check_envelope(&name)?;
        check_envelope(&tags)?;
        for (field, value) in &fields {
            check_name("field name", field)?;
            check_envelope(value)?;
        }
        let well_formed = id
            .strip_prefix("secret_")
            .is_some_and(|h| h.len() == 32 && h.chars().all(|c| c.is_ascii_hexdigit()));
        if !well_formed {
            return Err(invalid(
                "secret id must be 'secret_' followed by 32 hex characters",
            ));
        }
        if self.secrets.contains(&id)? {
            return Err(Error::Conflict {
                message: "a secret with this id already exists".to_owned(),
            }
            .into());
        }
        let now = env::time_now();
        self.secrets.insert(Secret {
            id: id.clone(),
            kind,
            name,
            tags,
            created_at: now,
            created_by: me.clone(),
            updated_at: now,
            updated_by: me.clone(),
            trashed: false,
            trashed_at: 0,
        })?;
        for (field, value) in fields {
            if !value.is_empty() {
                let _ = self.secret_fields.insert(&(id.clone(), field), &value)?;
            }
        }
        self.audit("secret_added", &id, &me)?;
        env::emit(
            Event::SecretChanged {
                secret_id: id.clone(),
            },
            Audience::All,
        )?;
        Ok(id)
    }

    /// Change some of a secret's fields. Editors and admins (`Forbidden`);
    /// `NotFound` for an unknown id. Only what is passed is touched: `name` and
    /// `tags` when not null, and each field in `fields`; an empty string clears a
    /// field. Every superseded non-empty value is kept in the history, still
    /// encrypted. `rekey` marks a re-encryption under a rotated key: the
    /// plaintext did not change, so nothing is added to the history. More than
    /// 64 fields afterwards is `Invalid` and changes nothing. Emits
    /// `SecretChanged`.
    pub fn update_secret(
        &mut self,
        id: String,
        name: Option<String>,
        tags: Option<String>,
        fields: BTreeMap<String, String>,
        rekey: bool,
    ) -> app::Result<()> {
        let me = self.require_editor()?;
        for v in fields.values().chain(name.iter()).chain(tags.iter()) {
            check_envelope(v)?;
        }
        for field in fields.keys() {
            check_name("field name", field)?;
        }
        let Some(mut secret) = self.secrets.get(&id)? else {
            return Err(not_found("secret not found"));
        };
        let now = env::time_now();
        let mut superseded: Vec<(String, String)> = Vec::new();
        if let Some(name) = name {
            superseded.push(("name".to_owned(), std::mem::replace(&mut secret.name, name)));
        }
        if let Some(tags) = tags {
            superseded.push(("tags".to_owned(), std::mem::replace(&mut secret.tags, tags)));
        }
        for (field, value) in fields {
            let key = (id.clone(), field.clone());
            let previous = self.secret_fields.get(&key)?.unwrap_or_default();
            if previous == value {
                continue;
            }
            if value.is_empty() {
                let _ = self.secret_fields.remove(&key)?;
            } else {
                let _ = self.secret_fields.insert(&key, &value)?;
            }
            superseded.push((field, previous));
        }
        if self.fields_of(&id)?.len() > MAX_FIELDS {
            return Err(invalid("too many fields"));
        }
        secret.updated_at = now;
        secret.updated_by = me.clone();
        self.secrets.upsert(secret)?;
        if !rekey {
            for (field, previous) in superseded {
                if previous.is_empty() {
                    continue;
                }
                let seq = self.revision_seq.increment()?;
                self.history.insert(RevisionRow {
                    secret_id: id.clone(),
                    seq,
                    field,
                    previous,
                    replaced_at: now,
                    replaced_by: me.clone(),
                })?;
            }
        }
        self.audit(
            if rekey {
                "secret_rekeyed"
            } else {
                "secret_updated"
            },
            &id,
            &me,
        )?;
        env::emit(Event::SecretChanged { secret_id: id }, Audience::All)?;
        Ok(())
    }

    /// Superseded values of one secret, newest first; `[]` for an unknown id.
    #[app::view]
    pub fn secret_history(&self, id: String) -> app::Result<Vec<RevisionView>> {
        let rows = all(|o| self.history.find("bySecret", &[s(&id)], o.reverse()))?;
        Ok(rows
            .into_iter()
            .map(|r| RevisionView {
                field: r.field,
                previous: r.previous,
                replaced_at: r.replaced_at,
                replaced_by: r.replaced_by,
            })
            .collect())
    }

    fn set_trashed(&mut self, id: &str, trashed: bool) -> app::Result<String> {
        let me = self.require_editor()?;
        let now = env::time_now();
        let found = self.secrets.update(id, |s| {
            s.trashed = trashed;
            s.trashed_at = if trashed { now } else { 0 };
        })?;
        if !found {
            return Err(not_found("secret not found"));
        }
        Ok(me)
    }

    /// Move a secret to the trash: recoverable until an admin purges it.
    /// Editors and admins (`Forbidden`); `NotFound` for an unknown id. Emits
    /// `SecretChanged`.
    pub fn trash_secret(&mut self, id: String) -> app::Result<()> {
        let me = self.set_trashed(&id, true)?;
        self.audit("secret_trashed", &id, &me)?;
        env::emit(Event::SecretChanged { secret_id: id }, Audience::All)?;
        Ok(())
    }

    /// Take a secret out of the trash. Editors and admins (`Forbidden`);
    /// `NotFound` for an unknown id. Emits `SecretChanged`.
    pub fn restore_secret(&mut self, id: String) -> app::Result<()> {
        let me = self.set_trashed(&id, false)?;
        self.audit("secret_restored", &id, &me)?;
        env::emit(Event::SecretChanged { secret_id: id }, Audience::All)?;
        Ok(())
    }

    /// Delete a trashed secret, its fields and its history for good. Admin only
    /// (`Forbidden`); `NotFound` for an unknown id, `Invalid` for one not in the
    /// trash. Emits `SecretChanged`.
    pub fn purge_secret(&mut self, id: String) -> app::Result<()> {
        let me = account()?;
        if !self.is_admin(&me)? {
            return Err(forbidden(
                "only a vault Admin can permanently delete a secret",
            ));
        }
        let Some(secret) = self.secrets.get(&id)? else {
            return Err(not_found("secret not found"));
        };
        if !secret.trashed {
            return Err(invalid("move the secret to the trash first"));
        }
        let _ = self.secrets.remove(&id)?;
        for field in self.fields_of(&id)?.into_keys() {
            let _ = self.secret_fields.remove(&(id.clone(), field))?;
        }
        let revisions = all(|o| self.history.find("bySecret", &[s(&id)], o))?;
        for r in revisions {
            let _ = self.history.remove(&(r.secret_id, r.seq))?;
        }
        self.audit("secret_purged", &id, &me)?;
        env::emit(Event::SecretChanged { secret_id: id }, Audience::All)?;
        Ok(())
    }

    /// One secret, or `null` for an unknown id.
    #[app::view]
    pub fn get_secret(&self, id: String) -> app::Result<Option<SecretView>> {
        match self.secrets.get(&id)? {
            Some(secret) => Ok(Some(self.view_of(secret)?)),
            None => Ok(None),
        }
    }

    /// Every secret, trashed ones included (the client splits them), by id.
    /// Search and filtering happen in the browser, after decryption: the
    /// contract holds ciphertext and has nothing to match against.
    #[app::view]
    pub fn list_secrets(&self) -> app::Result<Vec<SecretView>> {
        all(|o| self.secrets.scan(o))?
            .into_iter()
            .map(|secret| self.view_of(secret))
            .collect()
    }

    // ── audit ────────────────────────────────────────────────────────────────

    /// The trail, newest first: at most the newest 1,000 lines. Each line's
    /// account is the caller of the method that wrote it.
    #[app::view]
    pub fn get_audit_logs(&self) -> app::Result<Vec<AuditView>> {
        let page = self.audit.scan(FindOpts::default().limit(PAGE).reverse())?;
        Ok(page
            .items
            .into_iter()
            .map(|e| AuditView {
                action: e.action,
                target: e.target,
                account: e.account,
                device: String::new(),
                timestamp: e.timestamp,
                redacted: false,
            })
            .collect())
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire. Each
/// `message` is v1's wording.
#[app::error]
pub enum Error {
    /// The caller's vault role does not allow this.
    Forbidden { message: String },
    /// No such secret, device, or organization member.
    NotFound { message: String },
    /// An argument broke a rule.
    Invalid { message: String },
    /// The id is taken, or the change would leave the vault without an Admin.
    Conflict { message: String },
}

/// Events carry ids only. A subscriber learns THAT something changed and
/// re-reads it through the encrypted view; nothing sensitive rides the event.
/// Sent to everyone the app reaches (guests included), as in v1.
#[app::event]
pub enum Event {
    SecretChanged { secret_id: String },
    MembersChanged,
    KeysChanged,
    VaultRenamed,
}
