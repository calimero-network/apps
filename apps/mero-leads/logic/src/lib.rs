//! Mero Leads — an inbox for a website's contact form, and the pipeline a
//! team moves those leads through.
//!
//! A context is one inbox. Its members are the team, plus one account per
//! website form: a "form key" with no node of its own, which writes
//! `submit_lead` through a relay by delegated execution (see the README). The
//! team reads the leads, edits them and moves them through the pipeline from
//! the app.
//!
//! # Who may write what — enforced by every node, not by these methods
//!
//! A receiving node does not run this contract; it checks the delta's
//! signature and the entry's storage stamp, then applies it. The `if`s below
//! only make a refused write fail early. What holds is the tier, picked from
//! `apps/mero-chess/docs/trust-model.md`:
//!
//! * `submissions` is a plain `UnorderedMap<id, LwwRegister<Submission>>`
//!   (the register only makes the value mergeable), insert-only by this
//!   contract: `submit_lead` refuses an id that exists, and nothing else
//!   writes it. Deliberately NOT owned storage (`WriteOnce`/`Authored`): a
//!   form key writes through a relay, and core lets only an attested TEE relay
//!   (`RelayTee`) sign an owned entry on a member's behalf. Owned submissions
//!   would make every lead depend on Calimero Cloud's fleet, and a team's own
//!   node could never relay one. The price is that insert-only binds honest
//!   nodes only: a patched MEMBER node could overwrite a submission. Every
//!   member node already holds every lead, so that is a member misbehaving
//!   inside the boundary, not a way in. `submitted_by` is the calling account
//!   as the node that ran the call saw it; for a form key that node is the
//!   relay.
//! * `pipeline` is `SharedStorage<UnorderedMap<id, Pipeline>>`, writable by
//!   the team only: each lead's status, notes, owner and corrected contact
//!   details. A form key is a member but not on the team, so a pipeline write
//!   from it is rejected at merge on every node.
//! * `settings` is `SharedStorage<UnorderedMap<key, String>>` with the same
//!   writers as `pipeline`: the inbox's display name.
//! * `form_keys` is `SharedStorage<UnorderedMap<account, FormKey>>`, writable
//!   by the admins only: which accounts are website form keys, with a label.
//!   It is the app's register, not the grant. What lets a form key write is
//!   being a member of the namespace, which the app adds and removes through
//!   the node; the register is how the team knows which member is which.
//! * `roles` is `AccessControl`: the admins (the installer to start with) and
//!   the `team` role. Only admins change it, enforced at merge.
//!
//! The team's edits are an overlay: a lead reads as its submission with the
//! pipeline entry laid over it, so "edited" never means "rewritten".
//!
//! # Who may READ
//!
//! `list_leads` refuses anyone off the team, but that is a convenience, not
//! the boundary. A context's state replicates to every member NODE, so who
//! can read leads is whoever runs a node in this context. A form key runs no
//! node: a relay executes its one call inside an attested TEE and hands it
//! nothing back but the new lead's id. Keep the context to the team and its
//! form keys.

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{app, env, AccountId};
use calimero_storage::collections::{
    AccessControl, LwwRegister, SharedStorage, StoreError, UnorderedMap,
};

#[cfg(test)]
mod tests;

/// The role a team member holds, besides the admins.
const TEAM: &str = "team";

/// Where a lead is in the pipeline, in order. `spam` is a status rather than a
/// delete: submissions are immutable, and a spam lead should stay out of the
/// way without vanishing from the record.
pub const STATUSES: [&str; 6] = ["new", "contacted", "qualified", "won", "lost", "spam"];

/// Field limits, in characters. The form's backend enforces the same ones.
const MAX_NAME: usize = 200;
const MAX_EMAIL: usize = 254;
const MAX_COMPANY: usize = 200;
const MAX_MESSAGE: usize = 5_000;
const MAX_SOURCE: usize = 300;
const MAX_NOTES: usize = 10_000;
const MAX_LABEL: usize = 100;

/// The `settings` key the inbox's display name is kept under.
const INBOX_NAME: &str = "name";

