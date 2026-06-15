//! Mero Tag — distributed real-time location sharing on Calimero.
//!
//! Mirrors the structure of the MeroDesign contract: one app context holds the
//! whole sharing space (members, trackers, groups, geofences, presence, and a
//! bounded per-tracker location history). Every mutating method emits an event
//! so subscribers update live over SSE.
//!
//! Conflict resolution is last-writer-wins by timestamp via `MergeableTrait`,
//! so multiple nodes editing the same space converge.

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::app;
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

    /// Whether a history sample falls within the requested window (`since` = 0
    /// means "everything").
    pub fn within_window(sample_ts: u64, since: u64) -> bool {
        sample_ts >= since
    }
}

// ── Location ──────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct LocationSample {
    pub latitude:  f64,
    pub longitude: f64,
    pub timestamp: u64,
}

// ── Tracker ─────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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

impl MergeableTrait for Tracker {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.updated_at > self.updated_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Group ─────────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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
        if other.updated_at > self.updated_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Geofence ────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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
        if other.created_at > self.created_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Presence ────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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
        if other.last_seen > self.last_seen { *self = other.clone(); }
        Ok(())
    }
}

// ── Member ────────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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
        if other.joined_at > self.joined_at { *self = other.clone(); }
        Ok(())
    }
}

/// History entries are append-only; a list merges by taking the longer side
/// (the frontend never edits past samples, only appends new ones).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, Default)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct History {
    pub samples: Vec<LocationSample>,
}

impl MergeableTrait for History {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.samples.len() > self.samples.len() { *self = other.clone(); }
        Ok(())
    }
}

// ── Space info (summary) ──────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct SpaceInfo {
    pub name:          String,
    pub tracker_count: u32,
    pub member_count:  u32,
    pub group_count:   u32,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[app::event]
pub enum Event {
    MemberJoined(String),
    TrackerCreated(String),
    TrackerUpdated(String),
    TrackerRenamed(String),
    TrackerDeleted(String),
    TrackerShared(String),
    GroupCreated(String),
    GroupUpdated(String),
    GroupDeleted(String),
    GeofenceCreated(String),
    GeofenceDeleted(String),
    GeofenceEntered(String),
    GeofenceExited(String),
    PresenceUpdated(String),
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

    pub fn rename_space(&mut self, name: String) {
        self.space_name.set(name);
    }

    pub fn join(&mut self, member_id: String, username: String, timestamp: u64) {
        if self.members.contains(&member_id).unwrap_or(false) { return; }
        let m = Member { id: member_id.clone(), username, joined_at: timestamp };
        let _ = self.members.insert(member_id.clone(), m);
        app::emit!(Event::MemberJoined(member_id));
    }

    pub fn get_members(&self) -> Vec<Member> {
        self.members.entries().unwrap().map(|(_, v)| v).collect()
    }

    // ── Trackers ────────────────────────────────────────────────────────────────

    pub fn create_tracker(&mut self, id: String, name: String, owner_id: String, created_at: u64) -> String {
        if self.trackers.contains(&id).unwrap_or(false) { return id; }
        let t = Tracker {
            id: id.clone(), name, owner_id, viewers: vec![],
            latest: None, created_at, updated_at: created_at,
        };
        let _ = self.trackers.insert(id.clone(), t);
        app::emit!(Event::TrackerCreated(id.clone()));
        id
    }

    pub fn rename_tracker(&mut self, id: String, name: String, updated_at: u64) {
        if let Ok(Some(mut t)) = self.trackers.get_mut(&id) {
            t.name = name;
            t.updated_at = updated_at;
            drop(t);
            app::emit!(Event::TrackerRenamed(id));
        }
    }

    pub fn delete_tracker(&mut self, id: String) {
        let _ = self.trackers.remove(&id);
        let _ = self.history.remove(&id);
        app::emit!(Event::TrackerDeleted(id));
    }

