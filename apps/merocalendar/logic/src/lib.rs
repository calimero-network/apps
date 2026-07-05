//! Mero Calendar — a collaborative, peer-to-peer calendar on Calimero.
//!
//! State is split in two:
//!
//! - **Shared events** (`#[app::state]`, synced across the context): calendar
//!   entries owned by one member and optionally shared with peers. Reads are
//!   gated so a member only ever sees events they own or are invited to.
//! - **Private events** (`#[app::private]`, node-local, never replicated): a
//!   member's personal entries that never leave their own node.
//!
//! Members carry a human-readable `username` (last-writer-wins on a dedicated
//! clock) so the UI can render names instead of raw public keys.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{Mergeable as MergeableTrait, UnorderedMap};
use thiserror::Error;
use types::id;
mod types;

id::define!(pub UserId<32, 44>);

#[app::event]
pub enum Event {
    CalendarEventCreated(String),
    CalendarEventEdited(String),
    CalendarEventDeleted(String),
    MemberJoined(String),
    MemberUsernameUpdated(String),
}

// ── Members ─────────────────────────────────────────────────────────────────

/// A context member with a human-readable display name. Keyed by the base58
/// public key (matches the identity the frontend reads from
/// `/contexts/{id}/identities-owned`), so the UI can resolve `owner`/`peers`
/// public keys to names.
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub username: String,
    pub joined_at: u64,
    /// Dedicated LWW clock for username edits. Merging on `joined_at` (which
    /// never changes after first join) would freeze a username at its first
    /// value across nodes; this is the real last-writer-wins timestamp.
    pub username_updated_at: u64,
}

// Flat record (no nested Calimero collections) → no-op re-key; required by
// rc.9's `Mergeable: RekeyTarget` supertrait bound.
impl RekeyTarget for Member {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // `id` and `joined_at` are immutable after first join; only the
        // mutable profile field is LWW, keyed on `username_updated_at`.
        if other.username_updated_at > self.username_updated_at {
            self.username = other.username.clone();
            self.username_updated_at = other.username_updated_at;
        }
        Ok(())
    }
}

// ── Shared event state (synced) ───────────────────────────────────────────────

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct CalendarEventState {
    title: String,
    description: String,
    owner: UserId,
    start: String,
    end: String,
    event_type: String,
    color: String,
    peers: Vec<UserId>,
    created_at: u64,
    updated_at: u64,
}

