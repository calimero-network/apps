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
//!
//! # Identity (core 0.11.0-rc.23)
//!
//! Nothing here trusts a client-supplied member id. A member IS an account —
//! `env::account_id()`, the person — and so is every ownership record: the
//! roster, an object's author, a lock holder, a comment's author, the
//! `AccessControl` admin tier and the `Ownable` room name. Someone in the room
//! on a phone and an iPad is one member holding one role, not two.
//!
//! rc.20 keyed the roster by device and carried a self-registration map to reach
//! the account a grant had to name. rc.23 retires that twice over: the legacy
//! `executor_id()` shim now resolves to the account (core #3510), and group
//! membership is stated in accounts (core #3522). So the bridge is gone and a
//! member id is a 64-hex `AccountId` everywhere — including in what an admin
//! types to grant a role.
//!
//! `env::device_id()` survives in exactly one place: presence. See
//! [`MeroAR::update_presence`].

use std::str::FromStr;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, AccountId, BlobId};
use calimero_storage::address::Id;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::rekey::RekeyTarget;
use calimero_storage::collections::{
    AccessControl, LwwRegister, Mergeable as MergeableTrait, Ownable, UnorderedMap,
};

type ObjectId = String;
/// A member, written the way `AccountId` renders: 64 hex characters. Never a
/// bs58 key — those are 32 bytes too, so nothing downstream would object.
type MemberId = String;
type CommentId = String;

/// Named role granted on top of the admin tier. Editors may place, move, and
/// delete scene objects and publish the room's world map; everyone else is
/// read-only ("viewer") but may still be present in the room. The room creator
/// is the sole initial admin, and is implicitly owner + editor.
const ROLE_EDITOR: &str = "editor";

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

    /// A lock may be released by its holder, or broken by an admin — otherwise a
    /// member who leaves mid-edit wedges the object for good.
    pub fn may_unlock(locked_by: Option<&str>, caller: &str, is_admin: bool) -> bool {
        is_admin || locked_by == Some(caller)
    }

    /// A comment may be deleted by its author or by an admin.
    pub fn may_delete_comment(author: &str, caller: &str, is_admin: bool) -> bool {
        is_admin || author == caller
    }
}

// ── Geometry ──────────────────────────────────────────────────────────────────

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, Default)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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

// `SceneObject` is a flat record (no nested collections), so re-keying is a
// no-op — but rc.9's `Mergeable: RekeyTarget` supertrait bound requires the
// impl. The default `register_nested_value_types` (empty) is correct.
impl RekeyTarget for SceneObject {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
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

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id:        MemberId,
    pub username:  String,
    pub avatar:    Option<String>,
    pub joined_at: u64,
}

// Flat record → no-op re-key; required by rc.9's `Mergeable: RekeyTarget`.
impl RekeyTarget for Member {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.joined_at > self.joined_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Presence (camera pose per DEVICE) ─────────────────────────────────────────

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    /// The device holding this camera — a room id for a viewpoint, not a member.
    pub identity:        String,
    /// The member that device speaks for, so the roster can light up the person
    /// a viewpoint belongs to. Two of these may name the same member.
    pub member:          MemberId,
    pub camera_position: Vec3,
    pub camera_rotation: Quat,
    pub updated_at:      u64,
}

