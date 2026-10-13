//! Mero Org — the company's directory, group tree, app registry and
//! enrolment state, in one context every member replicates.
//!
//! Admin writes are gated by [`AccessControl`]: the admin tier is the writer
//! set of its backing storage, so a non-admin's forged grant is refused at
//! merge, not only on nodes that execute this code. Profiles live in an
//! [`AuthoredMap`], so each person edits only their own row. Everything else
//! is admin-written and replaced whole per key.

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{app, env, AccountId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AccessControl, AuthoredMap, LwwRegister, Mergeable, UnorderedMap, Vector,
};

#[cfg(test)]
mod tests;

pub const MAX_NAME: usize = 120;
pub const MAX_SHORT: usize = 200;
pub const MAX_LONG: usize = 2_000;
pub const DEFAULT_PAGE: u32 = 50;
pub const MAX_PAGE: u32 = 200;

#[derive(
    AbiType, Debug, Clone, Default, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct OrgSettings {
    pub name: String,
    /// Hex blob id of the org icon, or "".
    pub icon: String,
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct OrgView {
    pub name: String,
    pub icon: String,
    pub admins: Vec<String>,
    pub member_count: u32,
    pub group_count: u32,
    pub app_count: u32,
}

#[app::state(emits = for<'a> Event<'a>)]
pub struct Org {
    settings: LwwRegister<OrgSettings>,
    roles: AccessControl,
    members: UnorderedMap<String, Member>,
    profiles: AuthoredMap<String, Profile>,
    groups: UnorderedMap<String, Group>,
    memberships: UnorderedMap<String, Membership>,
    apps: UnorderedMap<String, App>,
    access: UnorderedMap<String, Access>,
    enrolments: UnorderedMap<String, Enrolment>,
    activity: Vector<ActivityRow>,
}

#[app::event]
pub enum Event<'a> {
    SettingsChanged,
    MemberChanged {
        account: &'a str,
        status: &'a str,
    },
    GroupChanged {
        group: &'a str,
    },
    AccessChanged {
        group: &'a str,
        app: &'a str,
    },
    EnrolmentChanged {
        account: &'a str,
        app: &'a str,
        state: &'a str,
    },
    ActivityAppended {
        index: u32,
    },
}

// Placeholders filled by Tasks 3–5; they exist so the state compiles now.
pub const STATUS_ENROLLED: &str = "enrolled";
pub const STATUS_ACTIVE: &str = "active";
pub const STATUS_SUSPENDED: &str = "suspended";
pub const STATUS_LEFT: &str = "left";
pub const STATUSES: &[&str] = &[
    STATUS_ENROLLED,
    STATUS_ACTIVE,
    STATUS_SUSPENDED,
    STATUS_LEFT,
];

#[app::mergeable(id = "mero_org::Member")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Member {
    pub account: String,
    pub status: LwwRegister<String>,
    pub joined_at: u64,
}
impl Mergeable for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.status.merge(&other.status);
        Ok(())
    }
}

#[app::mergeable(id = "mero_org::Profile")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Profile {
    pub display_name: LwwRegister<String>,
    /// Frozen at claim.
    pub handle: String,
    /// Hex blob id or "".
    pub avatar: LwwRegister<String>,
    pub updated_at: LwwRegister<u64>,
}
impl Mergeable for Profile {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.display_name.merge(&other.display_name);
        self.avatar.merge(&other.avatar);
        self.updated_at.merge(&other.updated_at);
        Ok(())
    }
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct MemberView {
    pub account: String,
    pub status: String,
    pub display_name: String,
    pub handle: String,
    pub avatar: String,
    pub joined_at: u64,
    pub groups: Vec<String>,
    pub apps: Vec<String>,
}

pub const ROLE_LEAD: &str = "lead";
pub const ROLE_MEMBER: &str = "member";
pub const MAX_DEPTH: usize = 16;

#[app::mergeable(id = "mero_org::Group")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Group {
    pub id: String,
    pub name: LwwRegister<String>,
    /// Parent group id, "" at the top.
    pub parent: LwwRegister<String>,
    pub admins: LwwRegister<Vec<String>>,
    pub created_at: u64,
}
impl Mergeable for Group {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.name.merge(&other.name);
        self.parent.merge(&other.parent);
        self.admins.merge(&other.admins);
        Ok(())
    }
}

#[app::mergeable(id = "mero_org::Membership")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Membership {
    pub group: String,
    pub account: String,
    pub role: LwwRegister<String>,
    pub since: u64,
}
impl Mergeable for Membership {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.role.merge(&other.role);
        Ok(())
    }
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct GroupView {
    pub id: String,
    pub name: String,
    pub parent: String,
    pub admins: Vec<String>,
    pub member_count: u32,
    pub created_at: u64,
}

