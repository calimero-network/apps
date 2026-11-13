//! MeroDesign: a collaborative, Figma-style design board (elements, layers,
//! comments, live pointers, board roles) on core's component SDK
//! (`calimero-sdk`).
//!
//! One app instance is one board. The app runs on its cluster's leader, which
//! applies every write in one replicated log, so the state is plain maps and
//! sets: v1's CRDT plumbing (whole-record LWW by `updatedAt`, the
//! `PermissionedStorage` writer sets projected from `AccessControl`, `Ownable`
//! cells, per-owner `Authored` keys, the dedicated merge clock on `Member`) has
//! nothing left to decide. A later write simply replaces an earlier one.
//!
//! | v1 (`calimero-storage`) | here |
//! |---|---|
//! | `PermissionedStorage<IndexedMap<ElementId, Element>>`, `#[index] layer_index` | `elements: UnorderedMap<id, Element>` + `layers: Set<(layerIndex, id)>`, the paint order as an ordered set kept in step with every write |
//! | `UserStorage<Member>` | `members: UnorderedMap<account, Member>`, written only for the caller (a map, not `PerUser`, because the roster is listed) |
//! | `PermissionedStorage<UnorderedMap<CommentId, Comment>>` | `comments: UnorderedMap<id, Comment>` (`replies` always stored empty) |
//! | `PermissionedStorage<SortedMap<"{comment}/{createdAt:020}/{reply}", CommentReply>>` | `replies: UnorderedMap<(comment, createdAt, reply), CommentReply>`: one thread is a key prefix, in order |
//! | `Authored<UnorderedMap<device, CursorState>>` | `cursors: UnorderedMap<account, CursorState>`: one pointer per account |
//! | `Ownable<LwwRegister<String>>` name / description + `Frozen` init values | `name`, `description: Cell<String>` and `owner: Cell<String>` |
//! | `AccessControl` (admin tier + the `editor` role) | `admins`, `editors: Set<account>` |
//!
//! # Who may do what
//!
//! The organization decides who reaches the board: its owner, admins, members
//! and guests (in v1, every member of the context). The rules v1 kept in
//! storage (writer sets checked at merge on every node) are checks here, in the
//! method, against `env::caller()`, before anything is written:
//!
//! - **admin**: the board's owner (the app's owner at `init`) and whoever the
//!   owner hands the board to. Grants and revokes the editor role, clears the
//!   board.
//! - **editor**: an explicit grant, or (new) an owner or admin of the app's
//!   organization: v1's web client granted that on every board by hand
//!   ("team Admin implies canvas edit"); the contract now sees org roles itself.
//! - **viewer**: everyone else. May `join`, rename themselves and move their
//!   pointer; every canvas and comment write is `Forbidden`.
//!
//! Everything a client sees differently from v1 is in `apps/mero-design/README.md`,
//! "What changed in the port".

use calimero_sdk::env::{Caller, OrgRole};
use calimero_sdk::prelude::*;
use serde::{Deserialize, Serialize};

/// Largest batch any `*Elements` method accepts.
pub const MAX_BATCH: usize = 200;
/// Largest page `getElementsPage` returns, and what `getElements` and the other
/// list views return at most.
pub const MAX_PAGE: u32 = 1000;
/// Page size `getElementsPage` uses when asked for 0.
pub const DEFAULT_PAGE: u32 = 500;
/// Rows read per batch when a method walks a collection.
const BATCH: u32 = 1000;

const ROLE_ADMIN: &str = "admin";
const ROLE_EDITOR: &str = "editor";
const ROLE_VIEWER: &str = "viewer";

// ── Element data ─────────────────────────────────────────────────────────────
//
// The element types are plain serde, exactly v1's JSON: camelCase element
// fields, `kind`-tagged `data`, and 64-bit fields (`createdAt`, `updatedAt`,
// `x`, `y`) as JSON numbers. The SDK writes 64-bit integers as decimal strings
// only where its macros see them (method parameters and results, records,
// events); a plain serde struct is opaque to them, which keeps every saved
// project file, the web client's element code and the agent guide's examples
// valid. Unix milliseconds and canvas pixels are far inside 2^53.

/// What an element is, as a JSON object tagged by `kind`: `rect`, `circle`, `line`,
/// `arrow`, `path`, `text`, `image` or `svg`, plus that kind's own fields.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[serde(rename_all = "lowercase")]
#[serde(tag = "kind")]
pub enum ElementData {
    /// A rectangle filling the element's box; `cornerRadius` rounds its corners.
    Rect,
    /// An ellipse filling the element's box.
    Circle,
    /// A straight line.
    Line {
        /// The two end points, `"x1,y1 x2,y2"`, in pixels from the element's `x` and `y`.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        points: String,
    },
    /// A straight line with an arrowhead at its second point.
    Arrow {
        /// The two end points; the arrowhead is at the second.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        points: String,
    },
    /// A freehand stroke or a closed outline.
    Path {
        /// SVG path data in pixels from the element's `x` and `y`, e.g. `"M 0 0 L 40 40 Z"`.
        points: String,
    },
    /// Text in the element's box.
    Text {
        /// The text itself; may be empty.
        content: String,
        /// Font size in pixels.
        #[serde(rename = "fontSize")]
        font_size: u32,
        /// A CSS font family, e.g. `"sans-serif"`.
        #[serde(rename = "fontFamily")]
        font_family: String,
        /// Bold weight.
        bold: bool,
        /// Italic style.
        italic: bool,
        /// Horizontal alignment: `"left"`, `"center"` or `"right"`; omitted means left.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text_align: Option<String>,
        /// Vertical alignment inside the box: `"top"`, `"middle"` or `"bottom"`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        vertical_align: Option<String>,
    },
    /// A raster image stored as one of this app's blobs.
    Image {
        /// The image's own width in pixels, before any scaling to the element's box.
        #[serde(rename = "naturalWidth")]
        natural_width: u32,
        /// The image's own height in pixels.
        #[serde(rename = "naturalHeight")]
        natural_height: u32,
        /// Id of the blob holding the image, uploaded to this app
        /// (`POST /apps/{app}/blobs`). Stored as given: the contract does not read it.
        #[serde(rename = "blobId", default, skip_serializing_if = "String::is_empty")]
        blob_id: String,
    },
    /// An SVG image stored as one of this app's blobs.
    Svg {
        /// The SVG's own width in pixels.
        #[serde(rename = "naturalWidth")]
        natural_width: u32,
        /// The SVG's own height in pixels.
        #[serde(rename = "naturalHeight")]
        natural_height: u32,
        /// Id of the blob holding the SVG markup, as for an image.
        #[serde(rename = "blobId", default, skip_serializing_if = "String::is_empty")]
        blob_id: String,
    },
}