// Flat record → no-op re-key; required by rc.9's `Mergeable: RekeyTarget`.
impl RekeyTarget for Presence {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

impl MergeableTrait for Presence {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.updated_at > self.updated_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Spatial comment ───────────────────────────────────────────────────────────

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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

// Flat record → no-op re-key; required by rc.9's `Mergeable: RekeyTarget`.
impl RekeyTarget for SpatialComment {
    fn rekey_relative_to(&mut self, _parent_id: Id) {}
}

impl MergeableTrait for SpatialComment {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.created_at > self.created_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Room info ──────────────────────────────────────────────────────────────────

#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub name:          String,
    pub object_count:  u32,
    pub member_count:  u32,
    pub world_map_blob: String,
    pub version:       u64,
    /// Room owner as a member id. `None` before the first owner edit — the
    /// `Ownable` cell has no owner to report until then.
    pub owner:         Option<MemberId>,
}

/// A member with their effective role — the roster the members sheet renders.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct MemberRole {
    pub member: MemberId,
    /// "admin" | "editor" | "viewer"
    pub role:   String,
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
    /// A member's role changed — clients re-resolve `my_role` on this.
    RoleUpdated(String),
    OwnerTransferred(String),
}

// ── App state ──────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroAR {
    /// The room's name, inside an owner-gated cell so a rename only converges
    /// from the owner — a forged rename delta from a non-owner is rejected at
    /// merge, not merely by the fail-fast API guard.
    ///
    /// EMPTY until the first owner edit; read it through `room_name_str`, never
    /// directly. See `initial_name`.
    room_name:     Ownable<LwwRegister<String>>,
    /// What `init` was called with.
    ///
    /// **`Ownable::insert` cannot be used inside `init` on core rc.20.** The
    /// cell is still detached from the state tree there: the writer set carries
    /// through the constructor, but the inserted VALUE is silently dropped —
    /// `insert` returns `Ok` and a later read returns `Ok("")`. So the init
    /// value lives here, in a plain register that persists normally, and the
    /// `Ownable` cell takes over from the first owner edit onwards. Written once
    /// at init and never again.
    initial_name:  LwwRegister<String>,
    /// Blob id of the shared `ARWorldMap` every device relocalizes against.
    ///
    /// Editor-gated by the API only (not `Ownable`): the world map is a shared
    /// scan that any editor may re-publish, and the last good scan should win by
    /// LWW rather than converge from one owner. A forged delta from a viewer
    /// would still merge — the guard is fail-fast, not cryptographic.
    world_map_blob: LwwRegister<String>,
    version:       LwwRegister<u64>,
    objects:       UnorderedMap<ObjectId, SceneObject>,
    members:       UnorderedMap<MemberId, Member>,
    presence:      UnorderedMap<String, Presence>,
    comments:      UnorderedMap<CommentId, SpatialComment>,
    /// Role registry whose admin tier is a signed writer set. Grants/revokes are
    /// admin-gated at merge; the room creator is the sole initial admin.
    ///
    /// Keyed by account, like every other map here — which is why rc.20's
    /// device→account registration map is gone rather than merely unused.
    roles:         AccessControl,
}