    /// Ingest a location update for a tracker. Validates → stores latest →
    /// appends a capped history sample → broadcasts.
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
    ) {
        let loc = Location { latitude, longitude, altitude, speed, heading, battery, timestamp };

        let mut tracker_exists = false;
        if let Ok(Some(mut t)) = self.trackers.get_mut(&tracker_id) {
            // Drop out-of-order updates.
            if pure::location_is_newer(t.latest.as_ref().map(|l| l.timestamp), timestamp) {
                t.latest = Some(loc.clone());
                t.updated_at = timestamp;
            }
            tracker_exists = true;
        }
        if !tracker_exists { return; }

        // Append to bounded history.
        let mut h = self.history.get(&tracker_id).ok().flatten().map(|v| v.clone()).unwrap_or_default();
        pure::push_capped(&mut h.samples, LocationSample { latitude, longitude, timestamp }, MAX_HISTORY);
        let _ = self.history.insert(tracker_id.clone(), h);

        app::emit!(Event::TrackerUpdated(tracker_id));
    }

    pub fn get_trackers(&self) -> Vec<Tracker> {
        self.trackers.entries().unwrap().map(|(_, v)| v).collect()
    }

    pub fn get_tracker(&self, id: String) -> Option<Tracker> {
        self.trackers.get(&id).ok().flatten().map(|v| v.clone())
    }

    // ── Sharing / permissions ─────────────────────────────────────────────────

    pub fn share_tracker(&mut self, tracker_id: String, user_id: String, updated_at: u64) {
        if let Ok(Some(mut t)) = self.trackers.get_mut(&tracker_id) {
            if !t.viewers.contains(&user_id) {
                t.viewers.push(user_id);
                t.updated_at = updated_at;
            }
            drop(t);
            app::emit!(Event::TrackerShared(tracker_id));
        }
    }

    pub fn unshare_tracker(&mut self, tracker_id: String, user_id: String, updated_at: u64) {
        if let Ok(Some(mut t)) = self.trackers.get_mut(&tracker_id) {
            t.viewers.retain(|v| v != &user_id);
            t.updated_at = updated_at;
            drop(t);
            app::emit!(Event::TrackerShared(tracker_id));
        }
    }

    // ── Groups ────────────────────────────────────────────────────────────────

    pub fn create_group(&mut self, id: String, name: String, owner_id: String, updated_at: u64) -> String {
        if self.groups.contains(&id).unwrap_or(false) { return id; }
        let g = Group {
            id: id.clone(), name, owner_id: owner_id.clone(),
            member_ids: vec![owner_id], tracker_ids: vec![], updated_at,
        };
        let _ = self.groups.insert(id.clone(), g);
        app::emit!(Event::GroupCreated(id.clone()));
        id
    }

    pub fn add_group_member(&mut self, group_id: String, member_id: String, updated_at: u64) {
        if let Ok(Some(mut g)) = self.groups.get_mut(&group_id) {
            if !g.member_ids.contains(&member_id) { g.member_ids.push(member_id); }
            g.updated_at = updated_at;
            drop(g);
            app::emit!(Event::GroupUpdated(group_id));
        }
    }

    pub fn remove_group_member(&mut self, group_id: String, member_id: String, updated_at: u64) {
        if let Ok(Some(mut g)) = self.groups.get_mut(&group_id) {
            g.member_ids.retain(|m| m != &member_id);
            g.updated_at = updated_at;
            drop(g);
            app::emit!(Event::GroupUpdated(group_id));
        }
    }

    pub fn add_tracker_to_group(&mut self, group_id: String, tracker_id: String, updated_at: u64) {
        if let Ok(Some(mut g)) = self.groups.get_mut(&group_id) {
            if !g.tracker_ids.contains(&tracker_id) { g.tracker_ids.push(tracker_id); }
            g.updated_at = updated_at;
            drop(g);
            app::emit!(Event::GroupUpdated(group_id));
        }
    }

    pub fn delete_group(&mut self, id: String) {
        let _ = self.groups.remove(&id);
        app::emit!(Event::GroupDeleted(id));
    }

    pub fn get_groups(&self) -> Vec<Group> {
        self.groups.entries().unwrap().map(|(_, v)| v).collect()
    }

    // ── Geofences ─────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn create_geofence(
        &mut self,
        id: String,
        name: String,
        center_lat: f64,
        center_lng: f64,
        radius: f64,
        created_by: String,
        created_at: u64,
    ) -> String {
        let g = Geofence { id: id.clone(), name, center_lat, center_lng, radius, created_by, created_at };
        let _ = self.geofences.insert(id.clone(), g);
        app::emit!(Event::GeofenceCreated(id.clone()));
        id
    }

    pub fn delete_geofence(&mut self, id: String) {
        let _ = self.geofences.remove(&id);
        app::emit!(Event::GeofenceDeleted(id));
    }

    pub fn get_geofences(&self) -> Vec<Geofence> {
        self.geofences.entries().unwrap().map(|(_, v)| v).collect()
    }

    /// Reported by the client's CLRegion monitor. `kind` is "enter" or "exit".
    /// The contract just validates the geofence exists and rebroadcasts.
    pub fn report_geofence_event(&mut self, geofence_id: String, kind: String) {
        if !self.geofences.contains(&geofence_id).unwrap_or(false) { return; }
        if kind == "enter" {
            app::emit!(Event::GeofenceEntered(geofence_id));
        } else if kind == "exit" {
            app::emit!(Event::GeofenceExited(geofence_id));
        }
    }

    // ── Presence ──────────────────────────────────────────────────────────────

    pub fn update_presence(&mut self, user_id: String, online: bool, last_seen: u64) {
        let p = Presence { user_id: user_id.clone(), online, last_seen };
        let _ = self.presence.insert(user_id.clone(), p);
        app::emit!(Event::PresenceUpdated(user_id));
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
