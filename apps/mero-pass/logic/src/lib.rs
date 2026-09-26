//! Mero Pass — one vault's replicated state.
//!
//! A Calimero context IS a vault. This contract holds what every member of that
//! context replicates: the vault's name, its secrets, who may change them, the
//! device keys the vault key is wrapped to, and an append-only activity trail.
//!
//! ── What the node never sees ────────────────────────────────────────────────
//!
//! Every secret NAME, FIELD and TAG list arrives here already encrypted by the
//! browser under the vault key (AES-256-GCM, see `app/src/lib/crypto.ts`). The
//! contract stores ciphertext envelopes and never decrypts them — it cannot: the
//! vault key only exists wrapped to device public keys, and the matching private
//! keys live in each browser's IndexedDB. A member's node, its disk, its logs and
//! its operator see ciphertext. Only the secret's KIND (login, totp, …) and its
//! bookkeeping (who, when) are cleartext, so the UI can draw an icon before the
//! vault is unlocked.
//!
//! ── Who may do what, and where it is enforced ───────────────────────────────
//!
//! Three roles: Admin, Editor, Viewer — plus `pending`, an account that has
//! registered a device and was never let in. They live in an [`AccessControl`]
//! whose writer set IS the admin tier, and are PROJECTED onto three guarded
//! stores as capability masks:
//!
//! | store       | Viewer | Editor        | Admin |
//! |-------------|--------|---------------|-------|
//! | `secrets`   | read   | WRITE         | FULL  |
//! | `history`   | read   | WRITE         | FULL  |
//! | `admin`     | read   | read          | FULL  |
//!
//! The masks are signed and re-checked by every peer at merge
//! ([`ProtocolAuthorizer`]), so a patched node that skips the API guards below
//! still has its forged write dropped everywhere else. The guards here are the
//! fail-fast half of the same rule.
//!
//! Hard-deleting a secret (`purge_secret`) needs DELETE, which only admins hold.
//! Editors move secrets to the trash, which is a WRITE of a tombstone flag — so
//! an editor can never make a secret unrecoverable.

#![allow(clippy::len_without_is_empty)]

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env, AccountId};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::permissioned::{Op, ProtocolAuthorizer};
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{
    AccessControl, AuthoredMap, AuthoredVector, LwwRegister, MergeStrategy,
    Mergeable as MergeableTrait, PermissionedStorage, UnorderedMap,
};
use calimero_storage::entities::OpMask;

/// Roles held in [`AccessControl`]. Admin is the registry's own admin tier.
///
/// Viewer is an explicit grant, not the absence of one: an account with no role
/// at all is `pending` — it registered a device but no admin has let it in —
/// and clients only wrap the vault key to accounts that hold SOME role. That is
/// what stops a removed member who re-registers a device from being handed the
/// key again.
const ROLE_EDITOR: &str = "editor";
const ROLE_VIEWER: &str = "viewer";

/// Role masks projected onto `secrets` and `history`. Admins always receive
/// `FULL` from `project_onto`, so they are not listed.
const CONTENT_ROLES: [(&str, OpMask); 1] = [(ROLE_EDITOR, OpMask::WRITE)];

/// Role masks projected onto `admin`: nobody but the admins.
const ADMIN_ONLY: [(&str, OpMask); 0] = [];

/// Upper bound on one ciphertext envelope. A 64 KiB note, base64'd and wrapped,
/// fits comfortably; anything larger belongs in a blob.
const MAX_ENVELOPE_LEN: usize = 128 * 1024;

/// Upper bound on the number of fields one secret may carry.
const MAX_FIELDS: usize = 64;

/// What a registered device key is. A recovery key is shown and handled
/// differently by clients (never prompted for approval, listed separately), and
/// nothing else.
const DEVICE_KINDS: [&str; 2] = ["browser", "recovery"];

/// The secret kinds the UI knows how to render.
const SECRET_KINDS: [&str; 6] = [
    "login",
    "secure_note",
    "totp",
    "ssh_key",
    "payment_card",
    "identity",
];

// ── Stored types ────────────────────────────────────────────────────────────

