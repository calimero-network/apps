#![allow(clippy::too_many_arguments)]

//! MeroPixArt: a collaborative layered image editor (raster, group, text,
//! adjustment and fill layers, masks, non-destructive adjustments, free
//! transform) on core's component SDK (`calimero-app-sdk`).
//!
//! One app instance is one document. The app runs on its cluster's leader,
//! which applies every write in one replicated log, so the state is plain
//! tables and maps: v1's CRDT plumbing (hand-written last-writer-wins merges,
//! the `Ownable` cells and their `Frozen` fallbacks, the role masks projected
//! onto a `PermissionedStorage`) has nothing left to decide.
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `Ownable<LwwRegister<String>>` name / description, `Ownable<LwwRegister<Option<Canvas>>>` canvas, `Frozen` opening values | `document: Cell<Document>`, written only by the owner (a check in the method) |
//! | the `Ownable` writer set (the owner) | `owner: Cell<String>`, the app's owner at `init` |
//! | `PermissionedStorage<IndexedMap<LayerId, Layer>>`, `#[index]` on `parent_id` and `layer_index` | `layers: Table<Layer>`, indexes `stack` (`layerIndex`) and `children` (`parentId`), a maintained count per kind |
//! | a raster layer's pixels: one PNG blob per layer (`blob_id`), a mask: one PNG blob (`mask_blob_id`) | `tiles: UnorderedMap<(layer, plane, tx, ty), BlobRef>`: 256 × 256 PNG tiles, each a blob; a stroke writes only the tiles it changed, and a layer loads its tiles a page at a time |
//! | `UserStorage<Member>` | `members: UnorderedMap<account, Member>`, each written only by its own account |
//! | `AccessControl` (admin tier + `editor` role), `LAYER_ROLE_MASKS` | `editors: Set<account>`; the admin is the owner |
//! | `Authored<UnorderedMap<device, CursorState>>` | nothing: live pointers are the node's presence (`publishPresence`), per device, outside the log |
//! | (new) | `exports: UnorderedMap<(createdAt, id), Export>`: images exported from the editor, each a blob |
//!
//! # Who may do what
//!
//! The organization decides who reaches the document: its owner, admins,
//! members and guests. Everyone who reaches it may read it, join its roster,
//! rename themselves and record an export. The rules v1 kept in storage are
//! checks here, in the method, against `env::caller()`, before anything is
//! written:
//!
//! - only an **editor** (granted by the admin) or the **admin** (the document's
//!   owner) may change layers or their pixels: anyone else gets `Forbidden`;
//! - only the **owner** may rename, resize or recolour the document, grant or
//!   revoke the editor role, hand the document on, or clear every layer;
//! - a roster entry is always the caller's own: no method takes the account it
//!   writes for.
//!
//! Every write goes through a method, so there is no "patched node" to defend
//! against: v1's forged-write tests are the same calls made as another account.
//!
//! Everything a client sees differently from v1 is in
//! `apps/mero-pixart/README.md`, "What changed in the port".

use calimero_app_sdk::env::Caller;
use calimero_app_sdk::json::{i64_auto, u64_auto};
use calimero_app_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// A tile's side, in pixels. Tile `(tx, ty)` covers `x in [tx*256, tx*256+256)`.
pub const TILE: u32 = 256;
/// The largest raster a layer may hold, per side: 32 × 32 tiles per plane.
pub const MAX_RASTER: u32 = 8192;
/// The most tiles a plane can have (`(MAX_RASTER / TILE)^2`), and so the most
/// one write may carry.
pub const MAX_TILES: usize = ((MAX_RASTER / TILE) * (MAX_RASTER / TILE)) as usize;
/// The most layers a document holds. Bounds `sendToBack`'s shift, a group's
/// re-parenting and a reorder, which each write up to every layer.
pub const MAX_LAYERS: u64 = 500;
/// The default canvas, when nobody has set one.
pub const DEFAULT_WIDTH: u32 = 1280;
pub const DEFAULT_HEIGHT: u32 = 720;
/// Largest page any paged view answers.
pub const MAX_PAGE: u32 = 1000;
/// Page size used when the caller gives none (or 0).
pub const DEFAULT_PAGE: u32 = 100;
/// Most tile entries one `clearLayers` call deletes (it always takes at least
/// one whole layer); the rest is left for the next call.
pub const CLEAR_BUDGET: u64 = 4096;
/// Longest text field a layer, a name or an export label may carry, in bytes.
pub const MAX_TEXT: usize = 4096;
/// Longest opaque JSON blob (`curves`, `warp`) a layer may carry, in bytes.
pub const MAX_JSON: usize = 16 * 1024;

const PIXELS: &str = "pixels";
const MASK: &str = "mask";
/// Map entries read per batch when a delete removes a layer's tiles.
const BATCH: u32 = 1000;

// ── stored values ────────────────────────────────────────────────────────────

/// Non-destructive adjustments, applied when compositing.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
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
    /// JSON curve control points (per-channel splines), opaque here; "" = identity.
    pub curves: String,
}

/// A text layer's properties.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextProps {
    pub content: String,
    pub font_family: String,
    pub font_size: u32,
    pub color: String,
    pub bold: bool,
    pub italic: bool,
    #[serde(default)]
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

