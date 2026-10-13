//! Mero Models — a collaborative 3D modelling scene that is a Calimero context.
//!
//! A scene is a set of objects (primitives, imported or edited meshes, lights
//! and empty groups), each with a transform, a material and a parent. Every
//! member's node holds the whole scene, edits replicate peer to peer, and there
//! is no server that stores the model.
//!
//! ## What is stored, and why it converges
//!
//! **One record per object, last write wins.** Two people dragging the same
//! cube resolve to one position, the same one on every node: `SceneObject` is
//! a whole-record LWW leaf, so a merge keeps one write whole and never a mix of
//! two (`tests/converge.rs`). Which concurrent write wins is the storage
//! layer's causal order. `updated_at` is the contract's own version stamp,
//! always moved past the stored value (see [`MeroModels::stamp`]), which is
//! what lets a client tell a changed mesh from one it already holds.
//!
//! **Heavy data lives in blobs; state holds references.** A production mesh is
//! hundreds of thousands of vertices and a texture is megabytes, far more than
//! belongs in a replicated record. So the vertices and the pixels are
//! content-addressed node blobs, announced to the context so every member's
//! node fetches them, and state holds a small [`MeshRef`] or [`TextureRef`]:
//! the blob id, its size and what is in it. Moving an object never touches its
//! mesh; replacing a mesh is one new blob and one small record.
//!
//! **Every version is kept.** Each mesh or texture write also appends a
//! [`VersionRecord`] to `history`, keyed by asset, so any earlier version can
//! be listed and restored — restoring is writing the old blob id again, and
//! because blobs are content-addressed nothing is copied. Version numbers are
//! derived on read from the order of the history, never stored.
//!
//! **Check-out locks are coordination, not security.** An editor checks an
//! asset out; while the lock is live, every honest node refuses anyone else's
//! write to it. The lock is a record like any other, so two people checking
//! out the same asset while offline resolve to one holder when they meet, and
//! a write made before a node saw the lock still merges. Locks expire, and an
//! admin can break one.
//!
//! **The hierarchy is derived on read.** An object names its `parent`; the
//! reader decides what that means. A parent that no longer exists, or a chain
//! that loops back on itself (two people re-parenting at once can produce
//! one), reads as a root object — see [`MeroModels::resolve_parents`].
//!
//! **Presence is not stored at all.** Who is looking at what, and what they
//! have selected, streams over the node's ephemeral channel from the
//! frontend; it never becomes a transaction.
//!
//! ## What holds against a node that does not run this code
//!
//! A receiving node does not execute this contract; it checks the author and
//! folds the delta into storage. So the `require_editor` checks below bind only
//! the node that runs them. What binds every node is the storage tier: the
//! scene collections are `PermissionedStorage`, and the editor role is
//! projected onto their capability maps, so a viewer's forged write is refused
//! on apply, everywhere. Member profiles live in `UserStorage`, one slot per
//! account that only that account can write.

use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, AccountId, BlobId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AccessControl, Frozen, Mergeable as MergeableTrait, PermissionedStorage, ProtocolAuthorizer,
    SortedMap, UnorderedMap, UserStorage,
};
use calimero_storage::entities::OpMask;

#[cfg(test)]
mod tests;

// ── Limits ────────────────────────────────────────────────────────────────────

/// Objects one call may write or delete. A paste, an import or a multi-select
/// drag is one call; bounding it bounds a single delta.
pub const MAX_BATCH: usize = 200;

/// Objects one scene may hold. Every read returns the whole list, so this is
/// what keeps a read cheap.
pub const MAX_OBJECTS: usize = 2_000;

/// Vertices one mesh may carry. The vertices live in a blob, so this bounds
/// what a member's browser has to hold, not what state holds.
pub const MAX_VERTICES: u32 = 4_000_000;

/// Triangles one mesh may carry.
pub const MAX_TRIANGLES: u32 = 8_000_000;

/// The largest blob a mesh or texture may name, in bytes. Core accepts up to
/// 1 GiB from a node (64 MiB through an account's relay).
pub const MAX_BLOB_BYTES: u64 = 512 * 1024 * 1024;

/// The largest texture side, in pixels.
pub const MAX_TEXTURE_SIDE: u32 = 16_384;

/// Textures one scene may hold.
pub const MAX_TEXTURES: usize = 1_000;

/// The longest a check-out may last before it lapses, in hours.
pub const MAX_LOCK_HOURS: u32 = 168;

/// The most history rows `list_history` returns, newest kept.
pub const MAX_HISTORY_VIEW: usize = 500;

/// Longest object or scene name, in characters.
pub const MAX_NAME_LEN: usize = 80;

/// The role that may change the scene. Everyone else in the context can look.
const ROLE_EDITOR: &str = "editor";

/// What the editor role may do to the scene collections, projected onto their
/// capability maps after every role change, where every node enforces it.
const SCENE_ROLE_MASKS: &[(&str, OpMask)] = &[(ROLE_EDITOR, OpMask::WRITE.union(OpMask::DELETE))];

/// The one key the environment map uses. A map rather than a register so the
/// record merges exactly like an object does.
const ENVIRONMENT_KEY: &str = "environment";

/// Every `kind` an object may have. Primitives are unit-sized and shaped by
/// their scale, exactly as a freshly added primitive is in any modeller.
pub const OBJECT_KINDS: &[&str] = &[
    "cube",
    "sphere",
    "icosphere",
    "cylinder",
    "cone",
    "torus",
    "plane",
    "capsule",
    "mesh",
    "group",
    "point_light",
    "spot_light",
    "directional_light",
];

type ObjectId = String;
type MemberId = String;

// ── Records ───────────────────────────────────────────────────────────────────
//
// ⚠️ No `#[serde(rename_all = "camelCase")]` anywhere in this file. The ABI
// emitter reads the Rust field names and ignores serde's attributes, so a rename
// gives a wire that says `updatedAt` and a generated client that says
// `updated_at`: it typechecks, and every renamed field reads as undefined.

