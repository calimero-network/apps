//! A task's links: the things in your other apps it works on, as chips on its
//! post ("Issue: Agent digest card", "Board: Feed redesign", "#launch").
//!
//! A link is a subject ([`crate::subject_key`]: `<app>:<context>[:<id>]`) on a
//! chain. Your agent's writes add them by themselves: an action that names a
//! subject, or a step of its turn that touches one ([`crate::Hyperfeed::touch_subject`]),
//! links it to the task. You add one by hand, or take one off. What teammates
//! do in a linked thing reaches the task through the lenses you approved: a
//! notification about the same subject joins the task's chain, and the chip
//! counts it and groups it under the link.
//!
//! No shared task space: a link is stored with the task, and your teammates
//! keep working in their apps.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::Mergeable;

use crate::{
    headline, lww, now_ms, reply_subject, Event, FeedItem, Hyperfeed, FROM_YOU, MAX_KEY, MAX_TITLE,
    STATUS_WAITING,
};

/// Links kept on one task; the agent's past that are not added.
pub const MAX_LINKS: usize = 30;
/// A task started from a chat, as the chat's link to it: `hyperfeed:task:<chain>`.
pub const TASK_SUBJECT: &str = "hyperfeed:task:";
/// The chat a task was started from, as the task's link back: `hyperfeed:from:<chain>`.
pub const FROM_SUBJECT: &str = "hyperfeed:from:";
/// Who added a link: your agent (by touching it) or you.
pub const LINK_BY: &[&str] = &["agent", "you"];

/// One link of a task, kept by `<chain>|<subject>`. Taking it off keeps the
/// row with `removed: true`, so your agent touching the thing again does not
/// bring it back; only you adding it does.
#[app::mergeable(id = "hyperfeed::Link")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Link {
    pub chain: String,
    pub subject: String,
    pub label: String,
    pub by: String,
    pub added_at: u64,
    pub removed: bool,
    pub updated_at: u64,
}

impl Mergeable for Link {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// What [`crate::Hyperfeed::add_link`] takes.
#[derive(AbiType, Debug, Clone, Default, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LinkInput {
    /// `<app>:<context>[:<id>]`, as [`crate::subject_key`] makes it.
    pub subject: String,
    /// What the chip says ("Agent digest card"); `""` keeps the one it has,
    /// and a client names an unlabelled one from what it knows.
    pub label: String,
    /// `agent` or `you`.
    pub by: String,
}

/// A link as [`crate::Hyperfeed::links`] returns it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LinkView {
    pub chain: String,
    pub subject: String,
    /// The subject's parts: the app's key, its context, and the one thing in
    /// it (`""` for the whole context: a chat, a board).
    pub app: String,
    pub context: String,
    pub item: String,
    pub label: String,
    pub by: String,
    pub added_at: u64,
    /// Notifications in the task about it: what teammates did there.
    pub activity: u32,
    /// The latest of them (ms); 0 with none.
    pub last_at: u64,
}

/// A subject's parts: app, context, item. Refused unless it has an app and a context.
pub fn split_subject(subject: &str) -> app::Result<(String, String, String)> {
    Hyperfeed::check_len("subject", subject, MAX_KEY, true)?;
    let mut parts = subject.splitn(3, ':');
    let app = parts.next().unwrap_or("");
    let context = parts.next().unwrap_or("");
    let item = parts.next().unwrap_or("");
    Hyperfeed::check_app(app)?;
    if context.is_empty() || context.contains(char::is_whitespace) {
        return Err(AppError::msg(
            "subject must be <app>:<context>[:<id>], with a context",
        ));
    }
    Ok((app.to_owned(), context.to_owned(), item.to_owned()))
}

fn link_key(chain: &str, subject: &str) -> String {
    format!("{chain}|{subject}")
}

impl Hyperfeed {
    /// Whether you took `subject` off `chain`: your agent touching it again
    /// neither brings the link back nor pulls its notifications in.
    pub(crate) fn link_removed(&self, chain: &str, subject: &str) -> app::Result<bool> {
        Ok(self
            .links
            .get(&link_key(chain, subject))?
            .is_some_and(|l| l.removed))
    }

    /// Link `subject` to `chain`. A link you took off stays off unless `by` is
    /// you. A task already at [`MAX_LINKS`] takes no more: an error when
    /// `strict` (you asked), skipped otherwise (your agent touched it).
    pub(crate) fn link_subject(
        &mut self,
        chain: &str,
        subject: &str,
        label: &str,
        by: &str,
        strict: bool,
    ) -> app::Result<()> {
        let key = link_key(chain, subject);
        let now = now_ms();
        let link = match self.links.get(&key)?.map(|l| l.clone()) {
            Some(l) if l.removed && by != "you" => return Ok(()),
            Some(l) if !l.removed && (label.is_empty() || label == l.label) => return Ok(()),
            Some(mut l) => {
                if !label.is_empty() {
                    l.label = label.to_owned();
                }
                if l.removed {
                    l.removed = false;
                    l.by = by.to_owned();
                    l.added_at = now;
                }
                l.updated_at = now.max(l.updated_at + 1);
                l
            }
            None => {
                let on = self
                    .links
                    .entries()?
                    .filter(|(_, l)| l.chain == chain && !l.removed)
                    .count();
                if on >= MAX_LINKS {
                    return if strict {
                        Err(AppError::msg(format!(
                            "a task has at most {MAX_LINKS} links; take one off first"
                        )))
                    } else {
                        Ok(())
                    };
                }
                Link {
                    chain: chain.to_owned(),
                    subject: subject.to_owned(),
                    label: label.to_owned(),
                    by: by.to_owned(),
                    added_at: now,
                    removed: false,
                    updated_at: now,
                }
            }
        };
        self.links.insert(key, link)?;
        app::emit!(Event::LinksChanged { chain });
        Ok(())
    }