/// A layer as callers see it (v1's `Layer`, with `pixelsRev`, `maskRev` and
/// `hasMask` in place of `blobId` / `maskBlobId`). `kind` says how it is
/// composited: `raster` (pixels in tiles), `group` (a folder: its children name
/// it as `parentId`), `text`, `adjustment` (applies `adjustments` below it),
/// `fill` (a solid `fill`).
///
/// A raster layer's pixels are not in the record: they are `tiles` entries,
/// `pixelsRev` counts the writes to them (0: none yet) and `maskRev` those to
/// the mask (`hasMask` whether one is set), so a client knows when to reload.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: String,
    pub name: String,
    /// "raster" | "group" | "text" | "adjustment" | "fill"
    pub kind: String,
    /// The group layer this one sits in; `null` at the top level.
    pub parent_id: Option<String>,
    /// Order within the document (ascending = bottom to top).
    pub layer_index: u32,
    pub visible: bool,
    pub locked: bool,
    /// 0..=100
    pub opacity: u8,
    pub blend_mode: String,
    /// A decimal string.
    #[serde(with = "i64_auto")]
    pub x: i64,
    /// A decimal string.
    #[serde(with = "i64_auto")]
    pub y: i64,
    pub width: u32,
    pub height: u32,
    pub rotation: i32,
    /// percent, 100 = 1:1
    pub scale_x: i32,
    pub scale_y: i32,
    /// Horizontal shear in degrees (-80..=80).
    pub skew_x: i32,
    /// Vertical shear in degrees (-80..=80).
    pub skew_y: i32,
    pub flip_h: bool,
    pub flip_v: bool,
    /// Corner-pin warp, JSON, opaque here; "" = none.
    pub warp: String,
    /// Writes to the pixel tiles so far; 0 = the layer has no pixels yet. A
    /// decimal string.
    #[serde(with = "u64_auto")]
    pub pixels_rev: u64,
    /// Writes to the mask tiles so far. A decimal string.
    #[serde(with = "u64_auto")]
    pub mask_rev: u64,
    /// Whether the layer has a mask.
    pub has_mask: bool,
    /// Solid colour for `fill` layers.
    pub fill: String,
    pub adjustments: Adjustments,
    pub text: Option<TextProps>,
    /// The account that added the layer (never what the client said).
    pub created_by: String,
    /// As the client gave it; a decimal string.
    #[serde(with = "u64_auto")]
    pub created_at: u64,
    /// As the client gave it; a decimal string.
    #[serde(with = "u64_auto")]
    pub updated_at: u64,
}

/// A layer as stored: [`Layer`] with its adjustments and text properties
/// flattened, because every field of a table record is a key part (the
/// indexes are built from them), and a nested struct is not one.
#[derive(Record)]
#[table(
    key = "id",
    index(stack = ["layer_index"]),
    index(children = ["parent_id"]),
    count(by_kind = ["kind"]),
)]
pub struct LayerRow {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub parent_id: Option<String>,
    pub layer_index: u32,
    pub visible: bool,
    pub locked: bool,
    pub opacity: u8,
    pub blend_mode: String,
    pub x: i64,
    pub y: i64,
    pub width: u32,
    pub height: u32,
    pub rotation: i32,
    pub scale_x: i32,
    pub scale_y: i32,
    pub skew_x: i32,
    pub skew_y: i32,
    pub flip_h: bool,
    pub flip_v: bool,
    pub warp: String,
    pub pixels_rev: u64,
    pub mask_rev: u64,
    pub has_mask: bool,
    pub fill: String,
    pub adj_brightness: i32,
    pub adj_contrast: i32,
    pub adj_saturation: i32,
    pub adj_hue: i32,
    pub adj_exposure: i32,
    pub adj_blur: u32,
    pub adj_invert: bool,
    pub adj_curves: String,
    pub has_text: bool,
    pub text_content: String,
    pub text_font_family: String,
    pub text_font_size: u32,
    pub text_color: String,
    pub text_bold: bool,
    pub text_italic: bool,
    pub text_align: Option<String>,
    pub created_by: String,
    pub created_at: u64,
    pub updated_at: u64,
}

impl LayerRow {
    fn adjustments(&self) -> Adjustments {
        Adjustments {
            brightness: self.adj_brightness,
            contrast: self.adj_contrast,
            saturation: self.adj_saturation,
            hue: self.adj_hue,
            exposure: self.adj_exposure,
            blur: self.adj_blur,
            invert: self.adj_invert,
            curves: self.adj_curves.clone(),
        }
    }

    fn set_adjustments(&mut self, a: Adjustments) {
        self.adj_brightness = a.brightness;
        self.adj_contrast = a.contrast;
        self.adj_saturation = a.saturation;
        self.adj_hue = a.hue;
        self.adj_exposure = a.exposure;
        self.adj_blur = a.blur;
        self.adj_invert = a.invert;
        self.adj_curves = a.curves;
    }

    fn text(&self) -> Option<TextProps> {
        self.has_text.then(|| TextProps {
            content: self.text_content.clone(),
            font_family: self.text_font_family.clone(),
            font_size: self.text_font_size,
            color: self.text_color.clone(),
            bold: self.text_bold,
            italic: self.text_italic,
            align: self.text_align.clone(),
        })
    }

    fn set_text(&mut self, t: Option<TextProps>) {
        self.has_text = t.is_some();
        let t = t.unwrap_or_else(|| TextProps {
            font_family: String::new(),
            font_size: 0,
            color: String::new(),
            ..TextProps::default()
        });
        self.text_content = t.content;
        self.text_font_family = t.font_family;
        self.text_font_size = t.font_size;
        self.text_color = t.color;
        self.text_bold = t.bold;
        self.text_italic = t.italic;
        self.text_align = t.align;
    }

    fn view(self) -> Layer {
        let adjustments = self.adjustments();
        let text = self.text();
        Layer {
            id: self.id,
            name: self.name,
            kind: self.kind,
            parent_id: self.parent_id,
            layer_index: self.layer_index,
            visible: self.visible,
            locked: self.locked,
            opacity: self.opacity,
            blend_mode: self.blend_mode,
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
            rotation: self.rotation,
            scale_x: self.scale_x,
            scale_y: self.scale_y,
            skew_x: self.skew_x,
            skew_y: self.skew_y,
            flip_h: self.flip_h,
            flip_v: self.flip_v,
            warp: self.warp,
            pixels_rev: self.pixels_rev,
            mask_rev: self.mask_rev,
            has_mask: self.has_mask,
            fill: self.fill,
            adjustments,
            text,
            created_by: self.created_by,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

/// What `addLayer` takes: a layer as the editor builds it. Anything else the
/// client's layer object carries (its old `blobId`, `createdBy`, …) is ignored.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewLayer {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub layer_index: u32,
    #[serde(default = "yes")]
    pub visible: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default = "full")]
    pub opacity: u8,
    #[serde(default = "normal")]
    pub blend_mode: String,
    /// A decimal string.
    #[serde(default, with = "i64_auto")]
    pub x: i64,
    /// A decimal string.
    #[serde(default, with = "i64_auto")]
    pub y: i64,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub rotation: i32,
    #[serde(default = "hundred")]
    pub scale_x: i32,
    #[serde(default = "hundred")]
    pub scale_y: i32,
    #[serde(default)]
    pub skew_x: i32,
    #[serde(default)]
    pub skew_y: i32,
    #[serde(default)]
    pub flip_h: bool,
    #[serde(default)]
    pub flip_v: bool,
    #[serde(default)]
    pub warp: String,
    #[serde(default)]
    pub fill: String,
    #[serde(default)]
    pub adjustments: Adjustments,
    #[serde(default)]
    pub text: Option<TextProps>,
    /// A decimal string.
    #[serde(default, with = "u64_auto")]
    pub created_at: u64,
    /// A decimal string.
    #[serde(default, with = "u64_auto")]
    pub updated_at: u64,
}