// ── Logic ──────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroAR {
    #[app::init]
    pub fn init(name: String) -> MeroAR {
        // One id for ownership, the admin tier, and the roster.
        let me = Self::caller_account();
        // Deliberately NOT seeding the `Ownable` cell here — see `initial_name`.
        // The value would be silently dropped and the room would come up unnamed.
        let room_name = Ownable::new_owned_by(me);
        MeroAR {
            room_name,
            initial_name:   LwwRegister::new(name),
            world_map_blob: LwwRegister::new(String::new()),
            version:        LwwRegister::new(0),
            objects:        UnorderedMap::new(),
            members:        UnorderedMap::new(),
            presence:       UnorderedMap::new(),
            comments:       UnorderedMap::new(),
            roles:          AccessControl::new(me),
        }
    }

    // ── Identity & authorization ──────────────────────────────────────────────

    /// Who is calling, as a person. Never trust a client-supplied id.
    ///
    /// The single authorization subject here: `AccessControl`, `Ownable`, the
    /// roster, and every "did you write this" comparison gate on this one value,
    /// so a second device of the same person inherits the first one's standing
    /// instead of arriving as a stranger.
    fn caller_account() -> AccountId {
        AccountId::from(sdk_env::account_id())
    }

    /// String form of the caller's account — the member id this room stores and
    /// puts on the wire.
    fn caller_id() -> String {
        Self::caller_account().to_string()
    }

    /// The installation executing this call, NOT the person behind it.
    ///
    /// The one place a device id is the right answer in this contract: a camera
    /// pose is a property of the phone holding the camera, so a member in the
    /// room on two devices is genuinely two viewpoints and must not overwrite
    /// themselves. Rendered hex to match how every other id here is written.
    fn caller_device() -> String {
        hex::encode(sdk_env::device_id())
    }

    /// Read a client-supplied member id back into the account a grant names.
    ///
    /// A plain parse since rc.23: a member id IS an account id, so a role can be
    /// set for someone before they have ever opened the room — which rc.20's
    /// device→account bridge could not do, because it had nothing to look up
    /// until that member wrote something.
    fn parse_member(member: &str) -> app::Result<AccountId> {
        AccountId::from_str(member)
            .map_err(|_| app::err!("that is not a member id — expected 64 hex characters"))
    }

    /// True if `who` may mutate the scene (admin or explicit editor).
    fn is_editor(&self, who: &AccountId) -> bool {
        self.roles.is_admin(who) || self.roles.has_role(ROLE_EDITOR, who).unwrap_or(false)
    }

    /// Gate a scene mutation. Viewers can look around and be present, but not
    /// place, move, or delete anything.
    fn require_editor(&self) -> app::Result<()> {
        if self.is_editor(&Self::caller_account()) {
            return Ok(());
        }
        app::bail!("view-only: editor or admin access is required to change this room");
    }

    /// Gate a room-level / destructive operation on admin.
    fn require_admin(&self) -> app::Result<()> {
        if self.roles.is_admin(&Self::caller_account()) {
            return Ok(());
        }
        app::bail!("admin access is required for this operation");
    }

    fn role_label(&self, who: &AccountId) -> String {
        if self.roles.is_admin(who) {
            "admin".to_string()
        } else if self.roles.has_role(ROLE_EDITOR, who).unwrap_or(false) {
            "editor".to_string()
        } else {
            "viewer".to_string()
        }
    }

    // ── Roles ─────────────────────────────────────────────────────────────────

    /// Grant a member the editor role. Admin-only (enforced at merge).
    pub fn grant_editor(&mut self, member: String) -> app::Result<()> {
        let who = Self::parse_member(&member)?;
        self.roles.grant(ROLE_EDITOR, who)?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    /// Revoke a member's editor role (downgrade to viewer). Admin-only.
    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        let who = Self::parse_member(&member)?;
        self.roles.revoke(ROLE_EDITOR, &who)?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    /// Effective role of a member: "admin", "editor", or "viewer".
    pub fn get_role(&self, member: String) -> String {
        match Self::parse_member(&member) {
            Ok(account) => self.role_label(&account),
            // Not an account id, so no grant could ever name them — viewer.
            Err(_) => "viewer".to_string(),
        }
    }

    /// The caller's own member id, so a client can mark "you" in the roster and
    /// recognise itself as the room's owner.
    ///
    /// The node-level `GET /admin-api/identity` reports the same account, but it
    /// needs an admin scope and a second round trip; this answers in the one
    /// vocabulary the rest of these methods already speak.
    pub fn whoami(&self) -> String {
        Self::caller_id()
    }

    /// Effective role of the caller — what the app's edit gate reads.
    pub fn my_role(&self) -> String {
        self.role_label(&Self::caller_account())
    }

    /// Whether the caller may change the scene.
    pub fn can_edit(&self) -> bool {
        self.is_editor(&Self::caller_account())
    }

    /// Every member with their effective role, for the members sheet.
    pub fn list_roles(&self) -> Vec<MemberRole> {
        let mut out = Vec::new();
        if let Ok(entries) = self.members.entries() {
            for (id, _) in entries {
                let role = match Self::parse_member(&id) {
                    Ok(account) => self.role_label(&account),
                    Err(_) => "viewer".to_string(),
                };
                out.push(MemberRole { member: id, role });
            }
        }
        out
    }

    /// Hand the room (and its owner-gated name) to another member. Owner-only.
    pub fn transfer_ownership(&mut self, new_owner: String) -> app::Result<()> {
        let owner = Self::parse_member(&new_owner)?;
        // Only the current owner can pass the `Ownable` transfer guard below, so
        // the caller IS the previous owner.
        let previous = Self::caller_account();
        self.room_name.transfer_ownership(owner)?;
        // The new owner becomes administratively able to manage roles…
        if !self.roles.is_admin(&owner) {
            self.roles.grant_admin(owner)?;
        }
        // …and the former owner relinquishes admin, so they can no longer pass
        // `require_admin` after handing the room off. Skip when transferring to
        // self. Granting the new admin first guarantees the set never empties.
        if previous != owner && self.roles.is_admin(&previous) {
            self.roles.revoke_admin(&previous)?;
        }
        app::emit!(Event::OwnerTransferred(new_owner));
        Ok(())
    }

    // ── Room ────────────────────────────────────────────────────────────────

    /// The room's name. The owner-gated cell wins once it holds anything; before
    /// the first owner edit it is empty and what `init` was given is the answer.
    /// See `initial_name`.
    fn room_name_str(&self) -> String {
        let edited = self
            .room_name
            .get()
            .map(|r| r.get().clone())
            .unwrap_or_default();
        if edited.is_empty() { self.initial_name.get().clone() } else { edited }
    }

    pub fn get_room(&self) -> RoomInfo {
        RoomInfo {
            name:           self.room_name_str(),
            object_count:   self.objects.len().unwrap_or(0) as u32,
            member_count:   self.members.len().unwrap_or(0) as u32,
            world_map_blob: self.world_map_blob.get().clone(),
            version:        *self.version.get(),
            owner:          self.room_name.owner().map(|a| a.to_string()),
        }
    }

    /// Rename the room. Owner-only — the rename only converges from the owner.
    pub fn rename_room(&mut self, name: String) -> app::Result<()> {
        self.room_name.only_owner()?;
        self.room_name.insert(LwwRegister::new(name))?;
        app::emit!(Event::RoomUpdated());
        Ok(())
    }

    /// Store the blob id of the shared ARWorldMap and announce it to the context
    /// so peers can download it for relocalization. Editor-gated: a viewer's
    /// scan must not redefine where everyone else's objects are anchored.
    pub fn set_world_map(&mut self, blob_id: String) -> app::Result<()> {
        self.require_editor()?;
        if let Ok(b) = blob_id.parse::<BlobId>() {
            sdk_env::blob_announce_to_context(b.as_ref(), &sdk_env::context_id());
        }
        self.world_map_blob.set(blob_id);
        app::emit!(Event::AnchorsUpdated());
        Ok(())
    }

    // ── Members ───────────────────────────────────────────────────────────────

    /// Enter the room under `username`. The member id is the caller's account, so
    /// a client can only ever create/refresh its own entry — and a second device
    /// of an existing member re-enters as that member rather than as a stranger.
    pub fn join(&mut self, username: String, avatar: Option<String>, timestamp: u64) {
        let member_id = Self::caller_id();
        if self.members.contains(&member_id).unwrap_or(false) { return; }
        let m = Member { id: member_id.clone(), username, avatar, joined_at: timestamp };
        let _ = self.members.insert(member_id.clone(), m);
        app::emit!(Event::MemberJoined(member_id));
    }

    pub fn get_members(&self) -> Vec<Member> {
        self.members.entries().unwrap().map(|(_, v)| v).collect()
    }

    /// Rename the caller's own member entry — never anyone else's.
    pub fn update_member_username(&mut self, username: String) {
        let member_id = Self::caller_id();
        if let Ok(Some(mut m)) = self.members.get_mut(&member_id) {
            m.username = username;
            drop(m);
            app::emit!(Event::MemberJoined(member_id));
        }
    }

    // ── Version counter ───────────────────────────────────────────────────────

    fn bump_version(&mut self) -> u64 {
        let next = self.version.get().wrapping_add(1);
        self.version.set(next);
        next
    }

    // ── Objects ─────────────────────────────────────────────────────────────────

    /// Place an object. `created_by` is overwritten with the real signer, so the
    /// attribution a client sends is advisory at most.
    pub fn add_object(&mut self, object: SceneObject) -> app::Result<String> {
        self.require_editor()?;
        let id = object.id.clone();
        if let ObjectData::Image { blob_id, .. } = &object.data {
            if let Ok(b) = blob_id.parse::<BlobId>() {
                sdk_env::blob_announce_to_context(b.as_ref(), &sdk_env::context_id());
            }
        }
        let mut object = object;
        object.created_by = Self::caller_id();
        // A client cannot pre-lock an object for someone else on the way in.
        object.locked_by = None;
        object.version = self.bump_version();
        let _ = self.objects.insert(id.clone(), object);
        app::emit!(Event::ObjectAdded(id.clone()));
        Ok(id)
    }

    /// Move/rotate/scale an object. Rejected if locked by anyone other than the
    /// caller. Applies version-then-timestamp LWW so stale edits are dropped.
    pub fn update_transform(&mut self, id: String, transform: Transform, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;
        // The lock holder is an ACCOUNT, and so is the caller — never a
        // client-supplied "editor" string. Keyed by account, the phone can
        // release what the laptop took, which is what a person expects of
        // their own lock.
        let editor = Self::caller_id();
        let next = self.bump_version();
        if let Ok(Some(mut obj)) = self.objects.get_mut(&id) {
            if !pure::can_edit(obj.locked_by.as_deref(), &editor) { return Ok(()); }
            if !pure::should_replace(obj.version, obj.updated_at, next, updated_at) { return Ok(()); }
            obj.transform = transform;
            obj.updated_at = updated_at;
            obj.version = next;
            drop(obj);
            app::emit!(Event::ObjectUpdated(id));
        }
        Ok(())
    }

    /// Recolor an object. Honours the advisory lock exactly like
    /// [`Self::update_transform`] — a lock has to hold for every field, or it
    /// only protects position.
    pub fn update_color(&mut self, id: String, color: String, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;
        let editor = Self::caller_id();
        let next = self.bump_version();
        if let Ok(Some(mut obj)) = self.objects.get_mut(&id) {
            if !pure::can_edit(obj.locked_by.as_deref(), &editor) { return Ok(()); }
            obj.color = color;
            obj.updated_at = updated_at;
            obj.version = next;
            drop(obj);
            app::emit!(Event::ObjectUpdated(id));
        }
        Ok(())
    }

    /// Take the advisory lock on an object, in the caller's own name.
    pub fn lock_object(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let by = Self::caller_id();
        if let Ok(Some(mut obj)) = self.objects.get_mut(&id) {
            if obj.locked_by.is_none() {
                obj.locked_by = Some(by);
                drop(obj);
                app::emit!(Event::ObjectLocked(id));
            }
        }
        Ok(())
    }

    /// Release a lock the caller holds. An admin may break any lock, so a member
    /// who leaves mid-edit can't wedge an object permanently.
    pub fn unlock_object(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let by = Self::caller_id();
        let is_admin = self.roles.is_admin(&Self::caller_account());
        if let Ok(Some(mut obj)) = self.objects.get_mut(&id) {
            if pure::may_unlock(obj.locked_by.as_deref(), &by, is_admin) {
                obj.locked_by = None;
                drop(obj);
                app::emit!(Event::ObjectUnlocked(id));
            }
        }
        Ok(())
    }

    /// Delete an object. Honours the advisory lock — deleting what someone else
    /// has locked is the most destructive way to ignore it.
    pub fn delete_object(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let editor = Self::caller_id();
        if let Ok(Some(obj)) = self.objects.get(&id) {
            if !pure::can_edit(obj.locked_by.as_deref(), &editor) { return Ok(()); }
        }
        let _ = self.objects.remove(&id);
        app::emit!(Event::ObjectDeleted(id));
        Ok(())
    }

    /// Clear the whole scene. Admin-only.
    pub fn clear_objects(&mut self) -> app::Result<()> {
        self.require_admin()?;
        let ids: Vec<ObjectId> = self.objects.entries()
            .map(|iter| iter.map(|(k, _)| k).collect())
            .unwrap_or_default();
        for id in ids {
            let _ = self.objects.remove(&id);
            app::emit!(Event::ObjectDeleted(id));
        }
        Ok(())
    }

    pub fn get_objects(&self) -> Vec<SceneObject> {
        self.objects.entries().unwrap().map(|(_, v)| v).collect()
    }

    pub fn get_object(&self, id: String) -> Option<SceneObject> {
        self.objects.get(&id).ok().flatten().map(|v| v.clone())
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    /// Pin a note in space. The author is the real signer, so a member cannot
    /// attribute a comment to someone else.
    pub fn add_comment(&mut self, id: String, text: String, position: Vec3, created_at: u64) -> app::Result<()> {
        self.require_editor()?;
        let author = Self::caller_id();
        let c = SpatialComment { id: id.clone(), text, position, author, created_at };
        let _ = self.comments.insert(id.clone(), c);
        app::emit!(Event::CommentAdded(id));
        Ok(())
    }

    /// Delete a comment. The author may delete their own; an admin may delete any.
    pub fn delete_comment(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let me = Self::caller_id();
        let is_admin = self.roles.is_admin(&Self::caller_account());
        if let Ok(Some(c)) = self.comments.get(&id) {
            if !pure::may_delete_comment(&c.author, &me, is_admin) {
                app::bail!("only the comment's author or an admin can delete it");
            }
        }
        let _ = self.comments.remove(&id);
        app::emit!(Event::CommentDeleted(id));
        Ok(())
    }

    pub fn get_comments(&self) -> Vec<SpatialComment> {
        self.comments.entries().unwrap().map(|(_, v)| v).collect()
    }

    // ── Presence ──────────────────────────────────────────────────────────────

    /// Publish this device's camera pose. Open to viewers — being in the room is
    /// not an edit — and keyed by the host-reported device, so nobody can puppet
    /// another viewpoint.
    ///
    /// The **only** device-keyed state in this contract. A pose belongs to the
    /// phone that took it: a member holding the room open on two devices is two
    /// cameras in the scene, and keying this by account would make each pose
    /// stomp the other twice a second. `member` carries the account so the
    /// roster can still tell whose viewpoint it is.
    pub fn update_presence(&mut self, camera_position: Vec3, camera_rotation: Quat, updated_at: u64) {
        let device = Self::caller_device();
        let p = Presence {
            identity: device.clone(),
            member:   Self::caller_id(),
            camera_position,
            camera_rotation,
            updated_at,
        };
        let _ = self.presence.insert(device.clone(), p);
        app::emit!(Event::PresenceUpdated(device));
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
}
