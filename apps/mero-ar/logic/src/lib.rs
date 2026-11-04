//! Mero AR: collaborative spatial editing on Calimero, on core's component SDK
//! (`calimero-sdk`).
//!
//! One app instance is one room. State holds the scene graph (objects with 3D
//! transforms), members, per-member camera presence, spatial comments, advisory
//! object locks, a version counter, the room's 3D scan and the blob id of the
//! shared `ARWorldMap` used for cross-device relocalization.
//!
//! This is the 3D analogue of MeroDesign's 2D canvas: SceneObject ≈ Element,
//! Presence ≈ cursor, SpatialComment ≈ comment.
//!
//! # One log, no merge
//!
//! The app runs on its cluster's leader, which applies every write in one
//! replicated log, so a later write simply replaces an earlier one. The 0.x
//! contract's CRDT plumbing has nothing left to decide and is gone:
//!
//! | 0.x (`calimero-storage`) | here |
//! |---|---|
//! | `#[app::mergeable]` records with a version-then-timestamp LWW `merge` | plain records in `UnorderedMap`s; the leader orders the writes |
//! | `Ownable<LwwRegister<String>>` room name + the `initial_name` register | `name: Cell<String>`, set by `init` |
//! | `AccessControl` (admin tier + the `editor` role) | `owner: Cell<String>`, `admins` and `editors: Set<String>` |
//! | `LwwRegister<String>` world map, `LwwRegister<u64>` version | `Cell<String>`, `Cell<u64>` |
//! | `UnorderedMap<"current", RoomScan>` | `roomScan: Cell<RoomScan>` |
//!
//! # Identity and access
//!
//! A member IS an account (`env::caller()`), and so is every ownership record:
//! the roster, an object's author, a lock holder, a comment's author, the room's
//! admins and owner. The organization decides who reaches the room; inside it:
//!
//! - **admin**: the room's owner (the app's owner at `init`) and whoever the
//!   owner hands the room to. Grants and revokes the editor role.
//! - **editor**: an explicit grant. May place, move, recolour, lock and delete
//!   objects, pin notes and publish the world map and the room scan.
//! - **viewer**: everyone else. May `join`, rename themselves and publish their
//!   camera pose.
//! - An **admin or owner of the app's organization** passes every editor and
//!   admin gate (clear the scene or the scan, break locks, remove comments).
//!   Granting roles and ownership stay with the room's own admins.
//!
//! Every record clock (`updatedAt`, `createdAt`, `joinedAt`, `scannedAt`) comes
//! from the leader's clock (`env::time_now()`), never from a phone.
//!
//! Records are plain serde, so their 64-bit fields stay JSON numbers (the iOS
//! client's wire shape); a top-level `u64` parameter or result is a decimal
//! string, as the SDK writes every one.

use calimero_sdk::env::{Caller, OrgRole};
use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// Rows read per page when a method walks a collection.
const BATCH: u32 = 1000;

const ROLE_ADMIN: &str = "admin";
const ROLE_EDITOR: &str = "editor";
const ROLE_VIEWER: &str = "viewer";

// ── Pure helpers (unit-testable without the runtime) ──────────────────────────

pub mod pure {
    /// How an incoming scene-object clock orders against the current one:
    /// version first, timestamp as the tiebreak.
    pub fn clock_cmp(
        cur_version: u64,
        cur_ts: u64,
        inc_version: u64,
        inc_ts: u64,
    ) -> ::core::cmp::Ordering {
        (inc_version, inc_ts).cmp(&(cur_version, cur_ts))
    }

    /// LWW for scene objects: an incoming edit replaces the current one if it
    /// has a higher version, or an equal version with a newer timestamp.
    pub fn should_replace(cur_version: u64, cur_ts: u64, inc_version: u64, inc_ts: u64) -> bool {
        clock_cmp(cur_version, cur_ts, inc_version, inc_ts) == ::core::cmp::Ordering::Greater
    }

    /// Squared distance between two 3D points (cheap; avoids sqrt for comparisons).
    pub fn dist_sq(ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64) -> f64 {
        let (dx, dy, dz) = (ax - bx, ay - by, az - bz);
        dx * dx + dy * dy + dz * dz
    }

    /// An object may be edited if it's unlocked, or locked by the editor
    /// themselves. Edits by anyone else are rejected.
    pub fn can_edit(locked_by: Option<&str>, editor: &str) -> bool {
        match locked_by {
            None => true,
            Some(holder) => holder == editor,
        }
    }

    /// A lock may be released by its holder, or broken by an admin — otherwise a
    /// member who leaves mid-edit wedges the object for good.
    pub fn may_unlock(locked_by: Option<&str>, caller: &str, is_admin: bool) -> bool {
        is_admin || locked_by == Some(caller)
    }

