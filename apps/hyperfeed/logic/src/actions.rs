//! What your agent can do in each app, in words you would use: "Edit
//! documents", "Send messages", "Delete your messages".
//!
//! An app's ABI lists methods. Your agent learns which methods belong together
//! and proposes them as an app's actions, the way it proposes a lens; nothing
//! uses them until you approve. Once you do, the actions decide what an agent
//! call is, whatever the agent says it is: a method's action fixes whether it
//! writes and, when it names one, which "always ask me before" guard covers
//! it; a method no action names asks you every time.
//!
//! You can then set each action on its own: let it act, have it ask, or turn
//! it off, apart from the app's mode. Your guards and the pause still win.
//!
//! Like lenses, actions are kept by `<app>@<application id>`, the app version
//! they were learned from. The newest approved set of an app is the one in
//! force, so learning a new version never leaves an app without rules while
//! the new set waits for you.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::Mergeable;

use crate::{
    lww, now_ms, Event, Hyperfeed, LENS_APPROVED, LENS_PROPOSED, LENS_REJECTED, MAX_KEY, MAX_SHORT,
    MAX_WHY,
};

/// How you set one action: `act` without asking, `ask` first, or `off`.
/// Empty follows the app's mode.
pub const ACTION_MODES: &[&str] = &["act", "ask", "off"];
/// Actions in one app's set, and methods in one action.
pub const MAX_ACTIONS: usize = 40;
pub const MAX_ACTION_METHODS: usize = 64;

/// One action, as your agent proposes it and settings shows it.
#[derive(
    AbiType, Debug, Clone, PartialEq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActionDef {
    /// Stable within the app, e.g. `edit`; your setting for it is kept by it.
    pub id: String,
    /// What it is, for you: "Edit documents".
    pub label: String,
    /// One line on what it covers: "Write, format and reorder text".
    pub description: String,
    /// The guard that always covers it, or empty when that depends on the
    /// call (sending to someone new): then the category the agent names stands.
    pub category: String,
    /// Whether it changes anything. An action that only reads always may run.
    pub writes: bool,
    /// The app's methods it covers, by name.
    pub methods: Vec<String>,
}

/// An app version's actions, as your agent learned them from its ABI.
#[app::mergeable(id = "hyperfeed::ActionSet")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActionSet {
    pub app: String,
    pub application_id: String,
    pub actions: Vec<ActionDef>,
    /// One line for you: what changed, or what the set covers.
    pub summary: String,
    /// [`LENS_PROPOSED`], [`LENS_APPROVED`] or [`LENS_REJECTED`].
    pub status: String,
    pub updated_at: u64,
}

impl Mergeable for ActionSet {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// Your setting for one action, kept by `<app>/<action id>`. It outlives the
/// set it was made under: a new version's action with the same id keeps it.
#[app::mergeable(id = "hyperfeed::ActionRule")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActionRule {
    /// One of [`ACTION_MODES`], or empty to follow the app again.
    pub mode: String,
    pub updated_at: u64,
}

impl Mergeable for ActionRule {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActionSetView {
    pub app: String,
    pub application_id: String,
    pub actions: Vec<ActionDef>,
    pub summary: String,
    pub status: String,
    pub updated_at: u64,
}

/// One action you set apart from its app's mode.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ActionModeView {
    pub app: String,
    pub action: String,
    pub mode: String,
}

/// What an agent call is, once the app's actions have had their say.
pub(crate) struct Resolved {
    /// The guard that covers it: the action's, or what the agent said.
    pub category: String,
    pub writes: bool,
    /// The action it belongs to, `None` when the app has no approved set or
    /// the agent named no method.
    pub action: Option<ActionDef>,
    /// Your mode for that action; empty follows the app.
    pub mode: String,
    /// The app has approved actions and none names this method.
    pub uncovered: bool,
}

fn set_key(app_key: &str, application_id: &str) -> String {
    format!("{app_key}@{application_id}")
}

