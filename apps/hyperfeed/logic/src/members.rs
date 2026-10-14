//! Agents with accounts of their own, and drafts you send yourself.
//!
//! A feed used to have one writer: you, on every device, with your agent
//! writing as you. An agent can now be a member of its own instead, a cloud
//! agent with an account nobody else holds, invited into the contexts you share
//! with it. Its writes there carry its name, its role caps what it can do, and
//! removing it is removing a member.
//!
//! To work your feed, such an agent must be **added** here by you, under the
//! name it reports in with ([`Hyperfeed::add_agent_account`]). Being invited
//! into the feed's context is not enough: the contract has no view of the
//! context's members, and the feed's writes are yours or an agent's you named.
//!
//! An added agent may make the agent's side of the feed: record what it did,
//! take up and answer your messages, report progress, suggest rules and lenses,
//! claim chains, keep watches, report what it can reach. Everything that
//! decides for you stays yours: approving, answering, rules, modes, guards,
//! access, assignments, push devices, and who is an agent. And it speaks only
//! as itself: wherever a method names an agent, an added agent may name only
//! the name you added it under.
//!
//! ## Drafts you send
//!
//! An agent that may do a whole thing on its own (draft a document, fill a
//! sheet) does it as itself. Some things should come from you: a message, a
//! reply in a thread. For those it records a proposal with a `send_call`, the
//! call that sends it in its app, and your client makes that call as you when
//! you approve it, then reports the outcome. The agent never carries one out,
//! so a draft needs only that the agent may read the app: an app you set to
//! Read only still takes drafts.
//!
//! What holds against a node that does not run this code is what held before
//! (see the crate docs): these checks bind honest nodes. A cloud agent is
//! attested code, which is why it is trusted with the agent's side at all.

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::{app, serde_json};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::Mergeable;

use crate::{lww, now_ms, Event, Hyperfeed, MAX_FIELDS, MAX_KEY};

/// At most this many agent accounts on one feed.
pub const MAX_AGENT_ACCOUNTS: usize = 16;

/// An agent's own account you added to the feed, by account.
#[app::mergeable(id = "hyperfeed::AgentAccount")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct AgentAccount {
    /// The name it reports in with, and the only one it may speak as.
    pub name: String,
    /// When you added it, or removed it; the later write wins.
    pub at: u64,
    /// Removed rows stay, so a removal is not undone by an older add merging in.
    pub removed: bool,
}

impl Mergeable for AgentAccount {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.at;
        lww(self, at, other, other.at);
        Ok(())
    }
}

/// An agent account, as settings shows it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AgentAccountView {
    pub account: String,
    pub name: String,
    pub added_at: u64,
}

/// The call that sends a draft in its app, kept beside the action it belongs to.
#[app::mergeable(id = "hyperfeed::SendCall")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct SendCall {
    /// `{"method": ..., "args": {...}}`, as a lens's `reply_call` is.
    pub call: String,
}

impl Mergeable for SendCall {
    fn merge(&mut self, _other: &Self) -> Result<(), MergeError> {
        // Written once, when the draft is recorded.
        Ok(())
    }
}

/// Who is calling, as far as the feed is concerned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Caller {
    /// You, on any of your devices.
    Owner,
    /// An agent account you added, and the name you added it under.
    Agent(String),
}

impl Hyperfeed {
    /// You, or an agent you added: who may make the agent's side of the feed.
    pub(crate) fn require_agent(&self) -> app::Result<Caller> {
        let caller = Self::caller();
        if *self.owner.get() == caller {
            return Ok(Caller::Owner);
        }
        match self.agent_accounts.get(&caller)? {
            Some(a) if !a.removed => Ok(Caller::Agent(a.name.clone())),
            _ => Err(AppError::msg(
                "only the feed's owner, or an agent they added, can write to it",
            )),
        }
    }