/// What the visitor sent, exactly. Inserted once, never edited.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Submission {
    pub name: String,
    pub email: String,
    pub company: String,
    pub message: String,
    /// The page the form was sent from, e.g. `/cloud/`.
    pub source: String,
    /// When the node accepted it, in nanoseconds since the Unix epoch.
    pub created_at: u64,
    /// The account that called `submit_lead` (hex): which form key, or which
    /// teammate entered it by hand.
    pub submitted_by: String,
}

/// The team's working state for one lead. Every field is a register, so two
/// teammates editing different fields at once both keep their change.
#[derive(BorshSerialize, BorshDeserialize, AbiType, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Pipeline {
    pub status: LwwRegister<String>,
    pub notes: LwwRegister<String>,
    /// The teammate looking after it, as an account (hex), or empty.
    pub owner: LwwRegister<String>,
    /// Corrected contact details; empty means "as submitted".
    pub name: LwwRegister<String>,
    pub email: LwwRegister<String>,
    pub company: LwwRegister<String>,
    pub updated_at: LwwRegister<u64>,
    /// Who made the last change, as an account (hex).
    pub updated_by: LwwRegister<String>,
}

/// A website form's key, as the admins registered it.
#[derive(BorshSerialize, BorshDeserialize, AbiType, app::Mergeable)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct FormKey {
    /// What the admins call it, e.g. "calimero.network contact form".
    pub label: LwwRegister<String>,
    pub created_at: LwwRegister<u64>,
    pub created_by: LwwRegister<String>,
}

#[app::state(emits = for<'a> Event<'a>)]
pub struct MeroLeads {
    submissions: UnorderedMap<String, LwwRegister<Submission>>,
    pipeline: SharedStorage<UnorderedMap<String, Pipeline>>,
    settings: SharedStorage<UnorderedMap<String, LwwRegister<String>>>,
    form_keys: SharedStorage<UnorderedMap<String, FormKey>>,
    roles: AccessControl,
}

/// Emitted after the write that caused it. Carries ids, never contact details.
#[app::event]
pub enum Event<'a> {
    /// A lead was submitted.
    Submitted { id: &'a str, source: &'a str },
    /// A teammate changed a lead.
    Updated { id: &'a str, status: &'a str },
}

/// A lead as the team sees it: the submission with the team's edits laid over.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LeadView {
    pub id: String,
    pub created_at: u64,
    pub name: String,
    pub email: String,
    pub company: String,
    pub message: String,
    pub source: String,
    pub status: String,
    pub notes: String,
    pub owner: String,
    /// The account that submitted it (hex): which form key, or which teammate.
    pub submitted_by: String,
    /// Zero until a teammate first changes it.
    pub updated_at: u64,
    pub updated_by: String,
    /// The details as submitted, for the fields a teammate corrected.
    pub original_name: String,
    pub original_email: String,
    pub original_company: String,
}

/// A registered form key, with what it has sent.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct FormKeyView {
    pub account: String,
    pub label: String,
    pub created_at: u64,
    pub created_by: String,
    /// How many leads this account has submitted.
    pub leads: u32,
    /// When it last submitted one, or zero.
    pub last_lead_at: u64,
}

/// One entry of the team.
#[derive(AbiType, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TeamMember {
    pub account: String,
    pub admin: bool,
}

/// What a teammate may change about a lead. Absent fields are left alone.
#[derive(AbiType, Debug, Clone, Default, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LeadChanges {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub company: Option<String>,
}

fn store_err(what: &'static str) -> impl FnOnce(StoreError) -> AppError {
    move |e| AppError::msg(format!("{what}: {e}"))
}

fn check(field: &str, value: &str, max: usize, required: bool) -> app::Result<()> {
    if required && value.trim().is_empty() {
        return Err(AppError::msg(format!("{field} is required")));
    }
    if value.chars().count() > max {
        return Err(AppError::msg(format!(
            "{field} is too long (at most {max} characters)"
        )));
    }
    Ok(())
}

/// A deliberately loose shape check: one `@`, something before it, a dot in
/// the domain, and no whitespace. Delivery is the real test.
pub fn looks_like_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !email.chars().any(char::is_whitespace)
}

