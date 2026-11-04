//! Mero Tag — distributed real-time location sharing on Calimero, on core's
//! component SDK (`calimero-sdk`).
//!
//! One app instance holds the whole sharing space (members, trackers, groups,
//! geofences, presence, and a bounded per-tracker location history). Every
//! mutating method emits an event so subscribers update live over SSE.
//!
//! # One log, no merge
//!
//! The app runs on its cluster's leader, which applies every write in one
//! replicated log, so a later write simply replaces an earlier one. The 0.x
//! contract's `#[app::mergeable]` records (last-writer-wins by timestamp with a
//! borsh tiebreak, and `History` merging by union) have nothing left to decide:
//! the records are plain serde values in `UnorderedMap`s, and the space's name
//! is a `Cell<String>`.
//!
//! # Identity, time and standing
//!
//! - **One id per person.** `env::caller()` is the account calling, and every
//!   owner, author and member id is taken from it rather than from an argument.
//! - **Writes run on the leader.** Record clocks come from the leader's
//!   `env::time_now()`, never from a phone. The one caller-supplied time left is
//!   a location fix's own `timestamp`: when the GPS took the fix, which only the
//!   phone knows.
//! - **Org standing.** `env::org_role` says whether the caller administers the
//!   app instance's organization; org admins moderate (rename the space, remove
//!   anyone's tracker, group or geofence).
//!
//! Records are plain serde, so their 64-bit fields stay JSON numbers (the iOS
//! client's wire shape); a top-level `u64` parameter (`timestamp`, `since`) is a
//! decimal string, as the SDK writes every one.

use calimero_sdk::env::{Caller, OrgRole};
use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// Keep at most this many history samples per tracker (oldest dropped first).
/// Caps state growth — the frontend decides how often to push a sample.
const MAX_HISTORY: usize = 500;

/// Rows read per page when a method walks a collection.
const BATCH: u32 = 1000;

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
        lat.is_finite()
            && lng.is_finite()
            && (-90.0..=90.0).contains(&lat)
            && (-180.0..=180.0).contains(&lng)
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

// ── Location ──────────────────────────────────────────────────────────────────

/// A location fix as the phone reported it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: f64,
    pub speed: f64,
    pub heading: f64,
    pub battery: u8,
    /// When the GPS took the fix, unix milliseconds: only the phone knows it.
    pub timestamp: u64,
}

/// A trimmed location for history playback (no battery/heading/speed).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocationSample {
    pub latitude: f64,
    pub longitude: f64,
    pub timestamp: u64,
}

// ── Records ───────────────────────────────────────────────────────────────────

/// Something whose location is shared: a phone, a tag.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tracker {
    pub id: String,
    pub name: String,
    /// The creator's account, set by the contract.
    pub owner_id: String,
    /// Member ids granted view access (owner is always implicitly allowed).
    pub viewers: Vec<String>,
    pub latest: Option<Location>,
    pub created_at: u64,
    pub updated_at: u64,
}

/// A named set of members and trackers.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub member_ids: Vec<String>,
    pub tracker_ids: Vec<String>,
    pub updated_at: u64,
}

/// A circle on the map that phones report entering and leaving.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Geofence {
    pub id: String,
    pub name: String,
    pub center_lat: f64,
    pub center_lng: f64,
    /// Radius in metres.
    pub radius: f64,
    pub created_by: String,
    pub created_at: u64,
}

/// A member's online state.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub user_id: String,
    pub online: bool,
    pub last_seen: u64,
}

/// Someone who has called `join`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub username: String,
    pub joined_at: u64,
}

/// A tracker's retained samples, oldest first, at most [`MAX_HISTORY`].
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct History {
    pub samples: Vec<LocationSample>,
}

/// The space summary.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpaceInfo {
    pub name: String,
    pub tracker_count: u32,
    pub member_count: u32,
    pub group_count: u32,
}

/// What a view tells the app about the caller: the member id this space stores
/// for them, and their standing in the organization the app instance belongs to.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    /// The caller's account — the id every record here is keyed by.
    pub member_id: String,
    /// The app instance's organization, when the caller holds a role in it.
    pub org: Option<String>,
    /// "guest" | "member" | "admin" | "owner", or `None` outside an org.
    pub org_role: Option<String>,
}

