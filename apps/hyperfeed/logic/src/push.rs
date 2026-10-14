//! Push to your phone: the devices Hyperfeed may wake when something starts
//! needing you, and the key your agent's runtime signs those pushes with.
//!
//! Your phone subscribes with its browser's push service and keeps the
//! subscription here ([`crate::Hyperfeed::add_push_device`]). Your agent's
//! runtime, which already watches the feed, sends each new thing that needs
//! you to every device, encrypted to it (RFC 8291) and signed with its VAPID
//! key (RFC 8292). The private half of that key never leaves the runtime; only
//! the public half is kept here, for the phone to subscribe with.
//!
//! A subscription is bound to the key it was made with: a new key drops every
//! device, and each phone subscribes again.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::Mergeable;

use crate::{lww, now_ms, Event, Hyperfeed, MAX_KEY};

/// Devices kept at once; the one written longest ago is dropped to make room.
pub const MAX_PUSH_DEVICES: usize = 10;
/// A push service's endpoint URL. Real ones are a few hundred bytes.
pub const MAX_PUSH_ENDPOINT: usize = 1024;
/// A base64url key: P-256 public keys are 87 characters, auth secrets 22.
pub const MAX_PUSH_KEY: usize = 128;
const KEY_ID: &str = "vapid";

/// One device, kept by its endpoint. Taking it off keeps the row with
/// `removed: true`, so a device that synced late does not bring it back.
#[app::mergeable(id = "hyperfeed::PushDevice")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PushDevice {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub name: String,
    /// Say only "Something needs you": no title, no text leaves your node.
    pub quiet: bool,
    /// The VAPID public key it subscribed with.
    pub key: String,
    pub added_at: u64,
    pub removed: bool,
    pub updated_at: u64,
}

impl Mergeable for PushDevice {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// The runtime's VAPID public key.
#[app::mergeable(id = "hyperfeed::PushKey")]
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PushKey {
    pub public_key: String,
    /// The runtime that holds its private half, by name.
    pub by: String,
    pub updated_at: u64,
}

impl Mergeable for PushKey {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        let at = self.updated_at;
        lww(self, at, other, other.updated_at);
        Ok(())
    }
}

/// What [`crate::Hyperfeed::add_push_device`] takes: the browser's
/// `PushSubscription.toJSON()`, a name, and how much it may say.
#[derive(AbiType, Debug, Clone, Default, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PushDeviceInput {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    /// "Sandi's iPhone"; `""` is named "A device".
    pub name: String,
    pub quiet: bool,
    /// The key it subscribed with: refused unless it is the current one.
    pub key: String,
}

/// A device as [`crate::Hyperfeed::push_devices`] returns it.
#[derive(AbiType, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PushDeviceView {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub name: String,
    pub quiet: bool,
    pub added_at: u64,
}

/// The key as [`crate::Hyperfeed::push_key`] returns it; empty before a runtime set one.
#[derive(AbiType, Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PushKeyView {
    pub public_key: String,
    pub by: String,
    pub updated_at: u64,
}

fn base64url(field: &str, value: &str) -> app::Result<()> {
    Hyperfeed::check_len(field, value, MAX_PUSH_KEY, true)?;
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '=')
    {
        Ok(())
    } else {
        Err(AppError::msg(format!("{field} must be base64url")))
    }
}

impl Hyperfeed {
    pub(crate) fn push_key_set(
        &mut self,
        public_key: String,
        by: String,
    ) -> app::Result<PushKeyView> {
        self.require_agent_as(&by)?;
        base64url("public_key", &public_key)?;
        Self::check_len("by", &by, MAX_KEY, true)?;
        let now = now_ms();
        let old = self.push_keys.get(KEY_ID)?.map(|k| k.clone());
        if old
            .as_ref()
            .is_some_and(|k| k.public_key == public_key && k.by == by)
        {
            return self.push_key_get();
        }
        let updated_at = old.as_ref().map_or(now, |k| now.max(k.updated_at + 1));
        // A subscription only works with the key it was made with.
        if old.is_some_and(|k| k.public_key != public_key) {
            let stale: Vec<PushDevice> = self
                .push_devices
                .entries()?
                .filter(|(_, d)| !d.removed)
                .map(|(_, d)| d.clone())
                .collect();
            for mut d in stale {
                d.removed = true;
                d.updated_at = now.max(d.updated_at + 1);
                self.push_devices.insert(d.endpoint.clone(), d)?;
            }
        }
        self.push_keys.insert(
            KEY_ID.to_owned(),
            PushKey {
                public_key,
                by,
                updated_at,
            },
        )?;
        app::emit!(Event::PushChanged);
        self.push_key_get()
    }