fn check_email(email: &str) -> app::Result<()> {
    if !looks_like_email(email) {
        return Err(AppError::msg("email is not a valid address"));
    }
    Ok(())
}

fn check_status(status: &str) -> app::Result<()> {
    if !STATUSES.contains(&status) {
        return Err(AppError::msg(format!(
            "unknown status {status:?}; one of {}",
            STATUSES.join(", ")
        )));
    }
    Ok(())
}

/// An account id from the hex string the app sends.
fn parse_account(field: &str, value: &str) -> app::Result<AccountId> {
    value
        .trim()
        .to_lowercase()
        .parse()
        .map_err(|_| AppError::msg(format!("{field} is not an account id")))
}

fn me() -> AccountId {
    env::account_id().into()
}

#[app::logic]
impl MeroLeads {
    /// Creates an empty inbox. The installer is its first admin and, until
    /// teammates are added, the only one who can read it.
    #[app::init]
    pub fn init() -> MeroLeads {
        let me = me();
        MeroLeads {
            submissions: UnorderedMap::new(),
            pipeline: SharedStorage::new(BTreeSet::from([me]), false),
            settings: SharedStorage::new(BTreeSet::from([me]), false),
            form_keys: SharedStorage::new(BTreeSet::from([me]), false),
            roles: AccessControl::new(me),
        }
    }

    /// Stores a lead and returns its id. What the website form calls.
    ///
    /// `name`, `email` and `message` are required; `company` and `source` may
    /// be empty. Emits `Submitted` with the id and source page only.
    pub fn submit_lead(
        &mut self,
        name: String,
        email: String,
        company: String,
        message: String,
        source: String,
    ) -> app::Result<String> {
        let submission = Submission {
            name: name.trim().to_owned(),
            email: email.trim().to_owned(),
            company: company.trim().to_owned(),
            message: message.trim().to_owned(),
            source: source.trim().to_owned(),
            created_at: env::time_now(),
            submitted_by: me().to_string(),
        };
        check("name", &submission.name, MAX_NAME, true)?;
        check("email", &submission.email, MAX_EMAIL, true)?;
        check("company", &submission.company, MAX_COMPANY, false)?;
        check("message", &submission.message, MAX_MESSAGE, true)?;
        check("source", &submission.source, MAX_SOURCE, false)?;
        check_email(&submission.email)?;

        let mut bytes = [0u8; 16];
        env::random_bytes(&mut bytes);
        let id = hex::encode(bytes);
        if self
            .submissions
            .contains(&id)
            .map_err(store_err("submissions.contains"))?
        {
            return Err(AppError::msg("lead id collision; submit again"));
        }
        let source = submission.source.clone();
        self.submissions
            .insert(id.clone(), LwwRegister::new(submission))
            .map_err(store_err("submissions.insert"))?;
        app::emit!(Event::Submitted {
            id: &id,
            source: &source,
        });
        Ok(id)
    }

    /// Every lead, newest first. Team only.
    pub fn list_leads(&self) -> app::Result<Vec<LeadView>> {
        self.only_team()?;
        let pipeline = self.pipeline.get().map_err(store_err("pipeline.get"))?;
        let mut views = Vec::new();
        for (id, submission) in self
            .submissions
            .entries()
            .map_err(store_err("submissions.entries"))?
        {
            let entry = pipeline.get(&id).map_err(store_err("pipeline.get"))?;
            views.push(view(id, submission.get().clone(), entry.as_deref()));
        }
        views.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok(views)
    }

    /// One lead. Team only.
    pub fn get_lead(&self, id: String) -> app::Result<LeadView> {
        self.only_team()?;
        let submission = self.submission(&id)?;
        let pipeline = self.pipeline.get().map_err(store_err("pipeline.get"))?;
        let entry = pipeline.get(&id).map_err(store_err("pipeline.get"))?;
        Ok(view(id, submission, entry.as_deref()))
    }