/// One element on the canvas.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[abi(plain)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    /// Chosen by the caller; use a fresh UUID. Writing an existing id replaces that element.
    pub id: String,
    /// What the element is, tagged by `kind`.
    pub data: ElementData,
    /// Left edge, canvas pixels.
    pub x: i64,
    /// Top edge, canvas pixels.
    pub y: i64,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Clockwise rotation in degrees.
    pub rotation: i32,
    /// Fill colour as a CSS colour; on a plain text element, the text colour.
    pub fill: String,
    /// Outline colour as a CSS colour.
    pub stroke: String,
    /// Outline width in pixels; 0 for none.
    pub stroke_width: u32,
    /// Opacity in percent, 0 to 100.
    pub opacity: u8,
    /// Paint order; higher paints on top.
    pub layer_index: u32,
    /// The creator's account, set by the contract; the value sent is ignored.
    pub created_by: String,
    /// Creation time, unix milliseconds.
    pub created_at: u64,
    /// Last change, unix milliseconds, as the client sent it.
    pub updated_at: u64,
    /// Drop shadow colour as a CSS colour; `null` for no shadow.
    pub shadow_color: Option<String>,
    /// Drop shadow horizontal offset in pixels.
    pub shadow_offset_x: Option<i32>,
    /// Drop shadow vertical offset in pixels.
    pub shadow_offset_y: Option<i32>,
    /// Drop shadow blur radius in pixels; `null` or 0 for no shadow.
    pub shadow_blur: Option<u32>,
    /// Layer name, a `/`-separated path: the groups, then the name. May carry client
    /// extras after a U+001F character; keep them when renaming.
    pub label: Option<String>,
    /// Corner radius in pixels for a `rect`; 0 or omitted means square corners.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_radius: Option<u32>,
}

/// A board member: someone who has called `join`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[abi(plain)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    /// The member's account, the id roles and ownership name.
    pub id: String,
    /// Display name the member chose.
    pub username: String,
    /// Avatar URL, or `null`.
    pub avatar: Option<String>,
    /// When the member joined, unix milliseconds from their own clock.
    pub joined_at: u64,
    /// Unix milliseconds of the last rename, from their own clock.
    pub username_updated_at: u64,
}

/// Board summary: name, description, counts and owner.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    /// The board's name; `""` until its owner sets one (`updateBoard`), and then the
    /// app instance's name is the one to show.
    pub name: String,
    /// The board's description; may be empty.
    pub description: String,
    /// How many elements are on the canvas.
    pub element_count: u32,
    /// How many members have joined.
    pub member_count: u32,
    /// The owner's account.
    pub owner: Option<String>,
}

/// A member with their effective role.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct MemberRole {
    /// The member's account.
    pub member: String,
    /// `"admin"`, `"editor"` or `"viewer"`.
    pub role: String,
    /// The member's account; always equal to `member` (v1 kept both).
    pub account: Option<String>,
}

/// A reply in a comment thread.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[abi(plain)]
#[serde(rename_all = "camelCase")]
pub struct CommentReply {
    /// Reply id, chosen by the caller.
    pub id: String,
    /// The reply text.
    pub content: String,
    /// The writer's account, set by the contract.
    pub author: String,
    /// Unix milliseconds; replies are listed in this order.
    pub created_at: u64,
}

/// A comment pinned at a canvas point, with its replies.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[abi(plain)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    /// Comment id, chosen by the caller.
    pub id: String,
    /// Pin position, canvas pixels.
    pub x: i64,
    /// Pin position, canvas pixels.
    pub y: i64,
    /// The comment text.
    pub content: String,
    /// The writer's account, set by the contract.
    pub author: String,
    /// Unix milliseconds.
    pub created_at: u64,
    /// The thread, oldest first: at most a page (1,000). Always stored empty and
    /// filled on read from `replies`, where each reply is its own entry.
    #[serde(default)]
    pub replies: Vec<CommentReply>,
}

/// A pointer's last reported position.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, AbiType)]
#[abi(plain)]
#[serde(rename_all = "camelCase")]
pub struct CursorState {
    /// Whose pointer this is: the account (v1: the device).
    pub identity: String,
    /// The account behind the pointer; equal to `identity`.
    #[serde(default)]
    pub account: String,
    /// Canvas pixels.
    pub x: i64,
    /// Canvas pixels.
    pub y: i64,
    /// Unix milliseconds of the last move.
    pub updated_at: u64,
}

/// One element's change in an `updateElements` call. Fields match `updateElement`'s
/// arguments (snake_case here, as in v1); an omitted or `null` field is left unchanged.
#[derive(Serialize, Deserialize, Clone, Debug, Default, AbiType)]
#[abi(plain)]
pub struct ElementPatch {
    /// The element to change; an unknown id is skipped.
    pub id: String,
    #[serde(default)]
    pub x: Option<i64>,
    #[serde(default)]
    pub y: Option<i64>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub rotation: Option<i32>,
    #[serde(default)]
    pub fill: Option<String>,
    #[serde(default)]
    pub stroke: Option<String>,
    #[serde(default)]
    pub stroke_width: Option<u32>,
    #[serde(default)]
    pub opacity: Option<u8>,
    #[serde(default)]
    pub corner_radius: Option<u32>,
}

