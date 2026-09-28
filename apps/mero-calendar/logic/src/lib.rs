//! Mero Calendar — a collaborative, peer-to-peer calendar on Calimero.
//!
//! State is split in two:
//!
//! - **Shared events** (`#[app::state]`, synced across the context): calendar
//!   entries owned by one member and optionally shared with peers. Only the
//!   owner can edit or delete one, and every node enforces that: `events` is an
//!   `Authored` map, so a patched node cannot rewrite someone else's event.
//! - **Private events** (`#[app::private]`, node-local, never replicated): a
//!   member's personal entries that never leave their own node.
//!
//! ⚠️ A shared event is NOT private to its owner and peers. `get_events` lists
//! only the events the caller owns or is invited to, but that is a view filter:
//! every shared event replicates to every member of the context, and any member
//! can read all of them from their own node's storage. What is confidential is
//! only what stays in `#[app::private]` storage.
//!
//! Members carry a human-readable `username` (last-writer-wins on a dedicated
//! clock) so the UI can render names instead of raw public keys. Each member's
//! entry is their own `UserStorage` slot, so nobody can rename anyone else.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::cmp::Ordering;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env};
use calimero_storage::collections::crdt_meta::MergeError;
use std::collections::BTreeMap;

use calimero_storage::collections::{
    Authored, IndexValue, IndexedMap, Mergeable as MergeableTrait, UnorderedMap, UserStorage,
};
use thiserror::Error;
use types::id;
mod types;

// 64, not 44: the second parameter is the length of the STRING form, and
// core 0.11.0-rc.27 made every id hex (core#3691). 44 was the base58 upper
// bound for 32 bytes; hex is exactly 2 per byte. `Id::SIZE_GUARD` fails the
// build if these disagree, so this cannot drift silently.
id::define!(pub UserId<32, 64>);

/// An id is its bytes in an index, so `owner` and `peers` can be seeked.
impl IndexValue for UserId {
    fn encode_index(&self, out: &mut Vec<Vec<u8>>) {
        let bytes: &[u8; 32] = (**self).as_ref();
        bytes.encode_index(out);
    }
}

#[app::event]
pub enum Event {
    CalendarEventCreated(String),
    CalendarEventEdited(String),
    CalendarEventDeleted(String),
    MemberJoined(String),
    MemberUsernameUpdated(String),
}

// ── Members ─────────────────────────────────────────────────────────────────

// ── LWW convergence helper ───────────────────────────────────────────────────

/// Take `other` iff it wins a **total order** of (clock, canonical borsh bytes).
///
/// A bare `other.ts > self.ts` is not commutative, and from core 0.11.0-rc.32
/// that is a live bug rather than a latent one. At an exact clock tie with
/// differing content each replica keeps its own copy: `merge` changes nothing
/// on either side, so re-merging never closes the gap and the two stay
/// divergent permanently, with no error. Breaking the tie on the borsh
/// encoding — a total order over values — makes both replicas elect the same
/// winner independently, which is what convergence requires.
///
/// Before [core#3807] a collection value's `merge` was never called (entries
/// resolved last-write-wins by write ORDER), so these rules were dead code and
/// the tie could not be observed. `#[app::mergeable]` turns them on.
///
/// [core#3807]: https://github.com/calimero-network/core/pull/3807
fn lww_take<T: BorshSerialize>(mine_ts: u64, theirs_ts: u64, mine: &T, theirs: &T) -> bool {
    match theirs_ts.cmp(&mine_ts) {
        Ordering::Greater => true,
        Ordering::Less => false,
        // Equal clocks: decide on the canonical encoding, so both replicas
        // elect the same side.
        //
        // Infallible on purpose. Core's contract for a dispatched merge
        // requires a TOTAL rule — "`Err` is not validation, it is a refusal to
        // converge: the entity stays divergent and repair retries it
        // indefinitely" — so this must not surface an encoding error. A value
        // that came back out of storage was borsh-encoded to get there, which
        // is why the fallback is unreachable rather than merely unlikely.
        Ordering::Equal => {
            let encode = |v: &T| calimero_sdk::borsh::to_vec(v).unwrap_or_default();
            encode(theirs) > encode(mine)
        }
    }
}

