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

#[app::mergeable(id = "mero_org::App")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct App {
    pub id: String,
}
impl Mergeable for App {
    fn merge(&mut self, _: &Self) -> Result<(), MergeError> {
        Ok(())
    }
}

#[app::mergeable(id = "mero_org::Access")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Access {
    pub group: String,
}
impl Mergeable for Access {
    fn merge(&mut self, _: &Self) -> Result<(), MergeError> {
        Ok(())
    }
}

#[app::mergeable(id = "mero_org::Enrolment")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Enrolment {
    pub account: String,
}
impl Mergeable for Enrolment {
    fn merge(&mut self, _: &Self) -> Result<(), MergeError> {
        Ok(())
    }
}

#[app::mergeable(id = "mero_org::ActivityRow")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActivityRow {
    pub index: u32,
}
impl Mergeable for ActivityRow {
    fn merge(&mut self, _: &Self) -> Result<(), MergeError> {
        Ok(())
    }
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

    #[allow(dead_code)] // used by Tasks 2-5
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

    /// Filled in Task 4; returns an empty list until then.
    fn apps_of(&self, _account: &str) -> app::Result<Vec<String>> {
        Ok(Vec::new())
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

    /// Filled in Task 4; nothing to remove until access rows exist.
    fn remove_access_rows_for_group(&mut self, _group: &str) -> app::Result<()> {
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

    /// Activity is implemented in Task 5; until then a no-op so earlier tasks compile.
    fn record(
        &mut self,
        _verb: &str,
        _subject: &str,
        _object: &str,
        _note: &str,
    ) -> app::Result<()> {
        Ok(())
    }
}