    /// Changes a lead: its status, notes, owner or corrected contact details.
    /// Team only, and the write itself is rejected at merge for anyone else.
    ///
    /// An empty `name`, `email` or `company` goes back to what was submitted.
    pub fn update_lead(&mut self, id: String, changes: LeadChanges) -> app::Result<LeadView> {
        self.only_team()?;
        let submission = self.submission(&id)?;

        if let Some(status) = &changes.status {
            check_status(status)?;
        }
        if let Some(notes) = &changes.notes {
            check("notes", notes, MAX_NOTES, false)?;
        }
        if let Some(owner) = &changes.owner {
            if !owner.is_empty() {
                let account = parse_account("owner", owner)?;
                if !self.is_team(&account)? {
                    return Err(AppError::msg("owner is not on the team"));
                }
            }
        }
        if let Some(name) = &changes.name {
            check("name", name.trim(), MAX_NAME, false)?;
        }
        if let Some(email) = &changes.email {
            let email = email.trim();
            check("email", email, MAX_EMAIL, false)?;
            if !email.is_empty() {
                check_email(email)?;
            }
        }
        if let Some(company) = &changes.company {
            check("company", company.trim(), MAX_COMPANY, false)?;
        }

        let now = env::time_now();
        let by = me().to_string();
        let pipeline = self
            .pipeline
            .get_mut()
            .map_err(store_err("pipeline.get_mut"))?;
        let mut entry = match pipeline.get(&id).map_err(store_err("pipeline.get"))? {
            Some(existing) => existing.clone_registers(),
            None => Pipeline::fresh(),
        };
        if let Some(status) = changes.status {
            entry.status.set(status);
        }
        if let Some(notes) = changes.notes {
            entry.notes.set(notes);
        }
        if let Some(owner) = changes.owner {
            entry.owner.set(owner.to_lowercase());
        }
        if let Some(name) = changes.name {
            entry.name.set(name.trim().to_owned());
        }
        if let Some(email) = changes.email {
            entry.email.set(email.trim().to_owned());
        }
        if let Some(company) = changes.company {
            entry.company.set(company.trim().to_owned());
        }
        entry.updated_at.set(now);
        entry.updated_by.set(by);
        let status = entry.status.get().clone();
        let lead = view(id.clone(), submission, Some(&entry));
        let _previous = pipeline
            .insert(id.clone(), entry)
            .map_err(store_err("pipeline.insert"))?;
        app::emit!(Event::Updated {
            id: &id,
            status: &status,
        });
        Ok(lead)
    }

    /// Moves a lead to `status`. Team only; the same as `update_lead` with
    /// only a status.
    pub fn set_status(&mut self, id: String, status: String) -> app::Result<LeadView> {
        self.update_lead(
            id,
            LeadChanges {
                status: Some(status),
                ..LeadChanges::default()
            },
        )
    }

    /// The statuses a lead can be in, in pipeline order.
    pub fn statuses(&self) -> app::Result<Vec<String>> {
        Ok(STATUSES.iter().map(|s| (*s).to_owned()).collect())
    }

    /// The team: the admins and the `team` role. Team only.
    pub fn list_team(&self) -> app::Result<Vec<TeamMember>> {
        self.only_team()?;
        let admins = self.roles.admins();
        let mut members: BTreeMap<String, bool> =
            admins.iter().map(|a| (a.to_string(), true)).collect();
        for account in self
            .roles
            .members_of(TEAM)
            .map_err(store_err("roles.members_of"))?
        {
            let _ = members.entry(account.to_string()).or_insert(false);
        }
        Ok(members
            .into_iter()
            .map(|(account, admin)| TeamMember { account, admin })
            .collect())
    }

    /// Adds `who` to the team. Admin only, enforced at merge.
    pub fn add_team_member(&mut self, who: String) -> app::Result<()> {
        self.only_admin()?;
        let who = parse_account("who", &who)?;
        let keys = self.form_keys.get().map_err(store_err("form_keys.get"))?;
        if keys
            .contains(&who.to_string())
            .map_err(store_err("form_keys.contains"))?
        {
            return Err(AppError::msg("a form key cannot join the team"));
        }
        self.roles
            .grant(TEAM, who)
            .map_err(store_err("roles.grant"))?;
        self.sync_pipeline_writers()
    }