    /// A comment may be deleted by its author or by an admin.
    pub fn may_delete_comment(author: &str, caller: &str, is_admin: bool) -> bool {
        is_admin || author == caller
    }

    /// The largest side a room scan may report, in metres. RoomPlan scans one
    /// room at a time; anything beyond this is a corrupted or hostile record.
    pub const MAX_SCAN_SIDE_M: f64 = 60.0;

    /// A room scan's dimensions are finite, positive and of room size.
    pub fn validate_scan_dimensions(
        width: f64,
        length: f64,
        height: f64,
    ) -> Result<(), &'static str> {
        for side in [width, length, height] {
            if !side.is_finite() || side <= 0.0 {
                return Err("room scan dimensions must be positive numbers");
            }
            if side > MAX_SCAN_SIDE_M {
                return Err("room scan dimensions are larger than a room");
            }
        }
        Ok(())
    }

    /// The longest furniture item name the room accepts.
    pub const MAX_FURNITURE_ITEM_LEN: usize = 32;

    /// A furniture item names a catalogue entry: non-empty, short.
    pub fn validate_furniture_item(item: &str) -> Result<(), &'static str> {
        if item.trim().is_empty() {
            return Err("a furniture object needs an item");
        }
        if item.len() > MAX_FURNITURE_ITEM_LEN {
            return Err("that furniture item name is too long");
        }
        Ok(())
    }

    /// A record clock: `now_ms`, unless that would not move past `after` (a new
    /// leader whose wall clock trails the old one's), then one past `after`.
    pub fn monotonic_ms(now_ms: u64, after: u64) -> u64 {
        now_ms.max(after.saturating_add(1))
    }

    /// The version a newly published scan gets: one past the scan it replaces.
    pub fn next_scan_version(current: Option<u64>) -> u64 {
        current.map_or(1, |v| v.saturating_add(1))
    }
}

// ── Geometry ──────────────────────────────────────────────────────────────────

/// A point or a scale, in metres.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// A rotation as a unit quaternion.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Quat {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
}

impl Default for Quat {
    fn default() -> Self {
        Quat {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            w: 1.0,
        }
    }
}

/// Where an object is, how it is turned and how big it is.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Transform {
    pub position: Vec3,
    pub rotation: Quat,
    pub scale: Vec3,
}

impl Default for Transform {
    fn default() -> Self {
        Transform {
            position: Vec3::default(),
            rotation: Quat::default(),
            scale: Vec3 {
                x: 1.0,
                y: 1.0,
                z: 1.0,
            },
        }
    }
}

// ── Object data (kind-tagged, lowercase to match ARKit/frontend) ──────────────

/// What an object is, as a JSON object tagged by `kind`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
#[serde(tag = "kind")]
pub enum ObjectData {
    Cube,
    Sphere,
    Arrow,
    Marker,
    Text {
        content: String,
    },
    Image {
        #[serde(rename = "blobId", default, skip_serializing_if = "String::is_empty")]
        blob_id: String,
        #[serde(rename = "naturalWidth", default)]
        natural_width: u32,
        #[serde(rename = "naturalHeight", default)]
        natural_height: u32,
    },
    /// A piece of furniture from the app's catalogue (`sofa`, `tv`, `picture`…),
    /// drawn by the client at real size.
    Furniture {
        item: String,
    },
}

// ── Records ───────────────────────────────────────────────────────────────────

/// One object in the scene.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneObject {
    /// Chosen by the caller; use a fresh UUID.
    pub id: String,
    pub data: ObjectData,
    pub transform: Transform,
    pub color: String,
    /// The account holding the advisory lock. Cleared on `addObject`.
    pub locked_by: Option<String>,
    /// The creator's account, set by the contract; the value sent is ignored.
    pub created_by: String,
    /// Unix milliseconds, the leader's clock; the value sent is ignored.
    pub created_at: u64,
    /// Unix milliseconds, the leader's clock; the value sent is ignored.
    pub updated_at: u64,
    /// The room's version counter at the object's last change.
    pub version: u64,
}

/// Someone who has called `join`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    /// The member's account.
    pub id: String,
    pub username: String,
    pub avatar: Option<String>,
    /// Unix milliseconds, the leader's clock.
    pub joined_at: u64,
}

/// A member's camera pose.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    /// The viewpoint's key. Core 1.0 has no devices, so this is the member's
    /// account, the same as `member`; kept so the wire shape is unchanged.
    pub identity: String,
    /// The member whose camera this is.
    pub member: String,
    pub camera_position: Vec3,
    pub camera_rotation: Quat,
    pub updated_at: u64,
}

/// A note pinned in space.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpatialComment {
    pub id: String,
    pub text: String,
    pub position: Vec3,
    /// The writer's account, set by the contract.
    pub author: String,
    pub created_at: u64,
}

