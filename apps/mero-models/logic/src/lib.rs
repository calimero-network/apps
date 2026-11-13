//! Mero Models — a collaborative 3D modelling scene, on core's component SDK.
//!
//! A scene is one app instance: a set of objects (primitives, imported or
//! edited meshes, lights and empty groups), each with a transform, a material
//! and a parent. Everyone the instance reaches sees the same scene, and an
//! editor's change is everyone's at once.
//!
//! ## What is stored
//!
//! **One record per object; a later write replaces an earlier one.** The app
//! runs on its cluster's leader, which applies every write in one replicated
//! log, so two people dragging the same cube end with the write the log
//! ordered last, whole. v1's whole-record LWW leaves (`impl_atomic_lww_leaf!`)
//! have nothing left to decide. `updated_at` is still the contract's own
//! version stamp, always moved past the stored value (see [`stamp`]): it is
//! what lets a client tell a changed mesh from one it already holds.
//!
//! **Heavy data lives in blobs; state holds references.** A production mesh is
//! hundreds of thousands of vertices and a texture is megabytes, far more than
//! belongs in a stored record. So the vertices and the pixels are the app's
//! own blobs (`POST /apps/{app}/blobs`), and state holds a small [`MeshRef`]
//! or [`TextureRef`]: the blob id, its size and what is in it. Moving an
//! object never touches its mesh; replacing a mesh is one new blob and one
//! small record. Stored rows hold the id as a [`BlobRef`], core's typed
//! reference, so a node that tracks blob references keeps every blob a row
//! names (see `src/blob.rs`).
//!
//! **One blob is at most [`MAX_BLOB_BYTES`] (47.25 MiB).** A blob reaches the
//! other nodes base64-encoded inside one sealed request of at most 64 MiB, with
//! 1 MiB kept for the rest (core's `node::MAX_BLOB_BYTES`). v1 allowed 512 MiB.
//! The mesh format is deflated (about 10 to 20 bytes a vertex for a typical
//! scan or sculpt), so a mesh of a few million vertices fits; one that does
//! not is refused when it is saved, and the editor says so before uploading.
//!
//! **Every version is kept.** Each mesh or texture write also adds a
//! [`VersionRecord`] to `history`, keyed by asset and a per-asset sequence
//! number, so any earlier version can be listed and restored. Restoring is
//! writing the old blob id again; a history row is a reference too, so the
//! blob of every version listed is still there to restore.
//!
//! **Check-out locks are coordination.** An editor checks an asset out; while
//! the lock is live, every write to it by anyone else is refused. Locks expire,
//! and an admin can break one.
//!
//! **The hierarchy is derived on read.** An object names its `parent`; a
//! parent that no longer exists, or a chain that loops back on itself, reads
//! as a root object — see [`resolve_parents`].
//!
//! **Presence is not stored at all.** Who is looking at what, and what they
//! have selected, streams over the app's presence channel from the frontend.
//!
//! ## Who may do what
//!
//! v1 kept the editor role in storage (`PermissionedStorage` capability maps
//! re-checked on every node at merge, an `AccessControl` with the creator as
//! admin). Here every write goes through a method, so the rules are checks in
//! each method against `env::caller()`:
//!
//! | role | who | may |
//! | --- | --- | --- |
//! | admin | the instance's owner (its creator), and the org's admins and owner | everything an editor may, plus `grantEditor`, `revokeEditor`, `clearScene`, and breaking anyone's check-out |
//! | editor | an account an admin granted the role | change the scene: objects, meshes, textures, environment, check-outs |
//! | viewer | everyone else the instance reaches (org members and guests) | read everything; `join` |
//!
//! Every change a client sees (camelCase method and argument names, `now` as a
//! decimal string, the error shape, event payloads) is listed in
//! `apps/mero-models/README.md`, "What changed in the port".

mod blob;

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::prelude::*;
use calimero_sdk::OrgRole;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

pub use blob::BlobRef;

// ── Limits ────────────────────────────────────────────────────────────────────

/// Objects one call may write or delete. A paste, an import or a multi-select
/// drag is one call; bounding it bounds a single log entry.
pub const MAX_BATCH: usize = 200;

/// Objects one scene may hold. Every read returns the whole list, so this is
/// what keeps a read cheap.
pub const MAX_OBJECTS: u64 = 2_000;

/// Vertices one mesh may carry. The vertices live in a blob, so this bounds
/// what a member's browser has to hold, not what state holds.
pub const MAX_VERTICES: u32 = 4_000_000;

/// Triangles one mesh may carry.
pub const MAX_TRIANGLES: u32 = 8_000_000;

/// The largest blob a mesh or texture may name, in bytes: 47.25 MiB, the
/// largest blob a node keeps (core's `node::MAX_BLOB_BYTES`,
/// `(64 MiB − 1 MiB) / 4 × 3`: a blob travels base64-encoded inside one sealed
/// request). A reference to anything larger names a blob no upload produced.
pub const MAX_BLOB_BYTES: u64 = 49_545_216;

/// The largest texture side, in pixels.
pub const MAX_TEXTURE_SIDE: u32 = 16_384;

/// Textures one scene may hold.
pub const MAX_TEXTURES: u64 = 1_000;

/// The longest a check-out may last before it lapses, in hours.
pub const MAX_LOCK_HOURS: u32 = 168;

/// The most history rows `listHistory` returns, newest kept.
pub const MAX_HISTORY_VIEW: u32 = 500;