/// A point or a direction in scene units, or Euler angles in radians.
#[derive(
    AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const ZERO: Vec3 = Vec3 {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };
    pub const ONE: Vec3 = Vec3 {
        x: 1.0,
        y: 1.0,
        z: 1.0,
    };

    fn is_finite(&self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

/// How an object's surface looks. A light reads `color` as its light colour.
#[derive(
    AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Material {
    /// Base colour, `#rrggbb`.
    pub color: String,
    /// 0 (dielectric) to 1 (metal).
    pub metalness: f64,
    /// 0 (mirror) to 1 (matte).
    pub roughness: f64,
    /// 0 (invisible) to 1 (opaque).
    pub opacity: f64,
    /// Emitted colour, `#rrggbb`; `#000000` for none.
    pub emissive: String,
    /// Draw the edges only.
    pub wireframe: bool,
    /// Faceted normals instead of smooth ones.
    pub flat_shading: bool,
    /// Texture id for the base colour (sRGB), or `""`.
    pub base_color_map: String,
    /// Texture id for the tangent-space normal map (OpenGL, +Y up), or `""`.
    pub normal_map: String,
    /// Strength of the normal map, 0 to 10.
    pub normal_scale: f64,
    /// Texture id packing occlusion (R), roughness (G) and metalness (B) — glTF's and
    /// Unreal's layout — or `""`.
    pub orm_map: String,
    /// Texture id for emission, or `""`.
    pub emissive_map: String,
}

/// One object in the scene.
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct SceneObject {
    /// Chosen by the caller; use a fresh UUID. Writing an existing id replaces that object.
    pub id: ObjectId,
    /// Shown in the outliner.
    pub name: String,
    /// One of [`OBJECT_KINDS`]. A `mesh` takes its shape from `put_mesh` under the same id.
    pub kind: String,
    /// The parent object's id, or `""` for a root object. A parent that does not exist, or
    /// a chain that loops, reads as `""`.
    pub parent: ObjectId,
    /// Position relative to the parent, scene units.
    pub position: Vec3,
    /// Euler rotation (XYZ order) relative to the parent, radians.
    pub rotation: Vec3,
    /// Scale relative to the parent. Primitives are unit-sized, so this is their size.
    pub scale: Vec3,
    /// Hidden objects (and their children) are not drawn.
    pub visible: bool,
    /// Surface, or light colour for a light.
    pub material: Material,
    /// How finely a curved primitive is tessellated, 3 to 128. Ignored by other kinds.
    pub segments: u32,
    /// A light's strength; ignored by other kinds.
    pub intensity: f64,
    /// Who first created it. Set by the contract; the value sent is ignored.
    pub created_by: MemberId,
    /// Creation time, unix milliseconds. Kept from the first write.
    pub created_at: u64,
    /// Last change, unix milliseconds. The contract moves it past the stored value, so it
    /// only ever grows; the value sent is a hint.
    pub updated_at: u64,
}

calimero_storage::impl_atomic_lww_leaf!(SceneObject, updated_at);

/// The shape of a `mesh` object: a reference to the blob holding its vertices.
///
/// The blob is the app's binary mesh format (see the frontend's `meshcodec.ts`).
/// The contract cannot read it; `vertex_count` and friends are what the writer
/// says is inside, and a reader checks them against what it decodes.
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MeshRef {
    /// The object this is the shape of.
    pub id: ObjectId,
    /// The blob, as the 64-character hex id the node returned from the upload.
    pub blob_id: String,
    /// The blob's length in bytes.
    pub size: u64,
    pub vertex_count: u32,
    pub triangle_count: u32,
    /// Whether the mesh carries texture coordinates.
    pub has_uvs: bool,
    /// Who wrote this version. Set by the contract.
    pub author: MemberId,
    /// A note for the history ("retopo pass", "Restored v3"); may be empty.
    pub message: String,
    /// Set by the contract; only ever grows.
    pub updated_at: u64,
}

calimero_storage::impl_atomic_lww_leaf!(MeshRef, updated_at);

/// An image a material can use, held in a blob.
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct TextureRef {
    /// Chosen by the caller; use a fresh UUID.
    pub id: String,
    pub name: String,
    /// The blob, as a 64-character hex id.
    pub blob_id: String,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    /// `image/png`, `image/jpeg` or `image/webp`.
    pub mime: String,
    /// `srgb` for colour, `linear` for data (normal, ORM).
    pub color_space: String,
    /// Set by the contract.
    pub author: MemberId,
    pub message: String,
    /// Set by the contract; only ever grows.
    pub updated_at: u64,
}

calimero_storage::impl_atomic_lww_leaf!(TextureRef, updated_at);

/// One saved version of a mesh or a texture. Written once per write and never
/// changed; restoring writes a new one.
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct VersionRecord {
    /// The mesh's object id or the texture's id.
    pub asset_id: String,
    /// `mesh` or `texture`.
    pub kind: String,
    pub blob_id: String,
    pub size: u64,
    /// Vertices and triangles for a mesh; width and height for a texture.
    pub a: u32,
    pub b: u32,
    pub author: MemberId,
    pub message: String,
    pub created_at: u64,
}

calimero_storage::impl_atomic_lww_leaf!(VersionRecord, created_at);

/// A check-out: one editor holding an asset until they check it in or it lapses.
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Lock {
    pub asset_id: String,
    /// Set by the contract.
    pub holder: MemberId,
    pub since: u64,
    /// After this (the holder's clock, unix milliseconds) the lock no longer holds.
    pub expires_at: u64,
    pub updated_at: u64,
}

calimero_storage::impl_atomic_lww_leaf!(Lock, updated_at);

/// What surrounds the scene: its name, the background and the ambient light.
#[derive(
    AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Environment {
    /// The scene's name; `""` shows the name it was created with.
    pub name: String,
    /// Viewport background, `#rrggbb`.
    pub background: String,
    /// Ambient light colour, `#rrggbb`.
    pub ambient_color: String,
    /// Ambient light strength, 0 to 10.
    pub ambient_intensity: f64,
    /// Set by the contract.
    pub updated_at: u64,
}

calimero_storage::impl_atomic_lww_leaf!(Environment, updated_at);

/// Someone who has opened the scene, as they describe themselves.
#[app::mergeable(id = "mero-models::Member")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Member {
    /// The member's account id. Filled in from the slot on read; never trusted from storage.
    pub id: MemberId,
    pub name: String,
    pub joined_at: u64,
    pub updated_at: u64,
}

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Only the slot's owner writes it, so this orders retries, not a race.
        // A total order (clock, then name) keeps the rule commutative at a tie.
        if (other.updated_at, &other.name) > (self.updated_at, &self.name) {
            self.name = other.name.clone();
            self.updated_at = other.updated_at;
        }
        Ok(())
    }
}

// ── Views ─────────────────────────────────────────────────────────────────────

/// The scene's header: name, environment, counts, and what the caller may do.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
pub struct SceneInfo {
    pub name: String,
    pub environment: Environment,
    pub object_count: u32,
    pub mesh_count: u32,
    pub texture_count: u32,
    pub member_count: u32,
    /// The caller's account id.
    pub me: MemberId,
    /// `admin`, `editor` or `viewer`.
    pub my_role: String,
}

/// One row of an asset's history, numbered from 1 in the order it was written.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
pub struct VersionView {
    /// 1 for the first version. Derived from the history's order, never stored.
    pub number: u32,
    pub kind: String,
    pub blob_id: String,
    pub size: u64,
    /// Vertices (mesh) or width (texture).
    pub a: u32,
    /// Triangles (mesh) or height (texture).
    pub b: u32,
    pub author: MemberId,
    pub message: String,
    pub created_at: u64,
    /// Whether this is the blob the asset points at now.
    pub current: bool,
}