    /// Removes `who` from the team. Admin only, enforced at merge.
    pub fn remove_team_member(&mut self, who: String) -> app::Result<()> {
        self.only_admin()?;
        let who = parse_account("who", &who)?;
        self.roles
            .revoke(TEAM, &who)
            .map_err(store_err("roles.revoke"))?;
        self.sync_pipeline_writers()
    }

    /// The inbox's display name, or empty. Anyone in the context may read it.
    pub fn inbox_name(&self) -> app::Result<String> {
        let settings = self.settings.get().map_err(store_err("settings.get"))?;
        Ok(settings
            .get(INBOX_NAME)
            .map_err(store_err("settings.get"))?
            .map(|v| v.get().clone())
            .unwrap_or_default())
    }

    /// Names the inbox. Team only.
    pub fn set_inbox_name(&mut self, name: String) -> app::Result<()> {
        self.only_team()?;
        let name = name.trim().to_owned();
        check("name", &name, MAX_NAME, false)?;
        let _previous = self
            .settings
            .get_mut()
            .map_err(store_err("settings.get_mut"))?
            .insert(INBOX_NAME.to_owned(), LwwRegister::new(name))
            .map_err(store_err("settings.insert"))?;
        Ok(())
    }

    /// Records `account` as a website form key called `label`. Admin only.
    ///
    /// The app calls this after it has made the account a member of the
    /// namespace; the register is what lists and labels it.
    pub fn register_form_key(&mut self, account: String, label: String) -> app::Result<()> {
        self.only_admin()?;
        let account = parse_account("account", &account)?;
        let label = label.trim().to_owned();
        check("label", &label, MAX_LABEL, true)?;
        if self.is_team(&account)? {
            return Err(AppError::msg("a teammate cannot be a form key"));
        }
        let key = FormKey {
            label: LwwRegister::new(label),
            created_at: LwwRegister::new(env::time_now()),
            created_by: LwwRegister::new(me().to_string()),
        };
        let _previous = self
            .form_keys
            .get_mut()
            .map_err(store_err("form_keys.get_mut"))?
            .insert(account.to_string(), key)
            .map_err(store_err("form_keys.insert"))?;
        Ok(())
    }

    /// Drops `account` from the register. Admin only. Removing its membership
    /// is what actually stops it writing; the app does both.
    pub fn forget_form_key(&mut self, account: String) -> app::Result<()> {
        self.only_admin()?;
        let account = parse_account("account", &account)?;
        let _removed = self
            .form_keys
            .get_mut()
            .map_err(store_err("form_keys.get_mut"))?
            .remove(&account.to_string())
            .map_err(store_err("form_keys.remove"))?;
        Ok(())
    }

    /// The registered form keys, newest first, with what each has sent. Admin
    /// only.
    pub fn list_form_keys(&self) -> app::Result<Vec<FormKeyView>> {
        self.only_admin()?;
        let mut sent: BTreeMap<String, (u32, u64)> = BTreeMap::new();
        for (_, submission) in self
            .submissions
            .entries()
            .map_err(store_err("submissions.entries"))?
        {
            let submission = submission.get();
            let entry = sent
                .entry(submission.submitted_by.clone())
                .or_insert((0, 0));
            entry.0 += 1;
            entry.1 = entry.1.max(submission.created_at);
        }
        let keys = self.form_keys.get().map_err(store_err("form_keys.get"))?;
        let mut views = Vec::new();
        for (account, key) in keys.entries().map_err(store_err("form_keys.entries"))? {
            let (leads, last_lead_at) = sent.get(&account).copied().unwrap_or((0, 0));
            views.push(FormKeyView {
                label: key.label.get().clone(),
                created_at: *key.created_at.get(),
                created_by: key.created_by.get().clone(),
                leads,
                last_lead_at,
                account,
            });
        }
        views.sort_by_key(|v| std::cmp::Reverse(v.created_at));
        Ok(views)
    }

    /// Whether the caller is on the team (an admin or holding `team`).
    pub fn am_i_team(&self) -> app::Result<bool> {
        self.is_team(&me())
    }