/// The room's current 3D scan: a RoomPlan `CapturedRoom` as JSON (walls,
/// doors, windows, openings, furniture with categories, sizes and transforms),
/// plus optionally the parametric USDZ RoomPlan export. Both are blobs of the
/// app instance; this record names them. One current scan per room: a new one
/// replaces it and bumps `version`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoomScan {
    /// Blob id of the `CapturedRoom` JSON — the shared model every client renders.
    pub json_blob: String,
    pub json_size: u64,
    /// Blob id of the USDZ export, when the scanner made one.
    pub usdz_blob: Option<String>,
    pub usdz_size: Option<u64>,
    /// Floor extent and wall height, in metres.
    pub width: f64,
    pub length: f64,
    pub height: f64,
    /// Detected furniture and fixtures in the scan.
    pub object_count: u32,
    /// A built-in sample room rather than a real scan (the Simulator and demos
    /// use one); clients label it as such.
    pub sample: bool,
    pub scanned_by: String,
    pub scanned_at: u64,
    pub version: u64,
}

/// The room summary.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub name: String,
    pub object_count: u32,
    pub member_count: u32,
    pub world_map_blob: String,
    pub version: u64,
    /// The room owner's account.
    pub owner: Option<String>,
}

/// A member with their effective role — the roster the members sheet renders.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemberRole {
    pub member: String,
    /// "admin" | "editor" | "viewer"
    pub role: String,
}

// ── State ─────────────────────────────────────────────────────────────────────

/// The room.
#[app::state(version = 1)]
pub struct MeroAR {
    /// The room's name: `init`'s argument, then whatever the owner renames it to.
    name: Cell<String>,
    /// The room's owner: the app's owner at `init`, then whoever it is handed to.
    owner: Cell<String>,
    /// Room admins: the owner, by grant of a transfer. Never empty.
    admins: Set<String>,
    /// Accounts granted the editor role.
    editors: Set<String>,
    /// Blob id of the shared `ARWorldMap` every device relocalizes against;
    /// empty until an editor publishes one.
    world_map_blob: Cell<String>,
    /// Bumped by every object write; an object records it as its `version`.
    version: Cell<u64>,
    objects: UnorderedMap<String, SceneObject>,
    /// Everyone who joined, by account; each entry written only by its account.
    members: UnorderedMap<String, Member>,
    /// One camera pose per account, written only by that account.
    presence: UnorderedMap<String, Presence>,
    comments: UnorderedMap<String, SpatialComment>,
    /// The room's current 3D scan.
    room_scan: Cell<RoomScan>,
}

#[app::logic]
impl MeroAR {
    /// A new room named `name` (the iOS app passes the room's name; without one
    /// the room is unnamed until the owner renames it). The app's owner becomes
    /// the room's owner and only admin.
    #[app::init]
    pub fn init(name: Option<String>) -> app::Result<Self> {
        let mut room = Self::load();
        let owner = env::app_owner();
        room.name.set(&name.unwrap_or_default())?;
        room.owner.set(&owner)?;
        room.world_map_blob.set(&String::new())?;
        room.version.set(&0)?;
        let _new = room.admins.insert(&owner)?;
        Ok(room)
    }

    // ── Roles ─────────────────────────────────────────────────────────────────

    /// Grant a member the editor role. Room admin only (`Forbidden`); `Invalid`
    /// when `member` is not an account of the room's organization (they need not
    /// have joined yet). Emits `RoleUpdated`.
    pub fn grant_editor(&mut self, member: String) -> app::Result<()> {
        self.require_room_admin()?;
        require_account(&member)?;
        let _new = self.editors.insert(&member)?;
        env::emit(Event::RoleUpdated { id: member }, Audience::All)?;
        Ok(())
    }

