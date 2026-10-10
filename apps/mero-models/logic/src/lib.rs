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
//! **Geometry lives apart from the object.** A mesh can be tens of thousands
//! of vertices, and moving an object must not rewrite them, so vertex data is
//! a second map keyed by the same id. The object carries the transform; the
//! mesh carries the shape.
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
use calimero_sdk::{app, env as sdk_env, AccountId};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AccessControl, Frozen, Mergeable as MergeableTrait, PermissionedStorage, ProtocolAuthorizer,
    UnorderedMap, UserStorage,
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

/// Vertices one mesh may carry. A sculpted-detail mesh belongs in a file, not
/// in a replicated delta every member has to store; the frontend decimates or
/// refuses an import above this.
pub const MAX_VERTICES: usize = 30_000;

/// Triangles one mesh may carry.
pub const MAX_TRIANGLES: usize = 60_000;

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

/// A triangle mesh: the shape of a `mesh` object, in its own local space.
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MeshData {
    /// The object this is the shape of.
    pub id: ObjectId,
    /// `x, y, z` per vertex, flattened.
    pub positions: Vec<f32>,
    /// Three vertex indices per triangle, counter-clockwise when seen from outside.
    pub indices: Vec<u32>,
    /// Set by the contract like an object's.
    pub updated_at: u64,
}

calimero_storage::impl_atomic_lww_leaf!(MeshData, updated_at);

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
    pub member_count: u32,
    /// The caller's account id.
    pub me: MemberId,
    /// `admin`, `editor` or `viewer`.
    pub my_role: String,
}

/// A mesh's identity and size without its vertices, so a client can tell which meshes it
/// already holds before downloading any.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
pub struct MeshStamp {
    pub id: ObjectId,
    pub updated_at: u64,
    pub vertex_count: u32,
    pub triangle_count: u32,
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
    /// Vertex data for `mesh` objects, keyed by the object's id. Guarded like `objects`.
    meshes: PermissionedStorage<UnorderedMap<ObjectId, MeshData>, ProtocolAuthorizer>,
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
    /// scene would exceed 2000 objects, or an object is malformed (unknown kind, a
    /// non-finite number, a bad colour, an object parented to itself).
    ///
    /// # Examples
    /// ```json
    /// {"objects":[{"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90","name":"Cube","kind":"cube","parent":"","position":{"x":0,"y":0.5,"z":0},"rotation":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1},"visible":true,"material":{"color":"#c8ccd4","metalness":0,"roughness":0.6,"opacity":1,"emissive":"#000000","wireframe":false,"flat_shading":false},"segments":32,"intensity":0,"created_by":"","created_at":0,"updated_at":0}],"now":1727000000000}
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
    /// the same call to remove a whole branch. Emits one `ObjectsDeleted` event.
    ///
    /// # Arguments
    /// * `ids` - at most 200.
    ///
    /// # Errors
    /// Fails, deleting nothing, if the caller is not an editor or the batch is too large.
    ///
    /// # Examples
    /// ```json
    /// {"ids":["5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"]}
    /// ```
    #[app::destructive]
    pub fn delete_objects(&mut self, ids: Vec<String>) -> app::Result<()> {
        self.require_editor()?;
        require_batch(ids.len())?;
        if ids.is_empty() {
            return Ok(());
        }
        {
            let objects = self.objects.get_mut()?;
            for id in &ids {
                let _ = objects.remove(id)?;
            }
        }
        let meshes = self.meshes.get_mut()?;
        for id in &ids {
            if meshes.contains(id)? {
                let _ = meshes.remove(id)?;
            }
        }
        app::emit!(Event::ObjectsDeleted(ids));
        Ok(())
    }

