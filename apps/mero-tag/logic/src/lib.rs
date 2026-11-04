//! Mero Tag — distributed real-time location sharing on Calimero.
//!
//! Mirrors the structure of the MeroDesign contract: one app context holds the
//! whole sharing space (members, trackers, groups, geofences, presence, and a
//! bounded per-tracker location history). Every mutating method emits an event
//! so subscribers update live over SSE.
//!
//! Conflict resolution is app-defined. Every stored record is
//! `#[app::mergeable]` and resolves last-writer-wins by its own timestamp,
//! except `History`, which unions append-only samples.
//!
//! `#[app::mergeable]` is what makes the storage layer CALL those rules. Before
//! core 0.11.0-rc.32 began requiring the declaration, a collection value that
//! declared nothing resolved last-write-wins by write order with the app's
//! `merge` never consulted — so every rule below was dead code, and the claim
//! that "multiple nodes editing the same space converge" was untested. Two of
//! them did not converge once actually dispatched; see `lww_wins` and
//! `History::merge`.
//!
//! # Core 1.0
//!
//! - **One id per person.** There are no devices: `env::account_id()` is the
//!   caller, and every owner, author and member id is taken from it rather than
//!   from an argument. A member id is that account as 64 hex.
//! - **Writes run on the leader.** Each app instance is one Raft group; the
//!   leader runs a call and followers apply it. Record clocks come from the
//!   leader's `env::time_now()`, not from each phone, and nothing is written
//!   offline.
//! - **Org standing.** `env::caller_org()` says whether the caller administers
//!   the app instance's organization; org admins may moderate (rename the
//!   space, remove anyone's tracker, group or geofence).
//! - **Named event fields.** Every event is `Variant { id }` (core#4753).

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::env::{self, OrgRole};
use calimero_sdk::{app, AccountId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{LwwRegister, Mergeable as MergeableTrait, UnorderedMap};

// ── ID aliases ──────────────────────────────────────────────────────────────

type TrackerId  = String;
type GroupId    = String;
type GeofenceId = String;
type MemberId   = String;

/// Keep at most this many history samples per tracker (oldest dropped first).
/// Caps WASM state growth — the frontend decides how often to push a sample.
const MAX_HISTORY: usize = 500;

// ── Pure helpers (unit-testable without the Calimero runtime) ─────────────────

pub mod pure {
    use super::LocationSample;

    /// Append a sample and trim the oldest entries so at most `max` remain.
    pub fn push_capped(samples: &mut Vec<LocationSample>, sample: LocationSample, max: usize) {
        samples.push(sample);
        if samples.len() > max {
            let overflow = samples.len() - max;
            samples.drain(0..overflow);
        }
    }

    /// Great-circle distance in metres between two lat/lng points (haversine).
    /// Used to decide geofence enter/exit and to throttle history sampling.
    pub fn haversine_m(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
        const R: f64 = 6_371_000.0; // mean Earth radius, metres
        let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
        let dlat = (lat2 - lat1).to_radians();
        let dlng = (lng2 - lng1).to_radians();
        let a = (dlat / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dlng / 2.0).sin().powi(2);
        2.0 * R * a.sqrt().atan2((1.0 - a).sqrt())
    }

    /// True when the point lies inside the circle (centre + radius metres).
    pub fn is_inside(center_lat: f64, center_lng: f64, radius_m: f64, lat: f64, lng: f64) -> bool {
        haversine_m(center_lat, center_lng, lat, lng) <= radius_m
    }

    /// A location update is accepted only if it's newer than (or equal to) the
    /// last one we stored — out-of-order/replayed fixes are dropped.
    pub fn location_is_newer(current_ts: Option<u64>, incoming_ts: u64) -> bool {
        match current_ts {
            Some(ts) => incoming_ts >= ts,
            None => true,
        }
    }

    /// Owner always sees their tracker; others only if explicitly shared.
    pub fn can_view(owner: &str, viewers: &[String], user: &str) -> bool {
        user == owner || viewers.iter().any(|v| v == user)
    }

    /// Geofence transition: given the previous and current inside-ness, return
    /// the event to emit (`"enter"`, `"exit"`, or `None` if unchanged).
    pub fn geofence_transition(was_inside: bool, now_inside: bool) -> Option<&'static str> {
        match (was_inside, now_inside) {
            (false, true) => Some("enter"),
            (true, false) => Some("exit"),
            _ => None,
        }
    }

    /// A record may be changed by its owner, or by an admin of the app
    /// instance's organization.
    pub fn may_manage(owner: &str, caller: &str, is_org_admin: bool) -> bool {
        is_org_admin || owner == caller
    }

    /// A latitude/longitude pair a map can show.
    pub fn valid_coordinates(lat: f64, lng: f64) -> bool {
        lat.is_finite() && lng.is_finite() && (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lng)
    }

    /// A record clock: `now_ms`, unless that would not move past `after` (a new
    /// leader whose wall clock trails the old one's), then one past `after`.
    pub fn monotonic_ms(now_ms: u64, after: u64) -> u64 {
        now_ms.max(after.saturating_add(1))
    }

    /// Whether a history sample falls within the requested window (`since` = 0
    /// means "everything").
    pub fn within_window(sample_ts: u64, since: u64) -> bool {
        sample_ts >= since
    }
}

// ── Merge rules ───────────────────────────────────────────────────────────────
//
// `Mergeable::merge` is a CRDT merge, and the storage layer will call it in any
// order, more than once, on any pair of divergent replicas. It must therefore be
// deterministic, commutative, associative, idempotent and total. `Err` is not
// validation — it refuses to converge and leaves repair retrying forever — so
// nothing below can fail.