// Flat record (no nested Calimero collections) → no-op re-key; required by
// rc.9's `Mergeable: RekeyTarget` supertrait bound.
impl RekeyTarget for CalendarEventState {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

impl MergeableTrait for CalendarEventState {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Whole-record last-writer-wins on the edit clock.
        if other.updated_at > self.updated_at {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Private event state (node-local, never replicated) ────────────────────────

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct PrivateEventState {
    title: String,
    description: String,
    start: String,
    end: String,
    event_type: String,
    color: String,
    created_at: u64,
    updated_at: u64,
}

// ── State ─────────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct CalendarState {
    /// Key is the event id; the value is the shared event.
    events: UnorderedMap<String, CalendarEventState>,
    /// Context members keyed by base58 public key → display name.
    members: UnorderedMap<String, Member>,
}

/// Node-local private state — NOT synchronised across the network. A member's
/// private calendar entries live only on their own node.
#[derive(BorshSerialize, BorshDeserialize, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[app::private]
pub struct PrivateCalendar {
    events: UnorderedMap<String, PrivateEventState>,
}

impl Default for PrivateCalendar {
    fn default() -> Self {
        Self {
            events: UnorderedMap::new(),
        }
    }
}

// ── Request / response types ──────────────────────────────────────────────────

/// A calendar event as returned to the frontend. `private` distinguishes
/// node-local entries from shared ones so the UI can render them uniformly.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub description: String,
    pub owner: UserId,
    pub start: String,
    pub end: String,
    pub event_type: String,
    pub color: String,
    pub peers: Vec<UserId>,
    pub private: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CreateCalendarEvent {
    pub title: String,
    pub description: String,
    pub start: String,
    pub end: String,
    pub event_type: String,
    pub color: String,
    #[serde(default)]
    pub peers: Vec<UserId>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct UpdateCalendarEvent {
    pub title: Option<String>,
    pub description: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub event_type: Option<String>,
    pub color: Option<String>,
    pub peers: Option<Vec<UserId>>,
}

#[derive(Debug, Error, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(tag = "kind", content = "data")]
pub enum Error {
    #[error("key not found: {0}")]
    NotFound(String),
    #[error("operation forbidden")]
    Forbidden,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl CalendarState {
    #[app::init]
    pub fn init() -> CalendarState {
        CalendarState {
            events: UnorderedMap::new(),
            members: UnorderedMap::new(),
        }
    }

    // ── Identity helpers ──────────────────────────────────────────────────────

    /// The real signer of this invocation. Never trust a client-supplied id.
    fn caller() -> UserId {
        UserId::new(env::executor_id())
    }

    /// Base58 string form of the caller — matches the identity the frontend
    /// reads from `/contexts/{id}/identities-owned`.
    fn caller_id() -> String {
        Self::caller().to_string()
    }

    // ── Members ─────────────────────────────────────────────────────────────

    /// Register or refresh the caller's display name. Idempotent: first call
    /// joins, later calls rename. The id is the real signer, so a member can
    /// only ever name themselves.
    pub fn set_username(&mut self, username: String, timestamp: u64) -> app::Result<()> {
        let username = username.trim().to_string();
        if username.is_empty() {
            app::bail!("username cannot be empty");
        }
        if username.len() > 50 {
            app::bail!("username cannot be longer than 50 characters");
        }

        let member_id = Self::caller_id();
        if self.members.contains(&member_id)? {
            if let Some(mut existing) = self.members.get_mut(&member_id)? {
                existing.username = username;
                existing.username_updated_at = timestamp;
            }
            app::emit!(Event::MemberUsernameUpdated(member_id));
        } else {
            let member = Member {
                id: member_id.clone(),
                username,
                joined_at: timestamp,
                username_updated_at: timestamp,
            };
            self.members.insert(member_id.clone(), member)?;
            app::emit!(Event::MemberJoined(member_id));
        }
        Ok(())
    }

    pub fn get_members(&self) -> app::Result<Vec<Member>> {
        let mut members = Vec::new();
        for (_, member) in self.members.entries()? {
            members.push(member);
        }
        Ok(members)
    }

    // ── Shared events ─────────────────────────────────────────────────────────

    pub fn get_events(&self) -> app::Result<Vec<CalendarEvent>> {
        let executor_id = Self::caller();

        let mut events = Vec::new();
        for (id, event) in self.events.entries()? {
            // Only surface events the caller owns or is invited to.
            if event.owner != executor_id && !event.peers.contains(&executor_id) {
                continue;
            }
            events.push(CalendarEvent {
                id,
                title: event.title,
                description: event.description,
                owner: event.owner,
                start: event.start,
                end: event.end,
                event_type: event.event_type,
                color: event.color,
                peers: event.peers,
                private: false,
            });
        }

        Ok(events)
    }

    pub fn create_event(
        &mut self,
        event_data: CreateCalendarEvent,
        timestamp: u64,
    ) -> app::Result<String> {
        app::log!("Creating calendar event {:?}", event_data);

        let id = self.generate_id();
        let executor_id = Self::caller();

        let event = CalendarEventState {
            title: event_data.title,
            description: event_data.description,
            owner: executor_id,
            start: event_data.start,
            end: event_data.end,
            event_type: event_data.event_type,
            color: event_data.color,
            peers: event_data.peers,
            created_at: timestamp,
            updated_at: timestamp,
        };

        self.events.insert(id.clone(), event)?;
        app::emit!(Event::CalendarEventCreated(id.clone()));

        Ok(id)
    }

    pub fn update_event(
        &mut self,
        event_id: String,
        event_data: UpdateCalendarEvent,
        timestamp: u64,
    ) -> app::Result<String> {
        app::log!("Updating calendar event {} with {:?}", event_id, event_data);

        let Some(mut event) = self.events.get_mut(&event_id)? else {
            app::bail!(Error::NotFound(event_id));
        };

        if event.owner != Self::caller() {
            app::bail!(Error::Forbidden);
        }

        if let Some(data) = event_data.title {
            event.title = data;
        }
        if let Some(data) = event_data.description {
            event.description = data;
        }
        if let Some(data) = event_data.start {
            event.start = data;
        }
        if let Some(data) = event_data.end {
            event.end = data;
        }
        if let Some(data) = event_data.event_type {
            event.event_type = data;
        }
        if let Some(data) = event_data.color {
            event.color = data;
        }
        if let Some(data) = event_data.peers {
            event.peers = data;
        }
        event.updated_at = timestamp;
        drop(event);

        app::emit!(Event::CalendarEventEdited(event_id.clone()));

        Ok(event_id)
    }

    pub fn delete_event(&mut self, event_id: String) -> app::Result<String> {
        app::log!("Deleting calendar event {}", event_id);

        let Some(event) = self.events.get(&event_id)? else {
            app::bail!(Error::NotFound(event_id));
        };

        let owner = event.owner;
        drop(event);
        if owner != Self::caller() {
            app::bail!(Error::Forbidden);
        }

        if self.events.remove(&event_id)?.is_none() {
            app::bail!(Error::NotFound(event_id));
        }

        app::emit!(Event::CalendarEventDeleted(event_id.clone()));

        Ok(event_id)
    }

    // ── Private events (node-local) ─────────────────────────────────────────────

    /// Private events live in `#[app::private]` storage, so they are never
    /// replicated to peers. `peers` on the request is ignored — a private event
    /// is, by definition, not shared.
    ///
    /// Takes `&mut self` so the runtime commits and flushes the private write;
    /// a `&self` method's private writes would be silently discarded.
    pub fn create_private_event(
        &mut self,
        event_data: CreateCalendarEvent,
        timestamp: u64,
    ) -> app::Result<String> {
        let id = self.generate_id();

        let event = PrivateEventState {
            title: event_data.title,
            description: event_data.description,
            start: event_data.start,
            end: event_data.end,
            event_type: event_data.event_type,
            color: event_data.color,
            created_at: timestamp,
            updated_at: timestamp,
        };

        let mut private = PrivateCalendar::private_load_or_default()?;
        private.as_mut().events.insert(id.clone(), event)?;

        Ok(id)
    }

    pub fn get_private_events(&self) -> app::Result<Vec<CalendarEvent>> {
        let owner = Self::caller();
        let private = PrivateCalendar::private_load_or_default()?;

        let mut events = Vec::new();
        for (id, event) in private.events.entries()? {
            events.push(CalendarEvent {
                id,
                title: event.title,
                description: event.description,
                owner,
                start: event.start,
                end: event.end,
                event_type: event.event_type,
                color: event.color,
                peers: Vec::new(),
                private: true,
            });
        }

        Ok(events)
    }

    pub fn update_private_event(
        &mut self,
        event_id: String,
        event_data: UpdateCalendarEvent,
        timestamp: u64,
    ) -> app::Result<String> {
        let mut private = PrivateCalendar::private_load_or_default()?;
        let mut private_mut = private.as_mut();

        let Some(mut event) = private_mut.events.get_mut(&event_id)? else {
            app::bail!(Error::NotFound(event_id));
        };

        if let Some(data) = event_data.title {
            event.title = data;
        }
        if let Some(data) = event_data.description {
            event.description = data;
        }
        if let Some(data) = event_data.start {
            event.start = data;
        }
        if let Some(data) = event_data.end {
            event.end = data;
        }
        if let Some(data) = event_data.event_type {
            event.event_type = data;
        }
        if let Some(data) = event_data.color {
            event.color = data;
        }
        event.updated_at = timestamp;
        drop(event);

        Ok(event_id)
    }

    pub fn delete_private_event(&mut self, event_id: String) -> app::Result<String> {
        let mut private = PrivateCalendar::private_load_or_default()?;
        if private.as_mut().events.remove(&event_id)?.is_none() {
            app::bail!(Error::NotFound(event_id));
        }
        Ok(event_id)
    }

    // ── Internal ────────────────────────────────────────────────────────────────

    fn generate_id(&self) -> String {
        let mut buffer = [0u8; 16];
        env::random_bytes(&mut buffer);
        STANDARD.encode(buffer)
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    const OTHER: [u8; 32] = [0x22; 32];
    const THIRD: [u8; 32] = [0x33; 32];

    fn new_app() -> TestHost<CalendarState> {
        TestHost::new(CalendarState::init)
    }

    fn event(peers: Vec<UserId>) -> CreateCalendarEvent {
        CreateCalendarEvent {
            title: "Standup".to_owned(),
            description: "Daily sync".to_owned(),
            start: "2026-07-01T09:00:00".to_owned(),
            end: "2026-07-01T09:30:00".to_owned(),
            event_type: "event".to_owned(),
            color: "rgb(51, 182, 121)".to_owned(),
            peers,
        }
    }

    // ── Members / usernames (the "missing names" fix) ─────────────────────────

    #[test]
    fn set_username_registers_member_and_is_idempotent() {
        let mut app = new_app();
        app.call(|s| s.set_username("alice".to_owned(), 1)).unwrap();
        let members = app.view(|s| s.get_members()).unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].username, "alice");

        // Rename does not create a second member; it bumps the LWW clock.
        app.call(|s| s.set_username("alice2".to_owned(), 2)).unwrap();
        let members = app.view(|s| s.get_members()).unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].username, "alice2");
        assert_eq!(members[0].username_updated_at, 2);
    }