pub const APP_READY: &str = "ready";
pub const APP_PENDING_ADMIN: &str = "pending_admin";
pub const ENROL_NOT: &str = "not_enrolled";
pub const ENROL_PENDING: &str = "invitation_pending";
pub const ENROL_JOINED: &str = "joined";
pub const ENROL_PLACED: &str = "placed";
pub const ENROL_REMOVED: &str = "removed";
pub const ENROL_FAILED: &str = "failed";
pub const ENROL_STATES: &[&str] = &[
    ENROL_NOT,
    ENROL_PENDING,
    ENROL_JOINED,
    ENROL_PLACED,
    ENROL_REMOVED,
    ENROL_FAILED,
];
/// An encoded SignedGroupOpenInvitation is a few KB of JSON.
pub const MAX_INVITATION: usize = 16_384;

#[app::mergeable(id = "mero_org::App")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct App {
    /// The app namespace id, 64 hex. One row per namespace.
    pub id: String,
    pub package: String,
    pub label: LwwRegister<String>,
    /// The org admin account that holds Admin in that namespace.
    pub admin_account: String,
    pub status: LwwRegister<String>,
    pub registered_at: u64,
}
impl Mergeable for App {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.label.merge(&other.label);
        self.status.merge(&other.status);
        Ok(())
    }
}

#[app::mergeable(id = "mero_org::Access")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Access {
    pub group: String,
    pub app: String,
    /// Core capability bitmask given to each placed member in the mirrored subgroup.
    pub capabilities: LwwRegister<u32>,
    pub enabled: LwwRegister<bool>,
}
impl Mergeable for Access {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.capabilities.merge(&other.capabilities);
        self.enabled.merge(&other.enabled);
        Ok(())
    }
}

#[app::mergeable(id = "mero_org::Enrolment")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Enrolment {
    pub account: String,
    pub app: String,
    pub state: LwwRegister<String>,
    /// JSON of the SignedGroupOpenInvitation while `invitation_pending`, else "".
    pub invitation: LwwRegister<String>,
    pub invitation_expires: LwwRegister<u64>,
    /// Mirrored subgroup ids the member is placed in.
    pub subgroups: LwwRegister<Vec<String>>,
    pub note: LwwRegister<String>,
    pub updated_at: LwwRegister<u64>,
}
impl Mergeable for Enrolment {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.state.merge(&other.state);
        self.invitation.merge(&other.invitation);
        self.invitation_expires.merge(&other.invitation_expires);
        self.subgroups.merge(&other.subgroups);
        self.note.merge(&other.note);
        self.updated_at.merge(&other.updated_at);
        Ok(())
    }
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AppView {
    pub id: String,
    pub package: String,
    pub label: String,
    pub admin_account: String,
    pub status: String,
    pub registered_at: u64,
    pub group_count: u32,
}
#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AccessView {
    pub group: String,
    pub app: String,
    pub capabilities: u32,
    pub enabled: bool,
}
#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct EnrolmentView {
    pub account: String,
    pub app: String,
    pub state: String,
    pub invitation: String,
    pub invitation_expires: u64,
    pub subgroups: Vec<String>,
    pub note: String,
    pub updated_at: u64,
}
#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlacementView {
    pub account: String,
    pub app: String,
    pub group: String,
    pub capabilities: u32,
}

#[app::mergeable(id = "mero_org::ActivityRow")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActivityRow {
    pub index: u32,
    pub at: u64,
    pub actor: String,
    pub verb: String,
    pub subject: String,
    pub object: String,
    pub note: String,
    pub prev_hash: String,
    pub hash: String,
}
impl Mergeable for ActivityRow {
    fn merge(&mut self, _: &Self) -> Result<(), MergeError> {
        Ok(())
    }
}

#[derive(AbiType, Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActivityPage {
    pub rows: Vec<ActivityRow>,
    pub total: u32,
}