/// Whether `candidate` should replace `incumbent` under last-writer-wins.
///
/// The timestamp decides; the borsh encoding breaks a tie.
///
/// The tiebreak is not decoration. A bare `candidate_ts > incumbent_ts` is NOT
/// commutative: two concurrent writes stamped the same millisecond leave each
/// node keeping its own copy, and they stay divergent permanently because every
/// re-merge changes nothing on either side. Comparing encodings gives a total
/// order over the whole record, so both replicas independently elect the same
/// winner. WHICH side wins is arbitrary; that it is the same side everywhere is
/// the property that matters.
///
/// Core 1.0: the stamps compared here now come from the leader's clock
/// (`stamp_after`), never from a phone, so the hazard below is closed for every
/// method except `update_location`, whose fix time only the phone knows — and
/// which already drops a fix older than the stored one.
///
/// ⚠️ **Every caller-supplied timestamp is now load-bearing.** `save_internal`
/// merges a `Custom`-stamped entry against the stored one on every write, a
/// node's own sequential writes included — its `Custom` arm merges "regardless
/// of timestamp ordering", deliberately, because a rule that only ran in one
/// direction would not be commutative. So a method handed a timestamp OLDER
/// than the record's stored one loses to the value it meant to replace, and
/// loses *quietly*: the method returns, `app::emit!` still fires, and the
/// record does not change. Eight methods here take that timestamp from the
/// caller (`rename_tracker`, `update_location`, `share_tracker`,
/// `unshare_tracker`, `add_group_member`, `remove_group_member`,
/// `add_tracker_to_group`, and the two constructors), so all of them share the
/// requirement: the frontend must pass ONE monotonic clock. `workflows/
/// logic-test.yml` violated it and is where this was found.
fn lww_wins<T: BorshSerialize>(
    candidate: &T,
    candidate_ts: u64,
    incumbent: &T,
    incumbent_ts: u64,
) -> bool {
    candidate_ts > incumbent_ts
        || (candidate_ts == incumbent_ts && encode(candidate) > encode(incumbent))
}

/// Borsh encoding, used only as a tiebreak key. Any failure would be
/// deterministic — borsh carries no state across calls — so both replicas reach
/// the same answer, and the empty fallback keeps the merge total.
fn encode<T: BorshSerialize>(value: &T) -> Vec<u8> {
    calimero_sdk::borsh::to_vec(value).unwrap_or_default()
}

/// Total, deterministic ordering key for a history sample.
///
/// `f64` has no `Ord` because of NaN, so the bit patterns stand in: they order
/// every value including NaN, and two replicas holding the same sample derive
/// the same key. Used for both sorting and dedup, so "same key" means "same
/// sample" throughout.
fn sample_key(sample: &LocationSample) -> (u64, u64, u64) {
    (
        sample.timestamp,
        sample.latitude.to_bits(),
        sample.longitude.to_bits(),
    )
}

// ── Location ──────────────────────────────────────────────────────────────────

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub latitude:  f64,
    pub longitude: f64,
    pub altitude:  f64,
    pub speed:     f64,
    pub heading:   f64,
    pub battery:   u8,
    pub timestamp: u64,
}

/// A trimmed location for history playback (no battery/heading/speed).
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct LocationSample {
    pub latitude:  f64,
    pub longitude: f64,
    pub timestamp: u64,
}

// ── Tracker ─────────────────────────────────────────────────────────────────

#[app::mergeable(id = "mero_tag::Tracker")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Tracker {
    pub id:         TrackerId,
    pub name:       String,
    pub owner_id:   MemberId,
    /// Member ids granted view access (owner is always implicitly allowed).
    pub viewers:    Vec<MemberId>,
    pub latest:     Option<Location>,
    pub created_at: u64,
    pub updated_at: u64,
}

// The re-key impl these types used to hand-write is generated by
// `#[app::mergeable]` now. Keeping a manual one would collide with it.
impl MergeableTrait for Tracker {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if lww_wins(other, other.updated_at, self, self.updated_at) {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Group ─────────────────────────────────────────────────────────────────────

#[app::mergeable(id = "mero_tag::Group")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id:          GroupId,
    pub name:        String,
    pub owner_id:    MemberId,
    pub member_ids:  Vec<MemberId>,
    pub tracker_ids: Vec<TrackerId>,
    pub updated_at:  u64,
}

impl MergeableTrait for Group {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if lww_wins(other, other.updated_at, self, self.updated_at) {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Geofence ────────────────────────────────────────────────────────────────

#[app::mergeable(id = "mero_tag::Geofence")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Geofence {
    pub id:         GeofenceId,
    pub name:       String,
    pub center_lat: f64,
    pub center_lng: f64,
    /// Radius in metres.
    pub radius:     f64,
    pub created_by: MemberId,
    pub created_at: u64,
}

impl MergeableTrait for Geofence {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Geofences are immutable once created; newest definition wins.
        if lww_wins(other, other.created_at, self, self.created_at) {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Presence ────────────────────────────────────────────────────────────────

#[app::mergeable(id = "mero_tag::Presence")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub user_id:   MemberId,
    pub online:    bool,
    pub last_seen: u64,
}

impl MergeableTrait for Presence {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if lww_wins(other, other.last_seen, self, self.last_seen) {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Member ────────────────────────────────────────────────────────────────────

#[app::mergeable(id = "mero_tag::Member")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id:        MemberId,
    pub username:  String,
    pub joined_at: u64,
}

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if lww_wins(other, other.joined_at, self, self.joined_at) {
            *self = other.clone();
        }
        Ok(())
    }
}

/// History entries are append-only; a list merges by taking the longer side
/// (the frontend never edits past samples, only appends new ones).
#[app::mergeable(id = "mero_tag::History")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, Default)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct History {
    pub samples: Vec<LocationSample>,
}

impl MergeableTrait for History {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Union, not longest-wins. Samples are append-only and each node
        // appends its OWN, so two nodes that each recorded one fix hold
        // different one-element lists: "longer wins" discarded one outright,
        // and on equal lengths it kept whichever side happened to be `self`,
        // which is not commutative — the two never converged.
        //
        // Union by `sample_key`, ordered by it, then capped exactly the way
        // `pure::push_capped` caps the write path: newest MAX_HISTORY kept,
        // oldest dropped.
        //
        // The cap is still associative, which is the subtle part: dropping the
        // OLDEST can only ever discard a sample that is older than MAX_HISTORY
        // others in the same union, and such a sample cannot be in the newest
        // MAX_HISTORY of the whole. So the result is "newest MAX_HISTORY of
        // everything merged", however the merges were grouped.
        self.samples.extend_from_slice(&other.samples);
        self.samples.sort_unstable_by_key(sample_key);
        // `dedup_by`, not `dedup_by_key`: the latter takes `&mut T` and the
        // closure wrapping `sample_key` reads as a redundant one to clippy,
        // which CI runs with `-D warnings`. Sorting first is what makes this
        // remove all duplicates rather than only consecutive ones.
        self.samples.dedup_by(|a, b| sample_key(a) == sample_key(b));
        let len = self.samples.len();
        if len > MAX_HISTORY {
            self.samples.drain(0..len - MAX_HISTORY);
        }
        Ok(())
    }
}