    #[test]
    fn set_username_rejects_empty() {
        let mut app = new_app();
        assert!(app.call(|s| s.set_username("   ".to_owned(), 1)).is_err());
    }

    #[test]
    fn members_are_keyed_per_identity() {
        let mut app = new_app();
        app.call(|s| s.set_username("alice".to_owned(), 1)).unwrap();
        app.call_as(OTHER, |s| s.set_username("bob".to_owned(), 1))
            .unwrap();
        assert_eq!(app.view(|s| s.get_members()).unwrap().len(), 2);
    }

    // ── Shared events ─────────────────────────────────────────────────────────

    #[test]
    fn owner_can_create_and_see_event() {
        let mut app = new_app();
        let me = UserId::new(app.executor_id());
        let id = app.call(|s| s.create_event(event(vec![]), 10)).unwrap();
        let events = app.view(|s| s.get_events()).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, id);
        assert_eq!(events[0].owner, me);
        assert!(!events[0].private);
    }

    #[test]
    fn peers_round_trip_without_collapsing() {
        // Regression: the old frontend joined peers with ',' but split on ', ',
        // collapsing every peer into one on edit. The contract stores a real
        // list, so a 2-peer event must come back with 2 peers.
        let mut app = new_app();
        let peers = vec![UserId::new(OTHER), UserId::new(THIRD)];
        app.call(|s| s.create_event(event(peers.clone()), 10))
            .unwrap();
        let events = app.view(|s| s.get_events()).unwrap();
        assert_eq!(events[0].peers.len(), 2);
        assert_eq!(events[0].peers, peers);
    }