/// One element's new label in an `updateElementLabels` call.
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
pub struct LabelUpdate {
    /// The element to rename; an unknown id is skipped.
    pub id: String,
    /// The new label, as for `updateElementLabel`; `null` clears it.
    pub label: Option<String>,
}

/// One page of the canvas in paint order, and the cursor of the next (`null` at the end).
#[derive(Serialize, Deserialize, Clone, Debug, AbiType)]
#[serde(rename_all = "camelCase")]
pub struct ElementPage {
    pub items: Vec<Element>,
    pub next_cursor: Option<String>,
}

// ── state ────────────────────────────────────────────────────────────────────

/// The board.
#[app::state(version = 1)]
pub struct MeroDesign {
    /// The name the owner set; empty until then.
    name: Cell<String>,
    /// The description the owner set; empty until then.
    description: Cell<String>,
    /// The board's owner: the app's owner at `init`, then whoever it is handed to.
    owner: Cell<String>,
    /// Board admins: the owner, by grant of a transfer. Never empty.
    admins: Set<String>,
    /// Accounts granted the editor role.
    editors: Set<String>,
    /// The canvas, by element id.
    elements: UnorderedMap<String, Element>,
    /// `(layerIndex, id)` for every element: the paint order, kept in step with
    /// every write to `elements`.
    layers: Set<(u32, String)>,
    /// Everyone who joined, by account; each entry written only by its account.
    members: UnorderedMap<String, Member>,
    /// Comments by id; their `replies` are always stored empty.
    comments: UnorderedMap<String, Comment>,
    /// `(comment, createdAt, reply)` → the reply: one comment's thread is a prefix, in order.
    replies: UnorderedMap<(String, u64, String), CommentReply>,
    /// One pointer per account, written only by that account.
    cursors: UnorderedMap<String, CursorState>,
}