// ── Space info (summary) ──────────────────────────────────────────────────────

#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct SpaceInfo {
    pub name:          String,
    pub tracker_count: u32,
    pub member_count:  u32,
    pub group_count:   u32,
}

// ── Caller ────────────────────────────────────────────────────────────────────

/// What a view tells the app about the caller: the member id this space stores
/// for them, and their standing in the organization the app instance belongs to.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Me {
    /// The caller's account (64 hex) — the id every record here is keyed by.
    pub member_id: String,
    /// The app instance's organization, when it belongs to one.
    pub org:       Option<String>,
    /// "guest" | "member" | "admin" | "owner", or `None` outside an org.
    pub org_role:  Option<String>,
}

// ── Events ────────────────────────────────────────────────────────────────────
//
// Named fields, not tuple variants: core#4753 stops compiling tuple variants in
// `#[app::event]`. Every variant carries the affected record as `id`, so the
// payload is `{"id":"…"}` and a client reads one field whatever the kind.

#[app::event]
pub enum Event {
    MemberJoined { id: String },
    TrackerCreated { id: String },
    TrackerUpdated { id: String },
    TrackerRenamed { id: String },
    TrackerDeleted { id: String },
    TrackerShared { id: String },
    GroupCreated { id: String },
    GroupUpdated { id: String },
    GroupDeleted { id: String },
    GeofenceCreated { id: String },
    GeofenceDeleted { id: String },
    GeofenceEntered { id: String },
    GeofenceExited { id: String },
    PresenceUpdated { id: String },
}

// ── App state ──────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroTag {
    space_name: LwwRegister<String>,
    members:    UnorderedMap<MemberId, Member>,
    trackers:   UnorderedMap<TrackerId, Tracker>,
    groups:     UnorderedMap<GroupId, Group>,
    geofences:  UnorderedMap<GeofenceId, Geofence>,
    presence:   UnorderedMap<MemberId, Presence>,
    history:    UnorderedMap<TrackerId, History>,
}

// ── Identity and time (core 1.0) ──────────────────────────────────────────────
//
// Core 1.0 has no devices: `env::account_id()` is the person calling, and it is
// the only member id this contract stores. Nothing takes an owner, author or
// member id from the caller any more — a client could put anyone's name there.
//
// Every write runs once, on the app instance's Raft leader, and there are no
// offline writes, so record clocks come from the leader (`env::time_now()`)
// instead of each phone. That retires the 0.x requirement that every client
// pass one monotonic clock (see `lww_wins`). The one caller-supplied time left
// is a location fix's own `timestamp`: it is when the GPS took the fix, which
// only the phone knows.

fn caller_id() -> MemberId {
    AccountId::from(env::account_id()).to_string()
}

/// The caller administers the app instance's organization (admin or owner).
/// Org admins moderate the space: they may remove anyone's tracker, group or
/// geofence, the way an admin removes content in any team tool.
fn caller_is_org_admin() -> bool {
    env::caller_org().is_some_and(|o| o.role >= OrgRole::Admin)
}

fn org_role_name(role: OrgRole) -> &'static str {
    match role {
        OrgRole::Guest => "guest",
        OrgRole::Member => "member",
        OrgRole::Admin => "admin",
        OrgRole::Owner => "owner",
    }
}

/// The leader's clock in milliseconds, never behind `after`. A new leader's
/// wall clock may trail the old one's by a little; LWW on these stamps must
/// still order a later write after an earlier one.
fn stamp_after(after: u64) -> u64 {
    pure::monotonic_ms(env::time_now() / 1_000_000, after)
}