    /// As [`Self::require_agent`], where the call names the agent it is for:
    /// an added agent may name only itself.
    pub(crate) fn require_agent_as(&self, name: &str) -> app::Result<Caller> {
        let caller = self.require_agent()?;
        if let Caller::Agent(own) = &caller {
            if own != name {
                return Err(AppError::msg(format!(
                    "this agent was added as {own:?} and cannot speak as {name:?}"
                )));
            }
        }
        Ok(caller)
    }

    pub(crate) fn agent_account_add(&mut self, account: String, name: String) -> app::Result<()> {
        self.require_owner()?;
        let account = account.trim().to_owned();
        let name = name.trim().to_owned();
        Self::check_len("account", &account, MAX_KEY, true)?;
        Self::check_len("name", &name, MAX_KEY, true)?;
        if account == *self.owner.get() {
            return Err(AppError::msg(
                "that is your own account; your agent there writes as you already",
            ));
        }
        let live: Vec<(String, AgentAccount)> = self
            .agent_accounts
            .entries()?
            .filter(|(_, a)| !a.removed)
            .collect();
        if let Some((other, _)) = live
            .iter()
            .find(|(acc, a)| a.name == name && *acc != account)
        {
            return Err(AppError::msg(format!(
                "{name:?} is already the name of agent account {other}; remove it first"
            )));
        }
        if !live.iter().any(|(acc, _)| *acc == account) && live.len() >= MAX_AGENT_ACCOUNTS {
            return Err(AppError::msg(format!(
                "{MAX_AGENT_ACCOUNTS} agent accounts, limit is {MAX_AGENT_ACCOUNTS}"
            )));
        }
        let at = self.next_account_at(&account)?;
        self.agent_accounts.insert(
            account,
            AgentAccount {
                name,
                at,
                removed: false,
            },
        )?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    pub(crate) fn agent_account_remove(&mut self, account: String) -> app::Result<()> {
        self.require_owner()?;
        let account = account.trim().to_owned();
        let Some(old) = self.agent_accounts.get(&account)?.map(|a| a.clone()) else {
            return Err(AppError::msg(format!("no agent account {account}")));
        };
        if old.removed {
            return Ok(());
        }
        let at = self.next_account_at(&account)?;
        self.agent_accounts.insert(
            account,
            AgentAccount {
                at,
                removed: true,
                ..old
            },
        )?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    fn next_account_at(&self, account: &str) -> app::Result<u64> {
        Ok(match self.agent_accounts.get(account)? {
            Some(a) => now_ms().max(a.at + 1),
            None => now_ms(),
        })
    }

    /// The agent accounts you added, by name.
    pub(crate) fn agent_account_list(&self) -> app::Result<Vec<AgentAccountView>> {
        let mut out: Vec<AgentAccountView> = self
            .agent_accounts
            .entries()?
            .filter(|(_, a)| !a.removed)
            .map(|(account, a)| AgentAccountView {
                account,
                name: a.name,
                added_at: a.at,
            })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.account.cmp(&b.account)));
        Ok(out)
    }

    /// A draft's send call: a JSON object naming a `method` and its `args`.
    pub(crate) fn check_send_call(call: &str) -> app::Result<()> {
        Self::check_len("send_call", call, MAX_FIELDS, true)?;
        let value: serde_json::Value = serde_json::from_str(call)
            .map_err(|e| AppError::msg(format!("send_call is not JSON: {e}")))?;
        let method = value
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or_default();
        if method.trim().is_empty() {
            return Err(AppError::msg("send_call names no method"));
        }
        if !value.get("args").is_some_and(serde_json::Value::is_object) {
            return Err(AppError::msg("send_call's args must be an object"));
        }
        Ok(())
    }

    /// The send call of a draft, or `None` for an action the agent carries out.
    pub(crate) fn send_call_of(&self, id: &str) -> app::Result<Option<String>> {
        Ok(self.sends.get(id)?.map(|s| s.call.clone()))
    }
}
