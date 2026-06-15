//! Mero AR — collaborative spatial editing on Calimero.
//!
//! One context = one room. State holds the scene graph (objects with 3D
//! transforms), members, per-user camera presence, spatial comments, advisory
//! object locks, a monotonic version counter, and a blob ref to the shared
//! `ARWorldMap` used for cross-device relocalization.
//!
//! This is the 3D analogue of the MeroDesign 2D canvas contract: SceneObject ≈
//! Element, Presence ≈ cursor, SpatialComment ≈ comment. Conflict resolution is
//! version-then-timestamp LWW via `MergeableTrait`.

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, BlobId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{LwwRegister, Mergeable as MergeableTrait, UnorderedMap};

type ObjectId  = String;
type MemberId  = String;
type CommentId = String;

// ── Pure helpers (unit-testable without the runtime) ──────────────────────────

pub mod pure {
    /// LWW for scene objects: an incoming edit replaces the current one if it
    /// has a higher version, or an equal version with a newer timestamp.
    pub fn should_replace(cur_version: u64, cur_ts: u64, inc_version: u64, inc_ts: u64) -> bool {
        inc_version > cur_version || (inc_version == cur_version && inc_ts > cur_ts)
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
}

// ── Geometry ──────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, Default)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Quat {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
}

impl Default for Quat {
    fn default() -> Self { Quat { x: 0.0, y: 0.0, z: 0.0, w: 1.0 } }
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Transform {
    pub position: Vec3,
    pub rotation: Quat,
    pub scale:    Vec3,
}

impl Default for Transform {
    fn default() -> Self {
        Transform { position: Vec3::default(), rotation: Quat::default(),
                    scale: Vec3 { x: 1.0, y: 1.0, z: 1.0 } }
    }
}

// ── Object data (kind-tagged, lowercase to match ARKit/frontend) ──────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
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
}

// ── Scene object ────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct SceneObject {
    pub id:         ObjectId,
    pub data:       ObjectData,
    pub transform:  Transform,
    pub color:      String,
    pub locked_by:  Option<MemberId>,
    pub created_by: MemberId,
    pub created_at: u64,
    pub updated_at: u64,
    pub version:    u64,
}

impl MergeableTrait for SceneObject {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if pure::should_replace(self.version, self.updated_at, other.version, other.updated_at) {
            *self = other.clone();
        }
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
    pub avatar:    Option<String>,
    pub joined_at: u64,
}

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.joined_at > self.joined_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Presence (camera pose per identity) ───────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub identity:        String,
    pub camera_position: Vec3,
    pub camera_rotation: Quat,
    pub updated_at:      u64,
}

impl MergeableTrait for Presence {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.updated_at > self.updated_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Spatial comment ───────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct SpatialComment {
    pub id:         CommentId,
    pub text:       String,
    pub position:   Vec3,
    pub author:     String,
    pub created_at: u64,
}

impl MergeableTrait for SpatialComment {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.created_at > self.created_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Room info ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub name:          String,
    pub object_count:  u32,
    pub member_count:  u32,
    pub world_map_blob: String,
    pub version:       u64,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[app::event]
pub enum Event {
    ObjectAdded(String),
    ObjectUpdated(String),
    ObjectDeleted(String),
    ObjectLocked(String),
    ObjectUnlocked(String),
    CommentAdded(String),
    CommentDeleted(String),
    PresenceUpdated(String),
    MemberJoined(String),
    AnchorsUpdated(),
    RoomUpdated(),
}

// ── App state ──────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroAR {
    room_name:     LwwRegister<String>,
    world_map_blob: LwwRegister<String>,
    version:       LwwRegister<u64>,
    objects:       UnorderedMap<ObjectId, SceneObject>,
    members:       UnorderedMap<MemberId, Member>,
    presence:      UnorderedMap<String, Presence>,
    comments:      UnorderedMap<CommentId, SpatialComment>,
}

// ── Logic ──────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroAR {
    #[app::init]
    pub fn init(name: String) -> MeroAR {
        MeroAR {
            room_name:      LwwRegister::new(name),
            world_map_blob: LwwRegister::new(String::new()),
            version:        LwwRegister::new(0),
            objects:        UnorderedMap::new(),
            members:        UnorderedMap::new(),
            presence:       UnorderedMap::new(),
            comments:       UnorderedMap::new(),
        }
    }

    // ── Room ────────────────────────────────────────────────────────────────

    pub fn get_room(&self) -> RoomInfo {
        RoomInfo {
            name:           self.room_name.get().clone(),
            object_count:   self.objects.len().unwrap_or(0) as u32,
            member_count:   self.members.len().unwrap_or(0) as u32,
            world_map_blob: self.world_map_blob.get().clone(),
            version:        *self.version.get(),
        }
    }

    pub fn rename_room(&mut self, name: String) {
        self.room_name.set(name);
        app::emit!(Event::RoomUpdated());
    }

