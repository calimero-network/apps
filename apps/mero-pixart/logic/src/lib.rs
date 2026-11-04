//! MeroPixArt: a collaborative layered image editor, on core's component SDK
//! (`calimero-sdk`).
//!
//! An app instance is one document (v1: one context); the organization it lives
//! in (a team) decides who reaches it. Pixels are not in this state: a raster
//! layer or a mask names a blob of the app (a PNG the frontend uploaded with
//! `POST /apps/{app}/blobs`), and this contract stores only its id.
//!
//! # Who may do what
//!
//! v1 held these rules in storage that every node checked when it merged a
//! peer's delta (`Ownable`, `AccessControl` with role masks projected onto a
//! `PermissionedStorage`, `UserStorage`, `Authored`). A component app runs on its
//! cluster's leader, which applies every write in one log, so each rule is a
//! check in the method against `env::caller()`, before anything is written:
//!
//! | v1 | here |
//! |---|---|
//! | `doc_name`/`doc_description`/`canvas: Ownable<LwwRegister<..>>` + `initial_*: Frozen` | `document: Cell<Document>`, set by `init`; `updateDocument` refuses anyone but `owner` (`OwnerOnly`) |
//! | `roles: AccessControl` (admin tier = the creator, moved by `transfer_ownership`) | the document's `owner`; admin == owner, as in v1 |
//! | `roles` editor grants, projected onto `layers` | `editors: Set<account>`; the org's owner and admins also edit (v1's frontend granted them by hand) |
//! | `layers: PermissionedStorage<IndexedMap<id, Layer>>` (indexes `parent_id`, `layer_index`) | `layers: UnorderedMap<id, Layer>`, at most `MAX_LAYERS`; every write refuses viewers (`ViewOnly`) |
//! | `members: UserStorage<Member>` | `members: UnorderedMap<account, Member>`, written only for the caller |
//! | `cursors: Authored<UnorderedMap<device, CursorState>>` | `cursors: UnorderedMap<account, CursorState>`, written only for the caller |
//! | `blob_announce_to_context` | nothing: an upload already makes the blob the app's on every node |

// The patch methods take one optional argument per field they change, as v1's
// did; a params struct would change every call's arguments.
#![allow(clippy::too_many_arguments)]

use calimero_sdk::env::OrgRole;
use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// Rows one storage read returns: a page of a collection.
const ROWS: u32 = 1_000;
/// The most layers one document holds: every layer read is one page.
pub const MAX_LAYERS: u64 = 1_000;
/// The longest display name.
pub const MAX_USERNAME: usize = 64;
/// The longest account id a role grant may name.
pub const MAX_ACCOUNT: usize = 256;
/// Parent hops `moveLayers` follows before giving up (a cycle guard).
const MAX_DEPTH: usize = 64;

pub const ROLE_ADMIN: &str = "admin";
pub const ROLE_EDITOR: &str = "editor";
pub const ROLE_VIEWER: &str = "viewer";

// ── Stored values ────────────────────────────────────────────────────────────
//
// Plain serde values, with v1's camelCase JSON field names: the frontend reads
// and sends them as v1 did. Their integers stay JSON numbers (all fit a double:
// pixel coordinates and millisecond clocks), unlike top-level `u64`/`i64`
// arguments, which travel as decimal strings.

/// Non-destructive adjustments, applied at composite time.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adjustments {
    /// -100..=100, 0 = neutral
    pub brightness: i32,
    /// -100..=100, 0 = neutral
    pub contrast: i32,
    /// -100..=100, 0 = neutral
    pub saturation: i32,
    /// -180..=180 degrees, 0 = neutral
    pub hue: i32,
    /// -100..=100, 0 = neutral
    pub exposure: i32,
    /// 0..=100 blur radius in px, 0 = none
    pub blur: u32,
    pub invert: bool,
    /// JSON curve control points, opaque to the contract. Empty = identity.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub curves: String,
}