// ── State ─────────────────────────────────────────────────────────────────────

/// The sharing space.
#[app::state(version = 1)]
pub struct MeroTag {
    /// `init`'s name, then whatever an org admin renames it to.
    space_name: Cell<String>,
    /// Everyone who joined, by account.
    members: UnorderedMap<String, Member>,
    trackers: UnorderedMap<String, Tracker>,
    groups: UnorderedMap<String, Group>,
    geofences: UnorderedMap<String, Geofence>,
    /// One presence per account, written only by that account.
    presence: UnorderedMap<String, Presence>,
    /// Each tracker's bounded history, by tracker id.
    history: UnorderedMap<String, History>,
}

#[app::logic]
impl MeroTag {
    /// A new space named `name` (the iOS app passes the space's name; without
    /// one the space is unnamed until an org admin renames it).
    #[app::init]
    pub fn init(name: Option<String>) -> app::Result<Self> {
        let mut space = Self::load();
        space.space_name.set(&name.unwrap_or_default())?;
        Ok(space)
    }

    // ── Space / members ───────────────────────────────────────────────────────

    /// The space's name and counts.
    #[app::view]
    pub fn get_space(&self) -> app::Result<SpaceInfo> {
        Ok(SpaceInfo {
            name: self.space_name.get()?.unwrap_or_default(),
            tracker_count: count(self.trackers.len()?),
            member_count: count(self.members.len()?),
            group_count: count(self.groups.len()?),
        })
    }

    /// Who the caller is here: their member id and org standing.
    #[app::view]
    pub fn whoami(&self) -> app::Result<Me> {
        let me = caller()?;
        let role = env::org_role(&me);
        Ok(Me {
            org: role.and_then(|_| env::org()),
            org_role: role.map(|r| org_role_name(r).to_owned()),
            member_id: me,
        })
    }

    /// Rename the space. Org admins only (`Forbidden`) — the space is the org's.
    pub fn rename_space(&mut self, name: String) -> app::Result<()> {
        let me = caller()?;
        if !is_org_admin(&me) {
            return Err(forbidden(
                "only an admin of this organization can rename the space",
            ));
        }
        self.space_name.set(&name)?;
        Ok(())
    }

    /// Join the space as the caller's own account. Idempotent. Emits
    /// `MemberJoined` the first time.
    pub fn join(&mut self, username: String) -> app::Result<()> {
        let me = caller()?;
        if self.members.contains(&me)? {
            return Ok(());
        }
        let member = Member {
            id: me.clone(),
            username,
            joined_at: stamp_after(0),
        };
        let _ = self.members.insert(&me, &member)?;
        env::emit(Event::MemberJoined { id: me }, Audience::All)?;
        Ok(())
    }

    /// Everyone who joined, by account.
    #[app::view]
    pub fn get_members(&self) -> app::Result<Vec<Member>> {
        values(&self.members)
    }

    // ── Trackers ──────────────────────────────────────────────────────────────

