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

// Placeholders filled by Tasks 2–5; they exist so the state compiles now.
#[app::mergeable(id = "mero_org::Member")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Member {
    pub account: String,
}
impl Mergeable for Member {
    fn merge(&mut self, _: &Self) -> Result<(), MergeError> {
        Ok(())
    }
}

#[app::mergeable(id = "mero_org::Profile")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Profile {
    pub display_name: String,
}
impl Mergeable for Profile {
    fn merge(&mut self, _: &Self) -> Result<(), MergeError> {
        Ok(())
    }
}

#[app::mergeable(id = "mero_org::Group")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Group {
    pub id: String,
}
impl Mergeable for Group {
    fn merge(&mut self, _: &Self) -> Result<(), MergeError> {
        Ok(())
    }
}

#[app::mergeable(id = "mero_org::Membership")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Membership {
    pub group: String,
}
impl Mergeable for Membership {
    fn merge(&mut self, _: &Self) -> Result<(), MergeError> {
        Ok(())
    }
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

    #[allow(dead_code)] // used by Tasks 2-5
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

    #[allow(dead_code)] // used by Tasks 2-5
    fn fresh_id() -> String {
        let mut buffer = [0u8; 16];
        env::random_bytes(&mut buffer);
        hex::encode(buffer)
    }

    #[allow(dead_code)] // used by Tasks 2-5
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
}