fn rule_key(app_key: &str, action: &str) -> String {
    format!("{app_key}/{action}")
}

fn view(s: ActionSet) -> ActionSetView {
    ActionSetView {
        app: s.app,
        application_id: s.application_id,
        actions: s.actions,
        summary: s.summary,
        status: s.status,
        updated_at: s.updated_at,
    }
}

impl Hyperfeed {
    fn check_actions(actions: &[ActionDef]) -> app::Result<()> {
        if actions.is_empty() || actions.len() > MAX_ACTIONS {
            return Err(AppError::msg(format!(
                "an app has 1 to {MAX_ACTIONS} actions, got {}",
                actions.len()
            )));
        }
        let mut ids: Vec<&str> = Vec::new();
        let mut methods: Vec<&str> = Vec::new();
        for a in actions {
            Self::check_len("action id", &a.id, MAX_SHORT, true)?;
            Self::check_len("action label", &a.label, MAX_SHORT, true)?;
            Self::check_len("action description", &a.description, MAX_WHY, false)?;
            Self::check_category(&a.category)?;
            if ids.contains(&a.id.as_str()) {
                return Err(AppError::msg(format!("two actions are called {:?}", a.id)));
            }
            ids.push(&a.id);
            if a.methods.is_empty() || a.methods.len() > MAX_ACTION_METHODS {
                return Err(AppError::msg(format!(
                    "{:?} covers 1 to {MAX_ACTION_METHODS} methods, got {}",
                    a.id,
                    a.methods.len()
                )));
            }
            for m in &a.methods {
                Self::check_len("method", m, MAX_SHORT, true)?;
                if methods.contains(&m.as_str()) {
                    return Err(AppError::msg(format!(
                        "{m:?} is in two actions; a method belongs to one"
                    )));
                }
                methods.push(m);
            }
        }
        Ok(())
    }

    /// The set in force for `app`: its newest approved one.
    fn active_set(&self, app: &str) -> app::Result<Option<ActionSet>> {
        Ok(self
            .action_sets
            .entries()?
            .map(|(_, s)| s)
            .filter(|s| s.app == app && s.status == LENS_APPROVED)
            .max_by(|a, b| {
                a.updated_at
                    .cmp(&b.updated_at)
                    .then_with(|| a.application_id.cmp(&b.application_id))
            }))
    }

    /// Your mode for one action; empty when you set none.
    fn action_mode(&self, app: &str, action: &str) -> app::Result<String> {
        Ok(self
            .action_rules
            .get(&rule_key(app, action))?
            .map(|r| r.mode.clone())
            .unwrap_or_default())
    }

    /// What a call to `method` in `app` is. With no approved actions, or no
    /// method named (agents made before actions), it is what the agent said.
    pub(crate) fn resolve_call(
        &self,
        app: &str,
        method: &str,
        category: &str,
        writes: bool,
    ) -> app::Result<Resolved> {
        let said = Resolved {
            category: category.to_owned(),
            writes,
            action: None,
            mode: String::new(),
            uncovered: false,
        };
        if method.is_empty() {
            return Ok(said);
        }
        let Some(set) = self.active_set(app)? else {
            return Ok(said);
        };
        let Some(action) = set
            .actions
            .into_iter()
            .find(|a| a.methods.iter().any(|m| m == method))
        else {
            // Nobody described it, so nothing says it only reads.
            return Ok(Resolved {
                writes: true,
                uncovered: true,
                ..said
            });
        };
        // The action's guard, when it names one. One it leaves empty can't
        // know in advance (is this person new to you?), so the agent's stands.
        let category = if action.category.is_empty() {
            said.category
        } else {
            action.category.clone()
        };
        Ok(Resolved {
            category,
            writes: action.writes,
            mode: self.action_mode(app, &action.id)?,
            action: Some(action),
            uncovered: false,
        })
    }

    /// The action `method` belongs to in `app`'s set in force, by id.
    pub(crate) fn action_of(&self, app: &str, method: &str) -> app::Result<Option<String>> {
        Ok(self
            .resolve_call(app, method, "", true)?
            .action
            .map(|a| a.id))
    }