    /// Store the blob id of the shared ARWorldMap and announce it to the context
    /// so peers can download it for relocalization.
    pub fn set_world_map(&mut self, blob_id: String) {
        if let Ok(b) = blob_id.parse::<BlobId>() {
            sdk_env::blob_announce_to_context(b.as_ref(), &sdk_env::context_id());
        }
        self.world_map_blob.set(blob_id);
        app::emit!(Event::AnchorsUpdated());
    }

    // ── Members ───────────────────────────────────────────────────────────────

    pub fn join(&mut self, member_id: String, username: String, avatar: Option<String>, timestamp: u64) {
        if self.members.contains(&member_id).unwrap_or(false) { return; }
        let m = Member { id: member_id.clone(), username, avatar, joined_at: timestamp };
        let _ = self.members.insert(member_id.clone(), m);
        app::emit!(Event::MemberJoined(member_id));
    }

    pub fn get_members(&self) -> Vec<Member> {
        self.members.entries().unwrap().map(|(_, v)| v).collect()
    }

    // ── Version counter ───────────────────────────────────────────────────────

    fn bump_version(&mut self) -> u64 {
        let next = self.version.get().wrapping_add(1);
        self.version.set(next);
        next
    }

    // ── Objects ─────────────────────────────────────────────────────────────────

    pub fn add_object(&mut self, object: SceneObject) -> String {
        let id = object.id.clone();
        if let ObjectData::Image { blob_id, .. } = &object.data {
            if let Ok(b) = blob_id.parse::<BlobId>() {
                sdk_env::blob_announce_to_context(b.as_ref(), &sdk_env::context_id());
            }
        }
        let mut object = object;
        object.version = self.bump_version();
        let _ = self.objects.insert(id.clone(), object);
        app::emit!(Event::ObjectAdded(id.clone()));
        id
    }

    /// Move/rotate/scale an object. Rejected if locked by someone other than
    /// `editor`. Applies version-then-timestamp LWW so stale edits are dropped.
    pub fn update_transform(&mut self, id: String, transform: Transform, editor: String, updated_at: u64) {
        let next = self.bump_version();
        if let Ok(Some(mut obj)) = self.objects.get_mut(&id) {
            if !pure::can_edit(obj.locked_by.as_deref(), &editor) { return; }
            if !pure::should_replace(obj.version, obj.updated_at, next, updated_at) { return; }
            obj.transform = transform;
            obj.updated_at = updated_at;
            obj.version = next;
            drop(obj);
            app::emit!(Event::ObjectUpdated(id));
        }
    }

    pub fn update_color(&mut self, id: String, color: String, updated_at: u64) {
        let next = self.bump_version();
        if let Ok(Some(mut obj)) = self.objects.get_mut(&id) {
            obj.color = color;
            obj.updated_at = updated_at;
            obj.version = next;
            drop(obj);
            app::emit!(Event::ObjectUpdated(id));
        }
    }

    pub fn lock_object(&mut self, id: String, by: String) {
        if let Ok(Some(mut obj)) = self.objects.get_mut(&id) {
            if obj.locked_by.is_none() {
                obj.locked_by = Some(by);
                drop(obj);
                app::emit!(Event::ObjectLocked(id));
            }
        }
    }

    pub fn unlock_object(&mut self, id: String, by: String) {
        if let Ok(Some(mut obj)) = self.objects.get_mut(&id) {
            if obj.locked_by.as_deref() == Some(by.as_str()) {
                obj.locked_by = None;
                drop(obj);
                app::emit!(Event::ObjectUnlocked(id));
            }
        }
    }

    pub fn delete_object(&mut self, id: String) {
        let _ = self.objects.remove(&id);
        app::emit!(Event::ObjectDeleted(id));
    }

    pub fn get_objects(&self) -> Vec<SceneObject> {
        self.objects.entries().unwrap().map(|(_, v)| v).collect()
    }

    pub fn get_object(&self, id: String) -> Option<SceneObject> {
        self.objects.get(&id).ok().flatten().map(|v| v.clone())
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    pub fn add_comment(&mut self, id: String, text: String, position: Vec3, author: String, created_at: u64) {
        let c = SpatialComment { id: id.clone(), text, position, author, created_at };
        let _ = self.comments.insert(id.clone(), c);
        app::emit!(Event::CommentAdded(id));
    }

    pub fn delete_comment(&mut self, id: String) {
        let _ = self.comments.remove(&id);
        app::emit!(Event::CommentDeleted(id));
    }

    pub fn get_comments(&self) -> Vec<SpatialComment> {
        self.comments.entries().unwrap().map(|(_, v)| v).collect()
    }

    // ── Presence ──────────────────────────────────────────────────────────────

    pub fn update_presence(&mut self, identity: String, camera_position: Vec3, camera_rotation: Quat, updated_at: u64) {
        let p = Presence { identity: identity.clone(), camera_position, camera_rotation, updated_at };
        let _ = self.presence.insert(identity.clone(), p);
        app::emit!(Event::PresenceUpdated(identity));
    }

    pub fn get_presence(&self) -> Vec<Presence> {
        self.presence.entries().unwrap().map(|(_, v)| v).collect()
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

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
}