/// Longest object or scene name, in characters.
pub const MAX_NAME_LEN: usize = 80;

/// Longest account id `grantEditor` takes (a cluster's ids are 64 hex digits).
const MAX_ACCOUNT_LEN: usize = 128;

/// One page of a map read.
const PAGE: u32 = 1000;

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

// ── Records ───────────────────────────────────────────────────────────────────
//
// Plain serde structs: their fields stay snake_case on the wire, as in v1, and
// their `u64` fields stay JSON numbers (unix milliseconds and byte sizes, all
// far below 2^53), which `#[abi(plain)]` describes (`u64_number`). Only a `u64`
// that is a method's own parameter (`now`) travels as a decimal string.

/// A point or a direction in scene units, or Euler angles in radians.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, AbiType)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    fn is_finite(&self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

/// How an object's surface looks. A light reads `color` as its light colour.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
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
    /// Texture id packing occlusion (R), roughness (G) and metalness (B), or `""`.
    pub orm_map: String,
    /// Texture id for emission, or `""`.
    pub emissive_map: String,
}

/// One object in the scene.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[abi(plain)]
pub struct SceneObject {
    /// Chosen by the caller; use a fresh UUID. Writing an existing id replaces that object.
    pub id: String,
    /// Shown in the outliner.
    pub name: String,
    /// One of [`OBJECT_KINDS`]. A `mesh` takes its shape from `putMesh` under the same id.
    pub kind: String,
    /// The parent object's id, or `""` for a root object. A parent that does not exist,
    /// or a chain that loops, reads as `""`.
    pub parent: String,
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
    pub created_by: String,
    /// Creation time, unix milliseconds. Kept from the first write.
    pub created_at: u64,
    /// Last change, unix milliseconds. The contract moves it past the stored value,
    /// so it only ever grows; the value sent is a hint.
    pub updated_at: u64,
}

/// The shape of a `mesh` object: a reference to the blob holding its vertices,
/// as sent and answered. Stored as a [`MeshRow`].
///
/// The blob is the app's binary mesh format (the frontend's `meshcodec.ts`).
/// The contract cannot read it; `vertex_count` and friends are what the writer
/// says is inside, and a reader checks them against what it decodes.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[abi(plain)]
pub struct MeshRef {
    /// The object this is the shape of.
    pub id: String,
    /// The blob, as the 64-character lowercase hex id the upload answered.
    pub blob_id: String,
    /// The blob's length in bytes, at most [`MAX_BLOB_BYTES`].
    pub size: u64,
    pub vertex_count: u32,
    pub triangle_count: u32,
    /// Whether the mesh carries texture coordinates.
    pub has_uvs: bool,
    /// Who wrote this version. Set by the contract.
    pub author: String,
    /// A note for the history ("retopo pass", "Restored v3"); may be empty.
    pub message: String,
    /// Set by the contract; only ever grows.
    pub updated_at: u64,
}

/// An image a material can use, held in a blob, as sent and answered. Stored
/// as a [`TextureRow`].
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[abi(plain)]
pub struct TextureRef {
    /// Chosen by the caller; use a fresh UUID.
    pub id: String,
    pub name: String,
    /// The blob, as a 64-character lowercase hex id.
    pub blob_id: String,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    /// `image/png`, `image/jpeg` or `image/webp`.
    pub mime: String,
    /// `srgb` for colour, `linear` for data (normal, ORM).
    pub color_space: String,
    /// Set by the contract.
    pub author: String,
    pub message: String,
    /// Set by the contract; only ever grows.
    pub updated_at: u64,
}

/// One saved version of a mesh or a texture. Written once per write and never
/// changed; restoring writes a new one.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct VersionRecord {
    /// The mesh's object id or the texture's id.
    pub asset_id: String,
    /// `mesh` or `texture`.
    pub kind: String,
    /// A reference, so the blob of every listed version is kept.
    pub blob: BlobRef,
    pub size: u64,
    /// Vertices and triangles for a mesh; width and height for a texture.
    pub a: u32,
    pub b: u32,
    pub author: String,
    pub message: String,
    pub created_at: u64,
}

/// A stored [`MeshRef`]: the same fields, the blob as a typed reference.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MeshRow {
    pub blob: BlobRef,
    pub size: u64,
    pub vertex_count: u32,
    pub triangle_count: u32,
    pub has_uvs: bool,
    pub author: String,
    pub message: String,
    pub updated_at: u64,
}

/// A stored [`TextureRef`]: the same fields, the blob as a typed reference.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TextureRow {
    pub name: String,
    pub blob: BlobRef,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    pub mime: String,
    pub color_space: String,
    pub author: String,
    pub message: String,
    pub updated_at: u64,
}

/// A check-out: one editor holding an asset until they check it in or it lapses.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Lock {
    pub asset_id: String,
    /// Set by the contract.
    pub holder: String,
    pub since: u64,
    /// After this (the holder's clock, unix milliseconds) the lock no longer holds.
    pub expires_at: u64,
    pub updated_at: u64,
}

/// What surrounds the scene: its name, the background and the ambient light.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[abi(plain)]
pub struct Environment {
    /// The scene's name; `""` shows the instance's name (the frontend fills it in).
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

/// Someone who has opened the scene, as they describe themselves.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Member {
    pub name: String,
    pub joined_at: u64,
    pub updated_at: u64,
}

// ── Views ─────────────────────────────────────────────────────────────────────