// ── Logic ──────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroTag {
    #[app::init]
    pub fn init(name: String) -> MeroTag {
        MeroTag {
            space_name: LwwRegister::new(name),
            members:    UnorderedMap::new(),
            trackers:   UnorderedMap::new(),
            groups:     UnorderedMap::new(),
            geofences:  UnorderedMap::new(),
            presence:   UnorderedMap::new(),
            history:    UnorderedMap::new(),
        }
    }

    // ── Space / members ───────────────────────────────────────────────────────

    pub fn get_space(&self) -> SpaceInfo {
        SpaceInfo {
            name:          self.space_name.get().clone(),
            tracker_count: self.trackers.len().unwrap_or(0) as u32,
            member_count:  self.members.len().unwrap_or(0) as u32,
            group_count:   self.groups.len().unwrap_or(0) as u32,
        }
    }

    /// Who the caller is here: their member id and org standing.
    pub fn whoami(&self) -> Me {
        let org = env::caller_org();
        Me {
            member_id: caller_id(),
            org:       org.as_ref().map(|o| o.org.clone()),
            org_role:  org.map(|o| org_role_name(o.role).to_owned()),
        }
    }

    /// Rename the space. Org admins only — the space is the org's.
    pub fn rename_space(&mut self, name: String) -> app::Result<()> {
        if !caller_is_org_admin() {
            app::bail!("only an admin of this organization can rename the space");
        }
        self.space_name.set(name);
        Ok(())
    }

    /// Join the space as the caller's own account. Idempotent.
    pub fn join(&mut self, username: String) {
        let member_id = caller_id();
        if self.members.contains(&member_id).unwrap_or(false) { return; }
        let m = Member { id: member_id.clone(), username, joined_at: stamp_after(0) };
        let _ = self.members.insert(member_id.clone(), m);
        app::emit!(Event::MemberJoined { id: member_id });
    }

    pub fn get_members(&self) -> Vec<Member> {
        self.members.entries().unwrap().map(|(_, v)| v).collect()
    }

    // ── Trackers ────────────────────────────────────────────────────────────────

    /// Create a tracker owned by the caller. Idempotent on `id`.
    pub fn create_tracker(&mut self, id: String, name: String) -> String {
        if self.trackers.contains(&id).unwrap_or(false) { return id; }
        let now = stamp_after(0);
        let t = Tracker {
            id: id.clone(), name, owner_id: caller_id(), viewers: vec![],
            latest: None, created_at: now, updated_at: now,
        };
        let _ = self.trackers.insert(id.clone(), t);
        app::emit!(Event::TrackerCreated { id: id.clone() });
        id
    }

    pub fn rename_tracker(&mut self, id: String, name: String) -> app::Result<()> {
        let me = caller_id();
        let admin = caller_is_org_admin();
        if let Ok(Some(mut t)) = self.trackers.get_mut(&id) {
            if !pure::may_manage(&t.owner_id, &me, admin) {
                app::bail!("only the tracker's owner can rename it");
            }
            t.name = name;
            t.updated_at = stamp_after(t.updated_at);
            drop(t);
            app::emit!(Event::TrackerRenamed { id });
        }
        Ok(())
    }

    pub fn delete_tracker(&mut self, id: String) -> app::Result<()> {
        let me = caller_id();
        if let Ok(Some(t)) = self.trackers.get(&id) {
            if !pure::may_manage(&t.owner_id, &me, caller_is_org_admin()) {
                app::bail!("only the tracker's owner can delete it");
            }
        }
        let _ = self.trackers.remove(&id);
        let _ = self.history.remove(&id);
        app::emit!(Event::TrackerDeleted { id });
        Ok(())
    }

    /// Ingest a location fix for one of the caller's trackers. Validates →
    /// stores latest → appends a capped history sample → broadcasts.
    ///
    /// Owner only, and not even an org admin: a location is the owner's to
    /// report, and an admin moving someone's pin would be a forged sighting.
    #[allow(clippy::too_many_arguments)]
    pub fn update_location(
        &mut self,
        tracker_id: String,
        latitude:  f64,
        longitude: f64,
        altitude:  f64,
        speed:     f64,
        heading:   f64,
        battery:   u8,
        timestamp: u64,
    ) -> app::Result<()> {
        if !pure::valid_coordinates(latitude, longitude) {
            app::bail!("that location is not a valid latitude/longitude");
        }
        let me = caller_id();
        let loc = Location { latitude, longitude, altitude, speed, heading, battery, timestamp };

        let mut tracker_exists = false;
        if let Ok(Some(mut t)) = self.trackers.get_mut(&tracker_id) {
            if t.owner_id != me {
                app::bail!("only the tracker's owner can report its location");
            }
            // Drop out-of-order fixes.
            if pure::location_is_newer(t.latest.as_ref().map(|l| l.timestamp), timestamp) {
                t.latest = Some(loc.clone());
                t.updated_at = stamp_after(t.updated_at);
            }
            tracker_exists = true;
        }
        if !tracker_exists { return Ok(()); }

        // Append to bounded history.
        let mut h = self.history.get(&tracker_id).ok().flatten().map(|v| v.clone()).unwrap_or_default();
        pure::push_capped(&mut h.samples, LocationSample { latitude, longitude, timestamp }, MAX_HISTORY);
        let _ = self.history.insert(tracker_id.clone(), h);

        app::emit!(Event::TrackerUpdated { id: tracker_id });
        Ok(())
    }

    pub fn get_trackers(&self) -> Vec<Tracker> {
        self.trackers.entries().unwrap().map(|(_, v)| v).collect()
    }

    pub fn get_tracker(&self, id: String) -> Option<Tracker> {
        self.trackers.get(&id).ok().flatten().map(|v| v.clone())
    }

    // ── Sharing / permissions ─────────────────────────────────────────────────

    pub fn share_tracker(&mut self, tracker_id: String, user_id: String) -> app::Result<()> {
        let me = caller_id();
        let admin = caller_is_org_admin();
        if let Ok(Some(mut t)) = self.trackers.get_mut(&tracker_id) {
            if !pure::may_manage(&t.owner_id, &me, admin) {
                app::bail!("only the tracker's owner can share it");
            }
            if !t.viewers.contains(&user_id) {
                t.viewers.push(user_id);
                t.updated_at = stamp_after(t.updated_at);
            }
            drop(t);
            app::emit!(Event::TrackerShared { id: tracker_id });
        }
        Ok(())
    }

    pub fn unshare_tracker(&mut self, tracker_id: String, user_id: String) -> app::Result<()> {
        let me = caller_id();
        let admin = caller_is_org_admin();
        if let Ok(Some(mut t)) = self.trackers.get_mut(&tracker_id) {
            // A viewer may always take themselves off a tracker.
            if !pure::may_manage(&t.owner_id, &me, admin) && user_id != me {
                app::bail!("only the tracker's owner can unshare it");
            }
            t.viewers.retain(|v| v != &user_id);
            t.updated_at = stamp_after(t.updated_at);
            drop(t);
            app::emit!(Event::TrackerShared { id: tracker_id });
        }
        Ok(())
    }

    // ── Groups ────────────────────────────────────────────────────────────────

    /// Create a group owned by the caller. Idempotent on `id`.
    pub fn create_group(&mut self, id: String, name: String) -> String {
        if self.groups.contains(&id).unwrap_or(false) { return id; }
        let owner_id = caller_id();
        let g = Group {
            id: id.clone(), name, owner_id: owner_id.clone(),
            member_ids: vec![owner_id], tracker_ids: vec![], updated_at: stamp_after(0),
        };
        let _ = self.groups.insert(id.clone(), g);
        app::emit!(Event::GroupCreated { id: id.clone() });
        id
    }

    pub fn add_group_member(&mut self, group_id: String, member_id: String) -> app::Result<()> {
        self.edit_group(&group_id, |g| {
            if !g.member_ids.contains(&member_id) { g.member_ids.push(member_id); }
        })
    }

    /// Remove a member. The group's owner may remove anyone; a member may
    /// always leave.
    pub fn remove_group_member(&mut self, group_id: String, member_id: String) -> app::Result<()> {
        if member_id == caller_id() {
            if let Ok(Some(mut g)) = self.groups.get_mut(&group_id) {
                g.member_ids.retain(|m| m != &member_id);
                g.updated_at = stamp_after(g.updated_at);
                drop(g);
                app::emit!(Event::GroupUpdated { id: group_id });
            }
            return Ok(());
        }
        self.edit_group(&group_id, |g| g.member_ids.retain(|m| m != &member_id))
    }

    pub fn add_tracker_to_group(&mut self, group_id: String, tracker_id: String) -> app::Result<()> {
        self.edit_group(&group_id, |g| {
            if !g.tracker_ids.contains(&tracker_id) { g.tracker_ids.push(tracker_id); }
        })
    }

    pub fn delete_group(&mut self, id: String) -> app::Result<()> {
        let me = caller_id();
        if let Ok(Some(g)) = self.groups.get(&id) {
            if !pure::may_manage(&g.owner_id, &me, caller_is_org_admin()) {
                app::bail!("only the group's owner can delete it");
            }
        }
        let _ = self.groups.remove(&id);
        app::emit!(Event::GroupDeleted { id });
        Ok(())
    }

    pub fn get_groups(&self) -> Vec<Group> {
        self.groups.entries().unwrap().map(|(_, v)| v).collect()
    }

    /// Owner- (or org-admin-) gated group edit, stamped and announced.
    fn edit_group(&mut self, group_id: &str, edit: impl FnOnce(&mut Group)) -> app::Result<()> {
        let me = caller_id();
        let admin = caller_is_org_admin();
        if let Ok(Some(mut g)) = self.groups.get_mut(group_id) {
            if !pure::may_manage(&g.owner_id, &me, admin) {
                app::bail!("only the group's owner can change it");
            }
            edit(&mut g);
            g.updated_at = stamp_after(g.updated_at);
            drop(g);
            app::emit!(Event::GroupUpdated { id: group_id.to_owned() });
        }
        Ok(())
    }

    // ── Geofences ─────────────────────────────────────────────────────────────

    pub fn create_geofence(
        &mut self,
        id: String,
        name: String,
        center_lat: f64,
        center_lng: f64,
        radius: f64,
    ) -> app::Result<String> {
        if !pure::valid_coordinates(center_lat, center_lng) {
            app::bail!("that place is not a valid latitude/longitude");
        }
        if !(radius.is_finite() && radius > 0.0) {
            app::bail!("a geofence needs a positive radius");
        }
        let me = caller_id();
        if let Ok(Some(existing)) = self.geofences.get(&id) {
            // Redefining someone else's place would move their alerts.
            if !pure::may_manage(&existing.created_by, &me, caller_is_org_admin()) {
                app::bail!("only the geofence's creator can change it");
            }
        }
        let g = Geofence {
            id: id.clone(), name, center_lat, center_lng, radius,
            created_by: me, created_at: stamp_after(0),
        };
        let _ = self.geofences.insert(id.clone(), g);
        app::emit!(Event::GeofenceCreated { id: id.clone() });
        Ok(id)
    }

    pub fn delete_geofence(&mut self, id: String) -> app::Result<()> {
        let me = caller_id();
        if let Ok(Some(g)) = self.geofences.get(&id) {
            if !pure::may_manage(&g.created_by, &me, caller_is_org_admin()) {
                app::bail!("only the geofence's creator can delete it");
            }
        }
        let _ = self.geofences.remove(&id);
        app::emit!(Event::GeofenceDeleted { id });
        Ok(())
    }

    pub fn get_geofences(&self) -> Vec<Geofence> {
        self.geofences.entries().unwrap().map(|(_, v)| v).collect()
    }

    /// Reported by the client's CLRegion monitor. `kind` is "enter" or "exit".
    /// The contract just validates the geofence exists and rebroadcasts.
    pub fn report_geofence_event(&mut self, geofence_id: String, kind: String) {
        if !self.geofences.contains(&geofence_id).unwrap_or(false) { return; }
        if kind == "enter" {
            app::emit!(Event::GeofenceEntered { id: geofence_id });
        } else if kind == "exit" {
            app::emit!(Event::GeofenceExited { id: geofence_id });
        }
    }

    // ── Presence ──────────────────────────────────────────────────────────────

    /// The caller's own presence. One entry per person: with no devices in core
    /// 1.0, a member on a phone and an iPad is one presence, not two.
    pub fn update_presence(&mut self, online: bool) {
        let user_id = caller_id();
        let previous = self.presence.get(&user_id).ok().flatten().map_or(0, |p| p.last_seen);
        let p = Presence { user_id: user_id.clone(), online, last_seen: stamp_after(previous) };
        let _ = self.presence.insert(user_id.clone(), p);
        app::emit!(Event::PresenceUpdated { id: user_id });
    }

    pub fn get_presence(&self) -> Vec<Presence> {
        self.presence.entries().unwrap().map(|(_, v)| v).collect()
    }

    // ── History ───────────────────────────────────────────────────────────────

    /// All retained samples for a tracker (oldest → newest). Pass `since` (ms
    /// epoch) to trim to a window (0 = everything). Frontend selects hour/day/week.
    pub fn get_history(&self, tracker_id: String, since: u64) -> Vec<LocationSample> {
        let h = self.history.get(&tracker_id).ok().flatten().map(|v| v.clone()).unwrap_or_default();
        h.samples.into_iter().filter(|s| s.timestamp >= since).collect()
    }
}