/// Text layer properties.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextProps {
    pub content: String,
    pub font_family: String,
    pub font_size: u32,
    pub color: String,
    pub bold: bool,
    pub italic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
}

impl Default for TextProps {
    fn default() -> Self {
        TextProps {
            content: String::new(),
            font_family: "Inter".to_owned(),
            font_size: 48,
            color: "#ffffff".to_owned(),
            bold: false,
            italic: false,
            align: None,
        }
    }
}

/// One layer. `kind` is "raster" | "group" | "text" | "adjustment" | "fill".
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: String,
    pub name: String,
    pub kind: String,
    /// The group this layer sits in; `None` = top level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Order within the parent (ascending = bottom to top).
    pub layer_index: u32,
    pub visible: bool,
    pub locked: bool,
    /// 0..=100
    pub opacity: u8,
    pub blend_mode: String,
    pub x: i64,
    pub y: i64,
    pub width: u32,
    pub height: u32,
    pub rotation: i32,
    /// percent, 100 = 1:1
    pub scale_x: i32,
    pub scale_y: i32,
    /// Horizontal shear in degrees (-80..=80).
    #[serde(default)]
    pub skew_x: i32,
    /// Vertical shear in degrees (-80..=80).
    #[serde(default)]
    pub skew_y: i32,
    #[serde(default)]
    pub flip_h: bool,
    #[serde(default)]
    pub flip_v: bool,
    /// Corner-pin warp JSON, opaque to the contract. Empty = no warp.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub warp: String,
    /// The PNG of a raster layer: one of the app's blobs, as its 64-hex id.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub blob_id: String,
    /// A grayscale PNG mask blob (64-hex id). `None` = no mask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask_blob_id: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub fill: String,
    pub adjustments: Adjustments,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextProps>,
    /// The account that added it: always the caller, never the argument.
    pub created_by: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// A member of the document's roster, stored under their account.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    /// The account. Filled from the row's key on read.
    pub id: String,
    pub username: String,
    pub avatar: Option<String>,
    pub joined_at: u64,
    pub username_updated_at: u64,
}

/// A pointer on the canvas, stored under the account that moved it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorState {
    /// The pointer's key: the account (v1: the device).
    pub identity: String,
    /// The account behind it.
    pub account: String,
    pub x: i64,
    pub y: i64,
    pub updated_at: u64,
}

/// The document's settings, one value.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub name: String,
    pub description: String,
    pub width: u32,
    pub height: u32,
    pub background: String,
    /// The account that owns the document (the creator, until a transfer).
    pub owner: String,
}

// ── Answers ──────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub name: String,
    pub description: String,
    pub width: u32,
    pub height: u32,
    pub background: String,
    pub layer_count: u32,
    pub member_count: u32,
    pub owner: Option<String>,
}

/// A member and their document role, for the settings screen.
#[derive(Clone, Debug, Serialize)]
pub struct MemberRole {
    pub member: String,
    pub role: String,
}

// ── State ────────────────────────────────────────────────────────────────────

#[app::state(version = 1)]
pub struct PixArt {
    /// Name, description, canvas and owner.
    document: Cell<Document>,
    /// Accounts the owner made editors.
    editors: Set<String>,
    /// Layers by id, at most `MAX_LAYERS` (enforced by `addLayer`).
    layers: UnorderedMap<String, Layer>,
    /// The roster, by account.
    members: UnorderedMap<String, Member>,
    /// One pointer per account.
    cursors: UnorderedMap<String, CursorState>,
}

/// The account the caller acts for. Anyone else is `LoginRequired`.
fn caller() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// A blob id as the node writes it: `hex(SHA-256)`, 64 lowercase hex digits.
fn is_blob_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[app::error]
pub enum Error {
    /// Editing needs the editor role (or the owner's, or an org admin's).
    ViewOnly,
    /// Only the document's owner (its admin) may do this.
    OwnerOnly,
    /// An argument the contract refuses, and why.
    Invalid { message: String },
}