/// A live check-out.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LockView {
    pub asset_id: String,
    pub holder: MemberId,
    pub since: u64,
    pub expires_at: u64,
    /// Whether the caller holds it.
    pub mine: bool,
}

/// A member with their effective role.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
pub struct MemberView {
    pub id: MemberId,
    pub name: String,
    /// `admin`, `editor` or `viewer`.
    pub role: String,
    pub joined_at: u64,
}

// ── Events ────────────────────────────────────────────────────────────────────

/// What changed, so an open client knows what to re-read. A nudge, not the truth: the
/// payload names ids, and a client re-reads them.
#[app::event]
pub enum Event {
    /// Objects were added or changed; the payload is their ids.
    ObjectsChanged(Vec<String>),
    /// Objects were deleted; the payload is the ids the call named.
    ObjectsDeleted(Vec<String>),
    /// A mesh's vertices changed; the payload is its object id.
    MeshChanged(String),
    /// A texture was added or replaced; the payload is its id.
    TextureChanged(String),
    /// Textures were deleted; the payload is the ids the call named.
    TexturesDeleted(Vec<String>),
    /// Assets were checked out or in; the payload is their ids.
    LocksChanged(Vec<String>),
    /// The name, background or ambient light changed.
    EnvironmentChanged(),
    /// Every object was removed.
    SceneCleared(),
    /// A member joined or renamed themselves; the payload is their member id.
    MemberChanged(String),
    /// A member's role changed; the payload is the id the caller passed.
    RoleChanged(String),
}

// ── State ─────────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroModels {
    /// What `init` was given. `Frozen`: nobody rewrites it. The environment's `name`
    /// overrides it once an editor sets one.
    initial_name: Frozen<String>,
    /// Every object, keyed by id. Writable only by accounts the editor role is
    /// projected onto, on every node.
    objects: PermissionedStorage<UnorderedMap<ObjectId, SceneObject>, ProtocolAuthorizer>,
    /// The current blob of every `mesh` object, keyed by the object's id. Guarded like
    /// `objects`.
    meshes: PermissionedStorage<UnorderedMap<ObjectId, MeshRef>, ProtocolAuthorizer>,
    /// Every texture, keyed by id. Guarded like `objects`.
    textures: PermissionedStorage<UnorderedMap<String, TextureRef>, ProtocolAuthorizer>,
    /// Every version of every mesh and texture, keyed
    /// `"<asset>/<stamp:020>/<author>/<blob>"` so one asset's history is a prefix scan
    /// in order. Guarded like `objects`.
    history: PermissionedStorage<SortedMap<String, VersionRecord>, ProtocolAuthorizer>,
    /// Live and lapsed check-outs, keyed by asset id. Guarded like `objects`.
    locks: PermissionedStorage<UnorderedMap<String, Lock>, ProtocolAuthorizer>,
    /// One entry, under [`ENVIRONMENT_KEY`]. Guarded like `objects`.
    environment: PermissionedStorage<UnorderedMap<String, Environment>, ProtocolAuthorizer>,
    /// One profile per account, written only by that account.
    members: UserStorage<Member>,
    /// Admins (the creator) and editors.
    roles: AccessControl,
}

#[app::logic]
impl MeroModels {
    /// Create a scene. Runs once, when the context is created; the creator becomes its
    /// only admin and may grant others the editor role.
    ///
    /// # Arguments
    /// * `name` - the scene's name.
    ///
    /// # Examples
    /// ```json
    /// {"name":"Robot"}
    /// ```
    #[app::init]
    pub fn init(name: String) -> MeroModels {
        let me = Self::caller_account();
        // Nothing is seeded into the guarded collections here: a cell is not
        // rooted in the state tree during `init`, and a value inserted into it
        // then is silently dropped (see mero-design's `initial_name`). The
        // environment reads as defaults until the first edit.
        MeroModels {
            initial_name: Frozen::new(clean_name(&name, "Untitled scene")),
            objects: PermissionedStorage::new(BTreeSet::from([me]), false),
            meshes: PermissionedStorage::new(BTreeSet::from([me]), false),
            textures: PermissionedStorage::new(BTreeSet::from([me]), false),
            history: PermissionedStorage::new(BTreeSet::from([me]), false),
            locks: PermissionedStorage::new(BTreeSet::from([me]), false),
            environment: PermissionedStorage::new(BTreeSet::from([me]), false),
            members: UserStorage::new(),
            roles: AccessControl::new(me),
        }
    }

    // ── Identity ──────────────────────────────────────────────────────────────

    /// Who this call is authorized as. Every "may they" question is about the account,
    /// never the device, and never an id the client sent.
    fn caller_account() -> AccountId {
        AccountId::from(sdk_env::account_id())
    }

    fn caller_id() -> MemberId {
        Self::caller_account().to_string()
    }

    fn is_editor(&self, who: &AccountId) -> bool {
        self.roles.is_admin(who) || self.roles.has_role(ROLE_EDITOR, who).unwrap_or(false)
    }

    fn require_editor(&self) -> app::Result<()> {
        if self.is_editor(&Self::caller_account()) {
            return Ok(());
        }
        app::bail!("view only: ask the scene's admin for the editor role to change it");
    }

    fn require_admin(&self) -> app::Result<()> {
        if self.roles.is_admin(&Self::caller_account()) {
            return Ok(());
        }
        app::bail!("only the scene's admin can do that");
    }

    fn role_label(&self, who: &AccountId) -> String {
        if self.roles.is_admin(who) {
            "admin"
        } else if self.roles.has_role(ROLE_EDITOR, who).unwrap_or(false) {
            "editor"
        } else {
            "viewer"
        }
        .to_owned()
    }

    /// Push the roles onto every scene collection's capability map.
    fn project_roles(&mut self) -> app::Result<()> {
        self.roles
            .project_onto(SCENE_ROLE_MASKS, &mut self.objects)?;
        self.roles
            .project_onto(SCENE_ROLE_MASKS, &mut self.meshes)?;
        self.roles
            .project_onto(SCENE_ROLE_MASKS, &mut self.environment)?;
        self.roles
            .project_onto(SCENE_ROLE_MASKS, &mut self.textures)?;
        self.roles
            .project_onto(SCENE_ROLE_MASKS, &mut self.history)?;
        self.roles.project_onto(SCENE_ROLE_MASKS, &mut self.locks)?;
        Ok(())
    }

    /// The `updated_at` a write stores: the caller's clock, moved past the stored value.
    ///
    /// So the stamp only ever grows, whatever the writer's clock says. Clients cache a
    /// mesh's vertices by it (`list_meshes` → `get_meshes`), and a slow clock that
    /// stamped an edit at or below the stored value would leave every cache holding
    /// the old shape.
    fn stamp(requested: u64, stored: Option<u64>) -> u64 {
        match stored {
            Some(prev) if requested <= prev => prev.saturating_add(1),
            _ => requested,
        }
    }