// ── Tests (pure helpers — run with `cargo test`) ──────────────────────────────

#[cfg(test)]
mod tests {
    use super::pure::*;
    use super::LocationSample;

    fn sample(ts: u64) -> LocationSample {
        LocationSample { latitude: 0.0, longitude: 0.0, timestamp: ts }
    }

    #[test]
    fn push_capped_keeps_newest() {
        let mut v = vec![];
        for ts in 0..10 {
            push_capped(&mut v, sample(ts), 5);
        }
        assert_eq!(v.len(), 5);
        assert_eq!(v.first().unwrap().timestamp, 5);
        assert_eq!(v.last().unwrap().timestamp, 9);
    }

    #[test]
    fn push_capped_under_limit_keeps_all() {
        let mut v = vec![];
        push_capped(&mut v, sample(1), 100);
        push_capped(&mut v, sample(2), 100);
        assert_eq!(v.len(), 2);
    }

    #[test]
    fn haversine_zero_distance() {
        assert!(haversine_m(40.0, -74.0, 40.0, -74.0) < 0.001);
    }

    #[test]
    fn haversine_one_degree_lat_is_about_111km() {
        let d = haversine_m(0.0, 0.0, 1.0, 0.0);
        assert!((d - 111_195.0).abs() < 500.0, "got {d}");
    }