/// What changed; every screen re-reads on any of them. Everyone the app
/// reaches hears them.
#[app::event]
pub enum Event {
    LayerAdded { id: String },
    LayerUpdated { id: String },
    LayerDeleted { id: String },
    LayersReordered {},
    MemberJoined { member: String },
    MemberUsernameUpdated { member: String },
    DocumentUpdated {},
    CursorMoved { identity: String },
    RoleUpdated { member: String },
    OwnerTransferred { member: String },
}

fn invalid(message: impl Into<String>) -> AppError {
    Error::Invalid {
        message: message.into(),
    }
    .into()
}

fn emit(event: Event) -> app::Result<()> {
    env::emit(event, Audience::All)
}

fn check_blob(id: &str) -> app::Result<()> {
    if id.is_empty() || is_blob_id(id) {
        Ok(())
    } else {
        Err(invalid(
            "a blob id is the 64-hex id the upload answered (`id`), not the base58 one",
        ))
    }
}

/// An account a grant or transfer may name: someone the app's org holds
/// (any role), or, for an app outside an org, any plausible account id.
fn check_account(account: &str) -> app::Result<()> {
    if account.is_empty() || account.len() > MAX_ACCOUNT {
        return Err(invalid("that is not a member id"));
    }
    if env::org().is_some() && env::org_role(account).is_none() {
        return Err(invalid("that account is not a member of this team"));
    }
    Ok(())
}

impl PixArt {
    fn doc(&self) -> app::Result<Document> {
        Ok(self.document.get()?.unwrap_or_default())
    }

    fn is_owner(&self, who: &str) -> app::Result<bool> {
        Ok(self.doc()?.owner == who)
    }

    fn is_editor(&self, who: &str) -> app::Result<bool> {
        if self.is_owner(who)? || self.editors.contains(&who.to_owned())? {
            return Ok(true);
        }
        Ok(matches!(
            env::org_role(who),
            Some(OrgRole::Owner | OrgRole::Admin)
        ))
    }

    fn role_label(&self, who: &str) -> app::Result<String> {
        Ok(if self.is_owner(who)? {
            ROLE_ADMIN
        } else if self.is_editor(who)? {
            ROLE_EDITOR
        } else {
            ROLE_VIEWER
        }
        .to_owned())
    }

    /// The caller, when they may edit.
    fn require_editor(&self) -> app::Result<String> {
        let me = caller()?;
        if self.is_editor(&me)? {
            Ok(me)
        } else {
            Err(Error::ViewOnly.into())
        }
    }

    /// The caller, when they own the document.
    fn require_owner(&self) -> app::Result<String> {
        let me = caller()?;
        if self.is_owner(&me)? {
            Ok(me)
        } else {
            Err(Error::OwnerOnly.into())
        }
    }

    /// Every layer (at most `MAX_LAYERS`, one page).
    fn all_layers(&self) -> app::Result<Vec<Layer>> {
        Ok(self
            .layers
            .page(FindOpts::default().limit(ROWS))?
            .items
            .into_iter()
            .map(|(_, l)| l)
            .collect())
    }

    /// Apply `f` to layer `id` and store it; `false` when there is none.
    fn patch(&mut self, id: &str, f: impl FnOnce(&mut Layer)) -> app::Result<bool> {
        let key = id.to_owned();
        let Some(mut layer) = self.layers.get(&key)? else {
            return Ok(false);
        };
        f(&mut layer);
        let _old = self.layers.insert(&key, &layer)?;
        Ok(true)
    }

    /// True when `candidate` sits anywhere under `ancestor`.
    fn is_descendant_of(&self, candidate: &str, ancestor: &str) -> app::Result<bool> {
        let mut cur = candidate.to_owned();
        for _ in 0..MAX_DEPTH {
            let parent = match self.layers.get(&cur)? {
                Some(l) => l.parent_id,
                None => return Ok(false),
            };
            match parent {
                Some(p) if p == ancestor => return Ok(true),
                Some(p) => cur = p,
                None => return Ok(false),
            }
        }
        Ok(false)
    }
}

