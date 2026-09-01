#![allow(clippy::len_without_is_empty)]

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env, AccountId};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{Mergeable as MergeableTrait, UnorderedMap};
use thiserror::Error;

#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct SecretItem {
    pub id: String,
    pub name: String,
    pub secret_type: String, // "login", "secure_note", "totp", "ssh_key", "payment_card"
    pub data: String,        // JSON serialized secret data
    pub tags: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub version: u64,
    pub created_by: String, // user public key
}

// Removed Vault: a Calimero context IS a vault.

/// A vault entry is replicated state, so it has to say how two divergent copies
/// reconcile — `UnorderedMap<_, SecretItem>` is rejected outright otherwise
/// ("cannot be stored in replicated state — it is not a CRDT").
///
/// Last-writer-wins, but over a **total order**, not just `version`. Two members
/// editing the same secret while partitioned both go 1 → 2, so `version` alone
/// ties; `updated_at` usually breaks it, and can itself tie on a fast edit or a
/// skewed clock. A merge that resolved a tie by "take other" would pick a
/// different winner depending on which side merged first, and the replicas would
/// silently disagree forever. Comparing the whole tuple makes the result a `max`
/// over a totally ordered set, which is commutative, associative and idempotent —
/// the actual requirement.
///
/// The losing edit IS discarded. That is the honest semantics for a password
/// field: there is no meaningful way to merge two different passwords, and
/// showing one of them is better than showing a splice of both.
impl MergeableTrait for SecretItem {
    // `std::result::Result`, spelled out: this module defines its own
    // `Result<T> = Result<T, AppError>` alias, which otherwise shadows the one in
    // the trait signature and fails as "type alias takes 1 generic argument".
    fn merge(&mut self, other: &Self) -> std::result::Result<(), MergeError> {
        let mine = (self.version, self.updated_at, &self.name, &self.data);
        let theirs = (other.version, other.updated_at, &other.name, &other.data);
        if theirs > mine {
            *self = other.clone();
        }
        Ok(())
    }
}

// Flat record, no nested collections, so re-keying is a no-op — but the
// `Mergeable: RekeyTarget` supertrait bound still requires the impl.
impl RekeyTarget for SecretItem {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct AuditLogEntry {
    pub id: String,
    pub action: String,
    pub details: String,
    pub user_public_key: String,
    pub timestamp: u64,
}

/// An audit entry is written once and never edited, and every entry is keyed by
/// 16 random bytes, so two entries never contend for the same key. If one ever
/// did, the copy already present wins: an audit trail that a later write can
/// rewrite is not an audit trail.
impl MergeableTrait for AuditLogEntry {
    fn merge(&mut self, _other: &Self) -> std::result::Result<(), MergeError> {
        Ok(())
    }
}

impl RekeyTarget for AuditLogEntry {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Vault not found")]
    VaultNotFound,
    #[error("Secret not found")]
    SecretNotFound,
    #[error("Invalid secret type")]
    InvalidSecretType,
    #[error("Unauthorized access")]
    Unauthorized,
}

pub type Result<T> = std::result::Result<T, AppError>;

// NOTE: no hand-written `#[derive(BorshSerialize, BorshDeserialize)]` and no
// `#[borsh(crate = ...)]` here. `#[app::state]` injects them itself now, and the
// duplicates are what produced `MeroPassApp: AppState is not satisfied`,
// `MeroPassApp: Identity is not satisfied` and `no method named
// __assign_deterministic_ids` — three errors that all read as a missing trait
// rather than as a derive written twice.
#[app::state(emits = for<'a> Event<'a>)]
pub struct MeroPassApp {
    pub secrets: UnorderedMap<String, SecretItem>,
    pub audit_logs: UnorderedMap<String, AuditLogEntry>,
}

#[app::event]
pub enum Event<'a> {
    SecretAdded { secret_id: &'a str, name: &'a str },
    SecretUpdated { secret_id: &'a str, name: &'a str },
    SecretDeleted { secret_id: &'a str, name: &'a str },
}

#[app::logic]
impl MeroPassApp {
    /// Who is calling, as an ACCOUNT — a person, not a machine.
    ///
    /// Was `format!("{:?}", env::executor_id())`, which was wrong three times
    /// over: that is the legacy shim, `{:?}` is a Debug rendering of a key type
    /// rather than its canonical form, and a vault entry's author is a PERSON,
    /// so one user's second device must not read as a different author. Since
    /// core rc.27 this renders as 64 hex characters.
    fn caller_id() -> String {
        AccountId::from(env::account_id()).to_string()
    }