/// A context member with a human-readable display name, in the member's own
/// `UserStorage` slot (keyed by ACCOUNT), so the UI can resolve `owner`/`peers`
/// to names. `id` is filled from the slot's key on read, never trusted from
/// the stored value.
#[app::mergeable(id = "mero_calendar::Member")]
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

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // `id` and `joined_at` are immutable after first join; only the
        // mutable profile field is LWW, keyed on `username_updated_at`.
        // Tie-break over exactly the fields assigned below, so the rule is a
        // maximum over a total order — commutative and associative. A bare
        // `>` would leave two replicas that renamed in the same clock tick
        // each holding their own username forever. See `lww_take`.
        if (other.username_updated_at, &other.username) > (self.username_updated_at, &self.username)
        {
            self.username = other.username.clone();
            self.username_updated_at = other.username_updated_at;
        }
        Ok(())
    }
}

// ── Shared event state (synced) ───────────────────────────────────────────────

/// One shared event. Its real owner is the entry's owner stamp; `owner` here is
/// only the key of the `owner` index, and a row whose field disagrees with the
/// stamp — what a patched node would write — is dropped on read.
#[app::mergeable(id = "mero_calendar::CalendarEventState")]
#[derive(
    Clone, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize, AbiType, app::Indexed,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct CalendarEventState {
    title: String,
    description: String,
    #[index]
    owner: UserId,
    start: String,
    end: String,
    event_type: String,
    color: String,
    /// One `peers` index row per invitee.
    #[index]
    peers: Vec<UserId>,
    created_at: u64,
    updated_at: u64,
}

impl MergeableTrait for CalendarEventState {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Whole-record last-writer-wins on the edit clock.
        if lww_take(self.updated_at, other.updated_at, self, other) {
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
    /// Key is the event id; the value is the shared event, owned by the
    /// account that created it. Only that account edits or deletes it.
    events: Authored<IndexedMap<String, CalendarEventState>>,
    /// Each member's display name, in their own slot.
    members: UserStorage<Member>,
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
            events: Authored::new(),
            members: UserStorage::new(),
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
        if let Some(mut existing) = self.members.get()? {
            existing.username = username;
            existing.username_updated_at = timestamp;
            let _ = self.members.insert(existing)?;
            app::emit!(Event::MemberUsernameUpdated(member_id));
        } else {
            let member = Member {
                id: member_id.clone(),
                username,
                joined_at: timestamp,
                username_updated_at: timestamp,
            };
            let _ = self.members.insert(member)?;
            app::emit!(Event::MemberJoined(member_id));
        }
        Ok(())
    }

    pub fn get_members(&self) -> app::Result<Vec<Member>> {
        let mut members = Vec::new();
        for (account, mut member) in self.members.entries()? {
            // The slot's key is the member; the stored `id` is just bytes.
            member.id = UserId::new(*account.as_bytes()).to_string();
            members.push(member);
        }
        Ok(members)
    }

    // ── Shared events ─────────────────────────────────────────────────────────