    // ── Scene ─────────────────────────────────────────────────────────────────

    fn environment_or_default(&self) -> Environment {
        self.environment
            .get()
            .ok()
            .and_then(|m| m.get(ENVIRONMENT_KEY).ok().flatten().map(|v| v.clone()))
            .unwrap_or_else(default_environment)
    }

    fn scene_name(&self, env: &Environment) -> String {
        if env.name.is_empty() {
            self.initial_name.get().cloned().unwrap_or_default()
        } else {
            env.name.clone()
        }
    }

    /// The scene's name and environment, its size, and the caller's id and role.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn get_scene(&self) -> SceneInfo {
        let environment = self.environment_or_default();
        let me = Self::caller_account();
        SceneInfo {
            name: self.scene_name(&environment),
            environment,
            object_count: self
                .objects
                .get()
                .ok()
                .and_then(|m| m.len().ok())
                .unwrap_or(0) as u32,
            mesh_count: self
                .meshes
                .get()
                .ok()
                .and_then(|m| m.len().ok())
                .unwrap_or(0) as u32,
            texture_count: self
                .textures
                .get()
                .ok()
                .and_then(|m| m.len().ok())
                .unwrap_or(0) as u32,
            member_count: self.members.entries().map(Iterator::count).unwrap_or(0) as u32,
            me: me.to_string(),
            my_role: self.role_label(&me),
        }
    }

    /// Rename the scene, or change its background or ambient light. Editors only.
    ///
    /// # Arguments
    /// * `environment` - the whole environment; `updated_at` is set by the contract.
    /// * `now` - the caller's clock, unix milliseconds.
    ///
    /// # Errors
    /// Fails if the caller is not an editor, or a colour is not `#rrggbb`.
    ///
    /// # Examples
    /// ```json
    /// {"environment":{"name":"Robot","background":"#1d1f24","ambient_color":"#ffffff","ambient_intensity":0.4,"updated_at":0},"now":1727000000000}
    /// ```
    pub fn set_environment(&mut self, environment: Environment, now: u64) -> app::Result<()> {
        self.require_editor()?;
        let mut env = environment;
        env.name = clean_name(&env.name, "");
        require_color(&env.background)?;
        require_color(&env.ambient_color)?;
        if !env.ambient_intensity.is_finite() {
            app::bail!("ambient_intensity must be a number");
        }
        env.ambient_intensity = env.ambient_intensity.clamp(0.0, 10.0);
        let stored = self
            .environment
            .get()?
            .get(ENVIRONMENT_KEY)?
            .map(|e| e.updated_at);
        env.updated_at = Self::stamp(now, stored);
        let _ = self
            .environment
            .get_mut()?
            .insert(ENVIRONMENT_KEY.to_owned(), env)?;
        app::emit!(Event::EnvironmentChanged());
        Ok(())
    }

    // ── Objects ───────────────────────────────────────────────────────────────

    /// Every object in the scene, with each `parent` resolved: a missing parent or a
    /// loop reads as `""`. Ordered by creation, then id.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn get_objects(&self) -> Vec<SceneObject> {
        let mut out: Vec<SceneObject> = self
            .objects
            .get()
            .ok()
            .and_then(|m| m.entries().ok().map(|rows| rows.map(|(_, o)| o).collect()))
            .unwrap_or_default();
        out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        Self::resolve_parents(&mut out);
        out
    }

    /// Several objects by id, in the order asked; unknown ids are left out. Parents are
    /// returned as stored — resolve them against `get_objects`.
    ///
    /// # Examples
    /// ```json
    /// {"ids":["5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"]}
    /// ```
    pub fn get_objects_by_ids(&self, ids: Vec<String>) -> Vec<SceneObject> {
        let Ok(map) = self.objects.get() else {
            return Vec::new();
        };
        ids.iter()
            .filter_map(|id| map.get(id).ok().flatten().map(|o| o.clone()))
            .collect()
    }

    /// Clear every `parent` that names a missing object or sits on a loop.
    ///
    /// Two people re-parenting at the same instant can each make a valid edit
    /// that together form a cycle (A under B, B under A), and nothing at write
    /// time can stop it. So the hierarchy is the READER's: every honest node
    /// runs this over the same rows and draws the same tree.
    pub(crate) fn resolve_parents(objects: &mut [SceneObject]) {
        let parent_of: BTreeMap<String, String> = objects
            .iter()
            .map(|o| (o.id.clone(), o.parent.clone()))
            .collect();
        for obj in objects.iter_mut() {
            if obj.parent.is_empty() {
                continue;
            }
            // Walk up. Reaching a root is fine; meeting a missing id or
            // revisiting one (the walk is bounded by the object count) is not.
            let mut seen = BTreeSet::from([obj.id.clone()]);
            let mut at = obj.parent.clone();
            let ok = loop {
                if at.is_empty() {
                    break true;
                }
                if !seen.insert(at.clone()) {
                    break false;
                }
                match parent_of.get(&at) {
                    Some(next) => at = next.clone(),
                    None => break false,
                }
            };
            if !ok {
                obj.parent = String::new();
            }
        }
    }

    /// Add objects, or replace the objects with the same ids. Editors only. Emits one
    /// `ObjectsChanged` event.
    ///
    /// Each object's `created_by` and `created_at` are kept from the first write;
    /// `updated_at` is the caller's `now`, moved past the stored value.
    ///
    /// # Arguments
    /// * `objects` - at most 200.
    /// * `now` - the caller's clock, unix milliseconds.
    ///
    /// # Returns
    /// The ids written, in the order given.
    ///
    /// # Errors
    /// Fails, writing nothing, if the caller is not an editor, the batch is too large, the
    /// scene would exceed 2000 objects, an object is checked out by someone else, or an
    /// object is malformed (unknown kind, a non-finite number, a bad colour, a texture id
    /// that is too long, an object parented to itself).
    ///
    /// # Examples
    /// ```json
    /// {"objects":[{"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90","name":"Cube","kind":"cube","parent":"","position":{"x":0,"y":0.5,"z":0},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1},"visible":true,"material":{"color":"#c8ccd4","metalness":0,"roughness":0.6,"opacity":1,"emissive":"#000000","wireframe":false,"flat_shading":false,"base_color_map":"","normal_map":"","normal_scale":1,"orm_map":"","emissive_map":""},"segments":32,"intensity":0,"created_by":"","created_at":0,"updated_at":0}],"now":1727000000000}
    /// ```
    pub fn put_objects(&mut self, objects: Vec<SceneObject>, now: u64) -> app::Result<Vec<String>> {
        self.require_editor()?;
        require_batch(objects.len())?;
        if objects.is_empty() {
            return Ok(Vec::new());
        }
        // Validate everything before writing anything, so a bad row cannot
        // leave half a paste behind.
        let mut cleaned = Vec::with_capacity(objects.len());
        for obj in objects {
            cleaned.push(validate_object(obj)?);
        }
        self.require_unlocked(cleaned.iter().map(|o| o.id.as_str()), now)?;
        let caller = Self::caller_id();
        let map = self.objects.get_mut()?;
        let existing = map.len()?;
        let mut new_ids = BTreeSet::new();
        for obj in &cleaned {
            if !map.contains(&obj.id)? {
                let _ = new_ids.insert(obj.id.clone());
            }
        }
        if existing + new_ids.len() > MAX_OBJECTS {
            app::bail!("a scene holds at most {MAX_OBJECTS} objects; this one has {existing}");
        }
        let mut ids = Vec::with_capacity(cleaned.len());
        for mut obj in cleaned {
            let prior = map.get(&obj.id)?.map(|o| o.clone());
            match &prior {
                Some(prev) => {
                    obj.created_by = prev.created_by.clone();
                    obj.created_at = prev.created_at;
                }
                None => {
                    obj.created_by = caller.clone();
                    obj.created_at = now;
                }
            }
            obj.updated_at = Self::stamp(now, prior.map(|p| p.updated_at));
            ids.push(obj.id.clone());
            let _ = map.insert(obj.id.clone(), obj)?;
        }
        app::emit!(Event::ObjectsChanged(ids.clone()));
        Ok(ids)
    }

    /// Delete objects and their meshes. Editors only. Ids already gone are fine. Children
    /// of a deleted object are not deleted — they read as root objects — so delete them in
    /// the same call to remove a whole branch. A deleted mesh's history is kept, so an undo
    /// can bring it back. Emits one `ObjectsDeleted` event.
    ///
    /// # Arguments
    /// * `ids` - at most 200.
    /// * `now` - the caller's clock, unix milliseconds, for judging check-outs.
    ///
    /// # Errors
    /// Fails, deleting nothing, if the caller is not an editor, the batch is too large, or
    /// one of the objects is checked out by someone else.
    ///
    /// # Examples
    /// ```json
    /// {"ids":["5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"],"now":1727000000000}
    /// ```
    #[app::destructive]
    pub fn delete_objects(&mut self, ids: Vec<String>, now: u64) -> app::Result<()> {
        self.require_editor()?;
        require_batch(ids.len())?;
        if ids.is_empty() {
            return Ok(());
        }
        self.require_unlocked(ids.iter().map(String::as_str), now)?;
        {
            let objects = self.objects.get_mut()?;
            for id in &ids {
                let _ = objects.remove(id)?;
            }
        }
        {
            let meshes = self.meshes.get_mut()?;
            for id in &ids {
                if meshes.contains(id)? {
                    let _ = meshes.remove(id)?;
                }
            }
        }
        let locks = self.locks.get_mut()?;
        for id in &ids {
            if locks.contains(id)? {
                let _ = locks.remove(id)?;
            }
        }
        app::emit!(Event::ObjectsDeleted(ids));
        Ok(())
    }

    /// Remove every object, mesh, texture, version and check-out. Admin only. The blobs
    /// themselves stay on the nodes that hold them.
    ///
    /// # Errors
    /// Fails if the caller is not an admin.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    #[app::destructive]
    pub fn clear_scene(&mut self) -> app::Result<()> {
        self.require_admin()?;
        self.objects.get_mut()?.clear()?;
        self.meshes.get_mut()?.clear()?;
        self.textures.get_mut()?.clear()?;
        self.history.get_mut()?.clear()?;
        self.locks.get_mut()?.clear()?;
        app::emit!(Event::SceneCleared());
        Ok(())
    }

    // ── Blobs ─────────────────────────────────────────────────────────────────

    /// Tell the context's members to fetch a blob. The upload announces it too; this
    /// covers a blob uploaded without a context, and a node that missed the first
    /// announcement.
    fn announce(blob_id: &str) -> app::Result<()> {
        let blob = blob_id
            .parse::<BlobId>()
            .map_err(|_| app::err!("{blob_id:?} is not a blob id — expected 64 hex characters"))?;
        let _ = sdk_env::blob_announce_to_context(blob.as_ref(), &sdk_env::context_id());
        Ok(())
    }

    /// Append one version to an asset's history.
    fn record_version(&mut self, record: VersionRecord) -> app::Result<()> {
        // The blob is in the key so two versions written in the same millisecond —
        // two devices of one person — are two rows, not one row merged away.
        let author: String = record.author.chars().take(16).collect();
        let blob: String = record.blob_id.chars().take(16).collect();
        let key = format!(
            "{}/{:020}/{author}/{blob}",
            record.asset_id, record.created_at
        );
        let _ = self.history.get_mut()?.insert(key, record)?;
        Ok(())
    }

    // ── Meshes ────────────────────────────────────────────────────────────────

    /// Point a `mesh` object at a new blob of vertices, and record it as a new version.
    /// Editors only. Upload the blob to the node first (with this context's id, so it is
    /// announced); write the object before or with it — a mesh with no object is stored but
    /// drawn by nobody.
    ///
    /// To restore an earlier version, write its `blob_id` (from `list_history`) again.
    ///
    /// # Arguments
    /// * `mesh` - the reference; `author` and `updated_at` are set by the contract. At most
    ///   4 000 000 vertices, 8 000 000 triangles and 512 MiB.
    /// * `now` - the caller's clock, unix milliseconds.
    ///
    /// # Errors
    /// Fails if the caller is not an editor, the mesh is checked out by someone else, the
    /// blob id is not 64 hex characters, or a count or size is over its limit.
    ///
    /// # Examples
    /// ```json
    /// {"mesh":{"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90","blob_id":"4f9c3d1e2b7a8c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d","size":180,"vertex_count":3,"triangle_count":1,"has_uvs":false,"author":"","message":"blockout","updated_at":0},"now":1727000000000}
    /// ```
    pub fn put_mesh(&mut self, mesh: MeshRef, now: u64) -> app::Result<()> {
        self.require_editor()?;
        let mut mesh = mesh;
        validate_mesh_ref(&mesh)?;
        self.require_unlocked(std::iter::once(mesh.id.as_str()), now)?;
        Self::announce(&mesh.blob_id)?;
        let stored = self.meshes.get()?.get(&mesh.id)?.map(|m| m.updated_at);
        mesh.updated_at = Self::stamp(now, stored);
        mesh.author = Self::caller_id();
        mesh.message = clean_name(&mesh.message, "");
        self.record_version(VersionRecord {
            asset_id: mesh.id.clone(),
            kind: "mesh".to_owned(),
            blob_id: mesh.blob_id.clone(),
            size: mesh.size,
            a: mesh.vertex_count,
            b: mesh.triangle_count,
            author: mesh.author.clone(),
            message: mesh.message.clone(),
            created_at: mesh.updated_at,
        })?;
        let id = mesh.id.clone();
        let _ = self.meshes.get_mut()?.insert(id.clone(), mesh)?;
        app::emit!(Event::MeshChanged(id));
        Ok(())
    }

    /// Every mesh's current reference, ordered by id. A client compares each `blob_id`
    /// with what it holds and downloads only the blobs it lacks.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn list_meshes(&self) -> Vec<MeshRef> {
        let mut out: Vec<MeshRef> = self
            .meshes
            .get()
            .ok()
            .and_then(|m| m.entries().ok().map(|rows| rows.map(|(_, r)| r).collect()))
            .unwrap_or_default();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    // ── Textures ──────────────────────────────────────────────────────────────

    /// Add a texture, or point an existing one at a new image, and record it as a new
    /// version. Editors only. Upload the image blob first, with this context's id.
    ///
    /// # Arguments
    /// * `texture` - the reference; `author` and `updated_at` are set by the contract. At
    ///   most 16 384 pixels a side and 512 MiB.
    /// * `now` - the caller's clock, unix milliseconds.
    ///
    /// # Errors
    /// Fails if the caller is not an editor, the texture is checked out by someone else,
    /// the scene already holds 1 000 textures, the blob id is not 64 hex characters, the
    /// mime type or colour space is not one this app knows, or a size is over its limit.
    ///
    /// # Examples
    /// ```json
    /// {"texture":{"id":"tex-1","name":"Crate albedo","blob_id":"4f9c3d1e2b7a8c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d","size":524288,"width":2048,"height":2048,"mime":"image/png","color_space":"srgb","author":"","message":"","updated_at":0},"now":1727000000000}
    /// ```
    pub fn put_texture(&mut self, texture: TextureRef, now: u64) -> app::Result<()> {
        self.require_editor()?;
        let mut texture = texture;
        validate_texture_ref(&mut texture)?;
        self.require_unlocked(std::iter::once(texture.id.as_str()), now)?;
        let stored = self.textures.get()?.get(&texture.id)?.map(|t| t.updated_at);
        if stored.is_none() && self.textures.get()?.len()? >= MAX_TEXTURES {
            app::bail!("a scene holds at most {MAX_TEXTURES} textures");
        }
        Self::announce(&texture.blob_id)?;
        texture.updated_at = Self::stamp(now, stored);
        texture.author = Self::caller_id();
        self.record_version(VersionRecord {
            asset_id: texture.id.clone(),
            kind: "texture".to_owned(),
            blob_id: texture.blob_id.clone(),
            size: texture.size,
            a: texture.width,
            b: texture.height,
            author: texture.author.clone(),
            message: texture.message.clone(),
            created_at: texture.updated_at,
        })?;
        let id = texture.id.clone();
        let _ = self.textures.get_mut()?.insert(id.clone(), texture)?;
        app::emit!(Event::TextureChanged(id));
        Ok(())
    }

    /// Every texture's current reference, ordered by name, then id.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn list_textures(&self) -> Vec<TextureRef> {
        let mut out: Vec<TextureRef> = self
            .textures
            .get()
            .ok()
            .and_then(|m| m.entries().ok().map(|rows| rows.map(|(_, t)| t).collect()))
            .unwrap_or_default();
        out.sort_by(|a, b| (&a.name, &a.id).cmp(&(&b.name, &b.id)));
        out
    }

    /// Delete textures. Editors only. Materials that name a deleted texture simply draw
    /// without it. Their history is kept.
    ///
    /// # Arguments
    /// * `ids` - at most 200.
    /// * `now` - the caller's clock, unix milliseconds, for judging check-outs.
    ///
    /// # Errors
    /// Fails, deleting nothing, if the caller is not an editor, the batch is too large, or
    /// one of them is checked out by someone else.
    ///
    /// # Examples
    /// ```json
    /// {"ids":["tex-1"],"now":1727000000000}
    /// ```
    #[app::destructive]
    pub fn delete_textures(&mut self, ids: Vec<String>, now: u64) -> app::Result<()> {
        self.require_editor()?;
        require_batch(ids.len())?;
        self.require_unlocked(ids.iter().map(String::as_str), now)?;
        let textures = self.textures.get_mut()?;
        for id in &ids {
            if textures.contains(id)? {
                let _ = textures.remove(id)?;
            }
        }
        app::emit!(Event::TexturesDeleted(ids));
        Ok(())
    }

    // ── History ───────────────────────────────────────────────────────────────

    /// Every saved version of one mesh or texture, oldest first and numbered from 1, with
    /// the one in use marked `current`. At most the newest 500.
    ///
    /// # Arguments
    /// * `asset_id` - a mesh object's id or a texture's id.
    ///
    /// # Examples
    /// ```json
    /// {"asset_id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"}
    /// ```
    pub fn list_history(&self, asset_id: String) -> Vec<VersionView> {
        let current = self
            .meshes
            .get()
            .ok()
            .and_then(|m| m.get(&asset_id).ok().flatten().map(|r| r.blob_id.clone()))
            .or_else(|| {
                self.textures
                    .get()
                    .ok()
                    .and_then(|m| m.get(&asset_id).ok().flatten().map(|t| t.blob_id.clone()))
            })
            .unwrap_or_default();
        let prefix = format!("{asset_id}/");
        let rows: Vec<VersionRecord> = self
            .history
            .get()
            .ok()
            .and_then(|h| {
                h.prefix(prefix.as_bytes())
                    .ok()
                    .map(|it| it.map(|(_, v)| v).collect())
            })
            .unwrap_or_default();
        // The key is `<asset>/<stamp>/…`, and a stamp is never reused for one asset
        // on one node, so this order is the order versions were written in.
        let skip = rows.len().saturating_sub(MAX_HISTORY_VIEW);
        let last = rows.iter().rposition(|r| r.blob_id == current);
        rows.into_iter()
            .enumerate()
            .skip(skip)
            .map(|(i, r)| VersionView {
                number: (i + 1) as u32,
                kind: r.kind,
                current: Some(i) == last,
                blob_id: r.blob_id,
                size: r.size,
                a: r.a,
                b: r.b,
                author: r.author,
                message: r.message,
                created_at: r.created_at,
            })
            .collect()
    }

    // ── Check-out ─────────────────────────────────────────────────────────────

    /// Fail if any of `ids` is checked out, live, by someone other than the caller.
    fn require_unlocked<'a>(
        &self,
        ids: impl Iterator<Item = &'a str>,
        now: u64,
    ) -> app::Result<()> {
        let Ok(locks) = self.locks.get() else {
            return Ok(());
        };
        let me = Self::caller_id();
        for id in ids {
            if let Some(lock) = locks.get(id)? {
                if lock.holder != me && lock.expires_at > now {
                    let who = AccountId::from_str(&lock.holder)
                        .ok()
                        .and_then(|a| self.members.get_for_user(&a).ok().flatten())
                        .map_or_else(|| lock.holder.chars().take(8).collect(), |m| m.name);
                    app::bail!("{id} is checked out by {who}; ask them to check it in");
                }
            }
        }
        Ok(())
    }

    /// Check assets out, so nobody else can change them until the caller checks them in or
    /// the check-out lapses. Editors only. Checking out something the caller already holds
    /// extends it.
    ///
    /// # Arguments
    /// * `ids` - object or texture ids, at most 200.
    /// * `hours` - how long the check-out lasts, 1 to 168.
    /// * `now` - the caller's clock, unix milliseconds.
    ///
    /// # Errors
    /// Fails, checking out nothing, if the caller is not an editor, the batch is too large,
    /// or one of them is checked out, live, by someone else.
    ///
    /// # Examples
    /// ```json
    /// {"ids":["5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"],"hours":8,"now":1727000000000}
    /// ```
    pub fn check_out(&mut self, ids: Vec<String>, hours: u32, now: u64) -> app::Result<()> {
        self.require_editor()?;
        require_batch(ids.len())?;
        self.require_unlocked(ids.iter().map(String::as_str), now)?;
        let hours = u64::from(hours.clamp(1, MAX_LOCK_HOURS));
        let me = Self::caller_id();
        let locks = self.locks.get_mut()?;
        for id in &ids {
            if id.is_empty() || id.len() > 64 {
                app::bail!("an asset id is 1 to 64 characters");
            }
            let prior = locks.get(id)?.map(|l| l.clone());
            let since = prior
                .as_ref()
                .filter(|l| l.holder == me && l.expires_at > now)
                .map_or(now, |l| l.since);
            let lock = Lock {
                asset_id: id.clone(),
                holder: me.clone(),
                since,
                expires_at: now.saturating_add(hours * 3_600_000),
                updated_at: Self::stamp(now, prior.map(|l| l.updated_at)),
            };
            let _ = locks.insert(id.clone(), lock)?;
        }
        app::emit!(Event::LocksChanged(ids));
        Ok(())
    }

    /// Check assets back in. Editors may check in their own; an admin may release anyone's
    /// (breaking a lock left by someone who is away). Ids not checked out are fine.
    ///
    /// # Arguments
    /// * `ids` - at most 200.
    ///
    /// # Errors
    /// Fails, releasing nothing, if the caller is not an editor, the batch is too large, or
    /// a non-admin names someone else's check-out.
    ///
    /// # Examples
    /// ```json
    /// {"ids":["5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"]}
    /// ```
    pub fn check_in(&mut self, ids: Vec<String>) -> app::Result<()> {
        self.require_editor()?;
        require_batch(ids.len())?;
        let me = Self::caller_id();
        let admin = self.roles.is_admin(&Self::caller_account());
        let locks = self.locks.get_mut()?;
        for id in &ids {
            if let Some(lock) = locks.get(id)? {
                if lock.holder != me && !admin {
                    app::bail!(
                        "{id} is someone else's check-out; only they or an admin can release it"
                    );
                }
            }
        }
        for id in &ids {
            if locks.contains(id)? {
                let _ = locks.remove(id)?;
            }
        }
        app::emit!(Event::LocksChanged(ids));
        Ok(())
    }

    /// Every check-out still live at `now`, ordered by asset id.
    ///
    /// # Arguments
    /// * `now` - the caller's clock, unix milliseconds.
    ///
    /// # Examples
    /// ```json
    /// {"now":1727000000000}
    /// ```
    pub fn list_locks(&self, now: u64) -> Vec<LockView> {
        let me = Self::caller_id();
        let mut out: Vec<LockView> = self
            .locks
            .get()
            .ok()
            .and_then(|m| {
                m.entries()
                    .ok()
                    .map(|rows| rows.map(|(_, l)| l).collect::<Vec<_>>())
            })
            .unwrap_or_default()
            .into_iter()
            .filter(|l| l.expires_at > now)
            .map(|l| LockView {
                mine: l.holder == me,
                asset_id: l.asset_id,
                holder: l.holder,
                since: l.since,
                expires_at: l.expires_at,
            })
            .collect();
        out.sort_by(|a, b| a.asset_id.cmp(&b.asset_id));
        out
    }

    // ── Members ───────────────────────────────────────────────────────────────

    /// Introduce the caller to the scene, or change the name they are shown by. Anyone in
    /// the context may; it grants no editing rights.
    ///
    /// # Arguments
    /// * `name` - display name, at most 80 characters; empty becomes `"Guest"`.
    /// * `now` - the caller's clock, unix milliseconds.
    ///
    /// # Examples
    /// ```json
    /// {"name":"Ada","now":1727000000000}
    /// ```
    pub fn join(&mut self, name: String, now: u64) -> app::Result<()> {
        let name = clean_name(&name, "Guest");
        let existing = self.members.get()?;
        if existing.as_ref().is_some_and(|m| m.name == name) {
            return Ok(());
        }
        let member = Member {
            id: Self::caller_id(),
            name,
            joined_at: existing.as_ref().map_or(now, |m| m.joined_at),
            updated_at: Self::stamp(now, existing.map(|m| m.updated_at)),
        };
        let _ = self.members.insert(member)?;
        app::emit!(Event::MemberChanged(Self::caller_id()));
        Ok(())
    }

    /// Everyone who has joined, with their effective role, oldest first. An admin or
    /// editor who has never opened the scene is listed too, named by their id.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn get_members(&self) -> Vec<MemberView> {
        let mut out: Vec<MemberView> = self
            .members
            .entries()
            .map(|rows| {
                rows.map(|(account, m)| MemberView {
                    // The slot's key, not the stored field: only the key is
                    // the account that wrote it.
                    id: account.to_string(),
                    name: m.name,
                    role: self.role_label(&account),
                    joined_at: m.joined_at,
                })
                .collect()
            })
            .unwrap_or_default();
        out.sort_by(|a, b| (a.joined_at, &a.id).cmp(&(b.joined_at, &b.id)));
        out
    }

    // ── Roles ─────────────────────────────────────────────────────────────────

    /// Let a member change the scene. Admin only.
    ///
    /// # Arguments
    /// * `member` - their member id (account id). They need not have joined yet.
    ///
    /// # Errors
    /// Fails if the caller is not an admin or `member` is not an account id.
    ///
    /// # Examples
    /// ```json
    /// {"member":"<member id from get_members>"}
    /// ```
    pub fn grant_editor(&mut self, member: String) -> app::Result<()> {
        let who = require_account(&member)?;
        self.require_admin()?;
        self.roles.grant(ROLE_EDITOR, who)?;
        self.project_roles()?;
        app::emit!(Event::RoleChanged(member));
        Ok(())
    }

    /// Make a member a viewer again. Admin only; an admin's own role is unaffected.
    ///
    /// # Arguments
    /// * `member` - their member id (account id).
    ///
    /// # Errors
    /// Fails if the caller is not an admin or `member` is not an account id.
    ///
    /// # Examples
    /// ```json
    /// {"member":"<member id from get_members>"}
    /// ```
    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        let who = require_account(&member)?;
        self.require_admin()?;
        self.roles.revoke(ROLE_EDITOR, &who)?;
        self.project_roles()?;
        app::emit!(Event::RoleChanged(member));
        Ok(())
    }

    /// The caller's effective role: `admin`, `editor` or `viewer`.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn my_role(&self) -> String {
        self.role_label(&Self::caller_account())
    }
}