    /// A fresh identifier.
    ///
    /// Was `format!("secret_{}", env::time_now())`. Two secrets added inside the
    /// same millisecond produced the SAME key, and `UnorderedMap::insert` is an
    /// upsert — so the second silently destroyed the first. In a password
    /// manager that is data loss with no error, and it converges to the loss on
    /// every replica; two members adding at once across nodes is the easy way in.
    /// Random bytes from the host are unique without coordination, which is what
    /// a CRDT needs.
    fn fresh_id(prefix: &str) -> String {
        let mut buffer = [0u8; 16];
        env::random_bytes(&mut buffer);
        format!("{prefix}_{}", hex::encode(buffer))
    }

    #[app::init]
    pub fn init() -> MeroPassApp {
        MeroPassApp {
            secrets: UnorderedMap::new(),
            audit_logs: UnorderedMap::new(),
        }
    }

    pub fn add_secret(
        &mut self,
        name: String,
        secret_type: String,
        data: String,
        tags: Vec<String>,
    ) -> app::Result<String> {
        app::log!("Adding secret: {} of type: {}", name, secret_type);

        let secret_id = Self::fresh_id("secret");
        let author = Self::caller_id();

        let secret = SecretItem {
            id: secret_id.clone(),
            name: name.clone(),
            secret_type,
            data,
            tags: tags.clone(),
            created_at: env::time_now(),
            updated_at: env::time_now(),
            version: 1,
            created_by: author,
        };

        self.secrets.insert(secret_id.clone(), secret)?;

        app::emit!(Event::SecretAdded {
            secret_id: &secret_id,
            name: &name,
        });

        self.log_audit_event(
            &secret_id,
            "secret_added",
            &format!("Secret '{}' added", name),
        )?;

        Ok(secret_id)
    }
    pub fn update_secret(
        &mut self,
        secret_id: String,
        name: String,
        data: String,
        tags: Vec<String>,
    ) -> app::Result<()> {
        let secret = self
            .secrets
            .get(&secret_id)?
            .ok_or(AppError::SecretNotFound)?;
        // `UnorderedMap::get` hands back a `ValueRef`, not the value: field reads
        // go through Deref, but an owned record is needed to edit and re-insert.
        let mut updated = (*secret).clone();
        updated.name = name.clone();
        updated.data = data;
        updated.tags = tags.clone();
        updated.updated_at = env::time_now();
        updated.version += 1;
        self.secrets.insert(secret_id.clone(), updated)?;
        self.log_audit_event(
            &secret_id,
            "secret_updated",
            &format!("Secret '{}' updated", name),
        )?;
        Ok(())
    }

    pub fn delete_secret(&mut self, secret_id: String) -> app::Result<()> {
        let secret = self
            .secrets
            .get(&secret_id)?
            .ok_or(AppError::SecretNotFound)?;
        self.secrets.remove(&secret_id)?;
        self.log_audit_event(
            &secret_id,
            "secret_deleted",
            &format!("Secret '{}' deleted", secret.name),
        )?;
        Ok(())
    }

    pub fn get_secret(&self, secret_id: String) -> app::Result<Option<SecretItem>> {
        // Deref out of the `ValueRef` — the RPC surface returns owned values.
        Ok(self.secrets.get(&secret_id)?.map(|s| (*s).clone()))
    }

    pub fn list_secrets(&self) -> app::Result<Vec<SecretItem>> {
        let secrets: Vec<SecretItem> = self.secrets.entries()?.map(|(_, s)| s).collect();
        Ok(secrets)
    }

    pub fn search_secrets(&self, query: String) -> app::Result<Vec<SecretItem>> {
        let query_lower = query.to_lowercase();
        let results: Vec<SecretItem> = self
            .secrets
            .entries()?
            .map(|(_, secret)| secret)
            .filter(|secret| {
                secret.name.to_lowercase().contains(&query_lower)
                    || secret
                        .tags
                        .iter()
                        .any(|tag| tag.to_lowercase().contains(&query_lower))
            })
            .collect();
        Ok(results)
    }

    pub fn get_secrets_by_tag(&self, tag: String) -> app::Result<Vec<SecretItem>> {
        let results: Vec<SecretItem> = self
            .secrets
            .entries()?
            .map(|(_, secret)| secret)
            .filter(|secret| secret.tags.iter().any(|t| t == &tag))
            .collect();
        Ok(results)
    }

    pub fn get_audit_logs(&self) -> app::Result<Vec<AuditLogEntry>> {
        let mut logs: Vec<AuditLogEntry> = self.audit_logs.entries()?.map(|(_, l)| l).collect();
        logs.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        Ok(logs)
    }