    /// The shared events the caller owns or is invited to — two seeks, on the
    /// `owner` and `peers` indexes.
    ///
    /// This is a view filter, not access control: every member's node holds
    /// every shared event. See the module docs.
    pub fn get_events(&self) -> app::Result<Vec<CalendarEvent>> {
        let caller = Self::caller();

        let mut found = BTreeMap::new();
        for (id, event) in self.events.query("owner").eq(&caller).entries()? {
            let _ = found.insert(id, event);
        }
        for (id, event) in self.events.query("peers").eq(&caller).entries()? {
            let _ = found.insert(id, event);
        }

        let mut events = Vec::with_capacity(found.len());
        for (id, event) in found {
            // The owner is the stamp. A row claiming an owner it was not
            // written by is a forgery, and is not shown as anyone's.
            let Some(owner) = self.owner_of(&id)? else {
                continue;
            };
            if owner != event.owner {
                continue;
            }
            events.push(CalendarEvent {
                id,
                title: event.title,
                description: event.description,
                owner,
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
    /// Removing peers changes the audience, not who holds it: `get_events`
    /// lists an event only to its owner and peers, so it drops out of a
    /// removed peer's calendar — but that is a view filter, and every member's
    /// node still holds the event.
    ///
    /// Only the owner may update it; every node refuses anyone else's edit.
    pub fn update_event(
        &mut self,
        event_id: String,
        event_data: UpdateCalendarEvent,
        timestamp: u64,
    ) -> app::Result<String> {
        app::log!("Updating calendar event {} with {:?}", event_id, event_data);

        self.require_owner(&event_id)?;

        self.events.modify(&event_id, |event| {
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
        })?;

        app::emit!(Event::CalendarEventEdited(event_id.clone()));

        Ok(event_id)
    }

    pub fn delete_event(&mut self, event_id: String) -> app::Result<String> {
        app::log!("Deleting calendar event {}", event_id);

        self.require_owner(&event_id)?;

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

    /// The event's owner stamp — who really created it, whatever its value says.
    fn owner_of(&self, event_id: &String) -> app::Result<Option<UserId>> {
        Ok(self
            .events
            .owner_of(event_id)?
            .map(|owner| UserId::new(*owner.as_bytes())))
    }

    /// A readable error for what storage refuses anyway: only the owner may
    /// change or remove an event.
    fn require_owner(&self, event_id: &String) -> app::Result<()> {
        match self.owner_of(event_id)? {
            None => app::bail!(Error::NotFound(event_id.clone())),
            Some(owner) if owner != Self::caller() => app::bail!(Error::Forbidden),
            Some(_) => Ok(()),
        }
    }

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

    // ── what every node enforces ─────────────────────────────────────────────
    //
    // These write straight into the collections, the way a patched node that
    // skips every method check would, and assert that storage still refuses.

    #[test]
    fn another_account_cannot_rewrite_or_remove_an_event_in_storage() {
        let mut app = new_app();
        let id = app
            .call(|s| s.create_event(event(vec![UserId::new(OTHER)]), 10))
            .unwrap();
        // Even an invited peer: being on the guest list is not ownership.
        assert!(app
            .call_as_account(OTHER, OTHER_DEVICE, |s| {
                s.events.modify(&id, |e| e.title = "Hijacked".to_owned())
            })
            .is_err());
        assert!(app
            .call_as_account(OTHER, OTHER_DEVICE, |s| s.events.remove(&id))
            .is_err());
        let events = app.view(|s| s.get_events()).unwrap();
        assert_eq!(events[0].title, "Standup");
    }

    /// The `owner` field is only an index key. A row a patched node writes
    /// claiming someone else as owner is not shown as theirs.
    #[test]
    fn a_forged_owner_field_is_not_believed() {
        let mut app = new_app();
        let me = UserId::new(app.account_id());
        app.call_as_account(OTHER, OTHER_DEVICE, |s| {
            s.events.insert(
                "forged".to_owned(),
                CalendarEventState {
                    title: "Fake meeting".to_owned(),
                    description: String::new(),
                    owner: me,
                    start: String::new(),
                    end: String::new(),
                    event_type: "event".to_owned(),
                    color: String::new(),
                    peers: vec![UserId::new(THIRD)],
                    created_at: 1,
                    updated_at: 1,
                },
            )
        })
        .unwrap();
        assert!(app.view(|s| s.get_events()).unwrap().is_empty());
        assert!(app
            .call_as_account(THIRD, THIRD_DEVICE, |s| s.get_events())
            .unwrap()
            .is_empty());
        // Nor does the field make it mine to delete: the gate is the stamp.
        assert!(app.call(|s| s.delete_event("forged".to_owned())).is_err());
    }

    #[test]
    fn nobody_can_rename_another_member() {
        let mut app = new_app();
        app.call(|s| s.set_username("alice".to_owned(), 1)).unwrap();
        app.call_as_account(OTHER, OTHER_DEVICE, |s| {
            s.set_username("alice".to_owned(), 9)
        })
        .unwrap();
        let members = app.view(|s| s.get_members()).unwrap();
        let me = UserId::new(app.account_id()).to_string();
        let mine = members.iter().find(|m| m.id == me).unwrap();
        assert_eq!(mine.username_updated_at, 1, "only my own slot is mine");
        assert_eq!(members.len(), 2);
    }
}