    /// Create a tracker owned by the caller. Idempotent on `id`. Answers the id.
    /// Emits `TrackerCreated`.
    pub fn create_tracker(&mut self, id: String, name: String) -> app::Result<String> {
        let me = caller()?;
        if self.trackers.contains(&id)? {
            return Ok(id);
        }
        let now = stamp_after(0);
        let tracker = Tracker {
            id: id.clone(),
            name,
            owner_id: me,
            viewers: vec![],
            latest: None,
            created_at: now,
            updated_at: now,
        };
        let _ = self.trackers.insert(&id, &tracker)?;
        env::emit(Event::TrackerCreated { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Rename a tracker. Its owner or an org admin (`Forbidden`). Does nothing
    /// for an unknown id. Emits `TrackerRenamed`.
    pub fn rename_tracker(&mut self, id: String, name: String) -> app::Result<()> {
        let me = caller()?;
        let Some(mut t) = self.trackers.get(&id)? else {
            return Ok(());
        };
        if !pure::may_manage(&t.owner_id, &me, is_org_admin(&me)) {
            return Err(forbidden("only the tracker's owner can rename it"));
        }
        t.name = name;
        t.updated_at = stamp_after(t.updated_at);
        let _ = self.trackers.insert(&id, &t)?;
        env::emit(Event::TrackerRenamed { id }, Audience::All)?;
        Ok(())
    }

    /// Delete a tracker and its history. Its owner or an org admin
    /// (`Forbidden`). Emits `TrackerDeleted`.
    pub fn delete_tracker(&mut self, id: String) -> app::Result<()> {
        let me = caller()?;
        if let Some(t) = self.trackers.get(&id)? {
            if !pure::may_manage(&t.owner_id, &me, is_org_admin(&me)) {
                return Err(forbidden("only the tracker's owner can delete it"));
            }
        }
        let _ = self.trackers.remove(&id)?;
        let _ = self.history.remove(&id)?;
        env::emit(Event::TrackerDeleted { id }, Audience::All)?;
        Ok(())
    }

    /// Ingest a location fix for one of the caller's trackers. Validates →
    /// stores latest → appends a capped history sample → broadcasts.
    /// `timestamp` (a `u64`, so a decimal string on the wire) is when the fix
    /// was taken; a fix older than the stored one is kept in history only.
    ///
    /// Owner only, and not even an org admin: a location is the owner's to
    /// report, and an admin moving someone's pin would be a forged sighting.
    /// Does nothing for an unknown tracker. Emits `TrackerUpdated`.
    #[allow(clippy::too_many_arguments)]
    pub fn update_location(
        &mut self,
        tracker_id: String,
        latitude: f64,
        longitude: f64,
        altitude: f64,
        speed: f64,
        heading: f64,
        battery: u8,
        timestamp: u64,
    ) -> app::Result<()> {
        if !pure::valid_coordinates(latitude, longitude) {
            return Err(invalid("that location is not a valid latitude/longitude"));
        }
        let me = caller()?;
        let Some(mut t) = self.trackers.get(&tracker_id)? else {
            return Ok(());
        };
        if t.owner_id != me {
            return Err(forbidden(
                "only the tracker's owner can report its location",
            ));
        }
        // Drop out-of-order fixes.
        if pure::location_is_newer(t.latest.as_ref().map(|l| l.timestamp), timestamp) {
            t.latest = Some(Location {
                latitude,
                longitude,
                altitude,
                speed,
                heading,
                battery,
                timestamp,
            });
            t.updated_at = stamp_after(t.updated_at);
            let _ = self.trackers.insert(&tracker_id, &t)?;
        }

        // Append to bounded history.
        let mut h = self.history.get(&tracker_id)?.unwrap_or_default();
        pure::push_capped(
            &mut h.samples,
            LocationSample {
                latitude,
                longitude,
                timestamp,
            },
            MAX_HISTORY,
        );
        let _ = self.history.insert(&tracker_id, &h)?;

        env::emit(Event::TrackerUpdated { id: tracker_id }, Audience::All)?;
        Ok(())
    }

    /// Every tracker, by id.
    #[app::view]
    pub fn get_trackers(&self) -> app::Result<Vec<Tracker>> {
        values(&self.trackers)
    }

    /// One tracker, or `null`.
    #[app::view]
    pub fn get_tracker(&self, id: String) -> app::Result<Option<Tracker>> {
        Ok(self.trackers.get(&id)?)
    }

    // ── Sharing / permissions ─────────────────────────────────────────────────

    /// Let `userId` view a tracker. Its owner or an org admin (`Forbidden`).
    /// Emits `TrackerShared`.
    pub fn share_tracker(&mut self, tracker_id: String, user_id: String) -> app::Result<()> {
        let me = caller()?;
        let Some(mut t) = self.trackers.get(&tracker_id)? else {
            return Ok(());
        };
        if !pure::may_manage(&t.owner_id, &me, is_org_admin(&me)) {
            return Err(forbidden("only the tracker's owner can share it"));
        }
        if !t.viewers.contains(&user_id) {
            t.viewers.push(user_id);
            t.updated_at = stamp_after(t.updated_at);
            let _ = self.trackers.insert(&tracker_id, &t)?;
        }
        env::emit(Event::TrackerShared { id: tracker_id }, Audience::All)?;
        Ok(())
    }

    /// Stop `userId` viewing a tracker. Its owner or an org admin; a viewer may
    /// always take themselves off (`Forbidden` otherwise). Emits `TrackerShared`.
    pub fn unshare_tracker(&mut self, tracker_id: String, user_id: String) -> app::Result<()> {
        let me = caller()?;
        let Some(mut t) = self.trackers.get(&tracker_id)? else {
            return Ok(());
        };
        if !pure::may_manage(&t.owner_id, &me, is_org_admin(&me)) && user_id != me {
            return Err(forbidden("only the tracker's owner can unshare it"));
        }
        t.viewers.retain(|v| v != &user_id);
        t.updated_at = stamp_after(t.updated_at);
        let _ = self.trackers.insert(&tracker_id, &t)?;
        env::emit(Event::TrackerShared { id: tracker_id }, Audience::All)?;
        Ok(())
    }

    // ── Groups ────────────────────────────────────────────────────────────────

    /// Create a group owned by the caller, with the caller as its first member.
    /// Idempotent on `id`. Answers the id. Emits `GroupCreated`.
    pub fn create_group(&mut self, id: String, name: String) -> app::Result<String> {
        let me = caller()?;
        if self.groups.contains(&id)? {
            return Ok(id);
        }
        let group = Group {
            id: id.clone(),
            name,
            owner_id: me.clone(),
            member_ids: vec![me],
            tracker_ids: vec![],
            updated_at: stamp_after(0),
        };
        let _ = self.groups.insert(&id, &group)?;
        env::emit(Event::GroupCreated { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Add a member to a group. Its owner or an org admin. Emits `GroupUpdated`.
    pub fn add_group_member(&mut self, group_id: String, member_id: String) -> app::Result<()> {
        self.edit_group(&group_id, |g| {
            if !g.member_ids.contains(&member_id) {
                g.member_ids.push(member_id);
            }
        })
    }

    /// Remove a member. The group's owner (or an org admin) may remove anyone; a
    /// member may always leave. Emits `GroupUpdated`.
    pub fn remove_group_member(&mut self, group_id: String, member_id: String) -> app::Result<()> {
        if member_id == caller()? {
            let Some(mut g) = self.groups.get(&group_id)? else {
                return Ok(());
            };
            g.member_ids.retain(|m| m != &member_id);
            g.updated_at = stamp_after(g.updated_at);
            let _ = self.groups.insert(&group_id, &g)?;
            env::emit(Event::GroupUpdated { id: group_id }, Audience::All)?;
            return Ok(());
        }
        self.edit_group(&group_id, |g| g.member_ids.retain(|m| m != &member_id))
    }

    /// Add a tracker to a group. Its owner or an org admin. Emits `GroupUpdated`.
    pub fn add_tracker_to_group(
        &mut self,
        group_id: String,
        tracker_id: String,
    ) -> app::Result<()> {
        self.edit_group(&group_id, |g| {
            if !g.tracker_ids.contains(&tracker_id) {
                g.tracker_ids.push(tracker_id);
            }
        })
    }

    /// Delete a group. Its owner or an org admin (`Forbidden`). Emits
    /// `GroupDeleted`.
    pub fn delete_group(&mut self, id: String) -> app::Result<()> {
        let me = caller()?;
        if let Some(g) = self.groups.get(&id)? {
            if !pure::may_manage(&g.owner_id, &me, is_org_admin(&me)) {
                return Err(forbidden("only the group's owner can delete it"));
            }
        }
        let _ = self.groups.remove(&id)?;
        env::emit(Event::GroupDeleted { id }, Audience::All)?;
        Ok(())
    }

    /// Every group, by id.
    #[app::view]
    pub fn get_groups(&self) -> app::Result<Vec<Group>> {
        values(&self.groups)
    }

    // ── Geofences ─────────────────────────────────────────────────────────────

    /// Create a geofence, or redefine one the caller created (or any, as an org
    /// admin; `Forbidden` otherwise). `Invalid` for a place off the map or a
    /// radius that is not positive. Answers the id. Emits `GeofenceCreated`.
    pub fn create_geofence(
        &mut self,
        id: String,
        name: String,
        center_lat: f64,
        center_lng: f64,
        radius: f64,
    ) -> app::Result<String> {
        if !pure::valid_coordinates(center_lat, center_lng) {
            return Err(invalid("that place is not a valid latitude/longitude"));
        }
        if !(radius.is_finite() && radius > 0.0) {
            return Err(invalid("a geofence needs a positive radius"));
        }
        let me = caller()?;
        if let Some(existing) = self.geofences.get(&id)? {
            // Redefining someone else's place would move their alerts.
            if !pure::may_manage(&existing.created_by, &me, is_org_admin(&me)) {
                return Err(forbidden("only the geofence's creator can change it"));
            }
        }
        let geofence = Geofence {
            id: id.clone(),
            name,
            center_lat,
            center_lng,
            radius,
            created_by: me,
            created_at: stamp_after(0),
        };
        let _ = self.geofences.insert(&id, &geofence)?;
        env::emit(Event::GeofenceCreated { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Delete a geofence. Its creator or an org admin (`Forbidden`). Emits
    /// `GeofenceDeleted`.
    pub fn delete_geofence(&mut self, id: String) -> app::Result<()> {
        let me = caller()?;
        if let Some(g) = self.geofences.get(&id)? {
            if !pure::may_manage(&g.created_by, &me, is_org_admin(&me)) {
                return Err(forbidden("only the geofence's creator can delete it"));
            }
        }
        let _ = self.geofences.remove(&id)?;
        env::emit(Event::GeofenceDeleted { id }, Audience::All)?;
        Ok(())
    }

    /// Every geofence, by id.
    #[app::view]
    pub fn get_geofences(&self) -> app::Result<Vec<Geofence>> {
        values(&self.geofences)
    }

    /// Reported by the client's CLRegion monitor. `kind` is "enter" or "exit".
    /// The contract just checks the geofence exists and rebroadcasts
    /// `GeofenceEntered` / `GeofenceExited`; anything else is ignored.
    pub fn report_geofence_event(&mut self, geofence_id: String, kind: String) -> app::Result<()> {
        let _me = caller()?;
        if !self.geofences.contains(&geofence_id)? {
            return Ok(());
        }
        if kind == "enter" {
            env::emit(Event::GeofenceEntered { id: geofence_id }, Audience::All)?;
        } else if kind == "exit" {
            env::emit(Event::GeofenceExited { id: geofence_id }, Audience::All)?;
        }
        Ok(())
    }

    // ── Presence ──────────────────────────────────────────────────────────────

    /// The caller's own presence. One entry per person: with no devices in core
    /// 1.0, a member on a phone and an iPad is one presence, not two. Emits
    /// `PresenceUpdated`.
    pub fn update_presence(&mut self, online: bool) -> app::Result<()> {
        let me = caller()?;
        let previous = self.presence.get(&me)?.map_or(0, |p| p.last_seen);
        let presence = Presence {
            user_id: me.clone(),
            online,
            last_seen: stamp_after(previous),
        };
        let _ = self.presence.insert(&me, &presence)?;
        env::emit(Event::PresenceUpdated { id: me }, Audience::All)?;
        Ok(())
    }

    /// Every member's presence, by account.
    #[app::view]
    pub fn get_presence(&self) -> app::Result<Vec<Presence>> {
        values(&self.presence)
    }

    // ── History ───────────────────────────────────────────────────────────────

    /// All retained samples for a tracker (oldest → newest). `since` (unix ms,
    /// a decimal string on the wire) trims to a window; `"0"` is everything.
    #[app::view]
    pub fn get_history(&self, tracker_id: String, since: u64) -> app::Result<Vec<LocationSample>> {
        let h = self.history.get(&tracker_id)?.unwrap_or_default();
        Ok(h.samples
            .into_iter()
            .filter(|s| pure::within_window(s.timestamp, since))
            .collect())
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// Owner- (or org-admin-) gated group edit, stamped and announced. Does
    /// nothing for an unknown group.
    fn edit_group(&mut self, group_id: &str, edit: impl FnOnce(&mut Group)) -> app::Result<()> {
        let me = caller()?;
        let group_id = group_id.to_owned();
        let Some(mut g) = self.groups.get(&group_id)? else {
            return Ok(());
        };
        if !pure::may_manage(&g.owner_id, &me, is_org_admin(&me)) {
            return Err(forbidden("only the group's owner can change it"));
        }
        edit(&mut g);
        g.updated_at = stamp_after(g.updated_at);
        let _ = self.groups.insert(&group_id, &g)?;
        env::emit(Event::GroupUpdated { id: group_id }, Audience::All)?;
        Ok(())
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// The caller may not change this record.
    Forbidden { message: String },
    /// The arguments are not acceptable.
    Invalid { message: String },
}

/// A change to the space, emitted after the write that caused it. Every variant
/// carries the affected record as `id`, so the payload is `{"id":"…"}`.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Who is calling, as an account. Nothing takes an owner, author or member id
/// from an argument: a client could put anyone's name there.
fn caller() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// `who` administers the app instance's organization (admin or owner). Org
/// admins moderate the space: they may remove anyone's tracker, group or
/// geofence, the way an admin removes content in any team tool.
fn is_org_admin(who: &str) -> bool {
    env::org_role(who).is_some_and(|r| r >= OrgRole::Admin)
}

fn org_role_name(role: OrgRole) -> &'static str {
    match role {
        OrgRole::Guest => "guest",
        OrgRole::Member => "member",
        OrgRole::Admin => "admin",
        OrgRole::Owner => "owner",
    }
}

/// The leader's clock in milliseconds, never behind `after`.
fn stamp_after(after: u64) -> u64 {
    pure::monotonic_ms(env::time_now(), after)
}

/// Every value of a map, in key order, a page at a time.
fn values<V>(map: &UnorderedMap<String, V>) -> app::Result<Vec<V>>
where
    V: Serialize + serde::de::DeserializeOwned,
{
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut opts = FindOpts::default().limit(BATCH);
        if let Some(c) = cursor.take() {
            opts = opts.cursor(c);
        }
        let page = map.page(opts)?;
        out.extend(page.items.into_iter().map(|(_, v)| v));
        match page.next {
            Some(next) => cursor = Some(next),
            None => return Ok(out),
        }
    }
}

fn count(n: u64) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

fn forbidden(message: impl Into<String>) -> AppError {
    Error::Forbidden {
        message: message.into(),
    }
    .into()
}

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

// ── Tests (pure helpers — run with `cargo test`) ──────────────────────────────
//
// The contract's behaviour on the real engine is in tests/harness.rs.

#[cfg(test)]
mod tests {
    use super::pure::*;
    use super::LocationSample;

    fn sample(ts: u64) -> LocationSample {
        LocationSample {
            latitude: 0.0,
            longitude: 0.0,
            timestamp: ts,
        }
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
        assert!(location_is_newer(None, 0)); // first fix always accepted
        assert!(location_is_newer(Some(100), 100)); // equal ts accepted (idempotent)
        assert!(location_is_newer(Some(100), 101)); // newer accepted
        assert!(!location_is_newer(Some(100), 99)); // stale rejected
    }

    #[test]
    fn permissions_owner_and_viewers() {
        let viewers = vec!["bob".to_string(), "carol".to_string()];
        assert!(can_view("alice", &viewers, "alice")); // owner
        assert!(can_view("alice", &viewers, "bob")); // shared viewer
        assert!(!can_view("alice", &viewers, "mallory")); // stranger
        assert!(!can_view("alice", &[], "bob")); // not shared
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
        assert!(within_window(500, 0)); // since=0 → everything
        assert!(within_window(500, 500)); // boundary inclusive
        assert!(within_window(600, 500)); // inside window
        assert!(!within_window(400, 500)); // older than window
    }

    #[test]
    fn helpers() {
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