    fn log_audit_event(
        &mut self,
        _entity_id: &str,
        action: &str,
        details: &str,
    ) -> app::Result<()> {
        let log_id = Self::fresh_id("log");
        let log_entry = AuditLogEntry {
            id: log_id.clone(),
            action: action.to_string(),
            details: details.to_string(),
            user_public_key: Self::caller_id(),
            timestamp: env::time_now(),
        };
        self.audit_logs.insert(log_id, log_entry)?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    // One person, two machines. `call_as` moves the DEVICE and keeps the
    // account, so these two are the same author — which is the point: a vault
    // entry is authored by a PERSON, and the old `executor_id()` attribution
    // would have made a user's laptop and phone look like two different people.
    const LAPTOP: [u8; 32] = [0xA1; 32];
    const PHONE: [u8; 32] = [0xA2; 32];

    // A different PERSON. Both axes have to move: `call_as` alone shifts only
    // the device, and a test using it for "somebody else" silently asserts
    // nothing once authorship is account-keyed.
    const OTHER_ACCOUNT: [u8; 32] = [0xB0; 32];
    const OTHER_DEVICE: [u8; 32] = [0xB1; 32];

    fn new_vault() -> TestHost<MeroPassApp> {
        TestHost::new(MeroPassApp::init)
    }

    fn add(app: &mut TestHost<MeroPassApp>, name: &str, tags: &[&str]) -> String {
        app.call(|s| {
            s.add_secret(
                name.to_owned(),
                "login".to_owned(),
                r#"{"username":"u","password":"p"}"#.to_owned(),
                tags.iter().map(|t| (*t).to_owned()).collect(),
            )
        })
        .unwrap()
    }

    // ── Vault basics ────────────────────────────────────────────────────────

    #[test]
    fn add_secret_stores_it_and_returns_a_usable_id() {
        let mut app = new_vault();
        let id = add(&mut app, "GitHub", &["dev"]);

        let got = app.view(|s| s.get_secret(id.clone())).unwrap();
        let got = got.expect("the id add_secret returned must resolve");
        assert_eq!(got.name, "GitHub");
        assert_eq!(got.secret_type, "login");
        assert_eq!(got.tags, vec!["dev".to_owned()]);
        assert_eq!(got.version, 1);
    }

    /// The regression test for the bug this port fixed.
    ///
    /// Ids were `format!("secret_{}", env::time_now())`. Two secrets added in
    /// the same millisecond collided, and `UnorderedMap::insert` is an upsert —
    /// so the second silently destroyed the first, on every replica. These two
    /// calls are as close together as the harness can make them.
    #[test]
    fn two_secrets_added_together_do_not_share_an_id() {
        let mut app = new_vault();
        let a = add(&mut app, "First", &[]);
        let b = add(&mut app, "Second", &[]);

        assert_ne!(
            a, b,
            "ids collided — one secret would have overwritten the other"
        );
        assert_eq!(app.view(|s| s.list_secrets()).unwrap().len(), 2);
    }

    #[test]
    fn update_secret_bumps_the_version_and_keeps_the_author() {
        let mut app = new_vault();
        let id = add(&mut app, "GitHub", &["dev"]);
        let author = app
            .view(|s| s.get_secret(id.clone()))
            .unwrap()
            .unwrap()
            .created_by;

        app.call(|s| {
            s.update_secret(
                id.clone(),
                "GitHub (work)".to_owned(),
                r#"{"username":"u2","password":"p2"}"#.to_owned(),
                vec!["work".to_owned()],
            )
        })
        .unwrap();

        let got = app.view(|s| s.get_secret(id)).unwrap().unwrap();
        assert_eq!(got.name, "GitHub (work)");
        assert_eq!(got.tags, vec!["work".to_owned()]);
        assert_eq!(got.version, 2);
        assert_eq!(
            got.created_by, author,
            "an edit must not reassign authorship"
        );
    }

    #[test]
    fn delete_secret_removes_it() {
        let mut app = new_vault();
        let id = add(&mut app, "GitHub", &[]);
        app.call(|s| s.delete_secret(id.clone())).unwrap();
        assert!(app.view(|s| s.get_secret(id)).unwrap().is_none());
        assert!(app.view(|s| s.list_secrets()).unwrap().is_empty());
    }

    #[test]
    fn operating_on_a_missing_secret_is_an_error_not_a_silent_noop() {
        let mut app = new_vault();
        let missing = "secret_does_not_exist".to_owned();

        assert!(app
            .call(|s| s.update_secret(missing.clone(), "x".to_owned(), "{}".to_owned(), vec![]))
            .is_err());
        assert!(app.call(|s| s.delete_secret(missing.clone())).is_err());
        // A read, by contrast, is a legitimate miss rather than an error.
        assert!(app.view(|s| s.get_secret(missing)).unwrap().is_none());
    }

    // ── Search ──────────────────────────────────────────────────────────────

    #[test]
    fn search_matches_name_and_tags_case_insensitively() {
        let mut app = new_vault();
        add(&mut app, "GitHub", &["dev", "Work"]);
        add(&mut app, "Bank", &["finance"]);

        let by_name = app.view(|s| s.search_secrets("github".to_owned())).unwrap();
        assert_eq!(by_name.len(), 1);
        assert_eq!(by_name[0].name, "GitHub");

        let by_tag = app.view(|s| s.search_secrets("WORK".to_owned())).unwrap();
        assert_eq!(by_tag.len(), 1, "tag matching must ignore case too");

        assert!(app
            .view(|s| s.search_secrets("nothing-matches".to_owned()))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn get_secrets_by_tag_is_exact_not_substring() {
        let mut app = new_vault();
        add(&mut app, "GitHub", &["dev"]);
        add(&mut app, "Bank", &["development"]);

        let hits = app
            .view(|s| s.get_secrets_by_tag("dev".to_owned()))
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "GitHub", "`dev` must not match `development`");
    }

    // ── Authorship is a PERSON ──────────────────────────────────────────────

    #[test]
    fn one_person_on_two_devices_is_one_author() {
        let mut app = new_vault();
        let from_laptop = app
            .call_as(LAPTOP, |s| {
                s.add_secret("A".to_owned(), "login".to_owned(), "{}".to_owned(), vec![])
            })
            .unwrap();
        let from_phone = app
            .call_as(PHONE, |s| {
                s.add_secret("B".to_owned(), "login".to_owned(), "{}".to_owned(), vec![])
            })
            .unwrap();

        let a = app.view(|s| s.get_secret(from_laptop)).unwrap().unwrap();
        let b = app.view(|s| s.get_secret(from_phone)).unwrap().unwrap();
        assert_eq!(a.created_by, b.created_by, "same account, so same author");
    }

    #[test]
    fn a_different_person_is_a_different_author() {
        let mut app = new_vault();
        let mine = add(&mut app, "Mine", &[]);
        let theirs = app
            .call_as_account(OTHER_ACCOUNT, OTHER_DEVICE, |s| {
                s.add_secret(
                    "Theirs".to_owned(),
                    "login".to_owned(),
                    "{}".to_owned(),
                    vec![],
                )
            })
            .unwrap();

        let a = app.view(|s| s.get_secret(mine)).unwrap().unwrap();
        let b = app.view(|s| s.get_secret(theirs)).unwrap().unwrap();
        assert_ne!(a.created_by, b.created_by);
    }

    #[test]
    fn an_author_renders_as_an_account_not_a_debug_string() {
        let mut app = new_vault();
        let id = add(&mut app, "GitHub", &[]);
        let author = app.view(|s| s.get_secret(id)).unwrap().unwrap().created_by;

        // Was `format!("{:?}", …)`, which produced a Debug rendering rather than
        // the canonical id. Since core rc.27 an AccountId is 32 bytes of hex.
        assert_eq!(author.len(), 64, "an AccountId renders as 32 bytes of hex");
        assert!(author.chars().all(|c| c.is_ascii_hexdigit()));
    }

    // ── Audit trail ─────────────────────────────────────────────────────────

    #[test]
    fn every_mutation_is_audited_newest_first() {
        let mut app = new_vault();
        let id = add(&mut app, "GitHub", &[]);
        app.call(|s| s.update_secret(id.clone(), "GH".to_owned(), "{}".to_owned(), vec![]))
            .unwrap();
        app.call(|s| s.delete_secret(id)).unwrap();

        let logs = app.view(|s| s.get_audit_logs()).unwrap();
        let actions: Vec<&str> = logs.iter().map(|l| l.action.as_str()).collect();
        assert!(actions.contains(&"secret_added"));
        assert!(actions.contains(&"secret_updated"));
        assert!(actions.contains(&"secret_deleted"));

        // get_audit_logs sorts descending, so timestamps must be non-increasing.
        for pair in logs.windows(2) {
            assert!(
                pair[0].timestamp >= pair[1].timestamp,
                "audit log is not newest-first"
            );
        }
    }

    #[test]
    fn audit_entries_do_not_collide_either() {
        let mut app = new_vault();
        add(&mut app, "A", &[]);
        add(&mut app, "B", &[]);

        // Two adds, two audit entries — they were keyed by the millisecond too.
        let logs = app.view(|s| s.get_audit_logs()).unwrap();
        assert_eq!(
            logs.len(),
            2,
            "an audit entry was overwritten by a same-ms sibling"
        );
    }
}