fn yes() -> bool {
    true
}
fn full() -> u8 {
    100
}
fn normal() -> String {
    "normal".to_owned()
}
fn hundred() -> i32 {
    100
}

/// The document's settings: what only the owner changes.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub name: String,
    pub description: String,
    pub width: u32,
    pub height: u32,
    pub background: String,
}

impl Default for Document {
    fn default() -> Self {
        Document {
            name: String::new(),
            description: String::new(),
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            background: "#00000000".to_owned(),
        }
    }
}

/// A roster entry: who joined the document, under which name.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    /// The account (taken from the key, never from the stored value).
    pub id: String,
    pub username: String,
    pub avatar: Option<String>,
    /// As the client gave it; a decimal string on the wire.
    #[serde(with = "u64_auto")]
    pub joined_at: u64,
    /// As the client gave it; a decimal string on the wire.
    #[serde(with = "u64_auto")]
    pub username_updated_at: u64,
}

/// An image exported from the editor, kept as a blob.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Export {
    /// 32 hex characters.
    pub id: String,
    /// The file's blob (64 hex in JSON); the node keeps it while this refers to it.
    pub blob_id: BlobRef,
    pub name: String,
    /// "png" | "jpeg" | "svg"
    pub format: String,
    pub created_by: String,
    /// Unix milliseconds (the log entry's time); a decimal string.
    #[serde(with = "u64_auto")]
    pub created_at: u64,
}

// ── arguments and results ────────────────────────────────────────────────────

/// One tile of a write: `blobId` the PNG's blob (64 hex), `null` for a tile
/// that is now empty (it is removed).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TileWrite {
    pub tx: u32,
    pub ty: u32,
    pub blob_id: Option<String>,
}

/// One stored tile.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tile {
    pub tx: u32,
    pub ty: u32,
    pub blob_id: String,
}

/// The document as callers see it.
#[derive(Serialize, Deserialize, Clone, Debug)]
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

/// A member paired with their role, for the settings screen.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemberRole {
    pub member: String,
    pub role: String,
}

/// One page of a paged view, and the cursor of the next (`null` at the end).
#[derive(Serialize)]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub next: Option<String>,
}

/// What `clearLayers` did: `more` while layers remain (call it again).
#[derive(Serialize)]
pub struct Cleared {
    pub removed: u32,
    pub more: bool,
}

// ── state ────────────────────────────────────────────────────────────────────

/// The document.
#[app::state(version = 1)]
pub struct MeroPixArt {
    /// Name, description and canvas; `Document::default()` until the owner sets them.
    document: Cell<Document>,
    /// The document's owner: its admin. The app's owner at `init`.
    owner: Cell<String>,
    layers: Table<LayerRow>,
    /// `(layer, plane, tx, ty)` → the tile's PNG; `plane` is `pixels` or `mask`.
    tiles: UnorderedMap<(String, String, u32, u32), BlobRef>,
    /// account → roster entry, written only by that account.
    members: UnorderedMap<String, Member>,
    /// Accounts granted the editor role.
    editors: Set<String>,
    /// `(createdAt, id)` → export, so the newest are the last keys.
    exports: UnorderedMap<(u64, String), Export>,
    /// export id → its `createdAt`, to find it by id.
    export_ids: UnorderedMap<String, u64>,
}