/// The scene's header: name, environment, counts, and what the caller may do.
#[derive(Serialize, Clone, Debug, AbiType)]
pub struct SceneInfo {
    pub name: String,
    pub environment: Environment,
    pub object_count: u32,
    pub mesh_count: u32,
    pub texture_count: u32,
    pub member_count: u32,
    /// The caller's account id.
    pub me: String,
    /// `admin`, `editor` or `viewer`.
    pub my_role: String,
}

/// One row of an asset's history, numbered from 1 in the order it was written.
#[derive(Serialize, Clone, Debug, AbiType)]
#[abi(plain)]
pub struct VersionView {
    /// 1 for the first version.
    pub number: u32,
    pub kind: String,
    pub blob_id: String,
    pub size: u64,
    /// Vertices (mesh) or width (texture).
    pub a: u32,
    /// Triangles (mesh) or height (texture).
    pub b: u32,
    pub author: String,
    pub message: String,
    pub created_at: u64,
    /// Whether this is the blob the asset points at now.
    pub current: bool,
}

/// A live check-out.
#[derive(Serialize, Clone, Debug, AbiType)]
#[abi(plain)]
pub struct LockView {
    pub asset_id: String,
    pub holder: String,
    pub since: u64,
    pub expires_at: u64,
    /// Whether the caller holds it.
    pub mine: bool,
}

/// A member with their effective role.
#[derive(Serialize, Clone, Debug, AbiType)]
#[abi(plain)]
pub struct MemberView {
    pub id: String,
    pub name: String,
    /// `admin`, `editor` or `viewer`.
    pub role: String,
    pub joined_at: u64,
}

// ── State ─────────────────────────────────────────────────────────────────────

#[app::state(version = 1)]
pub struct MeroModels {
    /// Every object, keyed by id. At most [`MAX_OBJECTS`], enforced by `putObjects`.
    objects: UnorderedMap<String, SceneObject>,
    /// The current blob of every `mesh` object, keyed by the object's id.
    meshes: UnorderedMap<String, MeshRow>,
    /// Every texture, keyed by id. At most [`MAX_TEXTURES`], enforced by `putTexture`.
    textures: UnorderedMap<String, TextureRow>,
    /// Every version of every mesh and texture, keyed `(asset, number)`, so one
    /// asset's history is a prefix read in order.
    history: UnorderedMap<(String, u64), VersionRecord>,
    /// The number of the last version of each asset.
    history_len: UnorderedMap<String, u64>,
    /// Live and lapsed check-outs, keyed by asset id.
    locks: UnorderedMap<String, Lock>,
    /// The name, background and ambient light; defaults until the first edit.
    environment: Cell<Environment>,
    /// One profile per account, written only by that account (`join`).
    members: UnorderedMap<String, Member>,
    /// Accounts an admin granted the editor role.
    editors: Set<String>,
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire. v1
/// failed with a message only; the message is kept as a field.
#[app::error]
pub enum Error {
    /// The caller's role does not allow this (a viewer editing, an editor doing
    /// an admin's job, releasing someone else's check-out).
    Forbidden { message: String },
    /// An argument broke a rule; `message` says which.
    Invalid { message: String },
    /// An asset is checked out by someone else.
    Locked { message: String },
}

/// What changed, so an open client knows what to re-read. A nudge, not the truth:
/// the payload names ids, and a client re-reads them.
#[app::event]
pub enum Event {
    /// Objects were added or changed.
    ObjectsChanged { ids: Vec<String> },
    /// Objects were deleted; the ids the call named.
    ObjectsDeleted { ids: Vec<String> },
    /// A mesh's vertices changed; its object id.
    MeshChanged { id: String },
    /// A texture was added or replaced.
    TextureChanged { id: String },
    /// Textures were deleted; the ids the call named.
    TexturesDeleted { ids: Vec<String> },
    /// Assets were checked out or in.
    LocksChanged { ids: Vec<String> },
    /// The name, background or ambient light changed.
    EnvironmentChanged,
    /// Every object was removed.
    SceneCleared,
    /// A member joined or renamed themselves; their account id.
    MemberChanged { member: String },
    /// A member's role changed; the id the caller passed.
    RoleChanged { member: String },
}

#[app::logic]
impl MeroModels {
    /// The empty scene. The node runs it once, when the instance is created; its
    /// creator (the instance's owner) is the scene's admin. The environment reads
    /// as defaults until the first edit, and the scene's name until then is the
    /// instance's name, which the frontend shows.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    // ── Scene ─────────────────────────────────────────────────────────────

    /// The scene's name and environment, its size, and the caller's id and role.
    #[app::view]
    pub fn get_scene(&self) -> app::Result<SceneInfo> {
        let environment = self.environment_or_default()?;
        let me = me()?;
        Ok(SceneInfo {
            name: environment.name.clone(),
            environment,
            object_count: count(self.objects.len()?),
            mesh_count: count(self.meshes.len()?),
            texture_count: count(self.textures.len()?),
            member_count: count(self.members.len()?),
            my_role: self.role_label(&me)?,
            me,
        })
    }