#[app::logic]
impl Org {
    /// No arguments: the frontend sends `{}`. The creator is the first admin.
    #[app::init]
    pub fn init() -> Org {
        Org {
            settings: LwwRegister::new(OrgSettings::default()),
            roles: AccessControl::new_admin_caller(),
            members: UnorderedMap::new(),
            profiles: AuthoredMap::new(),
            groups: UnorderedMap::new(),
            memberships: UnorderedMap::new(),
            apps: UnorderedMap::new(),
            access: UnorderedMap::new(),
            enrolments: UnorderedMap::new(),
            activity: Vector::new(),
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    fn caller() -> String {
        AccountId::from(env::account_id()).to_string()
    }

    #[allow(dead_code)] // used by Task 5
    fn caller_account() -> AccountId {
        AccountId::from(env::account_id())
    }

    fn require_admin(&self) -> app::Result<()> {
        self.roles
            .only_admin()
            .map_err(|_| AppError::msg("only an org admin can do this"))
    }

    fn fresh_id() -> String {
        let mut buffer = [0u8; 16];
        env::random_bytes(&mut buffer);
        hex::encode(buffer)
    }

    fn now() -> u64 {
        env::time_now()
    }

    fn check_len(field: &str, value: &str, max: usize, required: bool) -> app::Result<()> {
        if required && value.trim().is_empty() {
            return Err(AppError::msg(format!("{field} must not be empty")));
        }
        if value.len() > max {
            return Err(AppError::msg(format!(
                "{field} is {} bytes, limit is {max}",
                value.len()
            )));
        }
        Ok(())
    }

    fn parse_account(field: &str, value: &str) -> app::Result<AccountId> {
        let bytes =
            hex::decode(value).map_err(|_| AppError::msg(format!("{field} must be 64 hex")))?;
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| AppError::msg(format!("{field} must be 32 bytes")))?;
        Ok(AccountId::from(arr))
    }

    // ── settings and admins ──────────────────────────────────────────────────

    pub fn org(&self) -> app::Result<OrgView> {
        let s = self.settings.get();
        Ok(OrgView {
            name: s.name.clone(),
            icon: s.icon.clone(),
            admins: self.admins()?,
            member_count: self.members.len()? as u32,
            group_count: self.groups.len()? as u32,
            app_count: self.apps.len()? as u32,
        })
    }

    pub fn admins(&self) -> app::Result<Vec<String>> {
        let mut out: Vec<String> = self.roles.admins().iter().map(|a| a.to_string()).collect();
        out.sort();
        Ok(out)
    }

    pub fn set_settings(&mut self, name: String, icon: String) -> app::Result<()> {
        self.require_admin()?;
        Self::check_len("name", &name, MAX_NAME, false)?;
        Self::check_len("icon", &icon, 64, false)?;
        self.settings.set(OrgSettings { name, icon });
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    pub fn grant_admin(&mut self, account: String) -> app::Result<()> {
        self.require_admin()?;
        let who = Self::parse_account("account", &account)?;
        self.roles
            .grant_admin(who)
            .map_err(|e| AppError::msg(format!("grant_admin: {e}")))?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    pub fn revoke_admin(&mut self, account: String) -> app::Result<()> {
        self.require_admin()?;
        let who = Self::parse_account("account", &account)?;
        if self.roles.admins().len() <= 1 {
            return Err(AppError::msg("cannot remove the last admin"));
        }
        self.roles
            .revoke_admin(&who)
            .map_err(|e| AppError::msg(format!("revoke_admin: {e}")))?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    // ── members and profiles ─────────────────────────────────────────────────

    fn member_view(&self, m: &Member) -> app::Result<MemberView> {
        // Key-only reads on an AuthoredMap see the caller's own entry; name the owner.
        let owner = Self::parse_account("account", &m.account)?;
        let p = self.profiles.get_by(&owner, &m.account)?;
        Ok(MemberView {
            account: m.account.clone(),
            status: m.status.get().clone(),
            display_name: p
                .as_ref()
                .map(|p| p.display_name.get().clone())
                .unwrap_or_default(),
            handle: p.as_ref().map(|p| p.handle.clone()).unwrap_or_default(),
            avatar: p
                .as_ref()
                .map(|p| p.avatar.get().clone())
                .unwrap_or_default(),
            joined_at: m.joined_at,
            groups: self.groups_of(&m.account)?,
            apps: self.apps_of(&m.account)?,
        })
    }

    fn membership_key(group: &str, account: &str) -> String {
        format!("{group}:{account}")
    }

    fn groups_of(&self, account: &str) -> app::Result<Vec<String>> {
        let mut out: Vec<String> = self
            .memberships
            .entries()?
            .filter(|(_, m)| m.account == account)
            .map(|(_, m)| m.group.clone())
            .collect();
        out.sort();
        Ok(out)
    }

    fn access_key(group: &str, app: &str) -> String {
        format!("{group}:{app}")
    }
    fn enrolment_key(account: &str, app: &str) -> String {
        format!("{account}:{app}")
    }

    fn apps_of(&self, account: &str) -> app::Result<Vec<String>> {
        let groups = self.groups_of(account)?;
        let mut out: Vec<String> = self
            .access
            .entries()?
            .filter(|(_, a)| *a.enabled.get() && groups.contains(&a.group))
            .map(|(_, a)| a.app.clone())
            .collect();
        out.sort();
        out.dedup();
        Ok(out)
    }

    fn remove_access_rows_for_group(&mut self, group: &str) -> app::Result<()> {
        let keys: Vec<(String, String)> = self
            .access
            .entries()?
            .filter(|(_, a)| a.group == group)
            .map(|(k, a)| (k, a.app.clone()))
            .collect();
        for (k, app_id) in keys {
            self.access.remove(&k)?;
            self.record("access_removed", group, &app_id, "")?;
            app::emit!(Event::AccessChanged {
                group,
                app: &app_id
            });
        }
        Ok(())
    }

    fn app_view(&self, a: &App) -> app::Result<AppView> {
        let group_count = self
            .access
            .entries()?
            .filter(|(_, x)| x.app == a.id && *x.enabled.get())
            .count() as u32;
        Ok(AppView {
            id: a.id.clone(),
            package: a.package.clone(),
            label: a.label.get().clone(),
            admin_account: a.admin_account.clone(),
            status: a.status.get().clone(),
            registered_at: a.registered_at,
            group_count,
        })
    }

    pub fn register_app(
        &mut self,
        namespace_id: String,
        package: String,
        label: String,
        status: String,
    ) -> app::Result<AppView> {
        self.require_admin()?;
        Self::parse_account("namespace_id", &namespace_id)?; // 64 hex, same shape
        Self::check_len("package", &package, MAX_SHORT, true)?;
        Self::check_len("label", &label, MAX_NAME, true)?;
        if status != APP_READY && status != APP_PENDING_ADMIN {
            return Err(AppError::msg("status must be ready or pending_admin"));
        }
        if self.apps.contains(&namespace_id)? {
            return Err(AppError::msg("that namespace is already registered"));
        }
        let a = App {
            id: namespace_id.clone(),
            package,
            label: LwwRegister::new(label),
            admin_account: Self::caller(),
            status: LwwRegister::new(status),
            registered_at: Self::now(),
        };
        self.apps.insert(namespace_id.clone(), a.clone())?;
        self.record("app_registered", &namespace_id, "", "")?;
        self.app_view(&a)
    }

    pub fn set_app_status(&mut self, id: String, status: String) -> app::Result<()> {
        self.require_admin()?;
        if status != APP_READY && status != APP_PENDING_ADMIN {
            return Err(AppError::msg("status must be ready or pending_admin"));
        }
        let mut a = self
            .apps
            .get(&id)?
            .map(|v| v.clone())
            .ok_or_else(|| AppError::msg(format!("no app {id}")))?;
        a.status.set(status);
        self.apps.insert(id, a)?;
        Ok(())
    }

    pub fn remove_app(&mut self, id: String) -> app::Result<()> {
        self.require_admin()?;
        self.apps
            .remove(&id)?
            .ok_or_else(|| AppError::msg(format!("no app {id}")))?;
        let keys: Vec<(String, String)> = self
            .access
            .entries()?
            .filter(|(_, a)| a.app == id)
            .map(|(k, a)| (k, a.group.clone()))
            .collect();
        for (k, group) in keys {
            self.access.remove(&k)?;
            app::emit!(Event::AccessChanged {
                group: &group,
                app: &id
            });
        }
        let ekeys: Vec<String> = self
            .enrolments
            .entries()?
            .filter(|(_, e)| e.app == id)
            .map(|(k, _)| k)
            .collect();
        for k in ekeys {
            self.enrolments.remove(&k)?;
        }
        self.record("app_removed", &id, "", "")?;
        Ok(())
    }

    pub fn set_access(
        &mut self,
        group: String,
        app_id: String,
        capabilities: u32,
    ) -> app::Result<()> {
        self.require_admin()?;
        if !self.groups.contains(&group)? {
            return Err(AppError::msg(format!("no group {group}")));
        }
        if !self.apps.contains(&app_id)? {
            return Err(AppError::msg(format!("no app {app_id}")));
        }
        if capabilities >= 1 << 10 {
            return Err(AppError::msg("capabilities uses bits 0..=9 only"));
        }
        self.access.insert(
            Self::access_key(&group, &app_id),
            Access {
                group: group.clone(),
                app: app_id.clone(),
                capabilities: LwwRegister::new(capabilities),
                enabled: LwwRegister::new(true),
            },
        )?;
        self.record("access_set", &group, &app_id, &capabilities.to_string())?;
        app::emit!(Event::AccessChanged {
            group: &group,
            app: &app_id
        });
        Ok(())
    }

    pub fn remove_access(&mut self, group: String, app_id: String) -> app::Result<()> {
        self.require_admin()?;
        self.access
            .remove(&Self::access_key(&group, &app_id))?
            .ok_or_else(|| AppError::msg("no such access row"))?;
        self.record("access_removed", &group, &app_id, "")?;
        app::emit!(Event::AccessChanged {
            group: &group,
            app: &app_id
        });
        Ok(())
    }

    /// Written by the reconciler (an admin session) after each governance op.
    #[allow(clippy::too_many_arguments)]
    pub fn record_enrolment(
        &mut self,
        account: String,
        app_id: String,
        state: String,
        invitation: String,
        invitation_expires: u64,
        subgroups: Vec<String>,
        note: String,
    ) -> app::Result<()> {
        self.require_admin()?;
        if !ENROL_STATES.contains(&state.as_str()) {
            return Err(AppError::msg(format!("unknown enrolment state {state:?}")));
        }
        Self::check_len("invitation", &invitation, MAX_INVITATION, false)?;
        Self::check_len("note", &note, MAX_LONG, false)?;
        if !self.members.contains(&account)? {
            return Err(AppError::msg(format!("no member {account}")));
        }
        if !self.apps.contains(&app_id)? {
            return Err(AppError::msg(format!("no app {app_id}")));
        }
        let now = Self::now();
        self.enrolments.insert(
            Self::enrolment_key(&account, &app_id),
            Enrolment {
                account: account.clone(),
                app: app_id.clone(),
                state: LwwRegister::new(state.clone()),
                invitation: LwwRegister::new(invitation),
                invitation_expires: LwwRegister::new(invitation_expires),
                subgroups: LwwRegister::new(subgroups),
                note: LwwRegister::new(note),
                updated_at: LwwRegister::new(now),
            },
        )?;
        self.record("enrolment", &account, &app_id, &state)?;
        app::emit!(Event::EnrolmentChanged {
            account: &account,
            app: &app_id,
            state: &state
        });
        Ok(())
    }

    pub fn apps(&self) -> app::Result<Vec<AppView>> {
        let mut out = Vec::new();
        for (_, a) in self.apps.entries()? {
            out.push(self.app_view(&a)?);
        }
        out.sort_by(|a, b| a.label.cmp(&b.label));
        Ok(out)
    }

    fn access_view(a: &Access) -> AccessView {
        AccessView {
            group: a.group.clone(),
            app: a.app.clone(),
            capabilities: *a.capabilities.get(),
            enabled: *a.enabled.get(),
        }
    }

    pub fn access_rows(&self) -> app::Result<Vec<AccessView>> {
        let mut out: Vec<AccessView> = self
            .access
            .entries()?
            .map(|(_, a)| Self::access_view(&a))
            .collect();
        out.sort_by(|a, b| a.group.cmp(&b.group).then_with(|| a.app.cmp(&b.app)));
        Ok(out)
    }

    pub fn access_for(&self, group: String) -> app::Result<Vec<AccessView>> {
        Ok(self
            .access_rows()?
            .into_iter()
            .filter(|a| a.group == group)
            .collect())
    }

    fn enrolment_view(e: &Enrolment) -> EnrolmentView {
        EnrolmentView {
            account: e.account.clone(),
            app: e.app.clone(),
            state: e.state.get().clone(),
            invitation: e.invitation.get().clone(),
            invitation_expires: *e.invitation_expires.get(),
            subgroups: e.subgroups.get().clone(),
            note: e.note.get().clone(),
            updated_at: *e.updated_at.get(),
        }
    }

    pub fn enrolments(&self) -> app::Result<Vec<EnrolmentView>> {
        let mut out: Vec<EnrolmentView> = self
            .enrolments
            .entries()?
            .map(|(_, e)| Self::enrolment_view(&e))
            .collect();
        out.sort_by(|a, b| a.account.cmp(&b.account).then_with(|| a.app.cmp(&b.app)));
        Ok(out)
    }

    pub fn my_enrolments(&self) -> app::Result<Vec<EnrolmentView>> {
        let me = Self::caller();
        Ok(self
            .enrolments()?
            .into_iter()
            .filter(|e| e.account == me)
            .collect())
    }

    /// Every (member, app, group, capabilities) the graph implies, for members
    /// that are enrolled or active, through enabled access rows of ready apps.
    pub fn desired_placements(&self) -> app::Result<Vec<PlacementView>> {
        let ready: Vec<String> = self
            .apps
            .entries()?
            .filter(|(_, a)| a.status.get() == APP_READY)
            .map(|(k, _)| k.clone())
            .collect();
        let mut out = Vec::new();
        for (_, m) in self.members.entries()? {
            let st = m.status.get();
            if st != STATUS_ENROLLED && st != STATUS_ACTIVE {
                continue;
            }
            for g in self.groups_of(&m.account)? {
                for (_, a) in self
                    .access
                    .entries()?
                    .filter(|(_, a)| a.group == g && *a.enabled.get())
                {
                    if !ready.contains(&a.app) {
                        continue;
                    }
                    out.push(PlacementView {
                        account: m.account.clone(),
                        app: a.app.clone(),
                        group: g.clone(),
                        capabilities: *a.capabilities.get(),
                    });
                }
            }
        }
        out.sort_by(|a, b| {
            a.account
                .cmp(&b.account)
                .then_with(|| a.app.cmp(&b.app))
                .then_with(|| a.group.cmp(&b.group))
        });
        Ok(out)
    }

    /// The newcomer's first write. Reaching this method at all proves namespace
    /// membership, which is the only credential the org relies on.
    pub fn claim_membership(
        &mut self,
        display_name: String,
        handle: String,
    ) -> app::Result<MemberView> {
        Self::check_len("display_name", &display_name, MAX_NAME, true)?;
        Self::check_len("handle", &handle, MAX_NAME, true)?;
        let account = Self::caller();
        if self.members.contains(&account)? {
            return Err(AppError::msg("this account is already a member"));
        }
        let member = Member {
            account: account.clone(),
            status: LwwRegister::new(STATUS_ENROLLED.to_owned()),
            joined_at: Self::now(),
        };
        self.members.insert(account.clone(), member.clone())?;
        self.profiles.insert(
            account.clone(),
            Profile {
                display_name: LwwRegister::new(display_name),
                handle,
                avatar: LwwRegister::new(String::new()),
                updated_at: LwwRegister::new(Self::now()),
            },
        )?;
        self.record("enrolled", &account, "", "")?;
        app::emit!(Event::MemberChanged {
            account: &account,
            status: STATUS_ENROLLED
        });
        self.member_view(&member)
    }

    pub fn set_member_status(&mut self, account: String, status: String) -> app::Result<()> {
        self.require_admin()?;
        if !STATUSES.contains(&status.as_str()) {
            return Err(AppError::msg(format!("unknown status {status:?}")));
        }
        let mut m = self
            .members
            .get(&account)?
            .map(|v| v.clone())
            .ok_or_else(|| AppError::msg(format!("no member {account}")))?;
        m.status.set(status.clone());
        self.members.insert(account.clone(), m)?;
        self.record("status", &account, &status, "")?;
        app::emit!(Event::MemberChanged {
            account: &account,
            status: &status
        });
        Ok(())
    }

    pub fn update_profile(&mut self, display_name: String, avatar: String) -> app::Result<()> {
        let account = Self::caller();
        self.update_profile_of(account, display_name, avatar)
    }

    /// `update` on an AuthoredMap re-signs as the caller and storage refuses
    /// anyone but the owner; the explicit check gives a readable error first.
    pub fn update_profile_of(
        &mut self,
        account: String,
        display_name: String,
        avatar: String,
    ) -> app::Result<()> {
        if account != Self::caller() {
            return Err(AppError::msg("you can only edit your own profile"));
        }
        Self::check_len("display_name", &display_name, MAX_NAME, true)?;
        Self::check_len("avatar", &avatar, 64, false)?;
        let mut p = self
            .profiles
            .get(&account)?
            .ok_or_else(|| AppError::msg("no profile yet"))?;
        p.display_name.set(display_name);
        p.avatar.set(avatar);
        p.updated_at.set(Self::now());
        self.profiles
            .update(&account, p)
            .map_err(|e| AppError::msg(format!("profile update refused: {e}")))?;
        Ok(())
    }

    pub fn members(&self) -> app::Result<Vec<MemberView>> {
        let mut out = Vec::new();
        for (_, m) in self.members.entries()? {
            out.push(self.member_view(&m)?);
        }
        out.sort_by(|a, b| {
            a.display_name
                .cmp(&b.display_name)
                .then_with(|| a.account.cmp(&b.account))
        });
        Ok(out)
    }

    pub fn member(&self, account: String) -> app::Result<Option<MemberView>> {
        match self.members.get(&account)? {
            Some(m) => Ok(Some(self.member_view(&m)?)),
            None => Ok(None),
        }
    }

    // ── groups and memberships ───────────────────────────────────────────────

    fn group_view(&self, g: &Group) -> app::Result<GroupView> {
        let member_count = self
            .memberships
            .entries()?
            .filter(|(_, m)| m.group == g.id)
            .count() as u32;
        Ok(GroupView {
            id: g.id.clone(),
            name: g.name.get().clone(),
            parent: g.parent.get().clone(),
            admins: g.admins.get().clone(),
            member_count,
            created_at: g.created_at,
        })
    }

    /// Walks up from `parent`; errors if `child` is an ancestor (a cycle), the
    /// chain hits a missing group, or depth exceeds MAX_DEPTH.
    fn check_parent(&self, child: &str, parent: &str) -> app::Result<()> {
        let mut cur = parent.to_owned();
        let mut depth = 0;
        while !cur.is_empty() {
            if cur == child {
                return Err(AppError::msg("that move would make a cycle"));
            }
            let g = self
                .groups
                .get(&cur)?
                .ok_or_else(|| AppError::msg(format!("no group {cur}")))?;
            cur = g.parent.get().clone();
            depth += 1;
            if depth > MAX_DEPTH {
                return Err(AppError::msg("groups nest too deep"));
            }
        }
        Ok(())
    }

    fn group_of(&self, id: &str) -> app::Result<Group> {
        self.groups
            .get(id)?
            .map(|v| v.clone())
            .ok_or_else(|| AppError::msg(format!("no group {id}")))
    }

    pub fn create_group(&mut self, name: String, parent: String) -> app::Result<GroupView> {
        self.require_admin()?;
        Self::check_len("name", &name, MAX_NAME, true)?;
        let id = Self::fresh_id();
        self.check_parent(&id, &parent)?;
        let g = Group {
            id: id.clone(),
            name: LwwRegister::new(name),
            parent: LwwRegister::new(parent),
            admins: LwwRegister::new(Vec::new()),
            created_at: Self::now(),
        };
        self.groups.insert(id.clone(), g.clone())?;
        self.record("group_created", &id, "", "")?;
        app::emit!(Event::GroupChanged { group: &id });
        self.group_view(&g)
    }

    pub fn rename_group(&mut self, id: String, name: String) -> app::Result<()> {
        self.require_admin()?;
        Self::check_len("name", &name, MAX_NAME, true)?;
        let mut g = self.group_of(&id)?;
        g.name.set(name);
        self.groups.insert(id.clone(), g)?;
        self.record("group_renamed", &id, "", "")?;
        app::emit!(Event::GroupChanged { group: &id });
        Ok(())
    }

    pub fn move_group(&mut self, id: String, parent: String) -> app::Result<()> {
        self.require_admin()?;
        let mut g = self.group_of(&id)?;
        self.check_parent(&id, &parent)?;
        g.parent.set(parent);
        self.groups.insert(id.clone(), g)?;
        self.record("group_moved", &id, "", "")?;
        app::emit!(Event::GroupChanged { group: &id });
        Ok(())
    }

    pub fn set_group_admins(&mut self, id: String, admins: Vec<String>) -> app::Result<()> {
        self.require_admin()?;
        for a in &admins {
            if !self.members.contains(a)? {
                return Err(AppError::msg(format!("no member {a}")));
            }
        }
        let mut g = self.group_of(&id)?;
        g.admins.set(admins);
        self.groups.insert(id.clone(), g)?;
        app::emit!(Event::GroupChanged { group: &id });
        Ok(())
    }

    /// Removes the group, its memberships, its access rows (Task 4) and every child, depth first.
    pub fn delete_group(&mut self, id: String) -> app::Result<()> {
        self.require_admin()?;
        self.delete_group_tree(&id)
    }

    fn delete_group_tree(&mut self, id: &str) -> app::Result<()> {
        if !self.groups.contains(id)? {
            return Err(AppError::msg(format!("no group {id}")));
        }
        let children: Vec<String> = self
            .groups
            .entries()?
            .filter(|(_, g)| g.parent.get() == id)
            .map(|(k, _)| k)
            .collect();
        for c in children {
            self.delete_group_tree(&c)?;
        }
        let keys: Vec<(String, String)> = self
            .memberships
            .entries()?
            .filter(|(_, m)| m.group == id)
            .map(|(k, m)| (k, m.account.clone()))
            .collect();
        for (k, account) in keys {
            self.memberships.remove(&k)?;
            self.record("membership_removed", &account, id, "")?;
        }
        self.remove_access_rows_for_group(id)?;
        self.groups.remove(id)?;
        self.record("group_deleted", id, "", "")?;
        app::emit!(Event::GroupChanged { group: id });
        Ok(())
    }

    pub fn set_membership(
        &mut self,
        group: String,
        account: String,
        role: String,
    ) -> app::Result<()> {
        self.require_admin()?;
        if role != ROLE_LEAD && role != ROLE_MEMBER {
            return Err(AppError::msg("role must be lead or member"));
        }
        if !self.groups.contains(&group)? {
            return Err(AppError::msg(format!("no group {group}")));
        }
        if !self.members.contains(&account)? {
            return Err(AppError::msg(format!("no member {account}")));
        }
        let key = Self::membership_key(&group, &account);
        let since = self
            .memberships
            .get(&key)?
            .map(|m| m.since)
            .unwrap_or_else(Self::now);
        self.memberships.insert(
            key,
            Membership {
                group: group.clone(),
                account: account.clone(),
                role: LwwRegister::new(role.clone()),
                since,
            },
        )?;
        self.record("membership_set", &account, &group, &role)?;
        app::emit!(Event::GroupChanged { group: &group });
        Ok(())
    }

    pub fn remove_membership(&mut self, group: String, account: String) -> app::Result<()> {
        self.require_admin()?;
        let key = Self::membership_key(&group, &account);
        self.memberships
            .remove(&key)?
            .ok_or_else(|| AppError::msg("no such membership"))?;
        self.record("membership_removed", &account, &group, "")?;
        app::emit!(Event::GroupChanged { group: &group });
        Ok(())
    }

    pub fn groups(&self) -> app::Result<Vec<GroupView>> {
        let mut out = Vec::new();
        for (_, g) in self.groups.entries()? {
            out.push(self.group_view(&g)?);
        }
        out.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        Ok(out)
    }

    pub fn group_members(&self, group: String) -> app::Result<Vec<MemberView>> {
        let mut out = Vec::new();
        for (_, m) in self
            .memberships
            .entries()?
            .filter(|(_, m)| m.group == group)
        {
            if let Some(member) = self.members.get(&m.account)? {
                out.push(self.member_view(&member)?);
            }
        }
        out.sort_by(|a, b| {
            a.display_name
                .cmp(&b.display_name)
                .then_with(|| a.account.cmp(&b.account))
        });
        Ok(out)
    }

    fn row_hash(row: &ActivityRow) -> String {
        use sha2::{Digest, Sha256};
        let mut body: Vec<u8> = Vec::new();
        BorshSerialize::serialize(
            &(
                row.index,
                row.at,
                &row.actor,
                &row.verb,
                &row.subject,
                &row.object,
                &row.note,
                &row.prev_hash,
            ),
            &mut body,
        )
        .expect("borsh of plain fields");
        let mut h = Sha256::new();
        h.update(b"mero-org.activity.v1");
        h.update(body);
        hex::encode(h.finalize())
    }

    /// Appends one row. Concurrent appends from two admins both land (Vector
    /// merges as a union) and the chain is then verified per row's own
    /// `prev_hash`, which names the row the writer saw; `verify_activity`
    /// accepts a row whose `prev_hash` is any earlier row's hash.
    fn record(&mut self, verb: &str, subject: &str, object: &str, note: &str) -> app::Result<()> {
        let index = self.activity.len()? as u32;
        let prev_hash = self
            .activity
            .last()?
            .map(|r| r.hash.clone())
            .unwrap_or_default();
        let mut row = ActivityRow {
            index,
            at: Self::now(),
            actor: Self::caller(),
            verb: verb.to_owned(),
            subject: subject.to_owned(),
            object: object.to_owned(),
            note: note.to_owned(),
            prev_hash,
            hash: String::new(),
        };
        row.hash = Self::row_hash(&row);
        self.activity.push(row)?;
        app::emit!(Event::ActivityAppended { index });
        Ok(())
    }

    /// Newest first. `before` = 0 means from the end; otherwise rows with index < before.
    pub fn activity(&self, before: u32, limit: u32) -> app::Result<ActivityPage> {
        let total = self.activity.len()? as u32;
        let limit = if limit == 0 {
            DEFAULT_PAGE
        } else {
            limit.min(MAX_PAGE)
        };
        let end = if before == 0 {
            total
        } else {
            before.min(total)
        };
        let start = end.saturating_sub(limit);
        let mut rows = Vec::new();
        for i in (start..end).rev() {
            if let Some(r) = self.activity.get(i as usize)? {
                rows.push(r.clone());
            }
        }
        Ok(ActivityPage { rows, total })
    }

    pub fn verify_activity(&self) -> app::Result<bool> {
        let mut seen: Vec<String> = Vec::new();
        for row in self.activity.iter()? {
            if Self::row_hash(&row) != row.hash {
                return Ok(false);
            }
            if !row.prev_hash.is_empty() && !seen.contains(&row.prev_hash) {
                return Ok(false);
            }
            seen.push(row.hash.clone());
        }
        Ok(true)
    }
}