#[app::logic]
impl MeroPixArt {
    /// The empty document, owned by the app's owner (v1's creator, the sole
    /// initial admin). v1's `init(name, description, width, height)` becomes
    /// the owner's first `updateDocument`: a component's `init` takes no
    /// arguments here.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        let mut doc = Self::load();
        doc.owner.set(&env::app_owner())?;
        doc.document.set(&Document::default())?;
        Ok(doc)
    }

    // ── document ─────────────────────────────────────────────────────────────

    /// The document's settings and counts. `owner` is the admin's account.
    #[app::view]
    pub fn get_document(&self) -> app::Result<DocumentInfo> {
        let d = self.doc()?;
        Ok(DocumentInfo {
            name: d.name,
            description: d.description,
            width: d.width,
            height: d.height,
            background: d.background,
            layer_count: u32::try_from(self.layer_count()?).unwrap_or(u32::MAX),
            member_count: u32::try_from(self.members.len()?).unwrap_or(u32::MAX),
            owner: self.owner.get()?,
        })
    }

    /// Renames, re-describes, resizes or recolours the document; every argument
    /// is optional. Owner only (`Forbidden`); a size outside 1..=8192 is
    /// `Invalid`. Emits `DocumentUpdated`.
    pub fn update_document(
        &mut self,
        name: Option<String>,
        description: Option<String>,
        width: Option<u32>,
        height: Option<u32>,
        background: Option<String>,
    ) -> app::Result<()> {
        self.require_owner("change the document")?;
        let mut d = self.doc()?;
        if let Some(v) = name {
            check_text("name", &v)?;
            d.name = v;
        }
        if let Some(v) = description {
            check_text("description", &v)?;
            d.description = v;
        }
        if let Some(v) = width {
            check_side("width", v)?;
            d.width = v;
        }
        if let Some(v) = height {
            check_side("height", v)?;
            d.height = v;
        }
        if let Some(v) = background {
            check_text("background", &v)?;
            d.background = v;
        }
        self.document.set(&d)?;
        env::emit(Event::DocumentUpdated {}, Audience::All)?;
        Ok(())
    }

    /// Hands the document (and the admin role) to `newOwner`, an account of the
    /// app's organization (`Invalid` otherwise). Owner only. Emits
    /// `OwnerTransferred`.
    pub fn transfer_ownership(&mut self, new_owner: String) -> app::Result<()> {
        self.require_owner("hand the document on")?;
        check_account(&new_owner)?;
        self.owner.set(&new_owner)?;
        env::emit(Event::OwnerTransferred { owner: new_owner }, Audience::All)?;
        Ok(())
    }

    // ── roles ────────────────────────────────────────────────────────────────

    /// Grants `member` (an account of the organization, `Invalid` otherwise)
    /// the editor role, before or after they open the document. Owner only.
    /// Emits `RoleUpdated`.
    pub fn grant_editor(&mut self, member: String) -> app::Result<()> {
        self.require_owner("grant roles")?;
        check_account(&member)?;
        let _ = self.editors.insert(&member)?;
        env::emit(Event::RoleUpdated { member }, Audience::All)?;
        Ok(())
    }

    /// Takes the editor role from `member`. Owner only. Emits `RoleUpdated`.
    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        self.require_owner("revoke roles")?;
        let _ = self.editors.remove(&member)?;
        env::emit(Event::RoleUpdated { member }, Audience::All)?;
        Ok(())
    }

    /// `admin` (the owner), `editor` or `viewer`, for any account.
    #[app::view]
    pub fn get_role(&self, member: String) -> app::Result<String> {
        self.role_of(&member)
    }

    /// The caller's role.
    #[app::view]
    pub fn my_role(&self) -> app::Result<String> {
        self.role_of(&caller()?)
    }

    /// Whether the caller may change layers.
    #[app::view]
    pub fn can_edit(&self) -> app::Result<bool> {
        self.is_editor(&caller()?)
    }

    /// One page of the roster with each member's role, by account.
    #[app::view]
    pub fn list_roles(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<Paged<MemberRole>> {
        let page = self.members.page(page_opts(cursor, limit))?;
        let items = page
            .items
            .into_iter()
            .map(|(account, _)| {
                Ok(MemberRole {
                    role: self.role_of(&account)?,
                    member: account,
                })
            })
            .collect::<app::Result<_>>()?;
        Ok(Paged {
            items,
            next: page.next,
        })
    }

    // ── members ──────────────────────────────────────────────────────────────

    /// Puts the caller on the roster under `username` (at most 4,096 bytes).
    /// A caller already on it is left as they are. Emits `MemberJoined`.
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
        check_text("username", &username)?;
        if let Some(a) = &avatar {
            check_text("avatar", a)?;
        }
        let entry = Member {
            id: me.clone(),
            username,
            avatar,
            joined_at: timestamp,
            username_updated_at: timestamp,
        };
        let _ = self.members.insert(&me, &entry)?;
        env::emit(Event::MemberJoined { id: me }, Audience::All)?;
        Ok(())
    }

    /// One page of the roster, by account; `id` is the entry's key.
    #[app::view]
    pub fn get_members(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<Paged<Member>> {
        let page = self.members.page(page_opts(cursor, limit))?;
        Ok(Paged {
            items: page
                .items
                .into_iter()
                .map(|(account, mut m)| {
                    m.id = account;
                    m
                })
                .collect(),
            next: page.next,
        })
    }

    /// Renames the caller on the roster; nothing for a caller not on it.
    /// Emits `MemberUsernameUpdated`.
    pub fn update_member_username(&mut self, username: String, timestamp: u64) -> app::Result<()> {
        let me = caller()?;
        check_text("username", &username)?;
        let Some(mut m) = self.members.get(&me)? else {
            return Ok(());
        };
        m.username = username;
        m.username_updated_at = timestamp;
        let _ = self.members.insert(&me, &m)?;
        env::emit(Event::MemberUsernameUpdated { id: me }, Audience::All)?;
        Ok(())
    }

    // ── layers ───────────────────────────────────────────────────────────────

    /// Adds a layer and answers its id. Editors only. A layer with the same id
    /// is replaced (its pixels and mask dropped), as v1's insert did. At most
    /// 500 layers (`TooMany`). `createdBy` is the caller. Emits `LayerAdded`.
    pub fn add_layer(&mut self, layer: NewLayer) -> app::Result<String> {
        let me = self.require_editor()?;
        check_id(&layer.id)?;
        check_text("name", &layer.name)?;
        check_kind(&layer.kind)?;
        check_raster(layer.width, layer.height)?;
        check_json("warp", &layer.warp)?;
        check_json("curves", &layer.adjustments.curves)?;
        if let Some(t) = &layer.text {
            check_text("text", &t.content)?;
        }
        if self.layers.contains(&layer.id)? {
            self.drop_tiles(&layer.id, PIXELS)?;
            self.drop_tiles(&layer.id, MASK)?;
            let _ = self.layers.remove(&layer.id)?;
        } else if self.layer_count()? >= MAX_LAYERS {
            return Err(Error::TooMany {
                what: "layers".to_owned(),
                limit: MAX_LAYERS,
            }
            .into());
        }
        let id = layer.id.clone();
        let mut row = LayerRow {
            id: layer.id,
            name: layer.name,
            kind: layer.kind,
            parent_id: layer.parent_id,
            layer_index: layer.layer_index,
            visible: layer.visible,
            locked: layer.locked,
            opacity: layer.opacity.min(100),
            blend_mode: layer.blend_mode,
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
            scale_x: layer.scale_x,
            scale_y: layer.scale_y,
            skew_x: layer.skew_x.clamp(-80, 80),
            skew_y: layer.skew_y.clamp(-80, 80),
            flip_h: layer.flip_h,
            flip_v: layer.flip_v,
            warp: layer.warp,
            pixels_rev: 0,
            mask_rev: 0,
            has_mask: false,
            fill: layer.fill,
            adj_brightness: 0,
            adj_contrast: 0,
            adj_saturation: 0,
            adj_hue: 0,
            adj_exposure: 0,
            adj_blur: 0,
            adj_invert: false,
            adj_curves: String::new(),
            has_text: false,
            text_content: String::new(),
            text_font_family: String::new(),
            text_font_size: 0,
            text_color: String::new(),
            text_bold: false,
            text_italic: false,
            text_align: None,
            created_by: me,
            created_at: layer.created_at,
            updated_at: layer.updated_at,
        };
        row.set_adjustments(layer.adjustments);
        row.set_text(layer.text);
        self.layers.insert(row)?;
        env::emit(Event::LayerAdded { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// Patches a layer's properties, transform and compositing; every argument
    /// but `id` and `updatedAt` is optional. Editors only; an unknown id
    /// changes nothing. Emits `LayerUpdated` when the layer exists.
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
        self.require_editor()?;
        if let Some(v) = &name {
            check_text("name", v)?;
        }
        if let Some(w) = width {
            check_raster(w, 0)?;
        }
        if let Some(h) = height {
            check_raster(0, h)?;
        }
        let found = self.layers.update(&id, |l| {
            set(&mut l.name, name);
            set(&mut l.visible, visible);
            set(&mut l.locked, locked);
            set(&mut l.opacity, opacity.map(|o| o.min(100)));
            set(&mut l.blend_mode, blend_mode);
            set(&mut l.x, x);
            set(&mut l.y, y);
            set(&mut l.width, width);
            set(&mut l.height, height);
            set(&mut l.rotation, rotation);
            set(&mut l.scale_x, scale_x);
            set(&mut l.scale_y, scale_y);
            set(&mut l.fill, fill);
            l.updated_at = updated_at;
        })?;
        if found {
            env::emit(Event::LayerUpdated { id }, Audience::All)?;
        }
        Ok(())
    }

    /// Patches the free-transform params: rotation, scale, shear (clamped to
    /// -80..=80), mirror and corner-pin warp (`""` clears it). Editors only.
    /// Emits `LayerUpdated` when the layer exists.
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
        self.require_editor()?;
        if let Some(w) = &warp {
            check_json("warp", w)?;
        }
        let found = self.layers.update(&id, |l| {
            set(&mut l.rotation, rotation);
            set(&mut l.scale_x, scale_x);
            set(&mut l.scale_y, scale_y);
            set(&mut l.skew_x, skew_x.map(|v| v.clamp(-80, 80)));
            set(&mut l.skew_y, skew_y.map(|v| v.clamp(-80, 80)));
            set(&mut l.flip_h, flip_h);
            set(&mut l.flip_v, flip_v);
            set(&mut l.warp, warp);
            l.updated_at = updated_at;
        })?;
        if found {
            env::emit(Event::LayerUpdated { id }, Audience::All)?;
        }
        Ok(())
    }

    /// Re-parents several layers at once (`[id, parentId | null]` pairs, at most
    /// 500). A move that would make a layer its own ancestor is skipped, as are
    /// unknown ids. Editors only. Emits `LayersReordered`.
    pub fn move_layers(
        &mut self,
        moves: Vec<(String, Option<String>)>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        check_many("moves", moves.len())?;
        for (id, parent_id) in moves {
            if let Some(parent) = &parent_id {
                if *parent == id || self.is_descendant_of(parent, &id)? {
                    continue;
                }
            }
            let _ = self.layers.update(&id, |l| {
                l.parent_id = parent_id;
                l.updated_at = updated_at;
            })?;
        }
        env::emit(Event::LayersReordered {}, Audience::All)?;
        Ok(())
    }

    /// Replaces tiles of a raster layer's pixels after a destructive edit
    /// (brush, eraser, fill, filter, a baked transform): only the tiles that
    /// changed, each a 256 × 256 PNG blob the caller uploaded (`blobId: null`
    /// removes an emptied tile). `width` and `height` are the raster's new size
    /// (1..=8192); tiles outside it are removed. `UnknownBlob` for a blob the
    /// app does not hold; `Invalid` for a tile outside the raster or more than
    /// 1,024 tiles. Editors only; `NotFound` for an unknown layer. Emits
    /// `LayerUpdated`.
    pub fn update_layer_content(
        &mut self,
        id: String,
        width: u32,
        height: u32,
        tiles: Vec<TileWrite>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        check_side("width", width)?;
        check_side("height", height)?;
        let layer = self.require_layer(&id)?;
        self.write_tiles(&id, PIXELS, width, height, &tiles)?;
        if width < layer.width || height < layer.height {
            self.trim_tiles(&id, PIXELS, width, height)?;
            if layer.has_mask {
                self.trim_tiles(&id, MASK, width, height)?;
            }
        }
        let _ = self.layers.update(&id, |l| {
            l.width = width;
            l.height = height;
            l.pixels_rev += 1;
            l.updated_at = updated_at;
        })?;
        env::emit(Event::LayerUpdated { id }, Audience::All)?;
        Ok(())
    }

    /// Sets or clears a layer's mask: `tiles` as `updateLayerContent`'s, over
    /// the layer's own size; `null` removes the mask. Editors only. Emits
    /// `LayerUpdated`.
    pub fn update_layer_mask(
        &mut self,
        id: String,
        tiles: Option<Vec<TileWrite>>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        let layer = self.require_layer(&id)?;
        let has_mask = match &tiles {
            Some(tiles) => {
                let (w, h) = (layer.width.max(1), layer.height.max(1));
                self.write_tiles(&id, MASK, w, h, tiles)?;
                true
            }
            None => {
                self.drop_tiles(&id, MASK)?;
                false
            }
        };
        let _ = self.layers.update(&id, |l| {
            l.has_mask = has_mask;
            l.mask_rev += 1;
            l.updated_at = updated_at;
        })?;
        env::emit(Event::LayerUpdated { id }, Audience::All)?;
        Ok(())
    }

    /// One page of a layer's tiles (`mask: true` for its mask's), in `(tx, ty)`
    /// order. `NotFound` for an unknown layer.
    #[app::view]
    pub fn get_layer_tiles(
        &self,
        id: String,
        mask: Option<bool>,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<Paged<Tile>> {
        self.require_layer(&id)?;
        let plane = if mask.unwrap_or(false) { MASK } else { PIXELS };
        let page = self.tiles.prefix(
            &[KeyPart::Str(id), KeyPart::Str(plane.to_owned())],
            page_opts(cursor, limit),
        )?;
        Ok(Paged {
            items: page
                .items
                .into_iter()
                .map(|((_, _, tx, ty), blob)| Tile {
                    tx,
                    ty,
                    blob_id: blob.id(),
                })
                .collect(),
            next: page.next,
        })
    }

    /// Patches non-destructive adjustments. Editors only. Emits `LayerUpdated`
    /// when the layer exists.
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
        self.require_editor()?;
        if let Some(c) = &curves {
            check_json("curves", c)?;
        }
        let found = self.layers.update(&id, |l| {
            let mut a = l.adjustments();
            set(&mut a.brightness, brightness);
            set(&mut a.contrast, contrast);
            set(&mut a.saturation, saturation);
            set(&mut a.hue, hue);
            set(&mut a.exposure, exposure);
            set(&mut a.blur, blur);
            set(&mut a.invert, invert);
            set(&mut a.curves, curves);
            l.set_adjustments(a);
            l.updated_at = updated_at;
        })?;
        if found {
            env::emit(Event::LayerUpdated { id }, Audience::All)?;
        }
        Ok(())
    }

    /// Patches a text layer's properties (a layer without them gets the
    /// defaults first). Editors only. Emits `LayerUpdated` when it exists.
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
        self.require_editor()?;
        if let Some(c) = &content {
            check_text("content", c)?;
        }
        let found = self.layers.update(&id, |l| {
            let mut t = l.text().unwrap_or_default();
            set(&mut t.content, content);
            set(&mut t.font_family, font_family);
            set(&mut t.font_size, font_size);
            set(&mut t.color, color);
            set(&mut t.bold, bold);
            set(&mut t.italic, italic);
            if align.is_some() {
                t.align = align;
            }
            l.set_text(Some(t));
            l.updated_at = updated_at;
        })?;
        if found {
            env::emit(Event::LayerUpdated { id }, Audience::All)?;
        }
        Ok(())
    }

    /// Deletes a layer with its pixels and mask; a group's children move to the
    /// top level. Editors only; an unknown id changes nothing. Emits
    /// `LayerDeleted`.
    pub fn delete_layer(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        self.remove_layer(&id)?;
        env::emit(Event::LayerDeleted { id }, Audience::All)?;
        Ok(())
    }

    /// One page of the layers, bottom to top (`layerIndex` order).
    #[app::view]
    pub fn get_layers(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<Paged<Layer>> {
        let page = self.layers.find("stack", &[], page_opts(cursor, limit))?;
        Ok(Paged {
            items: page.items.into_iter().map(LayerRow::view).collect(),
            next: page.next,
        })
    }

    /// One layer, or `null`.
    #[app::view]
    pub fn get_layer(&self, id: String) -> app::Result<Option<Layer>> {
        Ok(self.layers.get(&id)?.map(LayerRow::view))
    }

    /// Moves a layer into (or out of, `null`) a group and sets its index.
    /// Editors only. Emits `LayersReordered` when the layer exists.
    pub fn move_layer(
        &mut self,
        id: String,
        parent_id: Option<String>,
        layer_index: u32,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        let found = self.layers.update(&id, |l| {
            l.parent_id = parent_id;
            l.layer_index = layer_index;
            l.updated_at = updated_at;
        })?;
        if found {
            env::emit(Event::LayersReordered {}, Audience::All)?;
        }
        Ok(())
    }

    /// Sets each listed layer's index (`[id, index]` pairs, at most 500), after
    /// a drag in the layers panel. Editors only. Emits `LayersReordered`.
    pub fn reorder_layers(
        &mut self,
        order: Vec<(String, u32)>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        check_many("order", order.len())?;
        for (id, index) in order {
            let _ = self.layers.update(&id, |l| {
                l.layer_index = index;
                l.updated_at = updated_at;
            })?;
        }
        env::emit(Event::LayersReordered {}, Audience::All)?;
        Ok(())
    }

    /// Puts a layer above every other one (one read of the `stack` index).
    /// Editors only. Emits `LayersReordered`.
    pub fn bring_to_front(&mut self, id: String, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;
        let top = self
            .layers
            .find("stack", &[], FindOpts::default().reverse().limit(1))?
            .items
            .into_iter()
            .next()
            .map_or(0, |l| l.layer_index);
        let _ = self.layers.update(&id, |l| {
            l.layer_index = top.saturating_add(1);
            l.updated_at = updated_at;
        })?;
        env::emit(Event::LayersReordered {}, Audience::All)?;
        Ok(())
    }

    /// Puts a layer below every other one. With room below the bottom (its
    /// index above 0) this writes one layer; a stack already at 0 shifts the
    /// others up by one (at most 500 writes). Editors only. Emits
    /// `LayersReordered`.
    pub fn send_to_back(&mut self, id: String, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;
        let lowest = self
            .layers
            .find("stack", &[], FindOpts::default().limit(2))?
            .items
            .into_iter()
            .find(|l| l.id != id)
            .map(|l| l.layer_index);
        let target = match lowest {
            Some(0) => {
                let mut cursor = None;
                loop {
                    let mut opts = FindOpts::default().limit(BATCH);
                    if let Some(c) = cursor.take() {
                        opts = opts.cursor(c);
                    }
                    let page = self.layers.find("stack", &[], opts)?;
                    let ids: Vec<String> = page
                        .items
                        .into_iter()
                        .map(|l| l.id)
                        .filter(|other| *other != id)
                        .collect();
                    // Shift from the top down so the cursor (over the index)
                    // never meets a row it already moved.
                    for other in ids.iter().rev() {
                        let _ = self.layers.update(other, |l| {
                            l.layer_index = l.layer_index.saturating_add(1);
                        })?;
                    }
                    match page.next {
                        Some(n) => cursor = Some(n),
                        None => break,
                    }
                }
                0
            }
            Some(bottom) => bottom - 1,
            None => 0,
        };
        let _ = self.layers.update(&id, |l| {
            l.layer_index = target;
            l.updated_at = updated_at;
        })?;
        env::emit(Event::LayersReordered {}, Audience::All)?;
        Ok(())
    }

    /// Deletes layers (with their pixels and masks) until none is left or this
    /// call has removed about 4,096 tiles: `more` says to call again. Owner
    /// only. Emits `LayersReordered`.
    pub fn clear_layers(&mut self) -> app::Result<Cleared> {
        self.require_owner("clear the document")?;
        let mut removed = 0u32;
        let mut budget = 0u64;
        loop {
            let page = self.layers.scan(FindOpts::default().limit(1))?;
            let Some(layer) = page.items.into_iter().next() else {
                env::emit(Event::LayersReordered {}, Audience::All)?;
                return Ok(Cleared {
                    removed,
                    more: false,
                });
            };
            if removed > 0 && budget >= CLEAR_BUDGET {
                env::emit(Event::LayersReordered {}, Audience::All)?;
                return Ok(Cleared {
                    removed,
                    more: true,
                });
            }
            budget += self.remove_layer(&layer.id)?;
            removed += 1;
        }
    }

    // ── exports ──────────────────────────────────────────────────────────────

    /// Records an image exported from the editor: `blobId` the uploaded file
    /// (`UnknownBlob` if the app does not hold it), `name` its file name,
    /// `format` `png`, `jpeg` or `svg`. Anyone who reaches the document may.
    /// Answers the export's id. Emits `ExportAdded`.
    pub fn add_export(
        &mut self,
        blob_id: String,
        name: String,
        format: String,
    ) -> app::Result<String> {
        let me = caller()?;
        check_text("name", &name)?;
        if !matches!(format.as_str(), "png" | "jpeg" | "svg") {
            return Err(invalid("format must be png, jpeg or svg"));
        }
        let blob = held_blob(&blob_id)?;
        let id = fresh_id();
        let now = env::time_now();
        let entry = Export {
            id: id.clone(),
            blob_id: blob,
            name,
            format,
            created_by: me,
            created_at: now,
        };
        let _ = self.exports.insert(&(now, id.clone()), &entry)?;
        let _ = self.export_ids.insert(&id, &now)?;
        env::emit(Event::ExportAdded { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// One page of the exports, newest first.
    #[app::view]
    pub fn get_exports(
        &self,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> app::Result<Paged<Export>> {
        let page = self.exports.page(page_opts(cursor, limit).reverse())?;
        Ok(Paged {
            items: page.items.into_iter().map(|(_, e)| e).collect(),
            next: page.next,
        })
    }

    /// Removes an export record (its blob goes once nothing refers to it). Its
    /// creator or the owner only (`Forbidden`); `NotFound` otherwise.
    pub fn delete_export(&mut self, id: String) -> app::Result<()> {
        let me = caller()?;
        let Some(at) = self.export_ids.get(&id)? else {
            return Err(not_found("export", &id));
        };
        let key = (at, id.clone());
        let Some(e) = self.exports.get(&key)? else {
            return Err(not_found("export", &id));
        };
        if e.created_by != me && !self.is_owner(&me)? {
            return Err(forbidden(
                "only its creator or the owner may delete an export",
            ));
        }
        let _ = self.exports.remove(&key)?;
        let _ = self.export_ids.remove(&id)?;
        env::emit(Event::ExportDeleted { id }, Audience::All)?;
        Ok(())
    }
}

// ── events and errors ────────────────────────────────────────────────────────

#[app::event]
pub enum Event {
    LayerAdded { id: String },
    LayerUpdated { id: String },
    LayerDeleted { id: String },
    LayersReordered {},
    MemberJoined { id: String },
    MemberUsernameUpdated { id: String },
    DocumentUpdated {},
    RoleUpdated { member: String },
    OwnerTransferred { owner: String },
    ExportAdded { id: String },
    ExportDeleted { id: String },
}

#[app::error]
pub enum Error {
    /// No such layer (or export).
    NotFound { what: String, id: String },
    /// The caller's role does not allow it.
    Forbidden { message: String },
    /// An argument out of range.
    Invalid { message: String },
    /// A blob id the app does not hold (never uploaded, or deleted).
    UnknownBlob { blob_id: String },
    /// A limit was reached.
    TooMany { what: String, limit: u64 },
}

// ── private methods ──────────────────────────────────────────────────────────

impl MeroPixArt {
    fn doc(&self) -> app::Result<Document> {
        Ok(self.document.get()?.unwrap_or_default())
    }

    fn layer_count(&self) -> app::Result<u64> {
        Ok(self.layers.count("byKind", &[])?)
    }

    fn is_owner(&self, who: &str) -> app::Result<bool> {
        Ok(self.owner.get()?.as_deref() == Some(who))
    }

    fn is_editor(&self, who: &str) -> app::Result<bool> {
        Ok(self.is_owner(who)? || self.editors.contains(&who.to_owned())?)
    }

    fn role_of(&self, who: &str) -> app::Result<String> {
        Ok(if self.is_owner(who)? {
            "admin"
        } else if self.editors.contains(&who.to_owned())? {
            "editor"
        } else {
            "viewer"
        }
        .to_owned())
    }

    /// The caller, when they may change layers; `Forbidden` (a viewer) otherwise.
    fn require_editor(&self) -> app::Result<String> {
        let me = caller()?;
        if self.is_editor(&me)? {
            Ok(me)
        } else {
            Err(forbidden(
                "view-only: editor or admin access is required to modify this document",
            ))
        }
    }

    fn require_owner(&self, what: &str) -> app::Result<String> {
        let me = caller()?;
        if self.is_owner(&me)? {
            Ok(me)
        } else {
            Err(forbidden(format!("only the document's owner may {what}")))
        }
    }

    fn require_layer(&self, id: &str) -> app::Result<LayerRow> {
        self.layers
            .get(&id.to_owned())?
            .ok_or_else(|| not_found("layer", id))
    }

    /// True when `candidate` sits anywhere under `ancestor`. Depth-capped.
    fn is_descendant_of(&self, candidate: &str, ancestor: &str) -> app::Result<bool> {
        let mut cur = candidate.to_owned();
        for _ in 0..64 {
            let Some(l) = self.layers.get(&cur)? else {
                return Ok(false);
            };
            match l.parent_id {
                Some(p) if p == ancestor => return Ok(true),
                Some(p) => cur = p,
                None => return Ok(false),
            }
        }
        Ok(false)
    }

    /// Removes a layer, its tiles and mask, and lifts its children to the top
    /// level. Answers how many tiles went.
    fn remove_layer(&mut self, id: &str) -> app::Result<u64> {
        let key = id.to_owned();
        if !self.layers.contains(&key)? {
            return Ok(0);
        }
        // A group's children: at most MAX_LAYERS, re-parented a page at a time
        // (each write leaves the prefix, so the first page is always fresh).
        loop {
            let page = self.layers.find(
                "children",
                &[KeyPart::Str(key.clone())],
                FindOpts::default().limit(BATCH),
            )?;
            if page.items.is_empty() {
                break;
            }
            for child in page.items {
                let _ = self.layers.update(&child.id, |l| l.parent_id = None)?;
            }
        }
        let gone = self.drop_tiles(id, PIXELS)? + self.drop_tiles(id, MASK)?;
        let _ = self.layers.remove(&key)?;
        Ok(gone)
    }

    /// Validates and writes `tiles` into `(id, plane)` over a `width` × `height` raster.
    fn write_tiles(
        &mut self,
        id: &str,
        plane: &str,
        width: u32,
        height: u32,
        tiles: &[TileWrite],
    ) -> app::Result<()> {
        if tiles.len() > MAX_TILES {
            return Err(invalid(format!(
                "{} tiles in one write, limit is {MAX_TILES}",
                tiles.len()
            )));
        }
        let (cols, rows) = (width.div_ceil(TILE), height.div_ceil(TILE));
        let mut checked = Vec::with_capacity(tiles.len());
        for t in tiles {
            if t.tx >= cols || t.ty >= rows {
                return Err(invalid(format!(
                    "tile ({}, {}) is outside a {width} x {height} raster",
                    t.tx, t.ty
                )));
            }
            let blob = t.blob_id.as_deref().map(held_blob).transpose()?;
            checked.push((t.tx, t.ty, blob));
        }
        for (tx, ty, blob) in checked {
            let key = (id.to_owned(), plane.to_owned(), tx, ty);
            let _ = match blob {
                Some(b) => self.tiles.insert(&key, &b)?,
                None => self.tiles.remove(&key)?,
            };
        }
        Ok(())
    }

    /// Removes the tiles of `(id, plane)` outside a `width` × `height` raster.
    fn trim_tiles(&mut self, id: &str, plane: &str, width: u32, height: u32) -> app::Result<()> {
        let (cols, rows) = (width.div_ceil(TILE), height.div_ceil(TILE));
        // At most MAX_TILES entries: read them all first, then remove.
        let mut outside = Vec::new();
        let mut cursor = None;
        loop {
            let mut opts = FindOpts::default().limit(BATCH);
            if let Some(c) = cursor.take() {
                opts = opts.cursor(c);
            }
            let page = self.tiles.prefix(
                &[KeyPart::Str(id.to_owned()), KeyPart::Str(plane.to_owned())],
                opts,
            )?;
            outside.extend(
                page.items
                    .into_iter()
                    .map(|(k, _)| k)
                    .filter(|(_, _, tx, ty)| *tx >= cols || *ty >= rows),
            );
            match page.next {
                Some(n) => cursor = Some(n),
                None => break,
            }
        }
        for key in outside {
            let _ = self.tiles.remove(&key)?;
        }
        Ok(())
    }

    /// Removes every tile of `(id, plane)`; answers how many.
    fn drop_tiles(&mut self, id: &str, plane: &str) -> app::Result<u64> {
        let mut gone = 0u64;
        loop {
            let page = self.tiles.prefix(
                &[KeyPart::Str(id.to_owned()), KeyPart::Str(plane.to_owned())],
                FindOpts::default().limit(BATCH),
            )?;
            if page.items.is_empty() {
                return Ok(gone);
            }
            for (key, _) in page.items {
                let _ = self.tiles.remove(&key)?;
                gone += 1;
            }
        }
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// The calling account; `LoginRequired` for anything that is not one.
fn caller() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// `Some(v)` replaces `*slot`; `None` keeps it.
fn set<T>(slot: &mut T, value: Option<T>) {
    if let Some(v) = value {
        *slot = v;
    }
}

/// 16 random bytes of the run, as 32 hex characters.
fn fresh_id() -> String {
    env::random_bytes(16)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The blob `id` names, when the app holds it.
fn held_blob(id: &str) -> app::Result<BlobRef> {
    let unknown = || -> AppError {
        Error::UnknownBlob {
            blob_id: id.to_owned(),
        }
        .into()
    };
    let blob = BlobRef::parse(id).ok_or_else(unknown)?;
    if blob.info().is_none() {
        return Err(unknown());
    }
    Ok(blob)
}

/// An account of the app's organization (any account when the app has none).
fn check_account(account: &str) -> app::Result<()> {
    if account.trim().is_empty() {
        return Err(invalid("expected an account id"));
    }
    if env::org().is_some() && env::org_role(account).is_none() {
        return Err(invalid(format!(
            "{account} is not a member of this document's organization"
        )));
    }
    Ok(())
}

fn check_id(id: &str) -> app::Result<()> {
    if id.is_empty() || id.len() > 128 {
        return Err(invalid("a layer id is 1 to 128 bytes"));
    }
    Ok(())
}

fn check_kind(kind: &str) -> app::Result<()> {
    if matches!(kind, "raster" | "group" | "text" | "adjustment" | "fill") {
        Ok(())
    } else {
        Err(invalid(format!(
            "kind must be raster, group, text, adjustment or fill, not {kind:?}"
        )))
    }
}

fn check_text(field: &str, value: &str) -> app::Result<()> {
    if value.len() > MAX_TEXT {
        return Err(invalid(format!(
            "{field} is {} bytes, limit is {MAX_TEXT}",
            value.len()
        )));
    }
    Ok(())
}

fn check_json(field: &str, value: &str) -> app::Result<()> {
    if value.len() > MAX_JSON {
        return Err(invalid(format!(
            "{field} is {} bytes, limit is {MAX_JSON}",
            value.len()
        )));
    }
    Ok(())
}

/// A canvas or raster side: 1..=8192.
fn check_side(field: &str, v: u32) -> app::Result<()> {
    if (1..=MAX_RASTER).contains(&v) {
        Ok(())
    } else {
        Err(invalid(format!(
            "{field} must be 1 to {MAX_RASTER}, not {v}"
        )))
    }
}

/// A layer's size: 0 (not set yet) up to 8192 per side.
fn check_raster(width: u32, height: u32) -> app::Result<()> {
    if width > MAX_RASTER || height > MAX_RASTER {
        return Err(invalid(format!(
            "a layer is at most {MAX_RASTER} x {MAX_RASTER}"
        )));
    }
    Ok(())
}

fn check_many(field: &str, n: usize) -> app::Result<()> {
    if n as u64 > MAX_LAYERS {
        return Err(invalid(format!(
            "{field} lists {n} layers, limit is {MAX_LAYERS}"
        )));
    }
    Ok(())
}

/// One page from `cursor`: no limit (or 0) is the default page, anything over
/// the cap is the cap.
fn page_opts(cursor: Option<String>, limit: Option<u32>) -> FindOpts {
    let limit = match limit {
        None | Some(0) => DEFAULT_PAGE,
        Some(n) => n.min(MAX_PAGE),
    };
    let opts = FindOpts::default().limit(limit);
    match cursor {
        Some(c) => opts.cursor(c),
        None => opts,
    }
}

fn not_found(what: &str, id: &str) -> AppError {
    Error::NotFound {
        what: what.to_owned(),
        id: id.to_owned(),
    }
    .into()
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