    /// Rename the scene, or change its background or ambient light. Editors only.
    /// `environment` is the whole environment (`updated_at` is set by the
    /// contract); `now` is the caller's clock, unix milliseconds. `Invalid` when a
    /// colour is not `#rrggbb`. Emits `EnvironmentChanged`.
    pub fn set_environment(&mut self, environment: Environment, now: u64) -> app::Result<()> {
        self.require_editor()?;
        let mut next = environment;
        next.name = clean_name(&next.name, "");
        require_color(&next.background)?;
        require_color(&next.ambient_color)?;
        if !next.ambient_intensity.is_finite() {
            return Err(invalid("ambient_intensity must be a number"));
        }
        next.ambient_intensity = next.ambient_intensity.clamp(0.0, 10.0);
        let stored = self.environment.get()?.map(|e| e.updated_at);
        next.updated_at = stamp(now, stored);
        self.environment.set(&next)?;
        env::emit(Event::EnvironmentChanged, Audience::All)?;
        Ok(())
    }

    // ── Objects ───────────────────────────────────────────────────────────

    /// Every object in the scene (at most 2,000), with each `parent` resolved: a
    /// missing parent or a loop reads as `""`. Ordered by creation, then id.
    #[app::view]
    pub fn get_objects(&self) -> app::Result<Vec<SceneObject>> {
        let mut out: Vec<SceneObject> = read_all(&self.objects)?
            .into_iter()
            .map(|(_, o)| o)
            .collect();
        out.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
        resolve_parents(&mut out);
        Ok(out)
    }

    /// Several objects by id, in the order asked; unknown ids are left out. Parents
    /// are returned as stored — resolve them against `getObjects`. At most 200 ids.
    #[app::view]
    pub fn get_objects_by_ids(&self, ids: Vec<String>) -> app::Result<Vec<SceneObject>> {
        require_batch(ids.len())?;
        let mut out = Vec::with_capacity(ids.len());
        for id in &ids {
            if let Some(o) = self.objects.get(id)? {
                out.push(o);
            }
        }
        Ok(out)
    }

    /// Add objects, or replace the objects with the same ids. Editors only. Emits
    /// one `ObjectsChanged` event and answers the ids written, in the order given.
    ///
    /// Each object's `created_by` and `created_at` are kept from the first write;
    /// `updated_at` is the caller's `now`, moved past the stored value.
    ///
    /// Fails, writing nothing, when the batch is over 200, the scene would exceed
    /// 2,000 objects or an object is malformed (`Invalid`: unknown kind, a
    /// non-finite number, a bad colour, a texture id that is too long, an object
    /// parented to itself), or an object is checked out by someone else
    /// (`Locked`).
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
        let existing = self.objects.len()?;
        let mut new_ids = BTreeSet::new();
        for obj in &cleaned {
            if !self.objects.contains(&obj.id)? {
                let _ = new_ids.insert(obj.id.clone());
            }
        }
        if existing + new_ids.len() as u64 > MAX_OBJECTS {
            return Err(invalid(&format!(
                "a scene holds at most {MAX_OBJECTS} objects; this one has {existing}"
            )));
        }
        let caller = me()?;
        let mut ids = Vec::with_capacity(cleaned.len());
        for mut obj in cleaned {
            let prior = self.objects.get(&obj.id)?;
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
            obj.updated_at = stamp(now, prior.map(|p| p.updated_at));
            ids.push(obj.id.clone());
            let _ = self.objects.insert(&obj.id, &obj)?;
        }
        env::emit(Event::ObjectsChanged { ids: ids.clone() }, Audience::All)?;
        Ok(ids)
    }

    /// Delete objects and their meshes. Editors only. Ids already gone are fine.
    /// Children of a deleted object are not deleted — they read as root objects —
    /// so delete them in the same call to remove a whole branch. A deleted mesh's
    /// history is kept, so an undo can bring it back. Fails, deleting nothing, when
    /// the batch is over 200 or one of the objects is checked out by someone else.
    /// Emits one `ObjectsDeleted` event.
    pub fn delete_objects(&mut self, ids: Vec<String>, now: u64) -> app::Result<()> {
        self.require_editor()?;
        require_batch(ids.len())?;
        if ids.is_empty() {
            return Ok(());
        }
        self.require_unlocked(ids.iter().map(String::as_str), now)?;
        for id in &ids {
            let _ = self.objects.remove(id)?;
            let _ = self.meshes.remove(id)?;
            let _ = self.locks.remove(id)?;
        }
        env::emit(Event::ObjectsDeleted { ids }, Audience::All)?;
        Ok(())
    }

    /// Remove every object, mesh, texture, version and check-out. Admins only. The
    /// blobs are no longer referenced, so a node that tracks references collects
    /// them an hour later.
    pub fn clear_scene(&mut self) -> app::Result<()> {
        self.require_admin()?;
        let _ = self.objects.clear()?;
        let _ = self.meshes.clear()?;
        let _ = self.textures.clear()?;
        let _ = self.history.clear()?;
        let _ = self.history_len.clear()?;
        let _ = self.locks.clear()?;
        env::emit(Event::SceneCleared, Audience::All)?;
        Ok(())
    }

    // ── Meshes ────────────────────────────────────────────────────────────