#[app::logic]
impl PixArt {
    /// A new document, owned by its creator (the app's creator: `init` runs
    /// as the owner). Every argument is optional: `name` "Untitled", a
    /// 1280 x 720 transparent canvas.
    #[app::init]
    pub fn init(
        name: Option<String>,
        description: Option<String>,
        width: Option<u32>,
        height: Option<u32>,
    ) -> app::Result<Self> {
        let mut state = Self::load();
        let owner = caller()?;
        let width = width.filter(|w| *w > 0).unwrap_or(1280);
        let height = height.filter(|h| *h > 0).unwrap_or(720);
        state.document.set(&Document {
            name: name
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| "Untitled".to_owned()),
            description: description.unwrap_or_default(),
            width,
            height,
            background: "#00000000".to_owned(),
            owner,
        })?;
        Ok(state)
    }

    // ── Document ─────────────────────────────────────────────────────────

    #[app::view]
    pub fn get_document(&self) -> app::Result<DocumentInfo> {
        let _ = caller()?;
        let d = self.doc()?;
        Ok(DocumentInfo {
            name: d.name,
            description: d.description,
            width: d.width,
            height: d.height,
            background: d.background,
            layer_count: u32::try_from(self.layers.len()?).unwrap_or(u32::MAX),
            member_count: u32::try_from(self.members.len()?).unwrap_or(u32::MAX),
            owner: Some(d.owner).filter(|o| !o.is_empty()),
        })
    }

    /// Rename, re-describe, resize or recolour the document. Owner only
    /// (`OwnerOnly`).
    pub fn update_document(
        &mut self,
        name: Option<String>,
        description: Option<String>,
        width: Option<u32>,
        height: Option<u32>,
        background: Option<String>,
    ) -> app::Result<()> {
        let _ = self.require_owner()?;
        let mut d = self.doc()?;
        if let Some(v) = name {
            d.name = v;
        }
        if let Some(v) = description {
            d.description = v;
        }
        if let Some(v) = width {
            d.width = v;
        }
        if let Some(v) = height {
            d.height = v;
        }
        if let Some(v) = background {
            d.background = v;
        }
        self.document.set(&d)?;
        emit(Event::DocumentUpdated {})
    }

    /// Hand the document to another member of the team. Owner only. The
    /// previous owner keeps editing (they become an editor).
    pub fn transfer_ownership(&mut self, new_owner: String) -> app::Result<()> {
        let previous = self.require_owner()?;
        check_account(&new_owner)?;
        let mut d = self.doc()?;
        d.owner = new_owner.clone();
        self.document.set(&d)?;
        if previous != new_owner {
            let _ = self.editors.insert(&previous)?;
        }
        let _ = self.editors.remove(&new_owner)?;
        emit(Event::OwnerTransferred { member: new_owner })
    }

    // ── Roles ────────────────────────────────────────────────────────────

    /// Let a member of the team edit. Owner only.
    pub fn grant_editor(&mut self, member: String) -> app::Result<()> {
        let _ = self.require_owner()?;
        check_account(&member)?;
        let _ = self.editors.insert(&member)?;
        emit(Event::RoleUpdated { member })
    }

    /// Make a member view-only again. Owner only. The org's owner and
    /// admins keep editing whatever this says.
    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        let _ = self.require_owner()?;
        if member.is_empty() || member.len() > MAX_ACCOUNT {
            return Err(invalid("that is not a member id"));
        }
        let _ = self.editors.remove(&member)?;
        emit(Event::RoleUpdated { member })
    }

    /// "admin" (the owner), "editor" or "viewer".
    #[app::view]
    pub fn get_role(&self, member: String) -> app::Result<String> {
        let _ = caller()?;
        self.role_label(&member)
    }

    #[app::view]
    pub fn my_role(&self) -> app::Result<String> {
        let me = caller()?;
        self.role_label(&me)
    }

    #[app::view]
    pub fn can_edit(&self) -> app::Result<bool> {
        let me = caller()?;
        self.is_editor(&me)
    }

    /// Every member on the roster with their role (at most 1,000).
    #[app::view]
    pub fn list_roles(&self) -> app::Result<Vec<MemberRole>> {
        let _ = caller()?;
        let page = self.members.page(FindOpts::default().limit(ROWS))?;
        page.items
            .into_iter()
            .map(|(account, _)| {
                Ok(MemberRole {
                    role: self.role_label(&account)?,
                    member: account,
                })
            })
            .collect()
    }

    // ── Members ──────────────────────────────────────────────────────────

    /// Put the caller on the roster. Idempotent: a member already on it is
    /// left as is.
    pub fn join(
        &mut self,
        username: String,
        avatar: Option<String>,
        timestamp: u64,
    ) -> app::Result<()> {
        let me = caller()?;
        if self.members.contains(&me)? {
            return Ok(());
        }
        let username = clean_username(username)?;
        let member = Member {
            id: me.clone(),
            username,
            avatar,
            joined_at: timestamp,
            username_updated_at: timestamp,
        };
        let _old = self.members.insert(&me, &member)?;
        emit(Event::MemberJoined { member: me })
    }

    /// Every member (at most 1,000), `id` from the row's account.
    #[app::view]
    pub fn get_members(&self) -> app::Result<Vec<Member>> {
        let _ = caller()?;
        let page = self.members.page(FindOpts::default().limit(ROWS))?;
        Ok(page
            .items
            .into_iter()
            .map(|(account, mut m)| {
                m.id = account;
                m
            })
            .collect())
    }

    /// Rename the caller on the roster. Nothing for someone not on it.
    pub fn update_member_username(&mut self, username: String, timestamp: u64) -> app::Result<()> {
        let me = caller()?;
        let Some(mut m) = self.members.get(&me)? else {
            return Ok(());
        };
        m.username = clean_username(username)?;
        m.username_updated_at = timestamp;
        let _old = self.members.insert(&me, &m)?;
        emit(Event::MemberUsernameUpdated { member: me })
    }

    // ── Layers ───────────────────────────────────────────────────────────

    /// Add a layer (or replace the one with its id). `createdBy` is the
    /// caller, whatever the argument says. Answers the id.
    pub fn add_layer(&mut self, layer: Layer) -> app::Result<String> {
        let me = self.require_editor()?;
        check_blob(&layer.blob_id)?;
        if let Some(mask) = &layer.mask_blob_id {
            check_blob(mask)?;
        }
        if layer.id.is_empty() {
            return Err(invalid("a layer needs an id"));
        }
        let mut layer = layer;
        layer.created_by = me;
        let id = layer.id.clone();
        if !self.layers.contains(&id)? && self.layers.len()? >= MAX_LAYERS {
            return Err(invalid(format!(
                "a document holds at most {MAX_LAYERS} layers"
            )));
        }
        let _old = self.layers.insert(&id, &layer)?;
        emit(Event::LayerAdded { id: id.clone() })?;
        Ok(id)
    }

    /// Patch a layer's metadata, transform and compositing. Each argument
    /// is optional; an unknown id changes nothing.
    pub fn update_layer(
        &mut self,
        id: String,
        name: Option<String>,
        visible: Option<bool>,
        locked: Option<bool>,
        opacity: Option<u8>,
        blend_mode: Option<String>,
        x: Option<i64>,
        y: Option<i64>,
        width: Option<u32>,
        height: Option<u32>,
        rotation: Option<i32>,
        scale_x: Option<i32>,
        scale_y: Option<i32>,
        fill: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        let _ = self.require_editor()?;
        let changed = self.patch(&id, |l| {
            if let Some(v) = name {
                l.name = v;
            }
            if let Some(v) = visible {
                l.visible = v;
            }
            if let Some(v) = locked {
                l.locked = v;
            }
            if let Some(v) = opacity {
                l.opacity = v;
            }
            if let Some(v) = blend_mode {
                l.blend_mode = v;
            }
            if let Some(v) = x {
                l.x = v;
            }
            if let Some(v) = y {
                l.y = v;
            }
            if let Some(v) = width {
                l.width = v;
            }
            if let Some(v) = height {
                l.height = v;
            }
            if let Some(v) = rotation {
                l.rotation = v;
            }
            if let Some(v) = scale_x {
                l.scale_x = v;
            }
            if let Some(v) = scale_y {
                l.scale_y = v;
            }
            if let Some(v) = fill {
                l.fill = v;
            }
            l.updated_at = updated_at;
        })?;
        if changed {
            emit(Event::LayerUpdated { id })?;
        }
        Ok(())
    }

    /// Patch the free-transform params: rotation, scale, shear (clamped to
    /// -80..=80), mirror and corner-pin warp (an empty warp clears it).
    pub fn update_transform(
        &mut self,
        id: String,
        rotation: Option<i32>,
        scale_x: Option<i32>,
        scale_y: Option<i32>,
        skew_x: Option<i32>,
        skew_y: Option<i32>,
        flip_h: Option<bool>,
        flip_v: Option<bool>,
        warp: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        let _ = self.require_editor()?;
        let changed = self.patch(&id, |l| {
            if let Some(v) = rotation {
                l.rotation = v;
            }
            if let Some(v) = scale_x {
                l.scale_x = v;
            }
            if let Some(v) = scale_y {
                l.scale_y = v;
            }
            if let Some(v) = skew_x {
                l.skew_x = v.clamp(-80, 80);
            }
            if let Some(v) = skew_y {
                l.skew_y = v.clamp(-80, 80);
            }
            if let Some(v) = flip_h {
                l.flip_h = v;
            }
            if let Some(v) = flip_v {
                l.flip_v = v;
            }
            if let Some(v) = warp {
                l.warp = v;
            }
            l.updated_at = updated_at;
        })?;
        if changed {
            emit(Event::LayerUpdated { id })?;
        }
        Ok(())
    }

    /// Re-parent several layers in one call (`[[id, parentId | null], ..]`).
    /// A move that would make a layer its own ancestor is skipped, as are
    /// unknown ids.
    pub fn move_layers(
        &mut self,
        moves: Vec<(String, Option<String>)>,
        updated_at: u64,
    ) -> app::Result<()> {
        let _ = self.require_editor()?;
        for (id, parent_id) in moves {
            if let Some(parent) = &parent_id {
                if *parent == id || self.is_descendant_of(parent, &id)? {
                    continue;
                }
            }
            let _ = self.patch(&id, |l| {
                l.parent_id = parent_id;
                l.updated_at = updated_at;
            })?;
        }
        emit(Event::LayersReordered {})
    }

    /// Replace a raster layer's pixels with a freshly uploaded blob.
    pub fn update_layer_content(
        &mut self,
        id: String,
        blob_id: String,
        width: u32,
        height: u32,
        updated_at: u64,
    ) -> app::Result<()> {
        let _ = self.require_editor()?;
        check_blob(&blob_id)?;
        let changed = self.patch(&id, |l| {
            l.blob_id = blob_id;
            l.width = width;
            l.height = height;
            l.updated_at = updated_at;
        })?;
        if changed {
            emit(Event::LayerUpdated { id })?;
        }
        Ok(())
    }

    /// Set or clear (`null`) a layer's mask blob.
    pub fn update_layer_mask(
        &mut self,
        id: String,
        mask_blob_id: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        let _ = self.require_editor()?;
        if let Some(mask) = &mask_blob_id {
            check_blob(mask)?;
        }
        let changed = self.patch(&id, |l| {
            l.mask_blob_id = mask_blob_id;
            l.updated_at = updated_at;
        })?;
        if changed {
            emit(Event::LayerUpdated { id })?;
        }
        Ok(())
    }

    /// Patch a layer's adjustments.
    pub fn update_adjustments(
        &mut self,
        id: String,
        brightness: Option<i32>,
        contrast: Option<i32>,
        saturation: Option<i32>,
        hue: Option<i32>,
        exposure: Option<i32>,
        blur: Option<u32>,
        invert: Option<bool>,
        curves: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        let _ = self.require_editor()?;
        let changed = self.patch(&id, |l| {
            let a = &mut l.adjustments;
            if let Some(v) = brightness {
                a.brightness = v;
            }
            if let Some(v) = contrast {
                a.contrast = v;
            }
            if let Some(v) = saturation {
                a.saturation = v;
            }
            if let Some(v) = hue {
                a.hue = v;
            }
            if let Some(v) = exposure {
                a.exposure = v;
            }
            if let Some(v) = blur {
                a.blur = v;
            }
            if let Some(v) = invert {
                a.invert = v;
            }
            if let Some(v) = curves {
                a.curves = v;
            }
            l.updated_at = updated_at;
        })?;
        if changed {
            emit(Event::LayerUpdated { id })?;
        }
        Ok(())
    }

    /// Patch a text layer's properties.
    pub fn update_text(
        &mut self,
        id: String,
        content: Option<String>,
        font_family: Option<String>,
        font_size: Option<u32>,
        color: Option<String>,
        bold: Option<bool>,
        italic: Option<bool>,
        align: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        let _ = self.require_editor()?;
        let changed = self.patch(&id, |l| {
            let mut t = l.text.clone().unwrap_or_default();
            if let Some(v) = content {
                t.content = v;
            }
            if let Some(v) = font_family {
                t.font_family = v;
            }
            if let Some(v) = font_size {
                t.font_size = v;
            }
            if let Some(v) = color {
                t.color = v;
            }
            if let Some(v) = bold {
                t.bold = v;
            }
            if let Some(v) = italic {
                t.italic = v;
            }
            if let Some(v) = align {
                t.align = Some(v);
            }
            l.text = Some(t);
            l.updated_at = updated_at;
        })?;
        if changed {
            emit(Event::LayerUpdated { id })?;
        }
        Ok(())
    }

    /// Delete a layer. A group's children move to the top level.
    pub fn delete_layer(&mut self, id: String) -> app::Result<()> {
        let _ = self.require_editor()?;
        let children: Vec<Layer> = self
            .all_layers()?
            .into_iter()
            .filter(|l| l.parent_id.as_deref() == Some(id.as_str()))
            .collect();
        for mut child in children {
            child.parent_id = None;
            child.updated_at = child.updated_at.saturating_add(1);
            let _old = self.layers.insert(&child.id.clone(), &child)?;
        }
        let _old = self.layers.remove(&id)?;
        emit(Event::LayerDeleted { id })
    }

    /// Every layer, bottom to top (`layerIndex`, then id). At most
    /// `MAX_LAYERS`, which `addLayer` enforces.
    #[app::view]
    pub fn get_layers(&self) -> app::Result<Vec<Layer>> {
        let _ = caller()?;
        let mut layers = self.all_layers()?;
        layers.sort_by(|a, b| a.layer_index.cmp(&b.layer_index).then(a.id.cmp(&b.id)));
        Ok(layers)
    }

    #[app::view]
    pub fn get_layer(&self, id: String) -> app::Result<Option<Layer>> {
        let _ = caller()?;
        Ok(self.layers.get(&id)?)
    }

    /// Move a layer into or out of a group and set its index in one call.
    pub fn move_layer(
        &mut self,
        id: String,
        parent_id: Option<String>,
        layer_index: u32,
        updated_at: u64,
    ) -> app::Result<()> {
        let _ = self.require_editor()?;
        let changed = self.patch(&id, |l| {
            l.parent_id = parent_id;
            l.layer_index = layer_index;
            l.updated_at = updated_at;
        })?;
        if changed {
            emit(Event::LayersReordered {})?;
        }
        Ok(())
    }

    /// Apply an explicit ordering: `[[id, index], ..]`.
    pub fn reorder_layers(
        &mut self,
        order: Vec<(String, u32)>,
        updated_at: u64,
    ) -> app::Result<()> {
        let _ = self.require_editor()?;
        for (id, idx) in order {
            let _ = self.patch(&id, |l| {
                l.layer_index = idx;
                l.updated_at = updated_at;
            })?;
        }
        emit(Event::LayersReordered {})
    }

    /// Put a layer above every other one.
    pub fn bring_to_front(&mut self, id: String, updated_at: u64) -> app::Result<()> {
        let _ = self.require_editor()?;
        let top = self
            .all_layers()?
            .iter()
            .map(|l| l.layer_index)
            .max()
            .unwrap_or(0);
        let _ = self.patch(&id, |l| {
            l.layer_index = top.saturating_add(1);
            l.updated_at = updated_at;
        })?;
        emit(Event::LayersReordered {})
    }

    /// Put a layer below every other one. With room below the bottom one
    /// (its index above 0) only this layer moves; a stack starting at 0
    /// shifts the others up by one.
    pub fn send_to_back(&mut self, id: String, updated_at: u64) -> app::Result<()> {
        let _ = self.require_editor()?;
        let others: Vec<Layer> = self
            .all_layers()?
            .into_iter()
            .filter(|l| l.id != id)
            .collect();
        let target = match others.iter().map(|l| l.layer_index).min() {
            Some(0) => {
                for mut other in others {
                    other.layer_index = other.layer_index.saturating_add(1);
                    other.updated_at = other.updated_at.saturating_add(1);
                    let _old = self.layers.insert(&other.id.clone(), &other)?;
                }
                0
            }
            Some(bottom) => bottom - 1,
            None => 0,
        };
        let _ = self.patch(&id, |l| {
            l.layer_index = target;
            l.updated_at = updated_at;
        })?;
        emit(Event::LayersReordered {})
    }

    /// Delete every layer. Owner only.
    pub fn clear_layers(&mut self) -> app::Result<()> {
        let _ = self.require_owner()?;
        let _ = self.layers.clear()?;
        emit(Event::LayersReordered {})
    }

    // ── Cursors ──────────────────────────────────────────────────────────

    /// Move the caller's pointer. Open to everyone who reaches the
    /// document, viewers included.
    pub fn update_cursor(&mut self, x: i64, y: i64, updated_at: u64) -> app::Result<()> {
        let me = caller()?;
        let cursor = CursorState {
            identity: me.clone(),
            account: me.clone(),
            x,
            y,
            updated_at,
        };
        let _old = self.cursors.insert(&me, &cursor)?;
        emit(Event::CursorMoved { identity: me })
    }

    /// Every pointer (at most 1,000).
    #[app::view]
    pub fn get_cursors(&self) -> app::Result<Vec<CursorState>> {
        let _ = caller()?;
        Ok(self
            .cursors
            .page(FindOpts::default().limit(ROWS))?
            .items
            .into_iter()
            .map(|(account, mut c)| {
                c.identity = account.clone();
                c.account = account;
                c
            })
            .collect())
    }
}

fn clean_username(username: String) -> app::Result<String> {
    let username = username.trim().to_owned();
    if username.is_empty() {
        return Err(invalid("username cannot be empty"));
    }
    if username.chars().count() > MAX_USERNAME {
        return Err(invalid(format!(
            "username cannot be longer than {MAX_USERNAME} characters"
        )));
    }
    Ok(username)
}