    /// Whether the caller is an admin of this inbox.
    pub fn am_i_admin(&self) -> app::Result<bool> {
        Ok(self.roles.is_admin(&me()))
    }

    /// The caller's account, hex-encoded: what `add_team_member` takes.
    pub fn my_account(&self) -> app::Result<String> {
        Ok(me().to_string())
    }
}

impl Pipeline {
    fn fresh() -> Pipeline {
        Pipeline {
            status: LwwRegister::new(STATUSES[0].to_owned()),
            notes: LwwRegister::new(String::new()),
            owner: LwwRegister::new(String::new()),
            name: LwwRegister::new(String::new()),
            email: LwwRegister::new(String::new()),
            company: LwwRegister::new(String::new()),
            updated_at: LwwRegister::new(0),
            updated_by: LwwRegister::new(String::new()),
        }
    }

    /// A copy that keeps each register's own clock, so setting one field does
    /// not stamp the others as new.
    fn clone_registers(&self) -> Pipeline {
        Pipeline {
            status: self.status.clone(),
            notes: self.notes.clone(),
            owner: self.owner.clone(),
            name: self.name.clone(),
            email: self.email.clone(),
            company: self.company.clone(),
            updated_at: self.updated_at.clone(),
            updated_by: self.updated_by.clone(),
        }
    }
}

/// The submission with the team's overlay laid over it. A status a patched
/// node wrote that is not in [`STATUSES`] reads as `new`.
fn view(id: String, s: Submission, p: Option<&Pipeline>) -> LeadView {
    let pick = |edited: Option<&String>, original: &str| match edited {
        Some(e) if !e.is_empty() => e.clone(),
        _ => original.to_owned(),
    };
    let status = p
        .map(|p| p.status.get().clone())
        .filter(|s| STATUSES.contains(&s.as_str()))
        .unwrap_or_else(|| STATUSES[0].to_owned());
    LeadView {
        name: pick(p.map(|p| p.name.get()), &s.name),
        email: pick(p.map(|p| p.email.get()), &s.email),
        company: pick(p.map(|p| p.company.get()), &s.company),
        status,
        notes: p.map(|p| p.notes.get().clone()).unwrap_or_default(),
        owner: p.map(|p| p.owner.get().clone()).unwrap_or_default(),
        updated_at: p.map(|p| *p.updated_at.get()).unwrap_or(0),
        updated_by: p.map(|p| p.updated_by.get().clone()).unwrap_or_default(),
        submitted_by: s.submitted_by,
        created_at: s.created_at,
        message: s.message,
        source: s.source,
        original_name: s.name,
        original_email: s.email,
        original_company: s.company,
        id,
    }
}

impl MeroLeads {
    fn is_team(&self, who: &AccountId) -> app::Result<bool> {
        Ok(self.roles.is_admin(who)
            || self
                .roles
                .has_role(TEAM, who)
                .map_err(store_err("roles.has_role"))?)
    }

    fn only_team(&self) -> app::Result<()> {
        if !self.is_team(&me())? {
            return Err(AppError::msg("only the team may do this"));
        }
        Ok(())
    }

    fn only_admin(&self) -> app::Result<()> {
        if !self.roles.is_admin(&me()) {
            return Err(AppError::msg("only an admin may do this"));
        }
        Ok(())
    }

    /// The pipeline is writable by exactly the admins and the `team` role.
    fn sync_pipeline_writers(&mut self) -> app::Result<()> {
        let mut writers = self.roles.admins();
        writers.extend(
            self.roles
                .members_of(TEAM)
                .map_err(store_err("roles.members_of"))?,
        );
        self.pipeline
            .rotate_writers(writers)
            .map_err(store_err("pipeline.rotate_writers"))?;
        Ok(())
    }

    fn submission(&self, id: &str) -> app::Result<Submission> {
        self.submissions
            .get(id)
            .map_err(store_err("submissions.get"))?
            .map(|s| s.get().clone())
            .ok_or_else(|| AppError::msg(format!("no lead {id}")))
    }
}