    /// Point a `mesh` object at a new blob of vertices, and record it as a new
    /// version. Editors only. Upload the blob to the app first
    /// (`POST /apps/{app}/blobs`); write the object before or with it — a mesh with
    /// no object is stored but drawn by nobody. To restore an earlier version, write
    /// its `blob_id` (from `listHistory`) again.
    ///
    /// `mesh.author` and `mesh.updated_at` are set by the contract. At most
    /// 4,000,000 vertices, 8,000,000 triangles and 47.25 MiB (`Invalid`);
    /// `Locked` when the mesh is checked out by someone else. Emits `MeshChanged`.
    pub fn put_mesh(&mut self, mesh: MeshRef, now: u64) -> app::Result<()> {
        self.require_editor()?;
        let blob = validate_mesh_ref(&mesh)?;
        self.require_unlocked(std::iter::once(mesh.id.as_str()), now)?;
        let stored = self.meshes.get(&mesh.id)?.map(|m| m.updated_at);
        let row = MeshRow {
            blob,
            size: mesh.size,
            vertex_count: mesh.vertex_count,
            triangle_count: mesh.triangle_count,
            has_uvs: mesh.has_uvs,
            author: me()?,
            message: clean_name(&mesh.message, ""),
            updated_at: stamp(now, stored),
        };
        self.record_version(VersionRecord {
            asset_id: mesh.id.clone(),
            kind: "mesh".to_owned(),
            blob,
            size: row.size,
            a: row.vertex_count,
            b: row.triangle_count,
            author: row.author.clone(),
            message: row.message.clone(),
            created_at: row.updated_at,
        })?;
        let _ = self.meshes.insert(&mesh.id, &row)?;
        env::emit(Event::MeshChanged { id: mesh.id }, Audience::All)?;
        Ok(())
    }

    /// Every mesh's current reference, ordered by id. A client compares each
    /// `blob_id` with what it holds and downloads only the blobs it lacks.
    #[app::view]
    pub fn list_meshes(&self) -> app::Result<Vec<MeshRef>> {
        // Keys are read in order, so this is ordered by id.
        Ok(read_all(&self.meshes)?
            .into_iter()
            .map(|(id, r)| MeshRef {
                id,
                blob_id: r.blob.id(),
                size: r.size,
                vertex_count: r.vertex_count,
                triangle_count: r.triangle_count,
                has_uvs: r.has_uvs,
                author: r.author,
                message: r.message,
                updated_at: r.updated_at,
            })
            .collect())
    }

    // ── Textures ──────────────────────────────────────────────────────────

    /// Add a texture, or point an existing one at a new image, and record it as a
    /// new version. Editors only. Upload the image blob first. `texture.author` and
    /// `texture.updated_at` are set by the contract.
    ///
    /// `Invalid` when the scene already holds 1,000 textures, the blob id is not 64
    /// lowercase hex characters, the mime type or colour space is not one this app
    /// knows, a side is over 16,384 pixels or the blob over 47.25 MiB; `Locked`
    /// when the texture is checked out by someone else. Emits `TextureChanged`.
    pub fn put_texture(&mut self, texture: TextureRef, now: u64) -> app::Result<()> {
        self.require_editor()?;
        let mut texture = texture;
        let blob = validate_texture_ref(&mut texture)?;
        self.require_unlocked(std::iter::once(texture.id.as_str()), now)?;
        let stored = self.textures.get(&texture.id)?.map(|t| t.updated_at);
        if stored.is_none() && self.textures.len()? >= MAX_TEXTURES {
            return Err(invalid(&format!(
                "a scene holds at most {MAX_TEXTURES} textures"
            )));
        }
        let row = TextureRow {
            name: texture.name,
            blob,
            size: texture.size,
            width: texture.width,
            height: texture.height,
            mime: texture.mime,
            color_space: texture.color_space,
            author: me()?,
            message: texture.message,
            updated_at: stamp(now, stored),
        };
        self.record_version(VersionRecord {
            asset_id: texture.id.clone(),
            kind: "texture".to_owned(),
            blob,
            size: row.size,
            a: row.width,
            b: row.height,
            author: row.author.clone(),
            message: row.message.clone(),
            created_at: row.updated_at,
        })?;
        let _ = self.textures.insert(&texture.id, &row)?;
        env::emit(Event::TextureChanged { id: texture.id }, Audience::All)?;
        Ok(())
    }

    /// Every texture's current reference, ordered by name, then id.
    #[app::view]
    pub fn list_textures(&self) -> app::Result<Vec<TextureRef>> {
        let mut out: Vec<TextureRef> = read_all(&self.textures)?
            .into_iter()
            .map(|(id, t)| TextureRef {
                id,
                name: t.name,
                blob_id: t.blob.id(),
                size: t.size,
                width: t.width,
                height: t.height,
                mime: t.mime,
                color_space: t.color_space,
                author: t.author,
                message: t.message,
                updated_at: t.updated_at,
            })
            .collect();
        out.sort_by(|a, b| (&a.name, &a.id).cmp(&(&b.name, &b.id)));
        Ok(out)
    }

    /// Delete textures. Editors only. Materials that name a deleted texture simply
    /// draw without it. Their history is kept. Fails, deleting nothing, when the
    /// batch is over 200 or one of them is checked out by someone else. Emits
    /// `TexturesDeleted`.
    pub fn delete_textures(&mut self, ids: Vec<String>, now: u64) -> app::Result<()> {
        self.require_editor()?;
        require_batch(ids.len())?;
        self.require_unlocked(ids.iter().map(String::as_str), now)?;
        for id in &ids {
            let _ = self.textures.remove(id)?;
        }
        env::emit(Event::TexturesDeleted { ids }, Audience::All)?;
        Ok(())
    }

    // ── History ───────────────────────────────────────────────────────────