    #[test]
    fn geofence_inside_and_outside() {
        // ~111m north of origin; 150m radius contains it, 50m does not.
        let (clat, clng) = (0.0, 0.0);
        let (plat, plng) = (0.001, 0.0); // ~111m
        assert!(is_inside(clat, clng, 150.0, plat, plng));
        assert!(!is_inside(clat, clng, 50.0, plat, plng));
    }

    #[test]
    fn location_newer_accepts_and_rejects() {
        assert!(location_is_newer(None, 0));            // first fix always accepted
        assert!(location_is_newer(Some(100), 100));     // equal ts accepted (idempotent)
        assert!(location_is_newer(Some(100), 101));     // newer accepted
        assert!(!location_is_newer(Some(100), 99));     // stale rejected
    }

    #[test]
    fn permissions_owner_and_viewers() {
        let viewers = vec!["bob".to_string(), "carol".to_string()];
        assert!(can_view("alice", &viewers, "alice"));   // owner
        assert!(can_view("alice", &viewers, "bob"));      // shared viewer
        assert!(!can_view("alice", &viewers, "mallory")); // stranger
        assert!(!can_view("alice", &[], "bob"));          // not shared
    }

    #[test]
    fn geofence_transitions() {
        assert_eq!(geofence_transition(false, true), Some("enter"));
        assert_eq!(geofence_transition(true, false), Some("exit"));
        assert_eq!(geofence_transition(true, true), None);
        assert_eq!(geofence_transition(false, false), None);
    }

    #[test]
    fn history_window() {
        assert!(within_window(500, 0));     // since=0 → everything
        assert!(within_window(500, 500));   // boundary inclusive
        assert!(within_window(600, 500));   // inside window
        assert!(!within_window(400, 500));  // older than window
    }
}

// ── Merge laws ────────────────────────────────────────────────────────────────
//
// The storage layer calls `merge` in any order, repeatedly, on any pair of
// divergent replicas, so these are the properties convergence actually rests
// on. They are asserted here rather than left to the merobox lane because a
// two-node scenario shows one interleaving; commutativity is a claim about all
// of them.
//
// Before `#[app::mergeable]` was added none of these functions was ever called,
// so none of this was covered — and two of the six did not hold.
#[cfg(test)]
mod merge_laws {
    use super::pure::push_capped;
    use super::{
        Geofence, Group, History, LocationSample, Member, MergeableTrait, Presence, Tracker,
        MAX_HISTORY,
    };

    fn tracker(name: &str, updated_at: u64) -> Tracker {
        Tracker {
            id:         "t1".to_string(),
            name:       name.to_string(),
            owner_id:   "alice".to_string(),
            viewers:    vec![],
            latest:     None,
            created_at: 0,
            updated_at,
        }
    }

    fn sample(ts: u64) -> LocationSample {
        LocationSample { latitude: 1.0, longitude: 2.0, timestamp: ts }
    }

    fn history(timestamps: &[u64]) -> History {
        History { samples: timestamps.iter().copied().map(sample).collect() }
    }

    fn merged<T: Clone + MergeableTrait>(a: &T, b: &T) -> T {
        let mut out = a.clone();
        out.merge(b).expect("merge must be total");
        out
    }

    #[test]
    fn newer_timestamp_wins_regardless_of_side() {
        let (old, new) = (tracker("old", 1), tracker("new", 2));
        assert_eq!(merged(&old, &new).name, "new");
        assert_eq!(merged(&new, &old).name, "new");
    }

    #[test]
    fn equal_timestamps_converge_on_the_same_winner() {
        // The case a bare `>` got wrong: same timestamp, different content, so
        // each replica kept its own copy and they stayed divergent forever.
        let (a, b) = (tracker("a", 7), tracker("b", 7));
        assert_eq!(merged(&a, &b).name, merged(&b, &a).name);
    }

    #[test]
    fn merge_is_idempotent() {
        let a = tracker("a", 5);
        assert_eq!(merged(&a, &a).name, "a");
        assert_eq!(merged(&merged(&a, &a), &a).name, "a");
    }

