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
use calimero_sdk::abi::AbiType;
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

// 64, not 44: the second parameter is the length of the STRING form, and
// core 0.11.0-rc.27 made every id hex (core#3691). 44 was the base58 upper
// bound for 32 bytes; hex is exactly 2 per byte. `Id::SIZE_GUARD` fails the
// build if these disagree, so this cannot drift silently.
id::define!(pub UserId<32, 64>);

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
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType)]
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

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType)]
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
#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
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

#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
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

#[derive(Clone, Debug, Serialize, Deserialize, AbiType)]
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
    ///
    /// The ACCOUNT, not the device. Everything this id is used for is
    /// ownership — `event.owner`, the `peers` list, the username map, every
    /// "is the caller allowed to edit this" check — and ownership belongs to a
    /// person. Keyed by device, the same human who created an event on a
    /// laptop cannot edit it from a phone, and appears twice in `peers`.
    ///
    /// This reverses the rc.20-era note that used to sit here. That note was
    /// right at the time: rc.20 split account from device and left the legacy
    /// `executor_id()` shim meaning the device. rc.23 flips the shim to the
    /// ACCOUNT (core #3510) precisely because reaching for an identity is
    /// almost always an ownership question, and it also makes the node's own
    /// group-members listing answer with accounts (#3522) — so a device id
    /// here would no longer match the member list it is compared against.
    ///
    /// The old note's other argument — that changing this orphans stored
    /// events — does not apply: this app has never published to the registry,
    /// so there is no deployed calendar whose rows would be stranded.
    fn caller() -> UserId {
        UserId::new(env::account_id())
    }

    /// String form of the caller's ACCOUNT — the member id this calendar
    /// stores and puts on the wire.
    ///
    /// Deliberately NOT the context key the frontend reads from
    /// `/contexts/{id}/identities-owned`: that is a device key, and since
    /// rc.23 the node's group-members listing is keyed by account, so this is
    /// the id a member row can actually be matched against.
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
        let caller = Self::caller();

        let mut events = Vec::new();
        for (id, event) in self.events.entries()? {
            // Only surface events the caller owns or is invited to.
            if event.owner != caller && !event.peers.contains(&caller) {
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

    /// Create an event, routing it to private or shared storage BY WHETHER
    /// ANYONE ELSE IS IN IT.
    ///
    /// An event with no peers is one person's own entry. Writing it to
    /// `#[app::state]` would replicate it to every node in the context and put
    /// it in the DAG permanently — for data that, by definition, nobody else is
    /// party to. So it goes to `#[app::private]` instead: node-local, never
    /// gossiped, no DAG growth.
    ///
    /// Peers are what make an event shared. The moment there is someone to share
    /// it WITH, replication is the point, and it goes to the DAG.
    ///
    /// ⚠️ This is enforced HERE and not in the client, deliberately. The
    /// frontend already had a `private` flag it could route on, but a client
    /// choosing whether data enters the permanent replicated log is a client
    /// deciding someone else's privacy. The contract is the only place that
    /// cannot be bypassed.
    ///
    /// `create_private_event` remains for "private even though peers were
    /// named" — an explicit override rather than the default path.
    pub fn create_event(
        &mut self,
        event_data: CreateCalendarEvent,
        timestamp: u64,
    ) -> app::Result<String> {
        if event_data.peers.is_empty() {
            app::log!("No peers — keeping this event in private storage");
            return self.create_private_event(event_data, timestamp);
        }

        app::log!("Creating calendar event {:?}", event_data);

        let id = self.generate_id();
        let caller = Self::caller();

        let event = CalendarEventState {
            title: event_data.title,
            description: event_data.description,
            owner: caller,
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

    /// Update a shared event.
    ///
    /// ⚠️ Emptying `peers` does NOT move the event back to private storage.
    /// Once shared, the event is in the DAG on every node in the context, and the
    /// DAG is append-only — nothing here can retract it. Moving the local copy
    /// into private storage would leave that replicated history in place while
    /// making the UI report the event as private, which is worse than saying
    /// plainly that sharing is one-way.
    ///
    /// Removing peers still does the useful part: `get_events` gates reads on
    /// owner-or-peer, so a removed peer stops SEEING it. It just cannot unsee
    /// what already synced.
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

    /// Move a private event into shared storage, applying `event_data` as it
    /// goes. Called only from `update_private_event`, when an update names peers.
    fn promote_private_event(
        &mut self,
        event_id: String,
        event_data: UpdateCalendarEvent,
        peers: Vec<UserId>,
        timestamp: u64,
    ) -> app::Result<String> {
        let caller = Self::caller();

        // Read the private event out, then REMOVE it, so the same event does not
        // exist in both stores. A copy left behind would show up twice in the
        // merged calendar the frontend builds from get_events + get_private_events.
        let mut private = PrivateCalendar::private_load_or_default()?;
        let existing = {
            let mut private_mut = private.as_mut();
            let Some(found) = private_mut.events.get(&event_id)? else {
                app::bail!(Error::NotFound(event_id));
            };
            let snapshot = found.clone();
            drop(found);
            private_mut.events.remove(&event_id)?;
            snapshot
        };

        let shared = CalendarEventState {
            title: event_data.title.unwrap_or(existing.title),
            description: event_data.description.unwrap_or(existing.description),
            owner: caller,
            start: event_data.start.unwrap_or(existing.start),
            end: event_data.end.unwrap_or(existing.end),
            event_type: event_data.event_type.unwrap_or(existing.event_type),
            color: event_data.color.unwrap_or(existing.color),
            peers,
            created_at: existing.created_at,
            updated_at: timestamp,
        };

        // Keeping the SAME id across the move: the frontend holds it, and a new
        // id would read as "the private one vanished and an unrelated shared one
        // appeared".
        self.events.insert(event_id.clone(), shared)?;
        app::log!("Promoted private event {} to shared storage", event_id);
        app::emit!(Event::CalendarEventCreated(event_id.clone()));

        Ok(event_id)
    }

    /// Update a private event — and PROMOTE it to shared storage if this update
    /// is what adds the first peer.
    ///
    /// This is the other half of `create_event`'s routing. Without it, an event
    /// created alone and later shared with someone would stay node-local, so the
    /// peer would never receive it and the share would silently do nothing.
    ///
    /// Promotion is one-way, and that is not an omission. Removing every peer
    /// from a shared event does NOT move it back: by then the event is already in
    /// the DAG on every node in the context, and the DAG is append-only. Moving
    /// the local copy into private storage would leave the replicated history
    /// untouched while making the UI claim the event had become private — which
    /// is a worse outcome than being honest that sharing cannot be undone. See
    /// `update_event`.
    pub fn update_private_event(
        &mut self,
        event_id: String,
        event_data: UpdateCalendarEvent,
        timestamp: u64,
    ) -> app::Result<String> {
        // Peers named in this update? Then this event stops being private, and
        // the move has to happen before the field-by-field edit below — the
        // shared and private states are different types.
        if let Some(peers) = event_data.peers.clone().filter(|p| !p.is_empty()) {
            return self.promote_private_event(event_id, event_data, peers, timestamp);
        }

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

    // A second and third PERSON. Both axes move together: `call_as` alone
    // shifts only the device and leaves the account, which models one person's
    // second machine — and since `caller()` reads the account, a test using it
    // for "somebody else" silently asserts nothing. The SDK's own note makes
    // the point: an app that aggregates per person and one that aggregates per
    // replica behave identically until the two axes actually disagree.
    const OTHER: [u8; 32] = [0x22; 32];
    const OTHER_DEVICE: [u8; 32] = [0xA2; 32];
    const THIRD: [u8; 32] = [0x33; 32];
    const THIRD_DEVICE: [u8; 32] = [0xA3; 32];

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
        app.call(|s| s.set_username("alice2".to_owned(), 2))
            .unwrap();
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
        app.call_as_account(OTHER, OTHER_DEVICE, |s| s.set_username("bob".to_owned(), 1))
            .unwrap();
        assert_eq!(app.view(|s| s.get_members()).unwrap().len(), 2);
    }

    // ── Shared events ─────────────────────────────────────────────────────────

    #[test]
    fn owner_can_create_and_see_event() {
        // Now created WITH a peer. `create_event` routes on the peer list, so an
        // empty one no longer lands in shared storage at all — this test was
        // asserting `get_events().len() == 1` for a peerless event, which is
        // exactly the behaviour that changed. The peerless case has its own test
        // (`event_with_no_peers_never_reaches_the_dag`).
        let mut app = new_app();
        let me = UserId::new(app.account_id());
        let id = app
            .call(|s| s.create_event(event(vec![UserId::new(OTHER)]), 10))
            .unwrap();
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
        assert_eq!(
            app.call_as_account(OTHER, OTHER_DEVICE, |s| s.get_events())
                .unwrap()
                .len(),
            1
        );
        // An uninvited identity sees nothing.
        assert_eq!(
            app.call_as_account(THIRD, THIRD_DEVICE, |s| s.get_events())
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn only_owner_can_update_or_delete() {
        let mut app = new_app();
        let id = app
            .call(|s| s.create_event(event(vec![UserId::new(OTHER)]), 10))
            .unwrap();

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
            .call_as_account(OTHER, OTHER_DEVICE, |s| s.update_event(
                id.clone(),
                patch.clone(),
                11
            ))
            .is_err());
        assert!(app
            .call_as_account(OTHER, OTHER_DEVICE, |s| s.delete_event(id.clone()))
            .is_err());

        // The owner can.
        app.call(|s| s.update_event(id.clone(), patch, 11)).unwrap();
        let events = app.view(|s| s.get_events()).unwrap();
        assert_eq!(events[0].title, "Renamed");

        app.call(|s| s.delete_event(id.clone())).unwrap();
        assert_eq!(app.view(|s| s.get_events()).unwrap().len(), 0);
    }

    // ── Private events (node-local) ─────────────────────────────────────────────

    #[test]
    fn event_with_no_peers_never_reaches_the_dag() {
        // The requirement: an event nobody else is in stays node-local. Asserted
        // through BOTH accessors, because "not in the shared map" and "in the
        // private one" are different claims and only the pair rules out a copy
        // sitting in each.
        let mut app = new_app();
        let id = app.call(|s| s.create_event(event(vec![]), 1)).unwrap();

        let shared = app.view(|s| s.get_events()).unwrap();
        assert!(
            shared.iter().all(|e| e.id != id),
            "an event with no peers must not enter shared (DAG) storage"
        );

        let private = app.view(|s| s.get_private_events()).unwrap();
        assert_eq!(private.len(), 1, "it must be in private storage instead");
        assert_eq!(private[0].id, id);
        assert!(private[0].private, "and must report itself as private");
    }

    #[test]
    fn event_with_peers_goes_to_shared_storage() {
        // The counterpart, so the test above is not passing merely because
        // create_event is broken for everything.
        let mut app = new_app();
        let peer = UserId::from([9u8; 32]);
        let id = app.call(|s| s.create_event(event(vec![peer]), 1)).unwrap();

        let shared = app.view(|s| s.get_events()).unwrap();
        assert!(
            shared.iter().any(|e| e.id == id),
            "an event with a peer belongs in shared storage"
        );
        assert!(
            app.view(|s| s.get_private_events()).unwrap().is_empty(),
            "and must not also sit in private storage"
        );
    }

    #[test]
    fn adding_a_peer_promotes_a_private_event_keeping_its_id() {
        // Without promotion, sharing an event created alone would silently do
        // nothing: it would stay node-local and the peer would never see it.
        let mut app = new_app();
        let id = app.call(|s| s.create_event(event(vec![]), 1)).unwrap();
        assert_eq!(app.view(|s| s.get_private_events()).unwrap().len(), 1);

        let peer = UserId::from([7u8; 32]);
        let returned = app
            .call(|s| {
                s.update_private_event(
                    id.clone(),
                    UpdateCalendarEvent {
                        title: None,
                        description: None,
                        start: None,
                        end: None,
                        event_type: None,
                        color: None,
                        peers: Some(vec![peer]),
                    },
                    2,
                )
            })
            .unwrap();

        // The id survives the move — the frontend holds it, and a fresh id would
        // read as "the private one vanished and an unrelated shared one appeared".
        assert_eq!(returned, id);
        assert!(
            app.view(|s| s.get_private_events()).unwrap().is_empty(),
            "the private copy must be REMOVED, or the merged calendar shows it twice"
        );
        let shared = app.view(|s| s.get_events()).unwrap();
        assert_eq!(shared.len(), 1);
        assert_eq!(shared[0].id, id);
        assert_eq!(shared[0].peers.len(), 1);
    }

    #[test]
    fn an_update_with_an_empty_peer_list_stays_private() {
        // `Some(vec![])` is "peers, but none" — it must NOT promote. Only a
        // non-empty list means there is someone to share with.
        let mut app = new_app();
        let id = app.call(|s| s.create_event(event(vec![]), 1)).unwrap();
        app.call(|s| {
            s.update_private_event(
                id.clone(),
                UpdateCalendarEvent {
                    title: Some("still mine".into()),
                    description: None,
                    start: None,
                    end: None,
                    event_type: None,
                    color: None,
                    peers: Some(vec![]),
                },
                2,
            )
        })
        .unwrap();

        let private = app.view(|s| s.get_private_events()).unwrap();
        assert_eq!(private.len(), 1);
        assert_eq!(private[0].title, "still mine");
        assert!(app.view(|s| s.get_events()).unwrap().is_empty());
    }

    #[test]
    fn removing_every_peer_does_not_demote_a_shared_event() {
        // Pins the one-way constraint so nobody "fixes" it into a demotion that
        // cannot actually retract the replicated history. Removing peers still
        // hides the event from them via get_events' owner-or-peer gate; it just
        // does not unshare what already synced.
        let mut app = new_app();
        let peer = UserId::from([5u8; 32]);
        let id = app.call(|s| s.create_event(event(vec![peer]), 1)).unwrap();

        app.call(|s| {
            s.update_event(
                id.clone(),
                UpdateCalendarEvent {
                    title: None,
                    description: None,
                    start: None,
                    end: None,
                    event_type: None,
                    color: None,
                    peers: Some(vec![]),
                },
                2,
            )
        })
        .unwrap();

        let shared = app.view(|s| s.get_events()).unwrap();
        assert_eq!(shared.len(), 1, "it stays in shared storage");
        assert!(shared[0].peers.is_empty(), "with its peer list emptied");
        assert!(
            app.view(|s| s.get_private_events()).unwrap().is_empty(),
            "and is NOT copied into private storage"
        );
    }

    #[test]
    fn private_events_are_separate_from_shared() {
        let mut app = new_app();
        // The shared one needs a PEER now: `create_event` routes a peerless event
        // into private storage, so `event(vec![])` here would have produced two
        // private events and nothing shared.
        app.call(|s| s.create_event(event(vec![UserId::new(OTHER)]), 10))
            .unwrap();
        // `create_private_event` still ignores peers — it is the explicit
        // "private regardless" path — so an empty list is right here.
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