    /// Every saved version of one mesh or texture, oldest first and numbered from
    /// 1, with the one in use marked `current`. At most the newest 500.
    #[app::view]
    pub fn list_history(&self, asset_id: String) -> app::Result<Vec<VersionView>> {
        let current = match self.meshes.get(&asset_id)? {
            Some(m) => Some(m.blob),
            None => self.textures.get(&asset_id)?.map(|t| t.blob),
        };
        let page = self.history.prefix(
            &[KeyPart::Str(asset_id)],
            FindOpts::default().limit(MAX_HISTORY_VIEW).reverse(),
        )?;
        let mut rows = page.items;
        rows.reverse();
        let last = rows.iter().rposition(|(_, r)| Some(r.blob) == current);
        Ok(rows
            .into_iter()
            .enumerate()
            .map(|(i, ((_, number), r))| VersionView {
                number: u32::try_from(number).unwrap_or(u32::MAX),
                kind: r.kind,
                current: Some(i) == last,
                blob_id: r.blob.id(),
                size: r.size,
                a: r.a,
                b: r.b,
                author: r.author,
                message: r.message,
                created_at: r.created_at,
            })
            .collect())
    }

    // ── Check-out ─────────────────────────────────────────────────────────

    /// Check assets out, so nobody else can change them until the caller checks
    /// them in or the check-out lapses. Editors only. Checking out something the
    /// caller already holds extends it. `ids` are object or texture ids (at most
    /// 200, each 1 to 64 characters), `hours` 1 to 168 (clamped), `now` the
    /// caller's clock. Fails, checking out nothing, when one of them is checked
    /// out, live, by someone else (`Locked`). Emits `LocksChanged`.
    pub fn check_out(&mut self, ids: Vec<String>, hours: u32, now: u64) -> app::Result<()> {
        self.require_editor()?;
        require_batch(ids.len())?;
        for id in &ids {
            if id.is_empty() || id.len() > 64 {
                return Err(invalid("an asset id is 1 to 64 characters"));
            }
        }
        self.require_unlocked(ids.iter().map(String::as_str), now)?;
        let hours = u64::from(hours.clamp(1, MAX_LOCK_HOURS));
        let me = me()?;
        for id in &ids {
            let prior = self.locks.get(id)?;
            let since = prior
                .as_ref()
                .filter(|l| l.holder == me && l.expires_at > now)
                .map_or(now, |l| l.since);
            let lock = Lock {
                asset_id: id.clone(),
                holder: me.clone(),
                since,
                expires_at: now.saturating_add(hours * 3_600_000),
                updated_at: stamp(now, prior.map(|l| l.updated_at)),
            };
            let _ = self.locks.insert(id, &lock)?;
        }
        env::emit(Event::LocksChanged { ids }, Audience::All)?;
        Ok(())
    }

    /// Check assets back in. Editors may check in their own; an admin may release
    /// anyone's (breaking a lock left by someone who is away). Ids not checked out
    /// are fine. Fails, releasing nothing, when the batch is over 200 or a
    /// non-admin names someone else's check-out (`Forbidden`). Emits `LocksChanged`.
    pub fn check_in(&mut self, ids: Vec<String>) -> app::Result<()> {
        self.require_editor()?;
        require_batch(ids.len())?;
        let me = me()?;
        let admin = self.is_admin(&me)?;
        for id in &ids {
            if let Some(lock) = self.locks.get(id)? {
                if lock.holder != me && !admin {
                    return Err(forbidden(&format!(
                        "{id} is someone else's check-out; only they or an admin can release it"
                    )));
                }
            }
        }
        for id in &ids {
            let _ = self.locks.remove(id)?;
        }
        env::emit(Event::LocksChanged { ids }, Audience::All)?;
        Ok(())
    }

    /// Every check-out still live at `now` (the caller's clock), ordered by asset id.
    #[app::view]
    pub fn list_locks(&self, now: u64) -> app::Result<Vec<LockView>> {
        let me = me()?;
        Ok(read_all(&self.locks)?
            .into_iter()
            .map(|(_, l)| l)
            .filter(|l| l.expires_at > now)
            .map(|l| LockView {
                mine: l.holder == me,
                asset_id: l.asset_id,
                holder: l.holder,
                since: l.since,
                expires_at: l.expires_at,
            })
            .collect())
    }

    // ── Members ───────────────────────────────────────────────────────────

    /// Introduce the caller to the scene, or change the name they are shown by.
    /// Anyone the instance reaches may, guests included; it grants no editing
    /// rights. `name` is at most 80 characters; empty becomes `"Guest"`. Emits
    /// `MemberChanged` when something changed.
    pub fn join(&mut self, name: String, now: u64) -> app::Result<()> {
        let account = me()?;
        let name = clean_name(&name, "Guest");
        let existing = self.members.get(&account)?;
        if existing.as_ref().is_some_and(|m| m.name == name) {
            return Ok(());
        }
        let member = Member {
            name,
            joined_at: existing.as_ref().map_or(now, |m| m.joined_at),
            updated_at: stamp(now, existing.map(|m| m.updated_at)),
        };
        let _ = self.members.insert(&account, &member)?;
        env::emit(Event::MemberChanged { member: account }, Audience::All)?;
        Ok(())
    }

    /// Everyone who has joined, with their effective role, oldest first.
    #[app::view]
    pub fn get_members(&self) -> app::Result<Vec<MemberView>> {
        let mut out = Vec::new();
        for (account, m) in read_all(&self.members)? {
            out.push(MemberView {
                role: self.role_label(&account)?,
                id: account,
                name: m.name,
                joined_at: m.joined_at,
            });
        }
        out.sort_by(|a, b| (a.joined_at, &a.id).cmp(&(b.joined_at, &b.id)));
        Ok(out)
    }

    // ── Roles ─────────────────────────────────────────────────────────────