// ── Validation ────────────────────────────────────────────────────────────────

fn require_batch(len: usize) -> app::Result<()> {
    if len > MAX_BATCH {
        app::bail!("one call writes at most {MAX_BATCH} objects, got {len}");
    }
    Ok(())
}

fn require_account(member: &str) -> app::Result<AccountId> {
    AccountId::from_str(member).map_err(|_| {
        app::err!("that is not a member id — expected the account id the members list shows")
    })
}

/// `#rrggbb`, nothing else: the value is handed straight to a renderer on every
/// member's screen.
fn require_color(c: &str) -> app::Result<()> {
    let ok = c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if !ok {
        app::bail!("a colour is #rrggbb, got {c:?}");
    }
    Ok(())
}

/// Trim, drop control characters, bound the length; `fallback` when nothing is left.
fn clean_name(name: &str, fallback: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_LEN)
        .collect::<String>()
        .trim()
        .to_owned();
    if cleaned.is_empty() {
        fallback.to_owned()
    } else {
        cleaned
    }
}

fn default_environment() -> Environment {
    Environment {
        name: String::new(),
        background: "#24262b".to_owned(),
        ambient_color: "#ffffff".to_owned(),
        ambient_intensity: 0.35,
        updated_at: 0,
    }
}

/// Check one object and bring its numbers into range. Rejects what a renderer
/// cannot draw; clamps what is merely out of range.
pub(crate) fn validate_object(mut obj: SceneObject) -> app::Result<SceneObject> {
    if obj.id.is_empty() || obj.id.len() > 64 {
        app::bail!("an object id is 1 to 64 characters");
    }
    if !OBJECT_KINDS.contains(&obj.kind.as_str()) {
        app::bail!("unknown object kind {:?}", obj.kind);
    }
    if obj.parent == obj.id {
        app::bail!("an object cannot be its own parent");
    }
    if obj.parent.len() > 64 {
        app::bail!("a parent id is at most 64 characters");
    }
    for v in [&obj.position, &obj.rotation, &obj.scale] {
        if !v.is_finite() {
            app::bail!("{:?}: transforms must be finite numbers", obj.name);
        }
    }
    let m = &mut obj.material;
    require_color(&m.color)?;
    require_color(&m.emissive)?;
    for x in [m.metalness, m.roughness, m.opacity, obj.intensity] {
        if !x.is_finite() {
            app::bail!("{:?}: material values must be finite numbers", obj.name);
        }
    }
    for map in [
        &m.base_color_map,
        &m.normal_map,
        &m.orm_map,
        &m.emissive_map,
    ] {
        if map.len() > 64 {
            app::bail!("{:?}: a texture id is at most 64 characters", obj.name);
        }
    }
    if !m.normal_scale.is_finite() {
        app::bail!("{:?}: material values must be finite numbers", obj.name);
    }
    m.normal_scale = m.normal_scale.clamp(0.0, 10.0);
    m.metalness = m.metalness.clamp(0.0, 1.0);
    m.roughness = m.roughness.clamp(0.0, 1.0);
    m.opacity = m.opacity.clamp(0.0, 1.0);
    obj.intensity = obj.intensity.clamp(0.0, 1_000.0);
    obj.segments = obj.segments.clamp(3, 128);
    obj.name = clean_name(&obj.name, &obj.kind);
    Ok(obj)
}