#[app::logic]
impl MeroDesign {
    /// The empty board. The node runs it once, when the app is created; the app's
    /// owner becomes the board's owner and only admin. v1's `name` and
    /// `description` init arguments are gone: the board's name is the app
    /// instance's, and the creator sets it on the board with `updateBoard`.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        let mut board = Self::load();
        let owner = env::app_owner();
        board.owner.set(&owner)?;
        let _new = board.admins.insert(&owner)?;
        Ok(board)
    }

    // ── board ────────────────────────────────────────────────────────────────

    /// The board's name, description, element and member counts, and owner.
    #[app::view]
    pub fn get_board(&self) -> app::Result<BoardInfo> {
        Ok(BoardInfo {
            name: self.name.get()?.unwrap_or_default(),
            description: self.description.get()?.unwrap_or_default(),
            element_count: count(self.elements.len()?),
            member_count: count(self.members.len()?),
            owner: self.owner.get()?,
        })
    }

    /// Rename or re-describe the board; `null` keeps a field. Owner only
    /// (`Forbidden`). Emits `BoardUpdated`.
    pub fn update_board(
        &mut self,
        name: Option<String>,
        description: Option<String>,
    ) -> app::Result<()> {
        self.require_owner()?;
        if let Some(n) = name {
            self.name.set(&n)?;
        }
        if let Some(d) = description {
            self.description.set(&d)?;
        }
        env::emit(Event::BoardUpdated {}, Audience::All)?;
        Ok(())
    }

    /// Hand the board to another account of the organization: it becomes owner and
    /// admin, and the caller stops being admin (so loses editing unless also an
    /// editor). Owner only (`Forbidden`); `Invalid` when `newOwner` is not an
    /// account of the app's organization. Emits `OwnerTransferred`.
    pub fn transfer_ownership(&mut self, new_owner: String) -> app::Result<()> {
        let previous = self.require_owner()?;
        require_account(&new_owner)?;
        self.owner.set(&new_owner)?;
        let _new = self.admins.insert(&new_owner)?;
        if previous != new_owner {
            let _was = self.admins.remove(&previous)?;
        }
        env::emit(Event::OwnerTransferred { member: new_owner }, Audience::All)?;
        Ok(())
    }

    // ── roles ────────────────────────────────────────────────────────────────

    /// Let a member change the canvas and comments. Admin only (`Forbidden`);
    /// `Invalid` when `member` is not an account of the app's organization (they
    /// need not have joined the board yet). Emits `RoleUpdated`.
    pub fn grant_editor(&mut self, member: String) -> app::Result<()> {
        self.require_admin()?;
        require_account(&member)?;
        let _new = self.editors.insert(&member)?;
        env::emit(Event::RoleUpdated { member }, Audience::All)?;
        Ok(())
    }

    /// Take the editor role away. Admin only (`Forbidden`). An admin's own admin
    /// role, and an org admin's editing, are unaffected. Emits `RoleUpdated`.
    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        self.require_admin()?;
        let _was = self.editors.remove(&member)?;
        env::emit(Event::RoleUpdated { member }, Audience::All)?;
        Ok(())
    }

    /// A member's effective role: `"admin"`, `"editor"` or `"viewer"`. Anything
    /// that names nobody is a viewer.
    #[app::view]
    pub fn get_role(&self, member: String) -> app::Result<String> {
        self.role_label(&member)
    }

    /// The caller's effective role.
    #[app::view]
    pub fn my_role(&self) -> app::Result<String> {
        self.role_label(&caller()?)
    }

    /// Whether the caller may change the canvas and comments.
    #[app::view]
    pub fn can_edit(&self) -> app::Result<bool> {
        self.is_editor(&caller()?)
    }

    /// Every member who has joined, with their effective role: at most a page (1,000).
    #[app::view]
    pub fn list_roles(&self) -> app::Result<Vec<MemberRole>> {
        let page = self.members.page(FindOpts::default().limit(MAX_PAGE))?;
        page.items
            .into_iter()
            .map(|(account, _)| {
                Ok(MemberRole {
                    role: self.role_label(&account)?,
                    account: Some(account.clone()),
                    member: account,
                })
            })
            .collect()
    }

    // ── members ──────────────────────────────────────────────────────────────

    /// Add the caller to the board's members, so others see their name. Anyone who
    /// reaches the app may join; joining grants no editing. Does nothing, and emits
    /// nothing, if the caller has already joined (`updateMemberUsername` renames).
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
        let member = Member {
            id: me.clone(),
            username,
            avatar,
            joined_at: timestamp,
            username_updated_at: timestamp,
        };
        let _ = self.members.insert(&me, &member)?;
        env::emit(Event::MemberJoined { member: me }, Audience::All)?;
        Ok(())
    }

    /// Every member who has joined: at most a page (1,000), by account.
    #[app::view]
    pub fn get_members(&self) -> app::Result<Vec<Member>> {
        Ok(self
            .members
            .page(FindOpts::default().limit(MAX_PAGE))?
            .items
            .into_iter()
            .map(|(_, m)| m)
            .collect())
    }

    /// Rename the caller's own member entry. Does nothing if the caller has not
    /// joined. Emits `MemberUsernameUpdated`.
    pub fn update_member_username(&mut self, username: String, timestamp: u64) -> app::Result<()> {
        let me = caller()?;
        let Some(mut member) = self.members.get(&me)? else {
            return Ok(());
        };
        member.username = username;
        member.username_updated_at = timestamp;
        let _ = self.members.insert(&me, &member)?;
        env::emit(Event::MemberUsernameUpdated { member: me }, Audience::All)?;
        Ok(())
    }

    // ── elements ─────────────────────────────────────────────────────────────

    /// Add an element, or replace the element with the same `id`. Editors only
    /// (`Forbidden`). `createdBy` is set by the contract. For an `image` or `svg`,
    /// `blobId` names a blob uploaded to this app. Answers the id. Emits `ElementAdded`.
    pub fn add_element(&mut self, element: Element) -> app::Result<String> {
        self.require_editor()?;
        let id = self.insert_element(element)?;
        env::emit(Event::ElementAdded { id: id.clone() }, Audience::All)?;
        Ok(id)
    }

    /// `addElement` for many elements in one call (a paste, an import): at most
    /// 200, else `Invalid` and nothing is added. Editors only. Answers the ids in
    /// order. Emits one `ElementsAdded`.
    pub fn add_elements(&mut self, elements: Vec<Element>) -> app::Result<Vec<String>> {
        self.require_editor()?;
        require_batch(elements.len())?;
        if elements.is_empty() {
            return Ok(Vec::new());
        }
        let mut ids = Vec::with_capacity(elements.len());
        for element in elements {
            ids.push(self.insert_element(element)?);
        }
        env::emit(Event::ElementsAdded { ids: ids.clone() }, Audience::All)?;
        Ok(ids)
    }

    /// Move, resize or restyle an element; `null` leaves a field unchanged. Editors
    /// only. Does nothing if `id` names no element. Emits `ElementUpdated`.
    #[allow(clippy::too_many_arguments)]
    pub fn update_element(
        &mut self,
        id: String,
        x: Option<i64>,
        y: Option<i64>,
        width: Option<u32>,
        height: Option<u32>,
        rotation: Option<i32>,
        fill: Option<String>,
        stroke: Option<String>,
        stroke_width: Option<u32>,
        opacity: Option<u8>,
        corner_radius: Option<u32>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        let patch = ElementPatch {
            id,
            x,
            y,
            width,
            height,
            rotation,
            fill,
            stroke,
            stroke_width,
            opacity,
            corner_radius,
        };
        if let Some(id) = self.patch_element(patch, updated_at)? {
            env::emit(Event::ElementUpdated { id }, Audience::All)?;
        }
        Ok(())
    }

    /// `updateElement` for many elements in one call (a multi-select drag): at most
    /// 200 patches, else `Invalid`. Editors only. Unknown ids are skipped. Emits one
    /// `ElementsUpdated` naming the ids that existed.
    pub fn update_elements(
        &mut self,
        patches: Vec<ElementPatch>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        require_batch(patches.len())?;
        let mut ids = Vec::new();
        for patch in patches {
            if let Some(id) = self.patch_element(patch, updated_at)? {
                ids.push(id);
            }
        }
        if !ids.is_empty() {
            env::emit(Event::ElementsUpdated { ids }, Audience::All)?;
        }
        Ok(())
    }

    /// Set or clear an element's label (its layer name and group). Editors only.
    /// Does nothing if `id` names no element. Emits `ElementUpdated`.
    pub fn update_element_label(
        &mut self,
        id: String,
        label: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if self.set_label(&id, label, updated_at)? {
            env::emit(Event::ElementUpdated { id }, Audience::All)?;
        }
        Ok(())
    }

    /// `updateElementLabel` for many elements in one call: at most 200, else
    /// `Invalid`. Editors only. Unknown ids are skipped. Emits one `ElementsUpdated`.
    pub fn update_element_labels(
        &mut self,
        labels: Vec<LabelUpdate>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        require_batch(labels.len())?;
        let mut ids = Vec::new();
        for u in labels {
            if self.set_label(&u.id, u.label, updated_at)? {
                ids.push(u.id);
            }
        }
        if !ids.is_empty() {
            env::emit(Event::ElementsUpdated { ids }, Audience::All)?;
        }
        Ok(())
    }

    /// Change a text element's content or style; `null` leaves a field unchanged.
    /// Editors only. Does nothing if `id` names no element; on an element that is
    /// not text it changes only `updatedAt`. Emits `ElementUpdated`.
    #[allow(clippy::too_many_arguments)]
    pub fn update_text_style(
        &mut self,
        id: String,
        content: Option<String>,
        font_family: Option<String>,
        font_size: Option<u32>,
        bold: Option<bool>,
        italic: Option<bool>,
        text_align: Option<String>,
        vertical_align: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        let Some(mut el) = self.elements.get(&id)? else {
            return Ok(());
        };
        if let ElementData::Text {
            content: c,
            font_family: ff,
            font_size: fs,
            bold: b,
            italic: i,
            text_align: ta,
            vertical_align: va,
        } = &mut el.data
        {
            if let Some(v) = content {
                *c = v;
            }
            if let Some(v) = font_family {
                *ff = v;
            }
            if let Some(v) = font_size {
                *fs = v;
            }
            if let Some(v) = bold {
                *b = v;
            }
            if let Some(v) = italic {
                *i = v;
            }
            if let Some(v) = text_align {
                *ta = Some(v);
            }
            if let Some(v) = vertical_align {
                *va = Some(v);
            }
        }
        el.updated_at = updated_at;
        let _ = self.elements.insert(&id, &el)?;
        env::emit(Event::ElementUpdated { id }, Audience::All)?;
        Ok(())
    }

    /// Set or remove an element's drop shadow: all four fields are replaced, all
    /// `null` removes it. Editors only. Does nothing if `id` names no element.
    /// Emits `ElementUpdated`.
    pub fn update_shadow(
        &mut self,
        id: String,
        shadow_color: Option<String>,
        shadow_offset_x: Option<i32>,
        shadow_offset_y: Option<i32>,
        shadow_blur: Option<u32>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        let Some(mut el) = self.elements.get(&id)? else {
            return Ok(());
        };
        el.shadow_color = shadow_color;
        el.shadow_offset_x = shadow_offset_x;
        el.shadow_offset_y = shadow_offset_y;
        el.shadow_blur = shadow_blur;
        el.updated_at = updated_at;
        let _ = self.elements.insert(&id, &el)?;
        env::emit(Event::ElementUpdated { id }, Audience::All)?;
        Ok(())
    }

    /// Delete every element, for every member. Board admin only (`Forbidden`).
    /// Emits `LayerReordered`.
    pub fn clear_elements(&mut self) -> app::Result<()> {
        self.require_admin()?;
        let _ = self.elements.clear()?;
        let _ = self.layers.clear()?;
        env::emit(Event::LayerReordered {}, Audience::All)?;
        Ok(())
    }

    /// Delete every comment and reply, for every member. Board admin only
    /// (`Forbidden`). Emits no event, as in v1.
    pub fn clear_comments(&mut self) -> app::Result<()> {
        self.require_admin()?;
        let _ = self.comments.clear()?;
        let _ = self.replies.clear()?;
        Ok(())
    }

    /// Delete an element. Editors only. An unknown id is not an error, and still
    /// emits `ElementDeleted`.
    pub fn delete_element(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        self.remove_element(&id)?;
        env::emit(Event::ElementDeleted { id }, Audience::All)?;
        Ok(())
    }

    /// `deleteElement` for many elements in one call: at most 200 ids, else
    /// `Invalid`. Editors only. Ids already gone are fine. Emits one `ElementsDeleted`.
    pub fn delete_elements(&mut self, ids: Vec<String>) -> app::Result<()> {
        self.require_editor()?;
        require_batch(ids.len())?;
        if ids.is_empty() {
            return Ok(());
        }
        for id in &ids {
            self.remove_element(id)?;
        }
        env::emit(Event::ElementsDeleted { ids }, Audience::All)?;
        Ok(())
    }

    /// The canvas in paint order, lowest `layerIndex` first: at most a page
    /// (1,000 elements). `getElementsPage` reads a larger board page by page.
    #[app::view]
    pub fn get_elements(&self) -> app::Result<Vec<Element>> {
        Ok(self.element_page(None, MAX_PAGE)?.items)
    }

    /// One page of the canvas in paint order. `cursor` is the previous page's
    /// `nextCursor` (`null` for the first page); `limit` 0 means 500, more than
    /// 1,000 means 1,000. New: v1 returned the whole board from `getElements`.
    #[app::view]
    pub fn get_elements_page(
        &self,
        cursor: Option<String>,
        limit: u32,
    ) -> app::Result<ElementPage> {
        let limit = match limit {
            0 => DEFAULT_PAGE,
            n => n.min(MAX_PAGE),
        };
        self.element_page(cursor, limit)
    }

    /// One element by id, or `null`.
    #[app::view]
    pub fn get_element(&self, id: String) -> app::Result<Option<Element>> {
        Ok(self.elements.get(&id)?)
    }

    /// Several elements by id in one read (the ids a batch event named): those that
    /// exist, in the order asked. At most 1,000 ids, else `Invalid`.
    #[app::view]
    pub fn get_elements_by_ids(&self, ids: Vec<String>) -> app::Result<Vec<Element>> {
        if ids.len() > MAX_PAGE as usize {
            return Err(invalid(format!(
                "at most {MAX_PAGE} ids in one read, got {}",
                ids.len()
            )));
        }
        let mut out = Vec::with_capacity(ids.len());
        for id in &ids {
            if let Some(el) = self.elements.get(id)? {
                out.push(el);
            }
        }
        Ok(out)
    }

    // ── layer order ──────────────────────────────────────────────────────────

    /// Move one element to a position in the paint order (0 at the back; past the
    /// end is clamped to the front). Only the elements whose index must change are
    /// written. Editors only. Does nothing if `id` names no element. Emits
    /// `LayerReordered`.
    pub fn set_layer_index(&mut self, id: String, index: u32, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;
        let order = self.layer_order()?;
        let Some(writes) = layer_move_writes(&order, &id, index as usize) else {
            return Ok(());
        };
        for (key, layer) in &writes {
            let stamp = (*key == id).then_some(updated_at);
            self.move_layer(key, *layer, stamp)?;
        }
        env::emit(Event::LayerReordered {}, Audience::All)?;
        Ok(())
    }

    /// Paint an element above every other one. Editors only. Does nothing for an
    /// unknown id. Emits `LayerReordered`.
    pub fn bring_to_front(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        if !self.elements.contains(&id)? {
            return Ok(());
        }
        let top = self.layers.last()?.map_or(0, |(layer, _)| layer);
        self.move_layer(&id, top.saturating_add(1), None)?;
        env::emit(Event::LayerReordered {}, Audience::All)?;
        Ok(())
    }

    /// Paint an element below every other one. Editors only. Does nothing for an
    /// unknown id. Emits `LayerReordered`.
    pub fn send_to_back(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let order = self.layer_order()?;
        let Some(writes) = layer_move_writes(&order, &id, 0) else {
            return Ok(());
        };
        for (key, layer) in &writes {
            self.move_layer(key, *layer, None)?;
        }
        env::emit(Event::LayerReordered {}, Audience::All)?;
        Ok(())
    }

    // ── comments ─────────────────────────────────────────────────────────────

    /// Pin a comment at a canvas point, or replace the comment with the same `id`
    /// (its replies are kept). Editors only; the author is the caller. Emits `CommentAdded`.
    pub fn add_comment(
        &mut self,
        id: String,
        x: i64,
        y: i64,
        content: String,
        created_at: u64,
    ) -> app::Result<()> {
        let author = self.require_editor()?;
        let comment = Comment {
            id: id.clone(),
            x,
            y,
            content,
            author,
            created_at,
            replies: Vec::new(),
        };
        let _ = self.comments.insert(&id, &comment)?;
        env::emit(Event::CommentAdded { id }, Audience::All)?;
        Ok(())
    }

    /// Reply to a comment. Editors only; the author is the caller. Does nothing if
    /// the comment does not exist. Emits `CommentUpdated`.
    pub fn add_reply(
        &mut self,
        comment_id: String,
        reply_id: String,
        content: String,
        created_at: u64,
    ) -> app::Result<()> {
        let author = self.require_editor()?;
        if !self.comments.contains(&comment_id)? {
            return Ok(());
        }
        let reply = CommentReply {
            id: reply_id.clone(),
            content,
            author,
            created_at,
        };
        let _ = self
            .replies
            .insert(&(comment_id.clone(), created_at, reply_id), &reply)?;
        env::emit(Event::CommentUpdated { id: comment_id }, Audience::All)?;
        Ok(())
    }

    /// Delete one reply. Editors only. Does nothing, and emits nothing, if the
    /// reply is not there. Emits `CommentUpdated`.
    pub fn delete_reply(&mut self, comment_id: String, reply_id: String) -> app::Result<()> {
        self.require_editor()?;
        let keys: Vec<(String, u64, String)> = self
            .thread_keys(&comment_id)?
            .into_iter()
            .filter(|(_, _, r)| *r == reply_id)
            .collect();
        if keys.is_empty() {
            return Ok(());
        }
        for key in keys {
            let _ = self.replies.remove(&key)?;
        }
        env::emit(Event::CommentUpdated { id: comment_id }, Audience::All)?;
        Ok(())
    }

    /// Delete a comment and its replies. Editors only. An unknown id is not an
    /// error, and still emits `CommentDeleted`.
    pub fn delete_comment(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let _ = self.comments.remove(&id)?;
        loop {
            let keys = self.thread_keys(&id)?;
            if keys.is_empty() {
                break;
            }
            for key in keys {
                let _ = self.replies.remove(&key)?;
            }
        }
        env::emit(Event::CommentDeleted { id }, Audience::All)?;
        Ok(())
    }

    /// The comments, each with its replies oldest first: at most a page of
    /// comments (1,000), each with at most a page of replies.
    #[app::view]
    pub fn get_comments(&self) -> app::Result<Vec<Comment>> {
        let page = self.comments.page(FindOpts::default().limit(MAX_PAGE))?;
        page.items
            .into_iter()
            .map(|(id, mut c)| {
                c.replies = self
                    .replies
                    .prefix(&[KeyPart::Str(id)], FindOpts::default().limit(MAX_PAGE))?
                    .items
                    .into_iter()
                    .map(|(_, r)| r)
                    .collect();
                Ok(c)
            })
            .collect()
    }

    // ── pointers ─────────────────────────────────────────────────────────────

    /// Report the caller's pointer position to the other members. Open to everyone
    /// who reaches the board, viewers included. One pointer per account (v1: per
    /// device). Emits `CursorMoved`.
    pub fn update_cursor(&mut self, x: i64, y: i64, updated_at: u64) -> app::Result<()> {
        let me = caller()?;
        let cursor = CursorState {
            identity: me.clone(),
            account: me.clone(),
            x,
            y,
            updated_at,
        };
        let _ = self.cursors.insert(&me, &cursor)?;
        env::emit(Event::CursorMoved { identity: me }, Audience::All)?;
        Ok(())
    }

    /// Every pointer's last reported position: at most a page (1,000).
    #[app::view]
    pub fn get_cursors(&self) -> app::Result<Vec<CursorState>> {
        Ok(self
            .cursors
            .page(FindOpts::default().limit(MAX_PAGE))?
            .items
            .into_iter()
            .map(|(_, c)| c)
            .collect())
    }

    // ── internal ─────────────────────────────────────────────────────────────

    /// Stores one element and keeps `layers` in step. `createdBy` is the caller,
    /// or, when the id is already on the board, whoever created it first.
    fn insert_element(&mut self, mut element: Element) -> app::Result<String> {
        let id = element.id.clone();
        if id.is_empty() {
            return Err(invalid("an element needs an id"));
        }
        element.created_by = match self.elements.get(&id)? {
            Some(existing) => {
                let _ = self.layers.remove(&(existing.layer_index, id.clone()))?;
                existing.created_by
            }
            None => caller()?,
        };
        let _ = self.layers.insert(&(element.layer_index, id.clone()))?;
        let _ = self.elements.insert(&id, &element)?;
        Ok(id)
    }

    fn remove_element(&mut self, id: &str) -> app::Result<()> {
        if let Some(old) = self.elements.remove(&id.to_owned())? {
            let _ = self.layers.remove(&(old.layer_index, id.to_owned()))?;
        }
        Ok(())
    }

    /// Applies one patch. Returns the id when the element exists.
    fn patch_element(
        &mut self,
        patch: ElementPatch,
        updated_at: u64,
    ) -> app::Result<Option<String>> {
        let Some(mut el) = self.elements.get(&patch.id)? else {
            return Ok(None);
        };
        if let Some(v) = patch.x {
            el.x = v;
        }
        if let Some(v) = patch.y {
            el.y = v;
        }
        if let Some(v) = patch.width {
            el.width = v;
        }
        if let Some(v) = patch.height {
            el.height = v;
        }
        if let Some(v) = patch.rotation {
            el.rotation = v;
        }
        if let Some(v) = patch.fill {
            el.fill = v;
        }
        if let Some(v) = patch.stroke {
            el.stroke = v;
        }
        if let Some(v) = patch.stroke_width {
            el.stroke_width = v;
        }
        if let Some(v) = patch.opacity {
            el.opacity = v;
        }
        // None leaves it; 0 means square corners.
        if let Some(v) = patch.corner_radius {
            el.corner_radius = Some(v);
        }
        el.updated_at = updated_at;
        let _ = self.elements.insert(&patch.id, &el)?;
        Ok(Some(patch.id))
    }

    fn set_label(&mut self, id: &str, label: Option<String>, updated_at: u64) -> app::Result<bool> {
        let id = id.to_owned();
        let Some(mut el) = self.elements.get(&id)? else {
            return Ok(false);
        };
        el.label = label;
        el.updated_at = updated_at;
        let _ = self.elements.insert(&id, &el)?;
        Ok(true)
    }

    /// Moves `id` to `layer`, in the element and in `layers`; `stamp` sets `updatedAt`.
    fn move_layer(&mut self, id: &str, layer: u32, stamp: Option<u64>) -> app::Result<()> {
        let id = id.to_owned();
        let Some(mut el) = self.elements.get(&id)? else {
            return Ok(());
        };
        let _ = self.layers.remove(&(el.layer_index, id.clone()))?;
        el.layer_index = layer;
        if let Some(t) = stamp {
            el.updated_at = t;
        }
        let _ = self.layers.insert(&(layer, id.clone()))?;
        let _ = self.elements.insert(&id, &el)?;
        Ok(())
    }

    /// The whole paint order, bottom first, as `(id, layerIndex)`: keys only, read
    /// a page at a time.
    fn layer_order(&self) -> app::Result<Vec<(String, u32)>> {
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut opts = FindOpts::default().limit(BATCH);
            if let Some(c) = cursor.take() {
                opts = opts.cursor(c);
            }
            let page = self.layers.page(opts)?;
            out.extend(page.items.into_iter().map(|(layer, id)| (id, layer)));
            match page.next {
                Some(next) => cursor = Some(next),
                None => return Ok(out),
            }
        }
    }

    fn element_page(&self, cursor: Option<String>, limit: u32) -> app::Result<ElementPage> {
        let mut opts = FindOpts::default().limit(limit);
        if let Some(c) = cursor {
            opts = opts.cursor(c);
        }
        let page = self.layers.page(opts)?;
        let mut items = Vec::with_capacity(page.items.len());
        for (_, id) in page.items {
            if let Some(el) = self.elements.get(&id)? {
                items.push(el);
            }
        }
        Ok(ElementPage {
            items,
            next_cursor: page.next,
        })
    }

    /// The keys of a comment's replies: one batch (1,000).
    fn thread_keys(&self, comment_id: &str) -> app::Result<Vec<(String, u64, String)>> {
        Ok(self
            .replies
            .prefix(
                &[KeyPart::Str(comment_id.to_owned())],
                FindOpts::default().limit(BATCH),
            )?
            .items
            .into_iter()
            .map(|(k, _)| k)
            .collect())
    }

    fn require_owner(&self) -> app::Result<String> {
        let me = caller()?;
        if self.owner.get()?.as_deref() != Some(me.as_str()) {
            return Err(forbidden("only the board's owner can do this"));
        }
        Ok(me)
    }

    fn require_admin(&self) -> app::Result<String> {
        let me = caller()?;
        if !self.admins.contains(&me)? {
            return Err(forbidden("admin access is required for this operation"));
        }
        Ok(me)
    }

    /// The caller, when they may change the canvas; else `Forbidden`.
    fn require_editor(&self) -> app::Result<String> {
        let me = caller()?;
        if !self.is_editor(&me)? {
            return Err(forbidden(
                "view-only: editor or admin access is required to modify this board",
            ));
        }
        Ok(me)
    }

    /// A board admin, an explicit editor, or an owner or admin of the app's org.
    fn is_editor(&self, who: &str) -> app::Result<bool> {
        let who = who.to_owned();
        Ok(self.admins.contains(&who)?
            || self.editors.contains(&who)?
            || matches!(env::org_role(&who), Some(OrgRole::Admin | OrgRole::Owner)))
    }

    fn role_label(&self, who: &str) -> app::Result<String> {
        let label = if self.admins.contains(&who.to_owned())? {
            ROLE_ADMIN
        } else if self.is_editor(who)? {
            ROLE_EDITOR
        } else {
            ROLE_VIEWER
        };
        Ok(label.to_owned())
    }
}