    /// Let an account change the scene. Admins only. `member` is their account id;
    /// they need not have joined yet, but must be in the instance's org (`Invalid`
    /// otherwise). Emits `RoleChanged`.
    pub fn grant_editor(&mut self, member: String) -> app::Result<()> {
        let who = require_account(&member)?;
        self.require_admin()?;
        let _ = self.editors.insert(&who)?;
        env::emit(Event::RoleChanged { member }, Audience::All)?;
        Ok(())
    }

    /// Make a member a viewer again. Admins only; an admin's own role is
    /// unaffected. Emits `RoleChanged`.
    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        let who = require_account(&member)?;
        self.require_admin()?;
        let _ = self.editors.remove(&who)?;
        env::emit(Event::RoleChanged { member }, Audience::All)?;
        Ok(())
    }

    /// The caller's effective role: `admin`, `editor` or `viewer`.
    #[app::view]
    pub fn my_role(&self) -> app::Result<String> {
        self.role_label(&me()?)
    }
}

// ── Roles and helpers ─────────────────────────────────────────────────────────

impl MeroModels {
    /// The instance's owner, or an admin or the owner of its org.
    fn is_admin(&self, who: &str) -> app::Result<bool> {
        Ok(who == env::app_owner() || env::org_role(who).is_some_and(|r| r >= OrgRole::Admin))
    }

    fn is_editor(&self, who: &str) -> app::Result<bool> {
        Ok(self.is_admin(who)? || self.editors.contains(&who.to_owned())?)
    }

    fn require_editor(&self) -> app::Result<()> {
        if self.is_editor(&me()?)? {
            return Ok(());
        }
        Err(forbidden(
            "view only: ask the scene's admin for the editor role to change it",
        ))
    }

    fn require_admin(&self) -> app::Result<()> {
        if self.is_admin(&me()?)? {
            return Ok(());
        }
        Err(forbidden("only the scene's admin can do that"))
    }

    fn role_label(&self, who: &str) -> app::Result<String> {
        Ok(if self.is_admin(who)? {
            "admin"
        } else if self.editors.contains(&who.to_owned())? {
            "editor"
        } else {
            "viewer"
        }
        .to_owned())
    }

    fn environment_or_default(&self) -> app::Result<Environment> {
        Ok(self.environment.get()?.unwrap_or_else(default_environment))
    }

    /// Add one version to an asset's history, numbered after the last.
    fn record_version(&mut self, record: VersionRecord) -> app::Result<()> {
        let number = self.history_len.get(&record.asset_id)?.unwrap_or(0) + 1;
        let _ = self.history_len.insert(&record.asset_id, &number)?;
        let _ = self
            .history
            .insert(&(record.asset_id.clone(), number), &record)?;
        Ok(())
    }

    /// `Locked` when any of `ids` is checked out, live, by someone other than the caller.
    fn require_unlocked<'a>(
        &self,
        ids: impl Iterator<Item = &'a str>,
        now: u64,
    ) -> app::Result<()> {
        let me = me()?;
        for id in ids {
            if let Some(lock) = self.locks.get(&id.to_owned())? {
                if lock.holder != me && lock.expires_at > now {
                    let who = self
                        .members
                        .get(&lock.holder)?
                        .map_or_else(|| lock.holder.chars().take(8).collect(), |m| m.name);
                    return Err(Error::Locked {
                        message: format!("{id} is checked out by {who}; ask them to check it in"),
                    }
                    .into());
                }
            }
        }
        Ok(())
    }
}

/// The `updated_at` a write stores: the caller's clock, moved past the stored value.
///
/// So the stamp only ever grows, whatever the writer's clock says. Clients cache a
/// mesh's vertices by it (`listMeshes` → the blob), and a slow clock that stamped
/// an edit at or below the stored value would leave every cache holding the old
/// shape.
pub fn stamp(requested: u64, stored: Option<u64>) -> u64 {
    match stored {
        Some(prev) if requested <= prev => prev.saturating_add(1),
        _ => requested,
    }
}