/// One secret, as independent registers rather than one record.
///
/// Field-level registers are the point: Alice fixing the URL while Bob rotates
/// the password are writes to two different registers, so BOTH survive the
/// merge. A single last-writer-wins record would keep one edit and silently
/// discard the other. Within one field, last writer wins by HLC — there is no
/// meaningful way to merge two different passwords.
#[derive(Default, BorshSerialize, BorshDeserialize, AbiType, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Secret {
    /// Cleartext kind — `login`, `totp`, … — so the UI can pick an icon.
    kind: LwwRegister<String>,
    /// Encrypted display name.
    name: LwwRegister<String>,
    /// Encrypted tag list (one envelope over a JSON array).
    tags: LwwRegister<String>,
    /// Field name (`password`, `url`, …) → encrypted value.
    fields: UnorderedMap<String, LwwRegister<String>>,
    created_at: LwwRegister<u64>,
    created_by: LwwRegister<String>,
    updated_at: LwwRegister<u64>,
    updated_by: LwwRegister<String>,
    /// Tombstone. Trashing is a flag rather than a `remove`, because the map is
    /// add-wins: a hard remove loses to a concurrent edit and the secret comes
    /// back. The flag resolves edit-vs-trash by HLC instead.
    trashed: LwwRegister<bool>,
    trashed_at: LwwRegister<u64>,
}

/// A superseded field value. Written once, never edited.
#[derive(Debug, Clone, Default, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Revision {
    secret_id: String,
    /// The field that changed; `name` and `tags` use those reserved names.
    field: String,
    /// The value it held before, still encrypted (under whichever vault key it
    /// was written with — the envelope names its key).
    previous: String,
    replaced_at: u64,
    replaced_by: String,
}

/// A device public key the vault key may be wrapped to.
///
/// Stored in an [`AuthoredMap`], so only the account that registered it can
/// remove it. The account and device fields are taken from the host, never
/// from the caller, so a member cannot register a key in someone else's name.
#[derive(Debug, Clone, Default, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct DeviceKey {
    /// Base64 of the raw (uncompressed) P-256 ECDH public key.
    public_key: String,
    label: String,
    /// `browser` for a browser's device key; `recovery` for an account's
    /// offline recovery key, whose private half exists only on paper.
    kind: String,
    account: String,
    node_device: String,
    added_at: u64,
}

/// The vault key, wrapped to one device key by one wrapper.
///
/// Keyed by `key_id:recipient:wrapper`, and stored in an [`AuthoredMap`] so a
/// wrap can be neither overwritten nor squatted by another member: each wrapper
/// owns its own slot. A forged wrap is detectable anyway — the recipient checks
/// that the unwrapped key hashes to `key_id` — but it must not be able to
/// displace a genuine one.
#[derive(Debug, Clone, Default, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct KeyWrap {
    key_id: String,
    recipient: String,
    wrapper: String,
    /// ECIES envelope: ephemeral public key, IV and ciphertext, base64 JSON.
    envelope: String,
    wrapped_by: String,
    wrapped_at: u64,
}

/// One line of the activity trail.
#[derive(Debug, Clone, Default, BorshSerialize, BorshDeserialize, AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct AuditLogEntry {
    action: String,
    /// The object acted on: a secret id, an account, a device fingerprint.
    /// Never a secret's name — names are ciphertext, and a trail that echoed
    /// them in the clear would undo the encryption.
    target: String,
    account: String,
    device: String,
    timestamp: u64,
}

/// Keys of the admin-only store. It is a flat map rather than a struct because
/// a guarded store must hold a collection: the per-entry writer stamps are what
/// peers verify at merge.
const ADMIN_DEFAULT_ROLE: &str = "default_role";
const ADMIN_CURRENT_KEY: &str = "current_key";
/// Prefix of a revoked device's entry. A revoked device is skipped by every
/// client that wraps a new vault key, which is what locks it out of writes made
/// after the next rotation.
const ADMIN_REVOKED: &str = "revoked:";
/// Prefix of a removed account's entry. Clients never auto-admit it again; only
/// an explicit `set_role` does.
const ADMIN_REMOVED: &str = "removed:";

// Written-once values: every write uses a fresh random key, so two replicas
// never contend for one entry, and if one ever did, the copy already present
// wins. Nothing for the merge point to decide, so no wasm hop is paid for it.
macro_rules! immutable_value {
    ($($t:ty),*) => {$(
        impl MergeStrategy for $t {
            const DISPATCHED: bool = false;
        }
        impl MergeableTrait for $t {
            fn merge(&mut self, _other: &Self) -> std::result::Result<(), MergeError> {
                Ok(())
            }
        }
        impl RekeyTarget for $t {
            fn rekey_relative_to(&mut self, _parent_id: Id) {}
        }
    )*};
}
immutable_value!(Revision, DeviceKey, KeyWrap, AuditLogEntry);