    #[test]
    fn invited_peer_sees_event_but_stranger_does_not() {
        let mut app = new_app();
        app.call(|s| s.create_event(event(vec![UserId::new(OTHER)]), 10))
            .unwrap();
        // The invited peer sees it.
        assert_eq!(app.call_as(OTHER, |s| s.get_events()).unwrap().len(), 1);
        // An uninvited identity sees nothing.
        assert_eq!(app.call_as(THIRD, |s| s.get_events()).unwrap().len(), 0);
    }

    #[test]
    fn only_owner_can_update_or_delete() {
        let mut app = new_app();
        let id = app.call(|s| s.create_event(event(vec![UserId::new(OTHER)]), 10)).unwrap();

        let patch = UpdateCalendarEvent {
            title: Some("Renamed".to_owned()),
            description: None,
            start: None,
            end: None,
            event_type: None,
            color: None,
            peers: None,
        };

        // A peer (non-owner) cannot edit or delete.
        assert!(app
            .call_as(OTHER, |s| s.update_event(id.clone(), patch.clone(), 11))
            .is_err());
        assert!(app.call_as(OTHER, |s| s.delete_event(id.clone())).is_err());

        // The owner can.
        app.call(|s| s.update_event(id.clone(), patch, 11)).unwrap();
        let events = app.view(|s| s.get_events()).unwrap();
        assert_eq!(events[0].title, "Renamed");

        app.call(|s| s.delete_event(id.clone())).unwrap();
        assert_eq!(app.view(|s| s.get_events()).unwrap().len(), 0);
    }

    // ── Private events (node-local) ─────────────────────────────────────────────

    #[test]
    fn private_events_are_separate_from_shared() {
        let mut app = new_app();
        app.call(|s| s.create_event(event(vec![]), 10)).unwrap();
        let pid = app
            .call(|s| s.create_private_event(event(vec![]), 11))
            .unwrap();

        // Shared reads never surface private events.
        assert_eq!(app.view(|s| s.get_events()).unwrap().len(), 1);

        // Private reads return only the private event, flagged as such.
        let priv_events = app.view(|s| s.get_private_events()).unwrap();
        assert_eq!(priv_events.len(), 1);
        assert_eq!(priv_events[0].id, pid);
        assert!(priv_events[0].private);
        assert!(priv_events[0].peers.is_empty());
    }

    #[test]
    fn private_events_can_be_updated_and_deleted() {
        let mut app = new_app();
        let pid = app
            .call(|s| s.create_private_event(event(vec![]), 11))
            .unwrap();
        let patch = UpdateCalendarEvent {
            title: Some("Therapy".to_owned()),
            description: None,
            start: None,
            end: None,
            event_type: None,
            color: None,
            peers: None,
        };
        app.call(|s| s.update_private_event(pid.clone(), patch, 12))
            .unwrap();
        assert_eq!(
            app.view(|s| s.get_private_events()).unwrap()[0].title,
            "Therapy"
        );

        app.call(|s| s.delete_private_event(pid.clone())).unwrap();
        assert_eq!(app.view(|s| s.get_private_events()).unwrap().len(), 0);
    }
}