    #[test]
    fn every_record_type_converges_on_a_timestamp_tie() {
        // One assertion per type, because each names its own timestamp field
        // and a copy-paste slip in any of them is silent.
        let g = |name: &str| Geofence {
            id:         "g1".to_string(),
            name:       name.to_string(),
            center_lat: 0.0,
            center_lng: 0.0,
            radius:     10.0,
            created_by: "alice".to_string(),
            created_at: 3,
        };
        assert_eq!(merged(&g("x"), &g("y")).name, merged(&g("y"), &g("x")).name);

        let p = |online: bool| Presence {
            user_id: "alice".to_string(),
            online,
            last_seen: 3,
        };
        assert_eq!(
            merged(&p(true), &p(false)).online,
            merged(&p(false), &p(true)).online
        );

        let m = |username: &str| Member {
            id:        "alice".to_string(),
            username:  username.to_string(),
            joined_at: 3,
        };
        assert_eq!(merged(&m("a"), &m("b")).username, merged(&m("b"), &m("a")).username);

        let gr = |name: &str| Group {
            id:          "g1".to_string(),
            name:        name.to_string(),
            owner_id:    "alice".to_string(),
            member_ids:  vec![],
            tracker_ids: vec![],
            updated_at:  3,
        };
        assert_eq!(merged(&gr("a"), &gr("b")).name, merged(&gr("b"), &gr("a")).name);
    }

    #[test]
    fn history_unions_concurrent_appends_instead_of_discarding_one() {
        // Each node appended its own fix, so both lists are length 1. The old
        // "longer wins" rule kept one and lost the other.
        let (a, b) = (history(&[10]), history(&[20]));
        for out in [merged(&a, &b), merged(&b, &a)] {
            let got: Vec<u64> = out.samples.iter().map(|s| s.timestamp).collect();
            assert_eq!(got, vec![10, 20]);
        }
    }

    #[test]
    fn history_merge_is_idempotent_and_dedups() {
        let a = history(&[1, 2, 3]);
        let once = merged(&a, &a);
        assert_eq!(once.samples.len(), 3, "identical samples must collapse");
        assert_eq!(merged(&once, &a).samples.len(), 3);
    }

    #[test]
    fn history_merge_is_associative() {
        let (a, b, c) = (history(&[1]), history(&[2]), history(&[3]));
        let left = merged(&merged(&a, &b), &c);
        let right = merged(&a, &merged(&b, &c));
        let ts = |h: &History| -> Vec<u64> { h.samples.iter().map(|s| s.timestamp).collect() };
        assert_eq!(ts(&left), ts(&right));
        assert_eq!(ts(&left), vec![1, 2, 3]);
    }

    #[test]
    fn history_merge_caps_to_the_newest_and_stays_ordered() {
        // Union overflows the cap; the newest MAX_HISTORY must survive, oldest
        // dropped — the same end the write path's `push_capped` reaches.
        let older: Vec<u64> = (0..MAX_HISTORY as u64).collect();
        let newer: Vec<u64> = (MAX_HISTORY as u64..MAX_HISTORY as u64 + 10).collect();
        let out = merged(&history(&older), &history(&newer));
        assert_eq!(out.samples.len(), MAX_HISTORY);
        assert_eq!(out.samples.last().unwrap().timestamp, MAX_HISTORY as u64 + 9);
        assert_eq!(out.samples.first().unwrap().timestamp, 10);
        assert!(
            out.samples.windows(2).all(|w| w[0].timestamp <= w[1].timestamp),
            "samples must stay in timestamp order"
        );
    }

    #[test]
    fn merge_cap_agrees_with_the_write_path_cap() {
        // `History::merge`'s comment claims it caps "exactly the way
        // `pure::push_capped` caps the write path". A comment asserting a
        // guarantee is weaker than the guarantee, so assert it: the same
        // samples, delivered one at a time by the write path or in two halves
        // by the merge, must end at the same list.
        let all: Vec<u64> = (0..MAX_HISTORY as u64 + 25).collect();

        let mut via_writes = Vec::new();
        for ts in &all {
            push_capped(&mut via_writes, sample(*ts), MAX_HISTORY);
        }

        let mid = all.len() / 2;
        let via_merge = merged(&history(&all[..mid]), &history(&all[mid..]));

        let ts = |v: &[LocationSample]| -> Vec<u64> { v.iter().map(|s| s.timestamp).collect() };
        assert_eq!(ts(&via_merge.samples), ts(&via_writes));
    }

    #[test]
    fn merging_an_empty_history_changes_nothing() {
        // The identity case, which the old "longer side wins" rule also
        // happened to get right — kept here so a future rewrite cannot lose it
        // while the interesting cases still pass.
        let a = history(&[1, 2, 3]);
        let empty = History::default();
        let ts = |h: &History| -> Vec<u64> { h.samples.iter().map(|s| s.timestamp).collect() };
        assert_eq!(ts(&merged(&a, &empty)), vec![1, 2, 3]);
        assert_eq!(ts(&merged(&empty, &a)), vec![1, 2, 3]);
    }

    #[test]
    fn samples_sharing_a_timestamp_but_not_a_place_both_survive() {
        // Dedup keys on (timestamp, lat, lng), not timestamp alone. Two devices
        // reporting the same instant from different places are two samples; a
        // timestamp-only key would silently drop one.
        let a = History { samples: vec![LocationSample { latitude: 1.0, longitude: 2.0, timestamp: 9 }] };
        let b = History { samples: vec![LocationSample { latitude: 3.0, longitude: 4.0, timestamp: 9 }] };
        assert_eq!(merged(&a, &b).samples.len(), 2);
        assert_eq!(merged(&b, &a).samples.len(), 2);
    }
}

// ── Core 1.0 semantics ──────────────────────────────────────────────────────────
//
// Run against the SDK's in-process `TestHost`: identities come from the host,
// never from arguments, and org admins moderate.
#[cfg(test)]
mod core_1_0 {
    use calimero_sdk::env::{CallerOrg, OrgRole};
    use calimero_sdk::testing::TestHost;
    use calimero_sdk::AccountId;