    pub(crate) fn link_add(&mut self, chain: String, input: LinkInput) -> app::Result<LinkView> {
        self.require_owner()?;
        Self::check_len("chain", &chain, MAX_KEY, true)?;
        if !self.chain_exists(&chain)? {
            return Err(AppError::msg(format!("no chain {chain}")));
        }
        let subject = input.subject.trim().to_owned();
        split_subject(&subject)?;
        Self::check_one_of("by", &input.by, LINK_BY)?;
        let label = input.label.trim().replace(['\n', '\r'], " ");
        Self::check_len("label", &label, MAX_TITLE, false)?;
        if input.by != "you" && self.link_removed(&chain, &subject)? {
            return Err(AppError::msg(
                "you took this link off the task; only you can add it back",
            ));
        }
        self.link_subject(&chain, &subject, &label, &input.by, true)?;
        // What teammates do there joins the task from now on.
        self.subject_chains.insert(
            subject.clone(),
            crate::Subject {
                subject: subject.clone(),
                chain: chain.clone(),
                at: now_ms(),
            },
        )?;
        self.link_list(&chain)?
            .into_iter()
            .find(|l| l.subject == subject)
            .ok_or_else(|| AppError::msg("the link was not kept"))
    }

    /// Start a task from the chat in `from`: your message `text` opens a
    /// chain of its own, and each links to the other, so the chat keeps a
    /// pointer to the task and the task knows where it came from.
    pub(crate) fn task_start(
        &mut self,
        from: String,
        text: String,
        title: Option<String>,
    ) -> app::Result<FeedItem> {
        self.require_owner()?;
        Self::check_len("from", &from, MAX_KEY, true)?;
        if !self.chain_exists(&from)? {
            return Err(AppError::msg(format!("no chain {from}")));
        }
        let title = Self::check_message(&text, title, true)?;
        // The chat takes one more link, or nothing is written.
        let on = self
            .links
            .entries()?
            .filter(|(_, l)| l.chain == from && !l.removed)
            .count();
        if on >= MAX_LINKS {
            return Err(AppError::msg(format!(
                "a chat has at most {MAX_LINKS} links; take one off first"
            )));
        }
        let chat = self.chain_goal(&from)?;
        let goal = title.clone().unwrap_or_else(|| headline(&text));
        let item = self.post_message(
            String::new(),
            FROM_YOU,
            text,
            String::new(),
            STATUS_WAITING,
            None,
            Vec::new(),
            title,
        )?;
        let task = item.chain.clone();
        self.link_subject(&from, &format!("{TASK_SUBJECT}{task}"), &goal, "you", true)?;
        self.link_subject(&task, &format!("{FROM_SUBJECT}{from}"), &chat, "you", true)?;
        Ok(item)
    }

    /// What a chain is about, as one line: the headline or first line of its
    /// first message; `""` for a chain that starts with something else.
    fn chain_goal(&self, chain: &str) -> app::Result<String> {
        let first = self
            .messages
            .entries()?
            .filter(|(_, m)| m.chain == chain)
            .min_by(|(_, a), (_, b)| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)))
            .map(|(_, m)| m.clone());
        let Some(m) = first else {
            return Ok(String::new());
        };
        Ok(match self.headlines.get(&m.id)? {
            Some(h) => h.text.clone(),
            None => headline(&m.text),
        })
    }

    pub(crate) fn link_remove(&mut self, chain: String, subject: String) -> app::Result<()> {
        self.require_owner()?;
        let key = link_key(&chain, &subject);
        let Some(mut link) = self.links.get(&key)?.map(|l| l.clone()) else {
            return Err(AppError::msg(format!("{subject} is not linked to {chain}")));
        };
        if link.removed {
            return Ok(());
        }
        link.removed = true;
        link.updated_at = now_ms().max(link.updated_at + 1);
        self.links.insert(key, link)?;
        // Nothing new about it joins the task; what already did stays.
        if self
            .subject_chains
            .get(&subject)?
            .is_some_and(|s| s.chain == chain)
        {
            self.subject_chains.remove(&subject)?;
        }
        app::emit!(Event::LinksChanged { chain: &chain });
        Ok(())
    }

    pub(crate) fn link_list(&self, chain: &str) -> app::Result<Vec<LinkView>> {
        // What teammates did there: the chain's notifications whose reply goes to it.
        let mut seen: Vec<(String, u64)> = Vec::new();
        for (_, n) in self.notifications.entries()? {
            if n.chain != chain {
                continue;
            }
            if let Some(t) = self.typed.get(&n.id)? {
                let s = reply_subject(&n.app, &n.source_context, &t.reply_call);
                if !s.is_empty() {
                    seen.push((s, n.created_at));
                }
            }
        }
        let mut out: Vec<LinkView> = Vec::new();
        for (_, l) in self.links.entries()? {
            if l.chain != chain || l.removed {
                continue;
            }
            let (app, context, item) = split_subject(&l.subject).unwrap_or_default();
            let mine = seen.iter().filter(|(s, _)| *s == l.subject);
            let (activity, last_at) =
                mine.fold((0u32, 0u64), |(n, at), (_, t)| (n + 1, at.max(*t)));
            out.push(LinkView {
                chain: l.chain.clone(),
                subject: l.subject.clone(),
                app,
                context,
                item,
                label: l.label.clone(),
                by: l.by.clone(),
                added_at: l.added_at,
                activity,
                last_at,
            });
        }
        out.sort_by(|a, b| (a.added_at, &a.subject).cmp(&(b.added_at, &b.subject)));
        Ok(out)
    }
}