    /// Remove every object and mesh. Admin only.
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
        app::emit!(Event::SceneCleared());
        Ok(())
    }

    // ── Meshes ────────────────────────────────────────────────────────────────

    /// Set the vertices of a `mesh` object. Editors only. Write the object first, or in the
    /// same session: a mesh with no object is stored but drawn by nobody.
    ///
    /// # Arguments
    /// * `mesh` - at most 30 000 vertices and 60 000 triangles; `updated_at` is set by the
    ///   contract.
    /// * `now` - the caller's clock, unix milliseconds.
    ///
    /// # Errors
    /// Fails if the caller is not an editor, the mesh is too large, `positions` is not a
    /// whole number of vertices, an index points past the last vertex, or a coordinate is
    /// not finite.
    ///
    /// # Examples
    /// ```json
    /// {"mesh":{"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90","positions":[0,0,0,1,0,0,0,1,0],"indices":[0,1,2],"updated_at":0},"now":1727000000000}
    /// ```
    pub fn put_mesh(&mut self, mesh: MeshData, now: u64) -> app::Result<()> {
        self.require_editor()?;
        let mut mesh = mesh;
        validate_mesh(&mesh)?;
        let stored = self.meshes.get()?.get(&mesh.id)?.map(|m| m.updated_at);
        mesh.updated_at = Self::stamp(now, stored);
        let id = mesh.id.clone();
        let _ = self.meshes.get_mut()?.insert(id.clone(), mesh)?;
        app::emit!(Event::MeshChanged(id));
        Ok(())
    }

    /// Every stored mesh's id, version and size — no vertices. Compare `updated_at` with
    /// what you hold and fetch only what changed with `get_meshes`.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn list_meshes(&self) -> Vec<MeshStamp> {
        let Ok(map) = self.meshes.get() else {
            return Vec::new();
        };
        let Ok(rows) = map.entries() else {
            return Vec::new();
        };
        let mut out: Vec<MeshStamp> = rows
            .map(|(id, m)| MeshStamp {
                id,
                updated_at: m.updated_at,
                vertex_count: (m.positions.len() / 3) as u32,
                triangle_count: (m.indices.len() / 3) as u32,
            })
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// Meshes by object id, in the order asked; unknown ids are left out.
    ///
    /// # Examples
    /// ```json
    /// {"ids":["5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"]}
    /// ```
    pub fn get_meshes(&self, ids: Vec<String>) -> Vec<MeshData> {
        let Ok(map) = self.meshes.get() else {
            return Vec::new();
        };
        ids.iter()
            .filter_map(|id| map.get(id).ok().flatten().map(|m| m.clone()))
            .collect()
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
    m.metalness = m.metalness.clamp(0.0, 1.0);
    m.roughness = m.roughness.clamp(0.0, 1.0);
    m.opacity = m.opacity.clamp(0.0, 1.0);
    obj.intensity = obj.intensity.clamp(0.0, 1_000.0);
    obj.segments = obj.segments.clamp(3, 128);
    obj.name = clean_name(&obj.name, &obj.kind);
    Ok(obj)
}

pub(crate) fn validate_mesh(mesh: &MeshData) -> app::Result<()> {
    if mesh.id.is_empty() || mesh.id.len() > 64 {
        app::bail!("a mesh id is 1 to 64 characters");
    }
    if !mesh.positions.len().is_multiple_of(3) || !mesh.indices.len().is_multiple_of(3) {
        app::bail!("positions and indices both come in threes");
    }
    let vertices = mesh.positions.len() / 3;
    if vertices > MAX_VERTICES {
        app::bail!("a mesh holds at most {MAX_VERTICES} vertices, got {vertices}");
    }
    let triangles = mesh.indices.len() / 3;
    if triangles > MAX_TRIANGLES {
        app::bail!("a mesh holds at most {MAX_TRIANGLES} triangles, got {triangles}");
    }
    if mesh.positions.iter().any(|p| !p.is_finite()) {
        app::bail!("vertex positions must be finite numbers");
    }
    if mesh.indices.iter().any(|&i| i as usize >= vertices) {
        app::bail!("a triangle refers to a vertex the mesh does not have");
    }
    Ok(())
}