    /// Revoke a member's editor role (downgrade to viewer). Room admin only.
    /// Emits `RoleUpdated`.
    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        self.require_room_admin()?;
        let _was = self.editors.remove(&member)?;
        env::emit(Event::RoleUpdated { id: member }, Audience::All)?;
        Ok(())
    }

    /// Effective room role of a member: "admin", "editor", or "viewer". Anything
    /// that names nobody is a viewer.
    #[app::view]
    pub fn get_role(&self, member: String) -> app::Result<String> {
        self.role_label(&member)
    }

    /// The caller's own account, so a client can mark "you" in the roster and
    /// recognise itself as the room's owner.
    #[app::view]
    pub fn whoami(&self) -> app::Result<String> {
        caller()
    }

    /// Effective role of the caller — what the app's edit gate reads. An org
    /// admin reads as "admin" here, since they pass every admin gate.
    #[app::view]
    pub fn my_role(&self) -> app::Result<String> {
        let me = caller()?;
        if is_org_admin(&me) {
            return Ok(ROLE_ADMIN.to_owned());
        }
        self.role_label(&me)
    }

    /// Whether the caller may change the scene.
    #[app::view]
    pub fn can_edit(&self) -> app::Result<bool> {
        self.is_editor(&caller()?)
    }

    /// Every member with their effective room role, for the members sheet.
    #[app::view]
    pub fn list_roles(&self) -> app::Result<Vec<MemberRole>> {
        all(&self.members)?
            .into_iter()
            .map(|(member, _)| {
                Ok(MemberRole {
                    role: self.role_label(&member)?,
                    member,
                })
            })
            .collect()
    }

    /// Hand the room (and its name) to another account of the organization: it
    /// becomes owner and admin, and the caller stops being admin. Owner only
    /// (`Forbidden`); `Invalid` when `newOwner` is not an account of the room's
    /// organization. Emits `OwnerTransferred`.
    pub fn transfer_ownership(&mut self, new_owner: String) -> app::Result<()> {
        let previous = self.require_owner()?;
        require_account(&new_owner)?;
        self.owner.set(&new_owner)?;
        let _new = self.admins.insert(&new_owner)?;
        if previous != new_owner {
            let _was = self.admins.remove(&previous)?;
        }
        env::emit(Event::OwnerTransferred { id: new_owner }, Audience::All)?;
        Ok(())
    }

    // ── Room ──────────────────────────────────────────────────────────────────

    /// The room's name, counts, world map, version and owner.
    #[app::view]
    pub fn get_room(&self) -> app::Result<RoomInfo> {
        Ok(RoomInfo {
            name: self.name.get()?.unwrap_or_default(),
            object_count: count(self.objects.len()?),
            member_count: count(self.members.len()?),
            world_map_blob: self.world_map_blob.get()?.unwrap_or_default(),
            version: self.version.get()?.unwrap_or_default(),
            owner: self.owner.get()?,
        })
    }

    /// Rename the room. Owner only (`Forbidden`). Emits `RoomUpdated`.
    pub fn rename_room(&mut self, name: String) -> app::Result<()> {
        self.require_owner()?;
        self.name.set(&name)?;
        env::emit(Event::RoomUpdated, Audience::All)?;
        Ok(())
    }

    /// Store the blob id of the shared ARWorldMap, uploaded to the app instance,
    /// so every member can download it for relocalization. Editors only: a
    /// viewer's scan must not redefine where everyone else's objects are
    /// anchored. Emits `AnchorsUpdated`.
    pub fn set_world_map(&mut self, blob_id: String) -> app::Result<()> {
        self.require_editor()?;
        self.world_map_blob.set(&blob_id)?;
        env::emit(Event::AnchorsUpdated, Audience::All)?;
        Ok(())
    }

    // ── Room scan ─────────────────────────────────────────────────────────────

    /// Publish the room's 3D scan: the `CapturedRoom` JSON blob (required) and
    /// optionally the USDZ export, both uploaded to the app instance's blobs
    /// (`/apps/{app}/blobs`) first. Replaces the current scan and returns the new
    /// version. Editors only. Emits `RoomScanUpdated`.
    #[allow(clippy::too_many_arguments)]
    pub fn set_room_scan(
        &mut self,
        json_blob: String,
        json_size: u64,
        usdz_blob: Option<String>,
        usdz_size: Option<u64>,
        width: f64,
        length: f64,
        height: f64,
        object_count: u32,
        sample: bool,
    ) -> app::Result<u64> {
        let me = self.require_editor()?;
        if json_blob.trim().is_empty() {
            return Err(invalid("a room scan needs its CapturedRoom JSON blob"));
        }
        if let Err(reason) = pure::validate_scan_dimensions(width, length, height) {
            return Err(invalid(reason));
        }
        let current = self.room_scan.get()?.map(|s| (s.version, s.scanned_at));
        let version = pure::next_scan_version(current.map(|(v, _)| v));
        let scanned_at = stamp_after(current.map_or(0, |(_, at)| at));
        let scan = RoomScan {
            json_blob,
            json_size,
            usdz_blob,
            usdz_size,
            width,
            length,
            height,
            object_count,
            sample,
            scanned_by: me,
            scanned_at,
            version,
        };
        self.room_scan.set(&scan)?;
        env::emit(
            Event::RoomScanUpdated {
                id: version.to_string(),
            },
            Audience::All,
        )?;
        Ok(version)
    }

    /// The room's current 3D scan, if one has been published.
    #[app::view]
    pub fn get_room_scan(&self) -> app::Result<Option<RoomScan>> {
        Ok(self.room_scan.get()?)
    }

    /// Remove the room's scan. Admin only: it takes the 3D room away from
    /// everyone. The blobs stay where they are; nothing names them any more.
    /// Emits `RoomScanUpdated` with id `"0"`.
    pub fn clear_room_scan(&mut self) -> app::Result<()> {
        self.require_admin()?;
        self.room_scan.clear()?;
        env::emit(Event::RoomScanUpdated { id: "0".to_owned() }, Audience::All)?;
        Ok(())
    }

    // ── Members ───────────────────────────────────────────────────────────────

    /// Enter the room under `username`. The member id is the caller's account, so
    /// a client can only ever create its own entry. Does nothing if the caller
    /// has already joined (`updateMemberUsername` renames). Emits `MemberJoined`.
    pub fn join(&mut self, username: String, avatar: Option<String>) -> app::Result<()> {
        let me = caller()?;
        if self.members.contains(&me)? {
            return Ok(());
        }
        let member = Member {
            id: me.clone(),
            username,
            avatar,
            joined_at: stamp_after(0),
        };
        let _ = self.members.insert(&me, &member)?;
        env::emit(Event::MemberJoined { id: me }, Audience::All)?;
        Ok(())
    }

    /// Everyone who has joined, by account.
    #[app::view]
    pub fn get_members(&self) -> app::Result<Vec<Member>> {
        Ok(all(&self.members)?.into_iter().map(|(_, m)| m).collect())
    }

    /// Rename the caller's own member entry — never anyone else's. Does nothing
    /// if the caller has not joined. Emits `MemberJoined`.
    pub fn update_member_username(&mut self, username: String) -> app::Result<()> {
        let me = caller()?;
        let Some(mut member) = self.members.get(&me)? else {
            return Ok(());
        };
        member.username = username;
        let _ = self.members.insert(&me, &member)?;
        env::emit(Event::MemberJoined { id: me }, Audience::All)?;
        Ok(())
    }

    // ── Objects ───────────────────────────────────────────────────────────────

    /// Place an object, or replace the object with the same `id`. Editors only.
    /// `createdBy`, `createdAt`, `updatedAt`, `version` and `lockedBy` are set by
    /// the contract, so what a client sends for them is ignored. Answers the id.
    /// Emits `ObjectAdded`.
    pub fn add_object(&mut self, object: SceneObject) -> app::Result<String> {
        let me = self.require_editor()?;
        if let ObjectData::Furniture { item } = &object.data {
            if let Err(reason) = pure::validate_furniture_item(item) {
                return Err(invalid(reason));
            }
        }
        let mut object = object;
        let id = object.id.clone();
        object.created_by = me;
        let now = stamp_after(0);
        object.created_at = now;
        object.updated_at = now;
        // A client cannot pre-lock an object for someone else on the way in.
        object.locked_by = None;
        object.version = self.bump_version()?;
        let _ = self.objects.insert(&id, &object)?;
        env::emit(Event::ObjectAdded { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Move/rotate/scale an object. Editors only. Does nothing if the object is
    /// absent or locked by someone other than the caller. Emits `ObjectUpdated`.
    pub fn update_transform(&mut self, id: String, transform: Transform) -> app::Result<()> {
        let editor = self.require_editor()?;
        let next = self.bump_version()?;
        let Some(mut obj) = self.objects.get(&id)? else {
            return Ok(());
        };
        if !pure::can_edit(obj.locked_by.as_deref(), &editor) {
            return Ok(());
        }
        let updated_at = stamp_after(obj.updated_at);
        if !pure::should_replace(obj.version, obj.updated_at, next, updated_at) {
            return Ok(());
        }
        obj.transform = transform;
        obj.updated_at = updated_at;
        obj.version = next;
        let _ = self.objects.insert(&id, &obj)?;
        env::emit(Event::ObjectUpdated { id }, Audience::All)?;
        Ok(())
    }

    /// Recolor an object. Honours the advisory lock exactly like
    /// `updateTransform` — a lock has to hold for every field, or it only
    /// protects position. Emits `ObjectUpdated`.
    pub fn update_color(&mut self, id: String, color: String) -> app::Result<()> {
        let editor = self.require_editor()?;
        let next = self.bump_version()?;
        let Some(mut obj) = self.objects.get(&id)? else {
            return Ok(());
        };
        if !pure::can_edit(obj.locked_by.as_deref(), &editor) {
            return Ok(());
        }
        obj.color = color;
        obj.updated_at = stamp_after(obj.updated_at);
        obj.version = next;
        let _ = self.objects.insert(&id, &obj)?;
        env::emit(Event::ObjectUpdated { id }, Audience::All)?;
        Ok(())
    }

    /// Take the advisory lock on an unlocked object, in the caller's own name.
    /// Editors only. Emits `ObjectLocked`.
    pub fn lock_object(&mut self, id: String) -> app::Result<()> {
        let by = self.require_editor()?;
        let next = self.bump_version()?;
        let Some(mut obj) = self.objects.get(&id)? else {
            return Ok(());
        };
        if obj.locked_by.is_none() {
            obj.locked_by = Some(by);
            obj.version = next;
            let _ = self.objects.insert(&id, &obj)?;
            env::emit(Event::ObjectLocked { id }, Audience::All)?;
        }
        Ok(())
    }

    /// Release a lock the caller holds. An admin (room or org) may break any
    /// lock, so a member who leaves mid-edit can't wedge an object permanently.
    /// Emits `ObjectUnlocked`.
    pub fn unlock_object(&mut self, id: String) -> app::Result<()> {
        let by = self.require_editor()?;
        let is_admin = self.is_admin(&by)?;
        let next = self.bump_version()?;
        let Some(mut obj) = self.objects.get(&id)? else {
            return Ok(());
        };
        if pure::may_unlock(obj.locked_by.as_deref(), &by, is_admin) {
            obj.locked_by = None;
            obj.version = next;
            let _ = self.objects.insert(&id, &obj)?;
            env::emit(Event::ObjectUnlocked { id }, Audience::All)?;
        }
        Ok(())
    }

    /// Delete an object. Honours the advisory lock — deleting what someone else
    /// has locked is the most destructive way to ignore it. Emits `ObjectDeleted`.
    pub fn delete_object(&mut self, id: String) -> app::Result<()> {
        let editor = self.require_editor()?;
        if let Some(obj) = self.objects.get(&id)? {
            if !pure::can_edit(obj.locked_by.as_deref(), &editor) {
                return Ok(());
            }
        }
        let _ = self.objects.remove(&id)?;
        env::emit(Event::ObjectDeleted { id }, Audience::All)?;
        Ok(())
    }

    /// Clear the whole scene. Admin only. Emits `ObjectDeleted` for each object.
    pub fn clear_objects(&mut self) -> app::Result<()> {
        self.require_admin()?;
        let ids: Vec<String> = all(&self.objects)?.into_iter().map(|(k, _)| k).collect();
        let _ = self.objects.clear()?;
        for id in ids {
            env::emit(Event::ObjectDeleted { id }, Audience::All)?;
        }
        Ok(())
    }

    /// Every object in the scene, by id.
    #[app::view]
    pub fn get_objects(&self) -> app::Result<Vec<SceneObject>> {
        Ok(all(&self.objects)?.into_iter().map(|(_, o)| o).collect())
    }

    /// One object, or `null`.
    #[app::view]
    pub fn get_object(&self, id: String) -> app::Result<Option<SceneObject>> {
        Ok(self.objects.get(&id)?)
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    /// Pin a note in space. Editors only. The author is the caller, so a member
    /// cannot attribute a comment to someone else. Emits `CommentAdded`.
    pub fn add_comment(&mut self, id: String, text: String, position: Vec3) -> app::Result<()> {
        let author = self.require_editor()?;
        let comment = SpatialComment {
            id: id.clone(),
            text,
            position,
            author,
            created_at: stamp_after(0),
        };
        let _ = self.comments.insert(&id, &comment)?;
        env::emit(Event::CommentAdded { id }, Audience::All)?;
        Ok(())
    }

    /// Delete a comment. Editors only; the author may delete their own, an admin
    /// any (`Forbidden` otherwise). Emits `CommentDeleted`.
    pub fn delete_comment(&mut self, id: String) -> app::Result<()> {
        let me = self.require_editor()?;
        let is_admin = self.is_admin(&me)?;
        if let Some(c) = self.comments.get(&id)? {
            if !pure::may_delete_comment(&c.author, &me, is_admin) {
                return Err(forbidden(
                    "only the comment's author or an admin can delete it",
                ));
            }
        }
        let _ = self.comments.remove(&id)?;
        env::emit(Event::CommentDeleted { id }, Audience::All)?;
        Ok(())
    }

    /// Every note, by id.
    #[app::view]
    pub fn get_comments(&self) -> app::Result<Vec<SpatialComment>> {
        Ok(all(&self.comments)?.into_iter().map(|(_, c)| c).collect())
    }

    // ── Presence ──────────────────────────────────────────────────────────────

    /// Publish the caller's camera pose. Open to viewers — being in the room is
    /// not an edit — and keyed by the caller's account, so nobody can puppet
    /// another viewpoint. One camera per member. Emits `PresenceUpdated`.
    pub fn update_presence(
        &mut self,
        camera_position: Vec3,
        camera_rotation: Quat,
    ) -> app::Result<()> {
        let me = caller()?;
        let previous = self.presence.get(&me)?.map_or(0, |p| p.updated_at);
        let pose = Presence {
            identity: me.clone(),
            member: me.clone(),
            camera_position,
            camera_rotation,
            updated_at: stamp_after(previous),
        };
        let _ = self.presence.insert(&me, &pose)?;
        env::emit(Event::PresenceUpdated { id: me }, Audience::All)?;
        Ok(())
    }

    /// Every member's last camera pose, by account.
    #[app::view]
    pub fn get_presence(&self) -> app::Result<Vec<Presence>> {
        Ok(all(&self.presence)?.into_iter().map(|(_, p)| p).collect())
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    fn bump_version(&mut self) -> app::Result<u64> {
        let next = self.version.get()?.unwrap_or_default().wrapping_add(1);
        self.version.set(&next)?;
        Ok(next)
    }

    fn require_owner(&self) -> app::Result<String> {
        let me = caller()?;
        if self.owner.get()?.as_deref() != Some(me.as_str()) {
            return Err(forbidden("only the room's owner can do this"));
        }
        Ok(me)
    }

    /// A room admin: granting roles stays with the room's own admins.
    fn require_room_admin(&self) -> app::Result<String> {
        let me = caller()?;
        if !self.admins.contains(&me)? {
            return Err(forbidden("admin access is required for this operation"));
        }
        Ok(me)
    }

    /// A room admin or an org admin: destructive room-level operations.
    fn require_admin(&self) -> app::Result<String> {
        let me = caller()?;
        if !self.is_admin(&me)? {
            return Err(forbidden("admin access is required for this operation"));
        }
        Ok(me)
    }

    /// Gate a scene mutation. Viewers can look around and be present, but not
    /// place, move, or delete anything.
    fn require_editor(&self) -> app::Result<String> {
        let me = caller()?;
        if !self.is_editor(&me)? {
            return Err(forbidden(
                "view-only: editor or admin access is required to change this room",
            ));
        }
        Ok(me)
    }

    fn is_admin(&self, who: &str) -> app::Result<bool> {
        Ok(is_org_admin(who) || self.admins.contains(&who.to_owned())?)
    }

    fn is_editor(&self, who: &str) -> app::Result<bool> {
        let who = who.to_owned();
        Ok(is_org_admin(&who) || self.admins.contains(&who)? || self.editors.contains(&who)?)
    }

    /// The room role, without the org: what the roster shows.
    fn role_label(&self, who: &str) -> app::Result<String> {
        let who = who.to_owned();
        let label = if self.admins.contains(&who)? {
            ROLE_ADMIN
        } else if self.editors.contains(&who)? {
            ROLE_EDITOR
        } else {
            ROLE_VIEWER
        };
        Ok(label.to_owned())
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire.
#[app::error]
pub enum Error {
    /// The caller's role does not allow this.
    Forbidden { message: String },
    /// The arguments are not acceptable.
    Invalid { message: String },
}

/// A change to the room, emitted after the write that caused it. Every variant
/// that names a record carries it as `id`, so the payload is `{"id":"…"}`.
#[app::event]
pub enum Event {
    ObjectAdded {
        id: String,
    },
    ObjectUpdated {
        id: String,
    },
    ObjectDeleted {
        id: String,
    },
    ObjectLocked {
        id: String,
    },
    ObjectUnlocked {
        id: String,
    },
    CommentAdded {
        id: String,
    },
    CommentDeleted {
        id: String,
    },
    /// `id` is the member whose camera moved.
    PresenceUpdated {
        id: String,
    },
    MemberJoined {
        id: String,
    },
    AnchorsUpdated,
    RoomUpdated,
    /// A member's role changed — clients re-resolve `myRole` on this.
    RoleUpdated {
        id: String,
    },
    OwnerTransferred {
        id: String,
    },
    /// The room's 3D scan was published or cleared; `id` is its version ("0"
    /// when cleared). Clients re-read `getRoomScan`.
    RoomScanUpdated {
        id: String,
    },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Who is calling, as an account. Never trust a client-supplied id.
fn caller() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// `who` administers the app's organization (admin or owner).
fn is_org_admin(who: &str) -> bool {
    env::org_role(who).is_some_and(|r| r >= OrgRole::Admin)
}

/// `account` is the app's owner or holds a role in its organization: a role can
/// be granted to someone before they have ever opened the room.
fn require_account(account: &str) -> app::Result<()> {
    if account == env::app_owner() || env::org_role(account).is_some() {
        return Ok(());
    }
    Err(invalid(format!(
        "not an account of this room's organization: {account}"
    )))
}

/// The leader's clock in milliseconds, never behind `after`.
fn stamp_after(after: u64) -> u64 {
    pure::monotonic_ms(env::time_now(), after)
}

/// Every entry of a map, in key order, a page at a time.
fn all<V>(map: &UnorderedMap<String, V>) -> app::Result<Vec<(String, V)>>
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
        out.extend(page.items);
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

// ── Tests of the pure helpers ─────────────────────────────────────────────────
//
// The contract's behaviour on the real engine is in tests/harness.rs.

#[cfg(test)]
mod tests {
    use super::pure::*;

    #[test]
    fn higher_version_replaces() {
        assert!(should_replace(1, 100, 2, 50));
    }

    #[test]
    fn equal_version_newer_ts_replaces() {
        assert!(should_replace(2, 100, 2, 150));
    }

    #[test]
    fn equal_version_older_ts_rejected() {
        assert!(!should_replace(2, 100, 2, 50));
    }

    #[test]
    fn lower_version_rejected() {
        assert!(!should_replace(3, 10, 2, 9999));
    }

    #[test]
    fn furniture_item_must_be_named() {
        assert!(validate_furniture_item("sofa").is_ok());
        assert!(validate_furniture_item("").is_err());
        assert!(validate_furniture_item("   ").is_err());
        assert!(validate_furniture_item(&"x".repeat(MAX_FURNITURE_ITEM_LEN)).is_ok());
        assert!(validate_furniture_item(&"x".repeat(MAX_FURNITURE_ITEM_LEN + 1)).is_err());
    }

    #[test]
    fn furniture_wire_shape() {
        let data = super::ObjectData::Furniture {
            item: "sofa".to_owned(),
        };
        let json = serde_json::to_string(&data).unwrap();
        assert_eq!(json, r#"{"kind":"furniture","item":"sofa"}"#);
        let back: super::ObjectData = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, super::ObjectData::Furniture { item } if item == "sofa"));
    }

    #[test]
    fn dist_sq_basic() {
        assert_eq!(dist_sq(0.0, 0.0, 0.0, 3.0, 4.0, 0.0), 25.0);
        assert_eq!(dist_sq(1.0, 1.0, 1.0, 1.0, 1.0, 1.0), 0.0);
    }

    #[test]
    fn can_edit_unlocked() {
        assert!(can_edit(None, "alice"));
    }

    #[test]
    fn can_edit_own_lock() {
        assert!(can_edit(Some("alice"), "alice"));
    }

    #[test]
    fn cannot_edit_others_lock() {
        assert!(!can_edit(Some("bob"), "alice"));
    }

    #[test]
    fn holder_may_unlock() {
        assert!(may_unlock(Some("alice"), "alice", false));
    }

    #[test]
    fn non_holder_may_not_unlock() {
        assert!(!may_unlock(Some("bob"), "alice", false));
    }

    #[test]
    fn admin_breaks_any_lock() {
        assert!(may_unlock(Some("bob"), "alice", true));
    }

    #[test]
    fn a_room_sized_scan_is_valid() {
        assert!(validate_scan_dimensions(5.2, 4.1, 2.6).is_ok());
    }

    #[test]
    fn scan_dimensions_must_be_positive_and_finite() {
        assert!(validate_scan_dimensions(0.0, 4.0, 2.5).is_err());
        assert!(validate_scan_dimensions(5.0, -1.0, 2.5).is_err());
        assert!(validate_scan_dimensions(5.0, 4.0, f64::NAN).is_err());
        assert!(validate_scan_dimensions(f64::INFINITY, 4.0, 2.5).is_err());
    }

    #[test]
    fn a_scan_bigger_than_a_room_is_refused() {
        assert!(validate_scan_dimensions(MAX_SCAN_SIDE_M + 0.1, 4.0, 2.5).is_err());
        assert!(validate_scan_dimensions(MAX_SCAN_SIDE_M, 4.0, 2.5).is_ok());
    }

    #[test]
    fn the_first_scan_is_version_one_and_each_replacement_bumps_it() {
        assert_eq!(next_scan_version(None), 1);
        assert_eq!(next_scan_version(Some(1)), 2);
        assert_eq!(next_scan_version(Some(u64::MAX)), u64::MAX);
    }

    #[test]
    fn unlocking_an_unlocked_object_is_allowed_for_holderless() {
        // No holder → nothing to protect; the call is a no-op either way.
        assert!(may_unlock(None, "alice", true));
        assert!(!may_unlock(None, "alice", false));
    }

    #[test]
    fn author_may_delete_own_comment() {
        assert!(may_delete_comment("alice", "alice", false));
    }

    #[test]
    fn stranger_may_not_delete_comment() {
        assert!(!may_delete_comment("alice", "bob", false));
    }

    #[test]
    fn admin_may_delete_any_comment() {
        assert!(may_delete_comment("alice", "bob", true));
    }

    #[test]
    fn monotonic_clock_never_goes_back() {
        assert_eq!(monotonic_ms(100, 0), 100);
        assert_eq!(monotonic_ms(100, 200), 201);
    }
}