    pub(crate) fn push_key_get(&self) -> app::Result<PushKeyView> {
        Ok(self
            .push_keys
            .get(KEY_ID)?
            .map(|k| PushKeyView {
                public_key: k.public_key.clone(),
                by: k.by.clone(),
                updated_at: k.updated_at,
            })
            .unwrap_or_default())
    }

    pub(crate) fn push_device_add(
        &mut self,
        input: PushDeviceInput,
    ) -> app::Result<PushDeviceView> {
        self.require_owner()?;
        let endpoint = input.endpoint.trim().to_owned();
        Self::check_len("endpoint", &endpoint, MAX_PUSH_ENDPOINT, true)?;
        if !endpoint.starts_with("https://") || endpoint.contains(char::is_whitespace) {
            return Err(AppError::msg("endpoint must be an https:// URL"));
        }
        base64url("p256dh", &input.p256dh)?;
        base64url("auth", &input.auth)?;
        let name = input.name.trim().replace(['\n', '\r'], " ");
        Self::check_len("name", &name, MAX_KEY, false)?;
        let current = self.push_key_get()?.public_key;
        if current.is_empty() {
            return Err(AppError::msg(
                "no push key yet: start your agent's runtime against this feed first",
            ));
        }
        if input.key != current {
            return Err(AppError::msg(
                "subscribed with an old push key; subscribe again with the current one",
            ));
        }
        let now = now_ms();
        let old = self.push_devices.get(&endpoint)?.map(|d| d.clone());
        if old.is_none() {
            let mut on: Vec<(u64, String)> = self
                .push_devices
                .entries()?
                .filter(|(_, d)| !d.removed)
                .map(|(_, d)| (d.updated_at, d.endpoint.clone()))
                .collect();
            if on.len() >= MAX_PUSH_DEVICES {
                on.sort();
                if let Some((_, oldest)) = on.first() {
                    self.push_device_drop(oldest, now)?;
                }
            }
        }
        let device = PushDevice {
            endpoint: endpoint.clone(),
            p256dh: input.p256dh,
            auth: input.auth,
            name: if name.is_empty() {
                "A device".to_owned()
            } else {
                name
            },
            quiet: input.quiet,
            key: current,
            added_at: old
                .as_ref()
                .filter(|d| !d.removed)
                .map_or(now, |d| d.added_at),
            removed: false,
            updated_at: old.as_ref().map_or(now, |d| now.max(d.updated_at + 1)),
        };
        let view = view_of(&device);
        self.push_devices.insert(endpoint, device)?;
        app::emit!(Event::PushChanged);
        Ok(view)
    }

    pub(crate) fn push_device_remove(&mut self, endpoint: String) -> app::Result<()> {
        self.require_owner()?;
        if self.push_device_drop(&endpoint, now_ms())? {
            app::emit!(Event::PushChanged);
        }
        Ok(())
    }

    fn push_device_drop(&mut self, endpoint: &str, now: u64) -> app::Result<bool> {
        let Some(mut d) = self.push_devices.get(endpoint)?.map(|d| d.clone()) else {
            return Ok(false);
        };
        if d.removed {
            return Ok(false);
        }
        d.removed = true;
        d.updated_at = now.max(d.updated_at + 1);
        self.push_devices.insert(endpoint.to_owned(), d)?;
        Ok(true)
    }

    /// The devices subscribed with the current key, newest first.
    pub(crate) fn push_device_list(&self) -> app::Result<Vec<PushDeviceView>> {
        let current = self.push_key_get()?.public_key;
        let mut out: Vec<PushDeviceView> = self
            .push_devices
            .entries()?
            .filter(|(_, d)| !d.removed && d.key == current)
            .map(|(_, d)| view_of(&d))
            .collect();
        out.sort_by(|a, b| (b.added_at, &b.endpoint).cmp(&(a.added_at, &a.endpoint)));
        Ok(out)
    }
}

fn view_of(d: &PushDevice) -> PushDeviceView {
    PushDeviceView {
        endpoint: d.endpoint.clone(),
        p256dh: d.p256dh.clone(),
        auth: d.auth.clone(),
        name: d.name.clone(),
        quiet: d.quiet,
        added_at: d.added_at,
    }
}