#[app::error]
pub enum Error {
    /// The caller's role does not allow this.
    Forbidden { message: String },
    /// An argument the method refuses.
    Invalid { message: String },
}

/// What changed on the board, so an open client knows what to re-read.
#[app::event]
pub enum Event {
    /// `addElement` stored an element.
    ElementAdded { id: String },
    /// One element changed (`updateElement`, `updateElementLabel`, `updateTextStyle`, `updateShadow`).
    ElementUpdated { id: String },
    /// `deleteElement` ran; the id it was given.
    ElementDeleted { id: String },
    /// The layer order changed, or `clearElements` emptied the canvas: re-read it.
    LayerReordered {},
    /// A member joined.
    MemberJoined { member: String },
    /// A member renamed themselves.
    MemberUsernameUpdated { member: String },
    /// The board's name or description changed.
    BoardUpdated {},
    /// A comment was added or replaced.
    CommentAdded { id: String },
    /// A comment's replies changed; `id` is the comment's.
    CommentUpdated { id: String },
    /// `deleteComment` ran; the id it was given.
    CommentDeleted { id: String },
    /// A pointer moved; `identity` is its account.
    CursorMoved { identity: String },
    /// A member's editor role was granted or revoked.
    RoleUpdated { member: String },
    /// The board changed owner.
    OwnerTransferred { member: String },
    /// `addElements` stored elements: every id, in call order.
    ElementsAdded { ids: Vec<String> },
    /// `updateElements` or `updateElementLabels` changed elements: the ids that existed.
    ElementsUpdated { ids: Vec<String> },
    /// `deleteElements` ran: every id the call named.
    ElementsDeleted { ids: Vec<String> },
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// The calling account; anything else (anonymous, the system, another app) is
/// `LoginRequired`.
fn caller() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// `account` is someone a grant can name: the app's owner or an account of its org.
fn require_account(account: &str) -> app::Result<()> {
    if account == env::app_owner() || env::org_role(account).is_some() {
        return Ok(());
    }
    Err(invalid(format!(
        "not an account of this board's organization: {account}"
    )))
}

fn require_batch(len: usize) -> app::Result<()> {
    if len > MAX_BATCH {
        return Err(invalid(format!(
            "a batch holds at most {MAX_BATCH} elements, got {len}"
        )));
    }
    Ok(())
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

/// The writes that move `id` to position `to` in `order` (the board's elements sorted by
/// layer index, bottom first), as `(id, new layer index)`. `None` when `id` is not on the board
/// or is already there.
///
/// Writes as few elements as the move allows:
/// - if there is a free index between the new neighbours, only the moved element changes;
/// - otherwise the indices already used by the slots it passes are handed round among those
///   elements, so a one-step move is a swap of two;
/// - indices that collide (equal values, which imports and old data can hold) are bumped
///   upward just far enough to be strictly increasing again.
fn layer_move_writes(order: &[(String, u32)], id: &str, to: usize) -> Option<Vec<(String, u32)>> {
    let from = order.iter().position(|(k, _)| k == id)?;
    let to = to.min(order.len().saturating_sub(1));
    if from == to {
        return None;
    }
    // Slot → index into `order` of the element that ends up there.
    let mut slots: Vec<usize> = (0..order.len()).collect();
    let moved = slots.remove(from);
    slots.insert(to, moved);
    let value = |slot: usize| order[slots[slot]].1;

    // A gap between the new neighbours takes the element with a single write.
    let below = to.checked_sub(1).map(value);
    let above = (to + 1 < slots.len()).then(|| value(to + 1));
    let gap = match (below, above) {
        (None, Some(a)) => a.checked_sub(1),
        (Some(b), None) => b.checked_add(1),
        (Some(b), Some(a)) if a > b.saturating_add(1) => Some(b + (a - b) / 2),
        _ => None,
    };
    if let Some(layer) = gap {
        return Some(vec![(id.to_owned(), layer)]);
    }

    // No room: every slot keeps its index value, now held by the reordered element, so only
    // the slots from..=to change hands. Then make the sequence strictly increasing again,
    // stopping at the first slot past them that is already fine.
    let (lo, hi) = (from.min(to), from.max(to));
    let mut values: Vec<u32> = order.iter().map(|(_, v)| *v).collect();
    let mut i = lo.max(1);
    while i < values.len() {
        if values[i] <= values[i - 1] {
            values[i] = values[i - 1].saturating_add(1);
        } else if i > hi {
            break;
        }
        i += 1;
    }
    let writes = slots
        .iter()
        .zip(values)
        .filter(|(&o, v)| order[o].1 != *v || order[o].0 == id)
        .map(|(&o, v)| (order[o].0.clone(), v))
        .collect();
    Some(writes)
}

#[cfg(test)]
mod tests {
    use super::layer_move_writes;

    fn board(vals: &[u32]) -> Vec<(String, u32)> {
        vals.iter()
            .enumerate()
            .map(|(i, v)| (format!("e{i}"), *v))
            .collect()
    }

    #[test]
    fn layer_moves_write_only_what_they_must() {
        // Dense: one step is a swap of two.
        let w = layer_move_writes(&board(&[0, 1, 2, 3]), "e1", 2).unwrap();
        assert_eq!(w, vec![("e2".to_owned(), 1), ("e1".to_owned(), 2)]);
        // A gap under the target takes the element alone.
        let w = layer_move_writes(&board(&[0, 10, 20]), "e2", 1).unwrap();
        assert_eq!(w, vec![("e2".to_owned(), 5)]);
        // Send to back with room below the lowest: one write.
        let w = layer_move_writes(&board(&[3, 4, 5]), "e2", 0).unwrap();
        assert_eq!(w, vec![("e2".to_owned(), 2)]);
        // A big dense board: one step never touches the rest.
        let big: Vec<u32> = (0..500).collect();
        assert_eq!(
            layer_move_writes(&board(&big), "e250", 251).unwrap().len(),
            2
        );
        // Duplicates get pulled apart just enough.
        let w = layer_move_writes(&board(&[0, 0, 0]), "e0", 2).unwrap();
        let mut vals: Vec<u32> = w.iter().map(|(_, v)| *v).collect();
        vals.sort_unstable();
        vals.dedup();
        assert_eq!(vals.len(), w.len());
    }

    #[test]
    fn unknown_ids_and_no_moves_write_nothing() {
        assert!(layer_move_writes(&board(&[0, 1]), "nope", 0).is_none());
        assert!(layer_move_writes(&board(&[0, 1, 2]), "e0", 0).is_none());
        // Past the end clamps to the last slot, one above the top.
        let w = layer_move_writes(&board(&[0, 1]), "e0", 99).unwrap();
        assert_eq!(w, vec![("e0".to_owned(), 2)]);
    }
}