/// Clear every `parent` that names a missing object or sits on a loop.
///
/// A chain can loop without any single write being wrong (A under B written
/// while B under A was in flight from the same editor's undo), so the hierarchy
/// is the READER's: every read runs this over the same rows and draws the same
/// tree.
pub fn resolve_parents(objects: &mut [SceneObject]) {
    let parent_of: BTreeMap<String, String> = objects
        .iter()
        .map(|o| (o.id.clone(), o.parent.clone()))
        .collect();
    for obj in objects.iter_mut() {
        if obj.parent.is_empty() {
            continue;
        }
        // Walk up. Reaching a root is fine; meeting a missing id or revisiting
        // one (the walk is bounded by the object count) is not.
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

/// The account the caller acts for (a signed-in account, or an API key acting
/// for one).
fn me() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// Every entry of `map`, following the cursor to the end, in key order.
fn read_all<K, V>(map: &UnorderedMap<K, V>) -> app::Result<Vec<(K, V)>>
where
    K: ToKey + FromKey,
    V: Serialize + DeserializeOwned,
{
    let mut out = Vec::new();
    let mut opts = FindOpts::default().limit(PAGE);
    loop {
        let page = map.page(opts)?;
        out.extend(page.items);
        match page.next {
            Some(next) => opts = FindOpts::default().limit(PAGE).cursor(next),
            None => return Ok(out),
        }
    }
}

fn count(n: u64) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

fn invalid(message: &str) -> AppError {
    Error::Invalid {
        message: message.to_owned(),
    }
    .into()
}

fn forbidden(message: &str) -> AppError {
    Error::Forbidden {
        message: message.to_owned(),
    }
    .into()
}

// ── Validation ────────────────────────────────────────────────────────────────

fn require_batch(len: usize) -> app::Result<()> {
    if len > MAX_BATCH {
        return Err(invalid(&format!(
            "one call writes at most {MAX_BATCH} objects, got {len}"
        )));
    }
    Ok(())
}

/// An account id the instance's org holds (any role); with no org, any account id.
fn require_account(member: &str) -> app::Result<String> {
    let member = member.trim();
    if member.is_empty()
        || member.len() > MAX_ACCOUNT_LEN
        || !member.bytes().all(|b| b.is_ascii_graphic())
    {
        return Err(invalid(
            "that is not a member id — expected the account id the members list shows",
        ));
    }
    if env::org().is_some() && env::org_role(member).is_none() {
        return Err(invalid(&format!(
            "{member} is not in this scene's organization"
        )));
    }
    Ok(member.to_owned())
}

/// `#rrggbb`, nothing else: the value is handed straight to a renderer on every
/// member's screen.
fn require_color(c: &str) -> app::Result<()> {
    let ok = c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if !ok {
        return Err(invalid(&format!("a colour is #rrggbb, got {c:?}")));
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
fn validate_object(mut obj: SceneObject) -> app::Result<SceneObject> {
    if obj.id.is_empty() || obj.id.len() > 64 {
        return Err(invalid("an object id is 1 to 64 characters"));
    }
    if !OBJECT_KINDS.contains(&obj.kind.as_str()) {
        return Err(invalid(&format!("unknown object kind {:?}", obj.kind)));
    }
    if obj.parent == obj.id {
        return Err(invalid("an object cannot be its own parent"));
    }
    if obj.parent.len() > 64 {
        return Err(invalid("a parent id is at most 64 characters"));
    }
    for v in [&obj.position, &obj.rotation, &obj.scale] {
        if !v.is_finite() {
            return Err(invalid(&format!(
                "{:?}: transforms must be finite numbers",
                obj.name
            )));
        }
    }
    let m = &mut obj.material;
    require_color(&m.color)?;
    require_color(&m.emissive)?;
    for x in [
        m.metalness,
        m.roughness,
        m.opacity,
        m.normal_scale,
        obj.intensity,
    ] {
        if !x.is_finite() {
            return Err(invalid(&format!(
                "{:?}: material values must be finite numbers",
                obj.name
            )));
        }
    }
    for map in [
        &m.base_color_map,
        &m.normal_map,
        &m.orm_map,
        &m.emissive_map,
    ] {
        if map.len() > 64 {
            return Err(invalid(&format!(
                "{:?}: a texture id is at most 64 characters",
                obj.name
            )));
        }
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

/// A 64-character lowercase hex blob id, the form an upload answers as `id`.
fn require_blob(blob_id: &str) -> app::Result<BlobRef> {
    BlobRef::parse(blob_id).ok_or_else(|| {
        invalid(&format!(
            "{blob_id:?} is not a blob id — expected 64 lowercase hex characters"
        ))
    })
}

fn require_blob_size(what: &str, size: u64) -> app::Result<()> {
    if size == 0 || size > MAX_BLOB_BYTES {
        return Err(invalid(&format!(
            "a {what} blob is 1 byte to {MAX_BLOB_BYTES} bytes (47.25 MiB), got {size}"
        )));
    }
    Ok(())
}

fn validate_mesh_ref(mesh: &MeshRef) -> app::Result<BlobRef> {
    if mesh.id.is_empty() || mesh.id.len() > 64 {
        return Err(invalid("a mesh id is 1 to 64 characters"));
    }
    let blob = require_blob(&mesh.blob_id)?;
    if mesh.vertex_count > MAX_VERTICES {
        return Err(invalid(&format!(
            "a mesh holds at most {MAX_VERTICES} vertices, got {}",
            mesh.vertex_count
        )));
    }
    if mesh.triangle_count > MAX_TRIANGLES {
        return Err(invalid(&format!(
            "a mesh holds at most {MAX_TRIANGLES} triangles, got {}",
            mesh.triangle_count
        )));
    }
    require_blob_size("mesh", mesh.size)?;
    Ok(blob)
}

fn validate_texture_ref(texture: &mut TextureRef) -> app::Result<BlobRef> {
    if texture.id.is_empty() || texture.id.len() > 64 {
        return Err(invalid("a texture id is 1 to 64 characters"));
    }
    let blob = require_blob(&texture.blob_id)?;
    if texture.width == 0
        || texture.height == 0
        || texture.width > MAX_TEXTURE_SIDE
        || texture.height > MAX_TEXTURE_SIDE
    {
        return Err(invalid(&format!(
            "a texture is 1 to {MAX_TEXTURE_SIDE} pixels a side"
        )));
    }
    require_blob_size("texture", texture.size)?;
    if !["image/png", "image/jpeg", "image/webp"].contains(&texture.mime.as_str()) {
        return Err(invalid(&format!(
            "a texture is image/png, image/jpeg or image/webp, got {:?}",
            texture.mime
        )));
    }
    if !["srgb", "linear"].contains(&texture.color_space.as_str()) {
        return Err(invalid("a texture's colour space is srgb or linear"));
    }
    texture.name = clean_name(&texture.name, "Texture");
    texture.message = clean_name(&texture.message, "");
    Ok(blob)
}