    use super::MeroTag;

    const ALICE: [u8; 32] = [1; 32];
    const BOB: [u8; 32] = [2; 32];

    fn hex(account: [u8; 32]) -> String {
        AccountId::from(account).to_string()
    }

    fn space() -> TestHost<MeroTag> {
        TestHost::new(|| MeroTag::init("Family".to_owned()))
    }

    fn org(role: OrgRole) -> Option<CallerOrg> {
        Some(CallerOrg { org: "org-1".to_owned(), role, teams: vec![] })
    }

    #[test]
    fn owner_and_member_ids_come_from_the_caller() {
        let mut app = space();
        app.set_account(ALICE);
        app.call(|s| s.join("alice".to_owned()));
        app.call(|s| s.create_tracker("t1".to_owned(), "Phone".to_owned()));

        let tracker = app.view(|s| s.get_tracker("t1".to_owned())).expect("created");
        assert_eq!(tracker.owner_id, hex(ALICE));
        let members = app.view(|s| s.get_members());
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].id, hex(ALICE));
        assert_eq!(app.view(|s| s.whoami()).member_id, hex(ALICE));
    }

    #[test]
    fn only_the_owner_reports_a_trackers_location() {
        let mut app = space();
        app.set_account(ALICE);
        app.call(|s| s.create_tracker("t1".to_owned(), "Phone".to_owned()));

        app.set_account(BOB);
        let forged = app.call(|s| s.update_location("t1".to_owned(), 1.0, 2.0, 0.0, 0.0, 0.0, 90, 10));
        assert!(forged.is_err(), "another member must not move my pin");
        // Not even an org admin may forge a sighting.
        app.set_caller_org(org(OrgRole::Admin));
        assert!(app.call(|s| s.update_location("t1".to_owned(), 1.0, 2.0, 0.0, 0.0, 0.0, 90, 10)).is_err());

        app.set_caller_org(None);
        app.set_account(ALICE);
        app.call(|s| s.update_location("t1".to_owned(), 1.0, 2.0, 0.0, 0.0, 0.0, 90, 10)).expect("owner");
        let latest = app.view(|s| s.get_tracker("t1".to_owned())).and_then(|t| t.latest).expect("fix stored");
        assert_eq!((latest.latitude, latest.longitude), (1.0, 2.0));
        assert_eq!(app.view(|s| s.get_history("t1".to_owned(), 0)).len(), 1);
    }

    #[test]
    fn an_org_admin_moderates_but_a_member_cannot() {
        let mut app = space();
        app.set_account(ALICE);
        app.call(|s| s.create_tracker("t1".to_owned(), "Phone".to_owned()));

        app.set_account(BOB);
        app.set_caller_org(org(OrgRole::Member));
        assert!(app.call(|s| s.delete_tracker("t1".to_owned())).is_err());
        assert!(app.call(|s| s.rename_space("Mine".to_owned())).is_err());
        assert!(app.view(|s| s.get_tracker("t1".to_owned())).is_some());

        app.set_caller_org(org(OrgRole::Admin));
        app.call(|s| s.delete_tracker("t1".to_owned())).expect("admin removes");
        app.call(|s| s.rename_space("Ours".to_owned())).expect("admin renames");
        assert!(app.view(|s| s.get_tracker("t1".to_owned())).is_none());
        assert_eq!(app.view(|s| s.get_space()).name, "Ours");
        assert_eq!(app.view(|s| s.whoami()).org_role.as_deref(), Some("admin"));
    }

    #[test]
    fn a_member_may_leave_a_group_but_not_remove_others() {
        let mut app = space();
        app.set_account(ALICE);
        app.call(|s| s.create_group("g1".to_owned(), "Hike".to_owned()));
        app.call(|s| s.add_group_member("g1".to_owned(), hex(BOB))).expect("owner adds");

        app.set_account(BOB);
        assert!(app.call(|s| s.remove_group_member("g1".to_owned(), hex(ALICE))).is_err());
        app.call(|s| s.remove_group_member("g1".to_owned(), hex(BOB))).expect("leaving is always allowed");
        let group = app.view(|s| s.get_groups()).pop().expect("group");
        assert_eq!(group.member_ids, vec![hex(ALICE)]);
    }

    #[test]
    fn record_clocks_only_move_forward() {
        let mut app = space();
        app.set_account(ALICE);
        app.call(|s| s.create_tracker("t1".to_owned(), "a".to_owned()));
        let first = app.view(|s| s.get_tracker("t1".to_owned())).unwrap().updated_at;
        app.call(|s| s.rename_tracker("t1".to_owned(), "b".to_owned())).unwrap();
        let second = app.view(|s| s.get_tracker("t1".to_owned())).unwrap();
        assert!(second.updated_at > first);
        assert_eq!(second.name, "b");
    }

    #[test]
    fn events_carry_a_named_id() {
        let mut app = space();
        app.set_account(ALICE);
        app.call(|s| s.create_tracker("t1".to_owned(), "a".to_owned()));
        let events = app.take_events();
        let created = events.iter().find(|e| e.kind == "TrackerCreated").expect("emitted");
        let payload: calimero_sdk::serde_json::Value =
            calimero_sdk::serde_json::from_slice(&created.data).expect("json payload");
        assert_eq!(payload["id"], "t1");
    }

    #[test]
    fn helpers() {
        use super::pure::{may_manage, monotonic_ms, valid_coordinates};
        assert_eq!(monotonic_ms(100, 0), 100);
        assert_eq!(monotonic_ms(100, 200), 201);
        assert!(may_manage("a", "a", false));
        assert!(may_manage("a", "b", true));
        assert!(!may_manage("a", "b", false));
        assert!(valid_coordinates(45.0, 15.0));
        assert!(!valid_coordinates(91.0, 0.0));
        assert!(!valid_coordinates(f64::NAN, 0.0));
    }
}