    pub(crate) fn actions_propose(
        &mut self,
        app_key: String,
        application_id: String,
        actions: Vec<ActionDef>,
        summary: String,
    ) -> app::Result<ActionSetView> {
        self.require_owner()?;
        Self::check_app(&app_key)?;
        Self::check_len("application_id", &application_id, MAX_KEY, true)?;
        Self::check_len("summary", &summary, MAX_WHY, true)?;
        Self::check_actions(&actions)?;
        let key = set_key(&app_key, &application_id);
        let prior = self.action_sets.get(&key)?.map(|s| s.clone());
        if let Some(s) = &prior {
            if s.actions == actions && s.summary == summary {
                return Ok(view(s.clone()));
            }
        }
        let set = ActionSet {
            app: app_key,
            application_id,
            actions,
            summary,
            status: LENS_PROPOSED.to_owned(),
            updated_at: prior.map_or(now_ms(), |s| now_ms().max(s.updated_at + 1)),
        };
        self.action_sets.insert(key, set.clone())?;
        app::emit!(Event::ActionsChanged {
            app: &set.app,
            status: &set.status,
        });
        Ok(view(set))
    }

    pub(crate) fn actions_decide(
        &mut self,
        app_key: String,
        application_id: String,
        decision: String,
    ) -> app::Result<ActionSetView> {
        self.require_owner()?;
        Self::check_one_of("decision", &decision, &["approve", "reject"])?;
        let key = set_key(&app_key, &application_id);
        let mut set = self
            .action_sets
            .get(&key)?
            .map(|s| s.clone())
            .ok_or_else(|| {
                AppError::msg(format!("no actions for {app_key} at {application_id}"))
            })?;
        set.status = if decision == "approve" {
            LENS_APPROVED
        } else {
            LENS_REJECTED
        }
        .to_owned();
        set.updated_at = now_ms().max(set.updated_at + 1);
        self.action_sets.insert(key, set.clone())?;
        app::emit!(Event::ActionsChanged {
            app: &set.app,
            status: &set.status,
        });
        Ok(view(set))
    }

    pub(crate) fn action_mode_set(
        &mut self,
        app_key: String,
        action: String,
        mode: String,
    ) -> app::Result<()> {
        self.require_owner()?;
        Self::check_app(&app_key)?;
        Self::check_len("action", &action, MAX_SHORT, true)?;
        if !mode.is_empty() {
            Self::check_one_of("mode", &mode, ACTION_MODES)?;
        }
        let key = rule_key(&app_key, &action);
        let updated_at = match self.action_rules.get(&key)? {
            Some(r) => now_ms().max(r.updated_at + 1),
            None => now_ms(),
        };
        self.action_rules
            .insert(key, ActionRule { mode, updated_at })?;
        app::emit!(Event::SettingsChanged);
        Ok(())
    }

    /// Every set, newest first.
    pub(crate) fn action_set_list(&self) -> app::Result<Vec<ActionSetView>> {
        let mut out: Vec<ActionSetView> =
            self.action_sets.entries()?.map(|(_, s)| view(s)).collect();
        out.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.app.cmp(&b.app))
        });
        Ok(out)
    }

    /// Every action you set apart from its app, by app then action.
    pub(crate) fn action_mode_list(&self) -> app::Result<Vec<ActionModeView>> {
        let mut out: Vec<ActionModeView> = self
            .action_rules
            .entries()?
            .filter(|(_, r)| !r.mode.is_empty())
            .filter_map(|(key, r)| {
                let (app, action) = key.split_once('/')?;
                Some(ActionModeView {
                    app: app.to_owned(),
                    action: action.to_owned(),
                    mode: r.mode,
                })
            })
            .collect();
        out.sort_by(|a, b| a.app.cmp(&b.app).then_with(|| a.action.cmp(&b.action)));
        Ok(out)
    }
}