// ── Views (what RPC returns) ────────────────────────────────────────────────

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct SecretView {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub tags: String,
    pub fields: BTreeMap<String, String>,
    pub created_at: u64,
    pub created_by: String,
    pub updated_at: u64,
    pub updated_by: String,
    pub trashed: bool,
    pub trashed_at: u64,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct RevisionView {
    pub field: String,
    pub previous: String,
    pub replaced_at: u64,
    pub replaced_by: String,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct DeviceView {
    pub fingerprint: String,
    pub public_key: String,
    pub label: String,
    pub kind: String,
    pub account: String,
    pub added_at: u64,
    pub revoked: bool,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct KeyWrapView {
    pub key_id: String,
    pub recipient: String,
    pub wrapper: String,
    pub envelope: String,
    pub wrapped_by: String,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct KeyWrapInput {
    pub key_id: String,
    pub recipient: String,
    pub wrapper: String,
    pub envelope: String,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct MemberView {
    pub account: String,
    /// `admin`, `editor` or `viewer`; `pending` for an account that has
    /// registered a device but was never given a role; `removed` for one an
    /// admin removed, which clients must not auto-admit.
    pub role: String,
    pub devices: u32,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct VaultInfo {
    pub name: String,
    pub current_key: String,
    pub default_role: String,
    pub my_account: String,
    pub my_role: String,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AuditView {
    pub action: String,
    pub target: String,
    pub account: String,
    pub device: String,
    pub timestamp: u64,
    /// True when the author blanked this entry. The slot stays, so a redaction
    /// is itself visible in the trail.
    pub redacted: bool,
}

// ── State ───────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroPassApp {
    /// The vault's human name, readable by every member on every node. The
    /// frontend also writes it to the subgroup's metadata, for members who have
    /// not entered the vault yet; this copy is the authoritative one.
    vault_name: LwwRegister<String>,
    roles: AccessControl,
    secrets: PermissionedStorage<UnorderedMap<String, Secret>, ProtocolAuthorizer>,
    history: PermissionedStorage<UnorderedMap<String, Revision>, ProtocolAuthorizer>,
    /// Admin-only settings: `default_role`, `current_key`, `revoked:<fp>`.
    admin: PermissionedStorage<UnorderedMap<String, LwwRegister<String>>, ProtocolAuthorizer>,
    /// Device fingerprint → public key. Any member may register their own.
    devices: AuthoredMap<String, DeviceKey>,
    /// `key_id:recipient:wrapper` → wrapped vault key.
    key_wraps: AuthoredMap<String, KeyWrap>,
    /// Append-only. Entries can be blanked only by their own author, and a
    /// blanked slot stays visible as a redaction.
    audit: AuthoredVector<AuditLogEntry>,
}

/// Events carry ids only. A subscriber learns THAT something changed and
/// re-reads it through the encrypted view; nothing sensitive rides the event.
#[app::event]
pub enum Event {
    SecretChanged { secret_id: String },
    MembersChanged,
    KeysChanged,
    VaultRenamed,
}

// ── Logic ───────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroPassApp {
    /// `name` arrives as the JSON `initializationParams` of `createContext`.
    /// The creator is the vault's first admin.
    #[app::init]
    pub fn init(name: String) -> MeroPassApp {
        let me = Self::me();
        let only_me: BTreeSet<AccountId> = BTreeSet::from([me]);
        MeroPassApp {
            vault_name: LwwRegister::new(name),
            roles: AccessControl::new(me),
            secrets: PermissionedStorage::new(only_me.clone(), false),
            history: PermissionedStorage::new(only_me.clone(), false),
            admin: PermissionedStorage::new(only_me, false),
            devices: AuthoredMap::new(),
            key_wraps: AuthoredMap::new(),
            audit: AuthoredVector::new(),
        }
    }

    // ── Identity ────────────────────────────────────────────────────────────

    /// The ACCOUNT calling — a person, not a machine. One user's phone and
    /// laptop are one principal here.
    fn me() -> AccountId {
        AccountId::from(env::account_id())
    }

    fn me_str() -> String {
        Self::me().to_string()
    }

    fn parse_account(hex_account: &str) -> app::Result<AccountId> {
        let bytes = hex::decode(hex_account.trim())
            .map_err(|_| app::err!("not an account id: expected 64 hex characters"))?;
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| app::err!("not an account id: expected 32 bytes"))?;
        Ok(AccountId::from(arr))
    }

    fn fresh_id(prefix: &str) -> String {
        let mut buffer = [0u8; 16];
        env::random_bytes(&mut buffer);
        format!("{prefix}_{}", hex::encode(buffer))
    }

    fn role_of(&self, who: &AccountId) -> &'static str {
        if self.roles.is_admin(who) {
            "admin"
        } else if self.roles.has_role(ROLE_EDITOR, who).unwrap_or(false) {
            "editor"
        } else if self.roles.has_role(ROLE_VIEWER, who).unwrap_or(false) {
            "viewer"
        } else {
            "pending"
        }
    }

    fn require(&self, allowed: bool, what: &str) -> app::Result<()> {
        if allowed {
            Ok(())
        } else {
            app::bail!("{what}")
        }
    }

    fn require_editor(&self) -> app::Result<()> {
        self.require(
            self.secrets.can(&Self::me(), Op::Write),
            "view-only: an Editor or Admin role is required to change secrets",
        )
    }

    fn require_admin(&self) -> app::Result<()> {
        self.require(
            self.roles.is_admin(&Self::me()),
            "only a vault Admin can do that",
        )
    }

    fn check_envelope(value: &str) -> app::Result<()> {
        if value.len() > MAX_ENVELOPE_LEN {
            app::bail!("value too large: {} bytes", value.len());
        }
        Ok(())
    }

    fn audit(&mut self, action: &str, target: &str) -> app::Result<()> {
        let _ = self.audit.push(AuditLogEntry {
            action: action.to_owned(),
            target: target.to_owned(),
            account: Self::me_str(),
            device: hex::encode(env::device_id()),
            timestamp: env::time_now(),
        })?;
        Ok(())
    }

    /// Push the role registry onto every guarded store. Must follow every role
    /// or admin change: the registry write and the projection are separate
    /// signed actions, and only the projection is consulted at merge.
    fn project_roles(&mut self) -> app::Result<()> {
        self.roles.project_onto(&CONTENT_ROLES, &mut self.secrets)?;
        self.roles.project_onto(&CONTENT_ROLES, &mut self.history)?;
        self.roles.project_onto(&ADMIN_ONLY, &mut self.admin)?;
        Ok(())
    }

    // ── The vault ───────────────────────────────────────────────────────────

    pub fn vault_info(&self) -> app::Result<VaultInfo> {
        let default_role = match self.admin_setting(ADMIN_DEFAULT_ROLE)?.as_str() {
            "" => "editor".to_owned(),
            other => other.to_owned(),
        };
        let me = Self::me();
        Ok(VaultInfo {
            name: self.vault_name.get().clone(),
            current_key: self.admin_setting(ADMIN_CURRENT_KEY)?,
            default_role,
            my_account: me.to_string(),
            my_role: self.role_of(&me).to_owned(),
        })
    }

    pub fn vault_name(&self) -> app::Result<String> {
        Ok(self.vault_name.get().clone())
    }

    /// Rename the vault. Editors and admins; concurrent renames resolve by
    /// last writer.
    pub fn rename_vault(&mut self, name: String) -> app::Result<()> {
        self.require_editor()?;
        self.vault_name.set(name);
        self.audit("vault_renamed", "vault")?;
        app::emit!(Event::VaultRenamed);
        Ok(())
    }

    // ── Roles ───────────────────────────────────────────────────────────────

    /// Everyone this vault knows about: each role holder, plus every account
    /// that registered a device without being given a role (`pending`).
    pub fn list_members(&self) -> app::Result<Vec<MemberView>> {
        let mut rows: BTreeMap<String, (String, u32)> = BTreeMap::new();
        for admin in self.roles.admins() {
            let _ = rows.insert(admin.to_string(), ("admin".to_owned(), 0));
        }
        for (role, name) in [(ROLE_EDITOR, "editor"), (ROLE_VIEWER, "viewer")] {
            for who in self.roles.members_of(role)? {
                let _ = rows
                    .entry(who.to_string())
                    .or_insert_with(|| (name.to_owned(), 0));
            }
        }
        let removed = self.prefixed_set(ADMIN_REMOVED)?;
        let revoked = self.revoked_set()?;
        for (fingerprint, device) in self.devices.entries()? {
            if revoked.contains(&fingerprint) {
                continue;
            }
            let fallback = if removed.contains(&device.account) {
                "removed"
            } else {
                "pending"
            };
            let row = rows
                .entry(device.account.clone())
                .or_insert_with(|| (fallback.to_owned(), 0));
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

    /// Give `account` a role: `admin`, `editor` or `viewer`. Admin only.
    ///
    /// Writes the registry AND re-projects it onto the guarded stores, so the
    /// label and what peers enforce cannot disagree.
    pub fn set_role(&mut self, account: String, role: String) -> app::Result<()> {
        self.require_admin()?;
        let who = Self::parse_account(&account)?;
        let is_admin = self.roles.is_admin(&who);
        match role.as_str() {
            "admin" => {
                if !is_admin {
                    self.roles.grant_admin(who)?;
                }
            }
            "editor" | "viewer" => {
                if is_admin && self.roles.admins().len() <= 1 {
                    app::bail!("a vault needs at least one Admin — promote someone else first");
                }
                // The grants first: they are admin actions, and an admin
                // stepping themselves down stops being one on the next line.
                let (grant, revoke) = if role == "editor" {
                    (ROLE_EDITOR, ROLE_VIEWER)
                } else {
                    (ROLE_VIEWER, ROLE_EDITOR)
                };
                self.roles.grant(grant, who)?;
                self.roles.revoke(revoke, &who)?;
                if is_admin {
                    self.roles.revoke_admin(&who)?;
                }
            }
            other => app::bail!("unknown role '{other}': expected admin, editor or viewer"),
        }
        // An explicit role is an explicit re-admission.
        let removed_key = format!("{ADMIN_REMOVED}{account}");
        if self.admin_setting(&removed_key)? == "1" {
            let _ = self
                .admin
                .get_mut()?
                .insert(removed_key, LwwRegister::new(String::new()))?;
        }
        self.project_roles()?;
        self.audit(&format!("role_set:{role}"), &account)?;
        app::emit!(Event::MembersChanged);
        Ok(())
    }

    /// Remove an account from the vault: drop every role and revoke every
    /// device it registered. The caller must then rotate the vault key (the
    /// client does, via `rotate_key`) so nothing written afterwards is
    /// readable with the key the removed account already holds.
    pub fn remove_member(&mut self, account: String) -> app::Result<()> {
        self.require_admin()?;
        let who = Self::parse_account(&account)?;
        if who == Self::me() {
            app::bail!("you cannot remove yourself — leave the team instead");
        }
        if self.roles.is_admin(&who) {
            self.roles.revoke_admin(&who)?;
        }
        for role in [ROLE_EDITOR, ROLE_VIEWER] {
            if self.roles.has_role(role, &who)? {
                self.roles.revoke(role, &who)?;
            }
        }
        self.project_roles()?;
        let theirs: Vec<String> = self
            .devices
            .entries()?
            .filter(|(_, d)| d.account == account)
            .map(|(fp, _)| fp)
            .collect();
        let admin = self.admin.get_mut()?;
        let _ = admin.insert(
            format!("{ADMIN_REMOVED}{account}"),
            LwwRegister::new("1".to_owned()),
        )?;
        for fp in theirs {
            let _ = admin.insert(
                format!("{ADMIN_REVOKED}{fp}"),
                LwwRegister::new("1".to_owned()),
            )?;
        }
        self.audit("member_removed", &account)?;
        app::emit!(Event::MembersChanged);
        Ok(())
    }

    /// The role newcomers are admitted with.
    pub fn set_default_role(&mut self, role: String) -> app::Result<()> {
        self.require_admin()?;
        if role != "editor" && role != "viewer" {
            app::bail!("default role must be editor or viewer");
        }
        let _ = self.admin.get_mut()?.insert(
            ADMIN_DEFAULT_ROLE.to_owned(),
            LwwRegister::new(role.clone()),
        )?;
        self.audit(&format!("default_role:{role}"), "vault")?;
        Ok(())
    }

    // ── Devices & keys ──────────────────────────────────────────────────────

    fn admin_setting(&self, key: &str) -> app::Result<String> {
        Ok(self
            .admin
            .get()?
            .get(key)?
            .map(|r| r.get().clone())
            .unwrap_or_default())
    }

    /// Every admin-store key under `prefix` whose flag is set, prefix stripped.
    fn prefixed_set(&self, prefix: &str) -> app::Result<BTreeSet<String>> {
        Ok(self
            .admin
            .get()?
            .entries()?
            .filter(|(_, flag)| flag.get() == "1")
            .filter_map(|(k, _)| k.strip_prefix(prefix).map(str::to_owned))
            .collect())
    }

    fn revoked_set(&self) -> app::Result<BTreeSet<String>> {
        self.prefixed_set(ADMIN_REVOKED)
    }

    /// Register this browser's public key so the vault key can be wrapped to
    /// it. `fingerprint` must be the hex SHA-256 of the raw key; the client
    /// derives both, and the contract checks the shape, not the hash (a wrong
    /// fingerprint only hurts the registrant: nothing wrapped to it opens).
    pub fn register_device(
        &mut self,
        fingerprint: String,
        public_key: String,
        label: String,
        kind: String,
    ) -> app::Result<()> {
        if fingerprint.len() != 64 || !fingerprint.chars().all(|c| c.is_ascii_hexdigit()) {
            app::bail!("fingerprint must be 64 hex characters");
        }
        if !DEVICE_KINDS.contains(&kind.as_str()) {
            app::bail!("device kind must be browser or recovery");
        }
        Self::check_envelope(&public_key)?;
        if self.devices.contains(&fingerprint)? {
            return Ok(());
        }
        self.devices.insert(
            fingerprint.clone(),
            DeviceKey {
                public_key,
                label,
                kind,
                account: Self::me_str(),
                node_device: hex::encode(env::device_id()),
                added_at: env::time_now(),
            },
        )?;
        self.audit("device_registered", &fingerprint)?;
        app::emit!(Event::KeysChanged);
        Ok(())
    }

    pub fn list_devices(&self) -> app::Result<Vec<DeviceView>> {
        let revoked = self.revoked_set()?;
        Ok(self
            .devices
            .entries()?
            .map(|(fingerprint, d)| DeviceView {
                revoked: revoked.contains(&fingerprint),
                fingerprint,
                public_key: d.public_key,
                label: d.label,
                kind: d.kind,
                account: d.account,
                added_at: d.added_at,
            })
            .collect())
    }

    /// Revoke a device. Your own device you may always revoke; anyone else's
    /// needs an admin. Follow with `rotate_key`.
    pub fn revoke_device(&mut self, fingerprint: String) -> app::Result<()> {
        if !self.devices.contains(&fingerprint)? {
            app::bail!("no such device");
        }
        let owned = self.devices.owned_by_me(&fingerprint).unwrap_or(false);
        let is_admin = self.roles.is_admin(&Self::me());
        self.require(
            owned || is_admin,
            "only the device's owner or a vault Admin can revoke it",
        )?;
        if is_admin {
            let _ = self.admin.get_mut()?.insert(
                format!("{ADMIN_REVOKED}{fingerprint}"),
                LwwRegister::new("1".to_owned()),
            )?;
        } else {
            // An owner revokes by withdrawing the key: nothing will be wrapped
            // to a key that is no longer listed.
            let _ = self.devices.remove(&fingerprint)?;
        }
        self.audit("device_revoked", &fingerprint)?;
        app::emit!(Event::KeysChanged);
        Ok(())
    }

    /// Store wraps of a vault key. Any member holding the key may wrap it to
    /// any registered, unrevoked device — that is how a newcomer or a new
    /// device gets in without the creator being online.
    pub fn add_key_wraps(&mut self, wraps: Vec<KeyWrapInput>) -> app::Result<u32> {
        let revoked = self.revoked_set()?;
        let mut added = 0;
        for w in wraps {
            Self::check_envelope(&w.envelope)?;
            if revoked.contains(&w.recipient) || !self.devices.contains(&w.recipient)? {
                continue;
            }
            let slot = format!("{}:{}:{}", w.key_id, w.recipient, w.wrapper);
            if self.key_wraps.contains(&slot)? {
                continue;
            }
            self.key_wraps.insert(
                slot,
                KeyWrap {
                    key_id: w.key_id,
                    recipient: w.recipient,
                    wrapper: w.wrapper,
                    envelope: w.envelope,
                    wrapped_by: Self::me_str(),
                    wrapped_at: env::time_now(),
                },
            )?;
            added += 1;
        }
        if added > 0 {
            app::emit!(Event::KeysChanged);
        }
        Ok(added)
    }

    /// Every wrap addressed to `recipient`.
    pub fn key_wraps_for(&self, recipient: String) -> app::Result<Vec<KeyWrapView>> {
        Ok(self
            .key_wraps
            .entries()?
            .filter(|(_, w)| w.recipient == recipient)
            .map(|(_, w)| KeyWrapView {
                key_id: w.key_id,
                recipient: w.recipient,
                wrapper: w.wrapper,
                envelope: w.envelope,
                wrapped_by: w.wrapped_by,
            })
            .collect())
    }

    /// Which `key_id:recipient` pairs already have a wrap, so a key holder
    /// only wraps what is missing.
    pub fn wrapped_pairs(&self) -> app::Result<Vec<String>> {
        let pairs: BTreeSet<String> = self
            .key_wraps
            .entries()?
            .map(|(_, w)| format!("{}:{}", w.key_id, w.recipient))
            .collect();
        Ok(pairs.into_iter().collect())
    }

    /// Make `key_id` the key new writes use. The first call bootstraps the
    /// vault; every later one is a rotation, and both are admin only.
    ///
    /// The caller must have stored wraps of the new key before calling this,
    /// or members would be told to write with a key they cannot open.
    pub fn rotate_key(&mut self, key_id: String) -> app::Result<()> {
        self.require_admin()?;
        let has_wrap = self.key_wraps.entries()?.any(|(_, w)| w.key_id == key_id);
        if !has_wrap {
            app::bail!("wrap the new key to at least one device before switching to it");
        }
        let first = self.admin_setting(ADMIN_CURRENT_KEY)?.is_empty();
        let _ = self.admin.get_mut()?.insert(
            ADMIN_CURRENT_KEY.to_owned(),
            LwwRegister::new(key_id.clone()),
        )?;
        self.audit(if first { "key_created" } else { "key_rotated" }, &key_id)?;
        app::emit!(Event::KeysChanged);
        Ok(())
    }

    // ── Secrets ─────────────────────────────────────────────────────────────

    fn view_of(id: String, s: &Secret) -> app::Result<SecretView> {
        let fields = s
            .fields
            .entries()?
            .map(|(k, v)| (k, v.get().clone()))
            .filter(|(_, v)| !v.is_empty())
            .collect();
        Ok(SecretView {
            id,
            kind: s.kind.get().clone(),
            name: s.name.get().clone(),
            tags: s.tags.get().clone(),
            fields,
            created_at: *s.created_at.get(),
            created_by: s.created_by.get().clone(),
            updated_at: *s.updated_at.get(),
            updated_by: s.updated_by.get().clone(),
            trashed: *s.trashed.get(),
            trashed_at: *s.trashed_at.get(),
        })
    }

    /// Add a secret under an id the CLIENT chose.
    ///
    /// Client-chosen because the id is bound into every field's ciphertext as
    /// associated data, which is what stops a member from pasting one secret's
    /// password envelope into another secret: the id has to exist before the
    /// encryption does. It is 16 random bytes like before, and an id that is
    /// already taken is refused rather than upserted.
    pub fn add_secret(
        &mut self,
        id: String,
        kind: String,
        name: String,
        tags: String,
        fields: BTreeMap<String, String>,
    ) -> app::Result<String> {
        self.require_editor()?;
        if !SECRET_KINDS.contains(&kind.as_str()) {
            app::bail!("unknown secret kind '{kind}'");
        }
        if fields.len() > MAX_FIELDS {
            app::bail!("too many fields");
        }
        Self::check_envelope(&name)?;
        Self::check_envelope(&tags)?;
        for v in fields.values() {
            Self::check_envelope(v)?;
        }

        let well_formed = id
            .strip_prefix("secret_")
            .is_some_and(|h| h.len() == 32 && h.chars().all(|c| c.is_ascii_hexdigit()));
        if !well_formed {
            app::bail!("secret id must be 'secret_' followed by 32 hex characters");
        }
        if self.secrets.get()?.contains(&id)? {
            app::bail!("a secret with this id already exists");
        }
        let now = env::time_now();
        let me = Self::me_str();
        let mut stored = UnorderedMap::new();
        for (k, v) in fields {
            let _ = stored.insert(k, LwwRegister::new(v))?;
        }
        let secret = Secret {
            kind: LwwRegister::new(kind),
            name: LwwRegister::new(name),
            tags: LwwRegister::new(tags),
            fields: stored,
            created_at: LwwRegister::new(now),
            created_by: LwwRegister::new(me.clone()),
            updated_at: LwwRegister::new(now),
            updated_by: LwwRegister::new(me),
            trashed: LwwRegister::new(false),
            trashed_at: LwwRegister::new(0),
        };
        let _ = self.secrets.get_mut()?.insert(id.clone(), secret)?;
        self.audit("secret_added", &id)?;
        app::emit!(Event::SecretChanged {
            secret_id: id.clone()
        });
        Ok(id)
    }

    /// Change some of a secret's fields. Only what is passed is touched, so
    /// two members editing different fields concurrently both keep their edit.
    /// An empty string clears a field. Every superseded value is kept in the
    /// history, still encrypted.
    ///
    /// `rekey` marks a re-encryption under a rotated key: the plaintext did not
    /// change, so nothing is added to the history.
    pub fn update_secret(
        &mut self,
        id: String,
        name: Option<String>,
        tags: Option<String>,
        fields: BTreeMap<String, String>,
        rekey: bool,
    ) -> app::Result<()> {
        self.require_editor()?;
        for v in fields.values().chain(name.iter()).chain(tags.iter()) {
            Self::check_envelope(v)?;
        }
        let now = env::time_now();
        let me = Self::me_str();
        let mut superseded: Vec<(String, String)> = Vec::new();
        {
            let map = self.secrets.get_mut()?;
            let mut secret = map
                .get_mut(&id)?
                .ok_or_else(|| app::err!("secret not found"))?;
            if let Some(name) = name {
                superseded.push(("name".to_owned(), secret.name.get().clone()));
                secret.name.set(name);
            }
            if let Some(tags) = tags {
                superseded.push(("tags".to_owned(), secret.tags.get().clone()));
                secret.tags.set(tags);
            }
            for (field, value) in fields {
                let previous = secret
                    .fields
                    .get(&field)?
                    .map(|r| r.get().clone())
                    .unwrap_or_default();
                if previous == value {
                    continue;
                }
                superseded.push((field.clone(), previous));
                let _ = secret.fields.insert(field, LwwRegister::new(value))?;
            }
            if secret.fields.len()? > MAX_FIELDS {
                app::bail!("too many fields");
            }
            secret.updated_at.set(now);
            secret.updated_by.set(me.clone());
        }
        if !rekey {
            let history = self.history.get_mut()?;
            for (field, previous) in superseded {
                if previous.is_empty() {
                    continue;
                }
                let _ = history.insert(
                    Self::fresh_id("rev"),
                    Revision {
                        secret_id: id.clone(),
                        field,
                        previous,
                        replaced_at: now,
                        replaced_by: me.clone(),
                    },
                )?;
            }
        }
        self.audit(
            if rekey {
                "secret_rekeyed"
            } else {
                "secret_updated"
            },
            &id,
        )?;
        app::emit!(Event::SecretChanged { secret_id: id });
        Ok(())
    }

    /// Superseded values of one secret, newest first.
    pub fn secret_history(&self, id: String) -> app::Result<Vec<RevisionView>> {
        let mut out: Vec<RevisionView> = self
            .history
            .get()?
            .entries()?
            .filter(|(_, r)| r.secret_id == id)
            .map(|(_, r)| RevisionView {
                field: r.field,
                previous: r.previous,
                replaced_at: r.replaced_at,
                replaced_by: r.replaced_by,
            })
            .collect();
        out.sort_by_key(|r| std::cmp::Reverse(r.replaced_at));
        Ok(out)
    }

    fn set_trashed(&mut self, id: &str, trashed: bool) -> app::Result<()> {
        self.require_editor()?;
        let now = env::time_now();
        let map = self.secrets.get_mut()?;
        let mut secret = map
            .get_mut(id)?
            .ok_or_else(|| app::err!("secret not found"))?;
        secret.trashed.set(trashed);
        secret.trashed_at.set(if trashed { now } else { 0 });
        Ok(())
    }

    /// Move a secret to the trash. Recoverable until an admin purges it.
    pub fn trash_secret(&mut self, id: String) -> app::Result<()> {
        self.set_trashed(&id, true)?;
        self.audit("secret_trashed", &id)?;
        app::emit!(Event::SecretChanged { secret_id: id });
        Ok(())
    }

    pub fn restore_secret(&mut self, id: String) -> app::Result<()> {
        self.set_trashed(&id, false)?;
        self.audit("secret_restored", &id)?;
        app::emit!(Event::SecretChanged { secret_id: id });
        Ok(())
    }

    /// Delete a trashed secret and its history for good. Admin only — this is
    /// the one operation that needs DELETE on the guarded store.
    pub fn purge_secret(&mut self, id: String) -> app::Result<()> {
        self.require(
            self.secrets.can(&Self::me(), Op::Delete),
            "only a vault Admin can permanently delete a secret",
        )?;
        let trashed = self
            .secrets
            .get()?
            .get(&id)?
            .map(|s| *s.trashed.get())
            .ok_or_else(|| app::err!("secret not found"))?;
        if !trashed {
            app::bail!("move the secret to the trash first");
        }
        let _ = self.secrets.get_mut()?.remove(&id)?;
        let revisions: Vec<String> = self
            .history
            .get()?
            .entries()?
            .filter(|(_, r)| r.secret_id == id)
            .map(|(k, _)| k)
            .collect();
        let history = self.history.get_mut()?;
        for k in revisions {
            let _ = history.remove(&k)?;
        }
        self.audit("secret_purged", &id)?;
        app::emit!(Event::SecretChanged { secret_id: id });
        Ok(())
    }

    pub fn get_secret(&self, id: String) -> app::Result<Option<SecretView>> {
        match self.secrets.get()?.get(&id)? {
            Some(s) => Ok(Some(Self::view_of(id, &s)?)),
            None => Ok(None),
        }
    }

    /// Every secret, trashed ones included — the client splits them. Search
    /// and filtering happen in the browser, after decryption: the contract
    /// holds ciphertext and has nothing to match against.
    pub fn list_secrets(&self) -> app::Result<Vec<SecretView>> {
        self.secrets
            .get()?
            .entries()?
            .map(|(id, s)| Self::view_of(id, &s))
            .collect()
    }

    // ── Audit ───────────────────────────────────────────────────────────────

    /// The trail, newest first.
    pub fn get_audit_logs(&self) -> app::Result<Vec<AuditView>> {
        let mut logs: Vec<AuditView> = self
            .audit
            .iter()?
            .map(|e| AuditView {
                redacted: e.action.is_empty(),
                action: e.action,
                target: e.target,
                account: e.account,
                device: e.device,
                timestamp: e.timestamp,
            })
            .collect();
        logs.sort_by_key(|l| std::cmp::Reverse(l.timestamp));
        Ok(logs)
    }
}

#[cfg(test)]
mod tests;