/// A 64-character hex blob id, the form the node returns from an upload.
fn require_blob_id(blob_id: &str) -> app::Result<()> {
    if blob_id.len() != 64 || !blob_id.chars().all(|c| c.is_ascii_hexdigit()) {
        app::bail!("{blob_id:?} is not a blob id — expected 64 hex characters");
    }
    Ok(())
}

pub(crate) fn validate_mesh_ref(mesh: &MeshRef) -> app::Result<()> {
    if mesh.id.is_empty() || mesh.id.len() > 64 {
        app::bail!("a mesh id is 1 to 64 characters");
    }
    require_blob_id(&mesh.blob_id)?;
    if mesh.vertex_count > MAX_VERTICES {
        app::bail!(
            "a mesh holds at most {MAX_VERTICES} vertices, got {}",
            mesh.vertex_count
        );
    }
    if mesh.triangle_count > MAX_TRIANGLES {
        app::bail!(
            "a mesh holds at most {MAX_TRIANGLES} triangles, got {}",
            mesh.triangle_count
        );
    }
    if mesh.size == 0 || mesh.size > MAX_BLOB_BYTES {
        app::bail!(
            "a mesh blob is 1 byte to {MAX_BLOB_BYTES} bytes, got {}",
            mesh.size
        );
    }
    Ok(())
}

pub(crate) fn validate_texture_ref(texture: &mut TextureRef) -> app::Result<()> {
    if texture.id.is_empty() || texture.id.len() > 64 {
        app::bail!("a texture id is 1 to 64 characters");
    }
    require_blob_id(&texture.blob_id)?;
    if texture.width == 0
        || texture.height == 0
        || texture.width > MAX_TEXTURE_SIDE
        || texture.height > MAX_TEXTURE_SIDE
    {
        app::bail!("a texture is 1 to {MAX_TEXTURE_SIDE} pixels a side");
    }
    if texture.size == 0 || texture.size > MAX_BLOB_BYTES {
        app::bail!(
            "a texture blob is 1 byte to {MAX_BLOB_BYTES} bytes, got {}",
            texture.size
        );
    }
    if !["image/png", "image/jpeg", "image/webp"].contains(&texture.mime.as_str()) {
        app::bail!(
            "a texture is image/png, image/jpeg or image/webp, got {:?}",
            texture.mime
        );
    }
    if !["srgb", "linear"].contains(&texture.color_space.as_str()) {
        app::bail!("a texture's colour space is srgb or linear");
    }
    texture.name = clean_name(&texture.name, "Texture");
    texture.message = clean_name(&texture.message, "");
    Ok(())
}
