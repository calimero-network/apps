use std::collections::BTreeSet;
use std::str::FromStr;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, AccountId, BlobId, PublicKey};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AccessControl, Authored, Frozen, IndexedMap, LwwRegister, Mergeable as MergeableTrait, Ownable,
    PermissionedStorage, ProtocolAuthorizer, SortedMap, UnorderedMap, UserStorage,
};
use calimero_storage::entities::OpMask;

// ── Types ─────────────────────────────────────────────────────────────────────

type ElementId = String;
type MemberId = String;
type CommentId = String;

/// Named role granted on top of the admin tier. Editors may mutate the canvas;
/// everyone else is read-only ("viewer"). The board creator is the sole initial
/// admin and is implicitly an editor + owner.
const ROLE_EDITOR: &str = "editor";

/// What each role may do to the canvas collections (`elements`, `comments`,
/// `replies`), projected onto their capability maps after every role change.
/// Editors add, change and remove; admins keep full control. Every node checks
/// a write against this on apply, so a viewer's forged edit is refused
/// everywhere, not only by the fail-fast `require_editor`.
const CANVAS_ROLE_MASKS: &[(&str, OpMask)] = &[(ROLE_EDITOR, OpMask::WRITE.union(OpMask::DELETE))];

// ── Element data ──────────────────────────────────────────────────────────────

/// What an element is, tagged by `kind`: rect, circle, line, arrow, path, text, image or svg.
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "lowercase")]
#[serde(tag = "kind")]
pub enum ElementData {
    /// A rectangle filling the element's box.
    Rect,
    /// An ellipse filling the element's box.
    Circle,
    /// A straight line; `points` is "x1,y1 x2,y2" in element-local pixels.
    // A bounding box cannot say which way a line was drawn. Defaulted so a bare
    // {"kind":"line"} still deserializes.
    Line {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        points: String,
    },
    /// A line with an arrowhead at its second point; `points` as for a line.
    Arrow {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        points: String,
    },
    /// A freehand path; `points` is SVG path data.
    Path { points: String },
    /// Text; `fontSize` in pixels, optional `text_align` of left, center or right.
    Text {
        content: String,
        #[serde(rename = "fontSize")]
        font_size: u32,
        #[serde(rename = "fontFamily")]
        font_family: String,
        bold: bool,
        italic: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_align: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        vertical_align: Option<String>,
    },
    /// A raster image stored as a node blob named by `blobId`.
    Image {
        #[serde(rename = "naturalWidth")]
        natural_width: u32,
        #[serde(rename = "naturalHeight")]
        natural_height: u32,
        #[serde(rename = "blobId", default, skip_serializing_if = "String::is_empty")]
        blob_id: String,
    },
    /// An SVG stored as a node blob named by `blobId`.
    Svg {
        #[serde(rename = "naturalWidth")]
        natural_width: u32,
        #[serde(rename = "naturalHeight")]
        natural_height: u32,
        #[serde(rename = "blobId", default, skip_serializing_if = "String::is_empty")]
        blob_id: String,
    },
}

// ── Element ───────────────────────────────────────────────────────────────────

// `layer_index` is indexed, so the stack in order, and its top and bottom, are seeks.
/// One canvas element on the board.
#[derive(
    AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, app::Indexed,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub id: ElementId,
    pub data: ElementData,
    /// Left edge, canvas pixels.
    pub x: i64,
    /// Top edge, canvas pixels.
    pub y: i64,
    pub width: u32,
    pub height: u32,
    /// Degrees.
    pub rotation: i32,
    pub fill: String,
    pub stroke: String,
    pub stroke_width: u32,
    /// Percent, 0 to 100.
    pub opacity: u8,
    /// Paint order; higher paints on top.
    #[index]
    pub layer_index: u32,
    /// The creator's member id, set by the contract; the value sent is ignored.
    pub created_by: MemberId,
    /// Unix milliseconds.
    pub created_at: u64,
    /// Unix milliseconds; the write with the larger value wins.
    pub updated_at: u64,
    pub shadow_color: Option<String>,
    pub shadow_offset_x: Option<i32>,
    pub shadow_offset_y: Option<i32>,
    pub shadow_blur: Option<u32>,
    /// Layer name; `/` separates groups, and `screen/<name>` marks a presentation screen.
    pub label: Option<String>,
    /// Corner radius in px, clamped by the client to min(width, height) / 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_radius: Option<u32>,
}

// Whole-record LWW by the monotonic `updated_at`; a leaf value with no nested
// collections, so this also emits the required no-op `RekeyTarget`.
calimero_storage::impl_atomic_lww_leaf!(Element, updated_at);

// ── Member ────────────────────────────────────────────────────────────────────

/// A board member.
#[app::mergeable(id = "mero_design::Member")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Member {
    /// Member id: the member's device key (64 hex).
    pub id: MemberId,
    pub username: String,
    pub avatar: Option<String>,
    /// Unix milliseconds.
    pub joined_at: u64,
    /// Unix milliseconds of the last profile edit; the newest edit wins.
    // A dedicated clock: merging on joined_at would freeze a username at its first value.
    pub username_updated_at: u64,
}

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        // Identity (`id`) and `joined_at` are immutable after first join; only
        // the mutable profile fields are LWW, keyed on `username_updated_at`.
        // Tie-break over exactly the fields assigned below, making the rule a
        // maximum over a total order — commutative, associative, idempotent.
        // A bare `>` is none of those at an exact clock tie: two replicas that
        // edited a profile in the same tick would each keep their own copy,
        // and re-merging would never close the gap. This rule is DISPATCHED
        // (`#[app::mergeable]`), so unlike the `impl_atomic_lww_leaf!` types
        // below it really does run at every merge point.
        let mine = (self.username_updated_at, &self.username, &self.avatar);
        let theirs = (other.username_updated_at, &other.username, &other.avatar);
        if theirs > mine {
            self.username = other.username.clone();
            self.avatar = other.avatar.clone();
            self.username_updated_at = other.username_updated_at;
        }
        Ok(())
    }
}

// ── Board info ────────────────────────────────────────────────────────────────

/// Board summary: name, description, counts and owner.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub name: String,
    pub description: String,
    pub element_count: u32,
    pub member_count: u32,
    /// The owner's member id, or their account id if no device of theirs has joined.
    pub owner: Option<String>,
}

/// A member with their effective role: "admin", "editor" or "viewer".
// A member id is an account, so `account` always equals `member`; the settings UI
// joins `/groups/{id}/members` rows on it.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct MemberRole {
    /// Member id (device key).
    pub member: String,
    pub role: String,
    /// The member's account id, or null until they have written to the board.
    pub account: Option<String>,
}

// ── Comments ──────────────────────────────────────────────────────────────────

/// A reply in a comment thread.
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct CommentReply {
    pub id: String,
    pub content: String,
    /// The writer's member id, set by the contract.
    pub author: String,
    /// Unix milliseconds.
    pub created_at: u64,
}

// A reply is written once and never edited, so its clock never moves.
calimero_storage::impl_atomic_lww_leaf!(CommentReply, created_at);

/// A comment pinned at a canvas point, with its replies.
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: CommentId,
    /// Canvas pixels.
    pub x: i64,
    /// Canvas pixels.
    pub y: i64,
    pub content: String,
    /// The writer's member id, set by the contract.
    pub author: String,
    pub created_at: u64,
    /// Filled on read from `MeroDesign::replies`, and always stored empty: a
    /// reply is its own entry, so two replies posted at once both survive.
    /// Kept in a `Vec` inside the comment they were whole-record LWW, and the
    /// comment's clock never moved, so one of them was lost.
    pub replies: Vec<CommentReply>,
}

// Whole-record LWW by the monotonic `created_at`; a leaf value with no nested
// collections, so this also emits the required no-op `RekeyTarget`.
calimero_storage::impl_atomic_lww_leaf!(Comment, created_at);

// ── Cursor state (ephemeral — last known position per identity) ────────────────

/// A member's last reported cursor position.
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct CursorState {
    /// The device (context identity) this pointer belongs to: one per open window.
    pub identity: String,
    /// The member (account) behind that device, read from the entry's owner
    /// stamp, so the overlay can label the pointer with a username.
    #[serde(default)]
    pub account: MemberId,
    pub x: i64,
    pub y: i64,
    pub updated_at: u64,
}

// Whole-record LWW by the monotonic `updated_at`; a leaf value with no nested
// collections, so this also emits the required no-op `RekeyTarget`.
calimero_storage::impl_atomic_lww_leaf!(CursorState, updated_at);

// ── Batches ───────────────────────────────────────────────────────────────────
//
// A multi-selection used to be written one element per call: pasting 3000
// shapes was 3000 concurrent `add_element` requests, and deleting a selection
// was a queue of `delete_element` round-trips. Each batch method below does the
// whole selection in ONE call and emits ONE event, so a peer re-reads a batch
// with one `get_elements_by_ids` instead of one `get_element` per shape.
//
// Every call still runs inside one gas budget (1e9 points on core 0.11), so a
// batch is capped, and an over-sized one is refused up front instead of being
// charged for and then dropped as out-of-gas.
//
// Measured on merod 0.11.0-rc.43 with 300-element batches: `add_elements`,
// `update_elements`, `update_element_labels` and `get_elements_by_ids` cost the
// same on an empty board and on a 3000-element one, ~0.1s each.
//
// `delete_elements` is the exception. A storage remove costs in proportion to
// how many elements the board holds, so what fits in one call is roughly
// 22 000 / board-size ids — 150 on an empty board, 23 at 1000, 6 at 4000 (a
// single `delete_element` at 4400 already spends a sixth of the budget). The
// cap cannot express that; the client sizes delete chunks from the board it
// has, and halves a chunk that still runs out.

/// Largest batch any `*_elements` method accepts.
pub const MAX_BATCH: usize = 200;

/// One element's share of an `update_elements` call. Field names and meaning
/// match `update_element`'s arguments: `None` leaves a field alone.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug, Default)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ElementPatch {
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

/// One element's share of an `update_element_labels` call.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
pub struct LabelUpdate {
    pub id: String,
    pub label: Option<String>,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[app::event]
pub enum Event {
    /// An element was added; the payload is its id.
    ElementAdded(String),
    /// An element changed; the payload is its id.
    ElementUpdated(String),
    /// An element was deleted; the payload is its id.
    ElementDeleted(String),
    /// The layer order changed or the board was cleared; re-read `get_elements`.
    LayerReordered(),
    /// A member joined; the payload is their member id.
    MemberJoined(String),
    /// A member renamed themselves; the payload is their member id.
    MemberUsernameUpdated(String),
    /// The board's name or description changed.
    BoardUpdated(),
    /// A comment was added; the payload is its id.
    CommentAdded(String),
    /// A comment's replies changed; the payload is the comment id.
    CommentUpdated(String),
    /// A comment was deleted; the payload is its id.
    CommentDeleted(String),
    /// A member's cursor moved; the payload is their member id.
    CursorMoved(String),
    /// A member's editor role was granted or revoked; the payload is the id the caller passed.
    RoleUpdated(String),
    /// The board changed owner; the payload is the id the caller passed.
    OwnerTransferred(String),
    // One event per batch call, carrying every id it touched.
    ElementsAdded(Vec<String>),
    ElementsUpdated(Vec<String>),
    ElementsDeleted(Vec<String>),
}

// ── App state ─────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroDesign {
    // Board metadata lives inside `Ownable` so a rename only converges from the
    // owner — a forged board-name delta from a non-owner is rejected at merge,
    // not merely by the fail-fast API guard.
    //
    // Both are EMPTY until the first owner edit; read them through
    // `board_name_str` / `board_description_str`, never directly. See
    // `initial_name` below.
    board_name: Ownable<LwwRegister<String>>,
    board_description: Ownable<LwwRegister<String>>,
    // What `init` was called with.
    //
    // **`Ownable::insert` cannot be used inside `init` on core rc.20.** The cell
    // is still detached from the state tree there: the writer set is carried
    // through by the constructor, but the inserted VALUE is silently dropped —
    // `insert` returns `Ok`, and a later read returns `Ok("")`. Core's own tests
    // only insert into an already-rooted cell (`Root::new(...)` then
    // `.insert(...)`), and `apps/components-demo` constructs its `Ownable`
    // without seeding it, so nothing upstream exercises seed-at-init.
    //
    // So the init values live here, and the `Ownable` cells take over from the
    // first owner edit onwards. `Frozen`: written once at init and changeable
    // by nobody — as plain registers any member could rewrite them, and so
    // rename the board until its owner first did.
    initial_name: Frozen<String>,
    initial_description: Frozen<String>,
    /// The canvas. Writer-set guarded: only accounts holding a role mask
    /// projected from `roles` (editors, admins) may write an entry, on every
    /// node.
    elements: PermissionedStorage<IndexedMap<ElementId, Element>, ProtocolAuthorizer>,
    /// One slot per account, written only by that account.
    members: UserStorage<Member>,
    /// Guarded like `elements`.
    comments: PermissionedStorage<UnorderedMap<CommentId, Comment>, ProtocolAuthorizer>,
    /// Every reply, keyed `"<comment>/<created_at:020>/<reply>"` so one
    /// comment's thread is a prefix slice in order. Guarded like `elements`.
    replies: PermissionedStorage<SortedMap<String, CommentReply>, ProtocolAuthorizer>,
    /// Keyed by DEVICE: a pointer belongs to a screen. Each entry is owned by
    /// the account that wrote it.
    cursors: Authored<UnorderedMap<String, CursorState>>,
    // Role registry whose admin tier is a signed writer set. Grants/revokes are
    // admin-gated at merge; the creator is the sole initial admin.
    roles: AccessControl,
}

fn reply_prefix(comment_id: &str) -> String {
    format!("{comment_id}/")
}

fn reply_key(comment_id: &str, created_at: u64, reply_id: &str) -> String {
    format!("{comment_id}/{created_at:020}/{reply_id}")
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroDesign {
    /// Create a board owned by the caller. Runs once, when the context is created,
    /// with the context's init arguments. The creator becomes the owner and only admin.
    ///
    /// # Arguments
    /// * `name` - the board's name.
    /// * `description` - free text; may be empty.
    ///
    /// # Examples
    /// ```json
    /// {"name":"Landing page","description":""}
    /// ```
    #[app::init]
    pub fn init(name: String, description: String) -> MeroDesign {
        // Ownership, the admin tier and the member roster are all ACCOUNT-scoped.
        let me = Self::caller_account();
        // Deliberately NOT seeding the `Ownable` cells here — see `initial_name`.
        // The values would be silently dropped and the board would come up with
        // no name and no description.
        MeroDesign {
            board_name: Ownable::new_owned_by(me),
            board_description: Ownable::new_owned_by(me),
            initial_name: Frozen::new(name),
            initial_description: Frozen::new(description),
            elements: PermissionedStorage::new(BTreeSet::from([me]), false),
            members: UserStorage::new(),
            comments: PermissionedStorage::new(BTreeSet::from([me]), false),
            replies: PermissionedStorage::new(BTreeSet::from([me]), false),
            cursors: Authored::new(),
            roles: AccessControl::new(me),
        }
    }

    // ── Identity & authorization helpers ────────────────────────────────────────

    /// The installation this call came from, as the hex context key the
    /// frontend reads back from `/contexts/{id}/identities-owned`.
    ///
    /// Used for exactly one thing: the cursor map. A pointer is a property of a
    /// screen, not of a person, so the same human on a second machine gets a
    /// second cursor. Every "whose is it" question is [`Self::caller_account`].
    fn caller_device() -> PublicKey {
        sdk_env::device_id().into()
    }

    /// Who this call is authorized as: the person, not the machine — what
    /// `AccessControl`, `Ownable` and every owner stamp gate on. Never trust a
    /// client-supplied id.
    fn caller_account() -> AccountId {
        AccountId::from(sdk_env::account_id())
    }

    /// Hex string form of the caller's account — this board's member id.
    ///
    /// A member id used to be a DEVICE key, with a self-registered
    /// device→account table to map it to the account grants name. Any member
    /// could write that table, so a patched node could pair someone else's
    /// device with its own account and receive their grants — or their board,
    /// on a transfer. An account needs no table: the host supplies it.
    fn caller_id() -> MemberId {
        Self::caller_account().to_string()
    }

    /// Resolve a client-supplied member id to the account a grant can name.
    /// A member id IS an account, so this is a parse — which also means an
    /// admin can grant someone who has never opened the board.
    fn require_account(&self, member: &str) -> app::Result<AccountId> {
        AccountId::from_str(member).map_err(|_| {
            app::err!(
                "that is not a member id — expected the 64-character account id \
                 the members list shows"
            )
        })
    }

    /// True if `who` may mutate the canvas (admin or explicit editor).
    fn is_editor(&self, who: &AccountId) -> bool {
        self.roles.is_admin(who) || self.roles.has_role(ROLE_EDITOR, who).unwrap_or(false)
    }

    /// Gate a canvas mutation. Viewers (no admin/editor role) are read-only.
    fn require_editor(&self) -> app::Result<()> {
        if self.is_editor(&Self::caller_account()) {
            return Ok(());
        }
        app::bail!("view-only: editor or admin access is required to modify this board");
    }

    /// Gate a board-level / destructive operation on admin.
    fn require_admin(&self) -> app::Result<()> {
        if self.roles.is_admin(&Self::caller_account()) {
            return Ok(());
        }
        app::bail!("admin access is required for this operation");
    }

    /// Push the current roles onto the canvas collections' capability maps,
    /// where every node enforces them. Run after every role or admin change.
    fn project_canvas_roles(&mut self) -> app::Result<()> {
        self.roles
            .project_onto(CANVAS_ROLE_MASKS, &mut self.elements)?;
        self.roles
            .project_onto(CANVAS_ROLE_MASKS, &mut self.comments)?;
        self.roles
            .project_onto(CANVAS_ROLE_MASKS, &mut self.replies)?;
        Ok(())
    }

    /// The element map, for reading. `None` only if storage cannot load it.
    fn element_map(&self) -> Option<&IndexedMap<ElementId, Element>> {
        self.elements.get().ok()
    }

    // ── Board ─────────────────────────────────────────────────────────────────

    /// The board's name. The owner-gated cell wins once it holds anything;
    /// before the first owner edit it is empty and what `init` was given is the
    /// answer. See `initial_name`.
    fn board_name_str(&self) -> String {
        let edited = self
            .board_name
            .get()
            .map(|r| r.get().clone())
            .unwrap_or_default();
        if edited.is_empty() {
            self.initial_name.get().cloned().unwrap_or_default()
        } else {
            edited
        }
    }

    /// As [`Self::board_name_str`], for the description.
    fn board_description_str(&self) -> String {
        let edited = self
            .board_description
            .get()
            .map(|r| r.get().clone())
            .unwrap_or_default();
        if edited.is_empty() {
            self.initial_description.get().cloned().unwrap_or_default()
        } else {
            edited
        }
    }

    /// The board's name, description, element and member counts, and owner.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn get_board(&self) -> BoardInfo {
        BoardInfo {
            name: self.board_name_str(),
            description: self.board_description_str(),
            element_count: self.element_map().and_then(|m| m.len().ok()).unwrap_or(0) as u32,
            member_count: self.members.entries().map(Iterator::count).unwrap_or(0) as u32,
            // An account IS a member id, so this needs no translation.
            owner: self.board_name.owner().map(|a| a.to_string()),
        }
    }

    /// Rename or re-describe the board. Owner only; a `null` field is left unchanged.
    ///
    /// # Errors
    /// Fails if the caller is not the owner.
    ///
    /// # Examples
    /// ```json
    /// {"name":"Landing page v2","description":null}
    /// ```
    pub fn update_board(
        &mut self,
        name: Option<String>,
        description: Option<String>,
    ) -> app::Result<()> {
        self.board_name.only_owner()?;
        if let Some(n) = name {
            self.board_name.insert(LwwRegister::new(n))?;
        }
        if let Some(d) = description {
            self.board_description.insert(LwwRegister::new(d))?;
        }
        app::emit!(Event::BoardUpdated());
        Ok(())
    }

    /// Hand the board to another member, who becomes owner and admin; the caller stops
    /// being admin. Owner only.
    ///
    /// # Arguments
    /// * `new_owner` - a member id from `get_members`, or that member's account id; the
    ///   member must have joined.
    ///
    /// # Errors
    /// Fails if the caller is not the owner, the id is not a valid key, or that member
    /// has not joined the board yet.
    ///
    /// # Examples
    /// ```json
    /// {"new_owner":"<member id from get_members>"}
    /// ```
    pub fn transfer_ownership(&mut self, new_owner: String) -> app::Result<()> {
        let owner = self.require_account(&new_owner)?;
        // Only the current owner can pass the `Ownable` transfer guards below,
        // so the caller IS the previous owner.
        let previous = Self::caller_account();
        self.board_name.transfer_ownership(owner)?;
        self.board_description.transfer_ownership(owner)?;
        // The new owner becomes administratively able to manage roles…
        if !self.roles.is_admin(&owner) {
            self.roles.grant_admin(owner)?;
        }
        // …and the former owner relinquishes admin, so they can no longer pass
        // `require_admin` (clear/role grants) after handing the board off. Skip
        // when transferring to self. Granting the new admin first guarantees the
        // set never empties.
        if previous != owner && self.roles.is_admin(&previous) {
            self.roles.revoke_admin(&previous)?;
        }
        // The previous owner still holds FULL on the canvas until this runs,
        // which is what lets them hand it over.
        self.project_canvas_roles()?;
        app::emit!(Event::OwnerTransferred(new_owner));
        Ok(())
    }

    // ── Roles ───────────────────────────────────────────────────────────────────

    /// Let a member edit the canvas. Admin only.
    ///
    /// # Arguments
    /// * `member` - a member id from `get_members`, or that member's account id; the
    ///   member must have called `join` first.
    ///
    /// # Errors
    /// Fails if the caller is not an admin, the id is not a valid key, or that member
    /// has not joined the board yet.
    ///
    /// # Examples
    /// ```json
    /// {"member":"<member id from get_members>"}
    /// ```
    pub fn grant_editor(&mut self, member: String) -> app::Result<()> {
        let who = self.require_account(&member)?;
        self.roles.grant(ROLE_EDITOR, who)?;
        self.project_canvas_roles()?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    /// Take the editor role away, leaving the member a viewer. Admin only.
    ///
    /// # Arguments
    /// * `member` - a member id or account id, as for `grant_editor`.
    ///
    /// # Errors
    /// Fails if the caller is not an admin, the id is not a valid key, or that member
    /// has not joined the board yet.
    ///
    /// # Examples
    /// ```json
    /// {"member":"<member id from get_members>"}
    /// ```
    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        let who = self.require_account(&member)?;
        self.roles.revoke(ROLE_EDITOR, &who)?;
        self.project_canvas_roles()?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    /// A member's effective role: `"admin"`, `"editor"` or `"viewer"`. Unknown members are viewers.
    ///
    /// # Arguments
    /// * `member` - a member id from `get_members`.
    ///
    /// # Examples
    /// ```json
    /// {"member":"<member id from get_members>"}
    /// ```
    pub fn get_role(&self, member: String) -> String {
        // Anything that is not a member id names nobody, and nobody holds a
        // grant — the same answer as a member who was never granted one.
        match AccountId::from_str(&member) {
            Ok(account) => self.role_label(&account),
            Err(_) => "viewer".to_string(),
        }
    }

    /// The caller's effective role: `"admin"`, `"editor"` or `"viewer"`.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn my_role(&self) -> String {
        self.role_label(&Self::caller_account())
    }

    /// Whether the caller may change the canvas (admin or editor).
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn can_edit(&self) -> bool {
        self.is_editor(&Self::caller_account())
    }

    /// Every joined member with their effective role and, once known, their account id.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn list_roles(&self) -> Vec<MemberRole> {
        let mut out = Vec::new();
        if let Ok(entries) = self.members.entries() {
            for (account, _) in entries {
                let id = account.to_string();
                out.push(MemberRole {
                    role: self.role_label(&account),
                    account: Some(id.clone()),
                    member: id,
                });
            }
        }
        out
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

    // ── Members ───────────────────────────────────────────────────────────────

    /// Register the caller as a board member. Call it on first opening the board:
    /// an admin can grant a role only to a member who has joined. A repeat join
    /// changes nothing.
    ///
    /// # Arguments
    /// * `username` - display name shown to other members.
    /// * `avatar` - avatar URL, or `null`.
    /// * `timestamp` - the caller's clock in unix milliseconds.
    ///
    /// # Examples
    /// ```json
    /// {"username":"bot","avatar":null,"timestamp":1727000000000}
    /// ```
    pub fn join(&mut self, username: String, avatar: Option<String>, timestamp: u64) {
        if self.members.contains_current_user().unwrap_or(false) {
            return;
        }
        let member_id = Self::caller_id();
        let m = Member {
            id: member_id.clone(),
            username,
            avatar,
            joined_at: timestamp,
            username_updated_at: timestamp,
        };
        let _ = self.members.insert(m);
        app::emit!(Event::MemberJoined(member_id));
    }

    /// Every member who has joined, with username, avatar and join time.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn get_members(&self) -> Vec<Member> {
        self.members
            .entries()
            .map(|entries| {
                entries
                    .map(|(account, mut m)| {
                        m.id = account.to_string();
                        m
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Rename the caller's own member entry; does nothing for a caller who never joined.
    ///
    /// # Arguments
    /// * `timestamp` - the caller's clock in unix milliseconds; the newest rename wins.
    ///
    /// # Examples
    /// ```json
    /// {"username":"bot-2","timestamp":1727000001000}
    /// ```
    pub fn update_member_username(&mut self, username: String, timestamp: u64) {
        if let Ok(Some(mut m)) = self.members.get() {
            m.username = username;
            m.username_updated_at = timestamp;
            let _ = self.members.insert(m);
            app::emit!(Event::MemberUsernameUpdated(Self::caller_id()));
        }
    }

    // ── Elements ──────────────────────────────────────────────────────────────

    /// Add an element to the canvas and return its id. Editors only.
    ///
    /// `data` says what the element is, tagged by `kind` (`rect`, `circle`, `line`, `arrow`,
    /// `path`, `text`, `image`, `svg`). The caller chooses `id` (a UUID); an existing id is
    /// replaced. Optional fields may be omitted.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"element":{"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90","data":{"kind":"rect"},"x":40,"y":60,"width":120,"height":80,"rotation":0,"fill":"#ef4444","stroke":"transparent","strokeWidth":0,"opacity":100,"layerIndex":0,"createdBy":"","createdAt":1727000000000,"updatedAt":1727000000000}}
    /// ```
    pub fn add_element(&mut self, element: Element) -> app::Result<String> {
        self.require_editor()?;
        let id = self.insert_element(element)?;
        app::emit!(Event::ElementAdded(id.clone()));
        Ok(id)
    }

    /// `add_element` for a whole selection — a paste, an import, a batch of
    /// rerouted connectors. An id that already exists is overwritten, exactly as
    /// `add_element` does. At most `MAX_BATCH` elements.
    pub fn add_elements(&mut self, elements: Vec<Element>) -> app::Result<Vec<String>> {
        self.require_editor()?;
        Self::require_batch(elements.len())?;
        if elements.is_empty() {
            return Ok(Vec::new());
        }
        let mut ids = Vec::with_capacity(elements.len());
        for el in elements {
            ids.push(self.insert_element(el)?);
        }
        app::emit!(Event::ElementsAdded(ids.clone()));
        Ok(ids)
    }

    /// Stores one element and announces its blob, if it has one. No event and
    /// no permission check: the public methods own both.
    ///
    /// `created_by` is the caller's account, or — when the id is already on
    /// the board — whoever created it first. Never what the client sent.
    fn insert_element(&mut self, mut element: Element) -> app::Result<String> {
        let id = element.id.clone();
        // Announce image/svg blobs to context so they propagate to all members
        let blob_id_str = match &element.data {
            ElementData::Image { blob_id, .. } | ElementData::Svg { blob_id, .. } => {
                blob_id.as_str()
            }
            _ => "",
        };
        if !blob_id_str.is_empty() {
            if let Ok(blob_id) = blob_id_str.parse::<BlobId>() {
                sdk_env::blob_announce_to_context(blob_id.as_ref(), &sdk_env::context_id());
            }
        }
        element.created_by = self
            .element_map()
            .and_then(|m| m.get(&id).ok().flatten())
            .map_or_else(Self::caller_id, |existing| existing.created_by.clone());
        let _ = self.elements.get_mut()?.insert(id.clone(), element)?;
        Ok(id)
    }

    fn require_batch(len: usize) -> app::Result<()> {
        if len > MAX_BATCH {
            app::bail!("a batch holds at most {} elements, got {}", MAX_BATCH, len);
        }
        Ok(())
    }

    // Clippy's 7-argument limit, allowed rather than refactored: this is a
    // partial-update method on the CONTRACT's public API, so every parameter is
    // an `Option<T>` field a caller may or may not be changing. Collapsing them
    // into a struct would change the ABI — and therefore the generated client
    // and the published contract — which a migration must not do.
    /// Change an element's geometry or style. Editors only.
    ///
    /// A `null` field is left unchanged. Does nothing if `id` names no element.
    ///
    /// # Arguments
    /// * `x` - left edge, canvas pixels.
    /// * `y` - top edge, canvas pixels.
    /// * `rotation` - degrees.
    /// * `opacity` - percent, 0 to 100.
    /// * `corner_radius` - pixels; 0 means square corners.
    /// * `updated_at` - unix milliseconds, newer than the element's current `updatedAt`.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90","x":300,"y":60,"width":null,"height":null,"rotation":null,"fill":"#22c55e","stroke":null,"stroke_width":null,"opacity":null,"corner_radius":8,"updated_at":1727000010000}
    /// ```
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
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

    /// `update_element` for a whole selection — a multi-drag, a fill applied to
    /// many shapes. Every patch shares one `updated_at`, as they are one edit.
    /// Unknown ids are skipped. At most `MAX_BATCH` patches.
    pub fn update_elements(
        &mut self,
        patches: Vec<ElementPatch>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        Self::require_batch(patches.len())?;
        let mut ids = Vec::new();
        for patch in patches {
            if let Some(id) = self.patch_element(patch, updated_at)? {
                ids.push(id);
            }
        }
        if !ids.is_empty() {
            app::emit!(Event::ElementsUpdated(ids));
        }
        Ok(())
    }

    /// Applies one patch. Returns the id when the element exists.
    fn patch_element(
        &mut self,
        patch: ElementPatch,
        updated_at: u64,
    ) -> app::Result<Option<String>> {
        let ElementPatch {
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
        } = patch;
        let found = self.elements.get_mut()?.update(&id, |el| {
            if let Some(v) = x {
                el.x = v;
            }
            if let Some(v) = y {
                el.y = v;
            }
            if let Some(v) = width {
                el.width = v;
            }
            if let Some(v) = height {
                el.height = v;
            }
            if let Some(v) = rotation {
                el.rotation = v;
            }
            if let Some(v) = fill {
                el.fill = v;
            }
            if let Some(v) = stroke {
                el.stroke = v;
            }
            if let Some(v) = stroke_width {
                el.stroke_width = v;
            }
            if let Some(v) = opacity {
                el.opacity = v;
            }
            // None means "leave alone"; 0 means "square corners".
            if let Some(v) = corner_radius {
                el.corner_radius = Some(v);
            }
            el.updated_at = updated_at;
        })?;
        Ok(found.map(|()| id))
    }

    /// Name an element's layer. Editors only. Does nothing if `id` names no element.
    ///
    /// # Arguments
    /// * `label` - a `/`-separated path: the group, then the layer name. A rectangle labelled
    ///   `screen/<name>` is a presentation screen. `null` clears the label.
    /// * `updated_at` - unix milliseconds, newer than the element's current `updatedAt`.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90","label":"screen/01 Sign in","updated_at":1727000030000}
    /// ```
    pub fn update_element_label(
        &mut self,
        id: String,
        label: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if self.set_label(&id, label, updated_at)? {
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

    /// `update_element_label` for a whole selection — grouping, ungrouping,
    /// renaming a group. Unknown ids are skipped. At most `MAX_BATCH` labels.
    pub fn update_element_labels(
        &mut self,
        labels: Vec<LabelUpdate>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        Self::require_batch(labels.len())?;
        let mut ids = Vec::new();
        for u in labels {
            if self.set_label(&u.id, u.label, updated_at)? {
                ids.push(u.id);
            }
        }
        if !ids.is_empty() {
            app::emit!(Event::ElementsUpdated(ids));
        }
        Ok(())
    }

    fn set_label(&mut self, id: &str, label: Option<String>, updated_at: u64) -> app::Result<bool> {
        let found = self.elements.get_mut()?.update(id, |el| {
            el.label = label;
            el.updated_at = updated_at;
        })?;
        Ok(found.is_some())
    }

    // Clippy's 7-argument limit, allowed rather than refactored: this is a
    // partial-update method on the CONTRACT's public API, so every parameter is
    // an `Option<T>` field a caller may or may not be changing. Collapsing them
    // into a struct would change the ABI — and therefore the generated client
    // and the published contract — which a migration must not do.
    /// Change a text element's content or style. Editors only.
    ///
    /// A `null` field is left unchanged. Does nothing if `id` names no element, and
    /// changes only `updated_at` on an element that is not text.
    ///
    /// # Arguments
    /// * `font_size` - pixels.
    /// * `text_align` - `left`, `center` or `right`.
    /// * `updated_at` - unix milliseconds, newer than the element's current `updatedAt`.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"id":"0d6f3a52-1b7e-4c9a-8e2d-5a4b3c2d1e0f","content":"Hello there","font_family":null,"font_size":32,"bold":true,"italic":null,"text_align":"center","vertical_align":null,"updated_at":1727000005000}
    /// ```
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
        let found = self.elements.get_mut()?.update(&id, |el| {
            if let ElementData::Text {
                content: ref mut c,
                font_family: ref mut ff,
                font_size: ref mut fs,
                bold: ref mut b,
                italic: ref mut i,
                text_align: ref mut ta,
                vertical_align: ref mut va,
            } = el.data
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
        })?;
        if found.is_some() {
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

    /// Delete every element on the board, for every member. Admin only.
    ///
    /// # Errors
    /// Fails if the caller is not an admin.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn clear_elements(&mut self) -> app::Result<()> {
        self.require_admin()?;
        self.elements.get_mut()?.clear()?;
        app::emit!(Event::LayerReordered());
        Ok(())
    }

    /// Delete every comment on the board, for every member. Admin only.
    ///
    /// # Errors
    /// Fails if the caller is not an admin.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn clear_comments(&mut self) -> app::Result<()> {
        self.require_admin()?;
        self.comments.get_mut()?.clear()?;
        self.replies.get_mut()?.clear()?;
        Ok(())
    }

    /// Set or clear an element's drop shadow; all four shadow fields are written, `null`
    /// clearing each. Editors only. Does nothing if `id` names no element.
    ///
    /// # Arguments
    /// * `shadow_color` - a CSS color, or `null` for no shadow.
    /// * `shadow_offset_x` - pixels.
    /// * `shadow_offset_y` - pixels.
    /// * `shadow_blur` - pixels.
    /// * `updated_at` - unix milliseconds, newer than the element's current `updatedAt`.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90","shadow_color":"#00000040","shadow_offset_x":0,"shadow_offset_y":4,"shadow_blur":12,"updated_at":1727000015000}
    /// ```
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
        let found = self.elements.get_mut()?.update(&id, |el| {
            el.shadow_color = shadow_color;
            el.shadow_offset_x = shadow_offset_x;
            el.shadow_offset_y = shadow_offset_y;
            el.shadow_blur = shadow_blur;
            el.updated_at = updated_at;
        })?;
        if found.is_some() {
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

    /// Delete an element for every member. Editors only. An unknown id is not an error.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"}
    /// ```
    pub fn delete_element(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let _ = self.elements.get_mut()?.remove(&id)?;
        app::emit!(Event::ElementDeleted(id));
        Ok(())
    }

    /// `delete_element` for a whole selection. Ids that are already gone are
    /// fine — a peer may have deleted them first. At most `MAX_BATCH` ids.
    pub fn delete_elements(&mut self, ids: Vec<String>) -> app::Result<()> {
        self.require_editor()?;
        Self::require_batch(ids.len())?;
        if ids.is_empty() {
            return Ok(());
        }
        let elements = self.elements.get_mut()?;
        for id in &ids {
            let _ = elements.remove(id)?;
        }
        app::emit!(Event::ElementsDeleted(ids));
        Ok(())
    }

    /// Every element in paint order, lowest `layerIndex` first.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn get_elements(&self) -> Vec<Element> {
        self.element_map()
            .and_then(|m| m.query("layer_index").entries().ok())
            .map(|rows| rows.into_iter().map(|(_, el)| el).collect())
            .unwrap_or_default()
    }

    /// One element, or `null` if `id` names no element.
    ///
    /// # Examples
    /// ```json
    /// {"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"}
    /// ```
    pub fn get_element(&self, id: String) -> Option<Element> {
        self.element_map()?
            .get(&id)
            .ok()
            .flatten()
            .map(|v| v.clone())
    }

    /// The elements a batch event named, in one read instead of one
    /// `get_element` each. Ids that no longer exist are left out.
    pub fn get_elements_by_ids(&self, ids: Vec<String>) -> Vec<Element> {
        let Some(map) = self.element_map() else {
            return Vec::new();
        };
        ids.iter()
            .filter_map(|id| map.get(id).ok().flatten().map(|v| v.clone()))
            .collect()
    }

    // ── Layer order ───────────────────────────────────────────────────────────

    /// Move one element to a position in the layer order and renumber the rest from 0,
    /// so one step up or down survives a sync. Editors only.
    ///
    /// # Arguments
    /// * `index` - the new position; 0 paints at the back, larger values are clamped to the front.
    /// * `updated_at` - unix milliseconds, newer than the element's current `updatedAt`.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90","index":0,"updated_at":1727000020000}
    /// ```
    pub fn set_layer_index(&mut self, id: String, index: u32, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;

        let Some(map) = self.element_map() else {
            return Ok(());
        };
        let order: Vec<(String, u32)> = map
            .query("layer_index")
            .entries()?
            .into_iter()
            .map(|(k, v)| (k, v.layer_index))
            .collect();
        let Some(from) = order.iter().position(|(k, _)| *k == id) else {
            return Ok(());
        };
        let to = (index as usize).min(order.len().saturating_sub(1));

        let mut next = order;
        let moved = next.remove(from);
        next.insert(to, moved);

        let elements = self.elements.get_mut()?;
        for (i, (key, current)) in next.iter().enumerate() {
            let i = i as u32;
            if *current == i && *key != id {
                continue;
            }
            let _ = elements.update(key, |el| {
                el.layer_index = i;
                if *key == id {
                    el.updated_at = updated_at;
                }
            })?;
        }
        app::emit!(Event::LayerReordered());
        Ok(())
    }

    /// Paint an element above every other one. Editors only.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"}
    /// ```
    pub fn bring_to_front(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let max_layer = self
            .element_map()
            .map(|m| m.query("layer_index").desc().first())
            .transpose()?
            .flatten()
            .map_or(0, |(_, el)| el.layer_index);
        let _ = self.elements.get_mut()?.update(&id, |el| {
            el.layer_index = max_layer + 1;
        })?;
        app::emit!(Event::LayerReordered());
        Ok(())
    }

    /// Paint an element below every other one. Editors only.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"id":"5f0c2b9e-8c1a-4d3e-9b7f-2a6d1e4c8b90"}
    /// ```
    pub fn send_to_back(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let lowest = self
            .element_map()
            .map(|m| m.query("layer_index").limit(2).entries())
            .transpose()?
            .unwrap_or_default()
            .into_iter()
            .find(|(k, _)| *k != id)
            .map(|(_, el)| el.layer_index);
        let target = match lowest {
            Some(0) => {
                let others: Vec<String> = self
                    .element_map()
                    .map(|m| m.query("layer_index").keys())
                    .transpose()?
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|k| *k != id)
                    .collect();
                let elements = self.elements.get_mut()?;
                for other_id in &others {
                    let _ = elements.update(other_id, |other| {
                        other.layer_index = other.layer_index.saturating_add(1);
                    })?;
                }
                0
            }
            Some(bottom) => bottom - 1,
            None => 0,
        };
        let _ = self.elements.get_mut()?.update(&id, |el| {
            el.layer_index = target;
        })?;
        app::emit!(Event::LayerReordered());
        Ok(())
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    /// Pin a comment at a canvas point. Editors only; the author is the caller.
    ///
    /// # Arguments
    /// * `id` - a new UUID chosen by the caller.
    /// * `x` - canvas pixels.
    /// * `y` - canvas pixels.
    /// * `created_at` - unix milliseconds.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"id":"9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d","x":120,"y":90,"content":"Bigger logo?","created_at":1727000040000}
    /// ```
    pub fn add_comment(
        &mut self,
        id: String,
        x: i64,
        y: i64,
        content: String,
        created_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        // Author is the real signer — not a client-supplied string — so a member
        // cannot attribute a comment to someone else.
        let author = Self::caller_id();
        let c = Comment {
            id: id.clone(),
            x,
            y,
            content,
            author,
            created_at,
            replies: vec![],
        };
        let _ = self.comments.get_mut()?.insert(id.clone(), c)?;
        app::emit!(Event::CommentAdded(id));
        Ok(())
    }

    /// Reply to a comment. Editors only; the author is the caller. Does nothing if the
    /// comment does not exist.
    ///
    /// # Arguments
    /// * `reply_id` - a new UUID chosen by the caller.
    /// * `created_at` - unix milliseconds.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"comment_id":"9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d","reply_id":"1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e","content":"Agreed","created_at":1727000050000}
    /// ```
    pub fn add_reply(
        &mut self,
        comment_id: String,
        reply_id: String,
        content: String,
        created_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if !self.comments.get()?.contains(&comment_id)? {
            return Ok(());
        }
        let reply = CommentReply {
            id: reply_id.clone(),
            content,
            author: Self::caller_id(),
            created_at,
        };
        let _ = self
            .replies
            .get_mut()?
            .insert(reply_key(&comment_id, created_at, &reply_id), reply)?;
        app::emit!(Event::CommentUpdated(comment_id));
        Ok(())
    }

    /// Remove one reply from a comment. Editors only.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"comment_id":"9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d","reply_id":"1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e"}
    /// ```
    pub fn delete_reply(&mut self, comment_id: String, reply_id: String) -> app::Result<()> {
        self.require_editor()?;
        let keys: Vec<String> = self
            .replies
            .get()?
            .prefix(reply_prefix(&comment_id).as_bytes())?
            .filter(|(_, r)| r.id == reply_id)
            .map(|(k, _)| k)
            .collect();
        if keys.is_empty() {
            return Ok(());
        }
        let replies = self.replies.get_mut()?;
        for key in keys {
            let _ = replies.remove(&key)?;
        }
        app::emit!(Event::CommentUpdated(comment_id));
        Ok(())
    }

    /// Delete a comment and its replies. Editors only.
    ///
    /// # Errors
    /// Fails if the caller is not an editor or admin.
    ///
    /// # Examples
    /// ```json
    /// {"id":"9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d"}
    /// ```
    pub fn delete_comment(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let _ = self.comments.get_mut()?.remove(&id)?;
        let thread: Vec<String> = self
            .replies
            .get()?
            .prefix(reply_prefix(&id).as_bytes())?
            .map(|(k, _)| k)
            .collect();
        let replies = self.replies.get_mut()?;
        for key in thread {
            let _ = replies.remove(&key)?;
        }
        app::emit!(Event::CommentDeleted(id));
        Ok(())
    }

    /// Every comment with its replies.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    pub fn get_comments(&self) -> Vec<Comment> {
        let (Ok(comments), Ok(replies)) = (self.comments.get(), self.replies.get()) else {
            return Vec::new();
        };
        let Ok(entries) = comments.entries() else {
            return Vec::new();
        };
        entries
            .map(|(id, mut c)| {
                c.replies = replies
                    .prefix(reply_prefix(&id).as_bytes())
                    .map(|thread| thread.map(|(_, r)| r).collect())
                    .unwrap_or_default();
                c
            })
            .collect()
    }

    // ── Cursor tracking ───────────────────────────────────────────────────────

    /// Broadcast the caller's cursor position. Open to every member, viewers included.
    ///
    /// # Arguments
    /// * `x` - canvas pixels.
    /// * `y` - canvas pixels.
    /// * `updated_at` - unix milliseconds.
    ///
    /// # Examples
    /// ```json
    /// {"x":200,"y":150,"updated_at":1727000060000}
    /// ```
    pub fn update_cursor(&mut self, x: i64, y: i64, updated_at: u64) {
        // Keyed by DEVICE: one pointer per open window, so a member editing
        // from two machines shows two.
        let identity = String::from(Self::caller_device());
        let cs = CursorState {
            identity: identity.clone(),
            account: Self::caller_id(),
            x,
            y,
            updated_at,
        };
        // First move inserts, later ones update. Keys are per owner, so this
        // asks about the caller's own entry, and nobody else's is in the way.
        let _ = if self.cursors.contains(&identity).unwrap_or(false) {
            self.cursors.update(&identity, cs)
        } else {
            self.cursors.insert(identity.clone(), cs)
        };
        app::emit!(Event::CursorMoved(identity));
    }

    /// Every member's last reported cursor position, labelled with its owner's account.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    // `entries_with_owners`, not a key-only `owner_of`: keys are per owner,
    // so `owner_of` would only ever name the caller.
    pub fn get_cursors(&self) -> Vec<CursorState> {
        let Ok(entries) = self.cursors.entries_with_owners() else {
            return Vec::new();
        };
        entries
            .into_iter()
            .map(|(owner, _, mut cs)| {
                cs.account = owner.to_string();
                cs
            })
            .collect()
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    const OTHER: [u8; 32] = [0x22; 32];

    // Roles and ownership are keyed by ACCOUNT since rc.20, and `call_as` keeps
    // the caller's account on purpose (two devices of one person). A second
    // PERSON therefore needs their own account.
    const OTHER_ACCOUNT: [u8; 32] = [0xA2; 32];

    fn new_board() -> TestHost<MeroDesign> {
        TestHost::new(|| MeroDesign::init("Board".to_owned(), "desc".to_owned()))
    }

    fn sample_element(id: &str) -> Element {
        Element {
            id: id.to_owned(),
            data: ElementData::Rect,
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            rotation: 0,
            fill: "#fff".to_owned(),
            stroke: "#000".to_owned(),
            stroke_width: 1,
            opacity: 100,
            layer_index: 0,
            created_by: "creator".to_owned(),
            created_at: 1,
            updated_at: 1,
            shadow_color: None,
            shadow_offset_x: None,
            shadow_offset_y: None,
            shadow_blur: None,
            label: None,
            corner_radius: None,
        }
    }

    #[test]
    fn creator_is_admin_and_can_edit() {
        let app = new_board();
        assert_eq!(app.view(|s| s.my_role()), "admin");
        assert!(app.view(|s| s.can_edit()));
    }

    #[test]
    fn join_uses_signer_identity_not_client_arg() {
        let mut app = new_board();
        // The member id is derived from the executor — there is no client arg to
        // spoof. The default test executor is all-zeroes.
        app.call(|s| s.join("alice".to_owned(), None, 1));
        let members = app.view(|s| s.get_members());
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].username, "alice");
        // id is the base58 of the all-zero key — non-empty and stable.
        assert!(!members[0].id.is_empty());
    }

    #[test]
    fn viewer_cannot_edit_editor_can() {
        let mut app = new_board();
        // A second person joins; with no grant they are a viewer and are refused.
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.join("bob".to_owned(), None, 1));
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s
                .add_element(sample_element("e1")))
            .is_err());
        assert_eq!(app.view(|s| s.get_elements()).len(), 0);

        // Admin grants editor → now the same identity may add elements.
        let bob = AccountId::from(OTHER_ACCOUNT).to_string();
        app.call(|s| s.grant_editor(bob.clone())).unwrap();
        assert_eq!(app.view(|s| s.get_role(bob.clone())), "editor");
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| {
            s.add_element(sample_element("e1"))
        })
        .unwrap();
        assert_eq!(app.view(|s| s.get_elements()).len(), 1);

        // Revoke → back to viewer, refused again.
        app.call(|s| s.revoke_editor(bob.clone())).unwrap();
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.delete_element("e1".to_owned()))
            .is_err());
    }

    /// A member id is an account now, so an admin can set a role from the
    /// node's members list alone — before the invitee has ever opened the
    /// board. Under the old device→account table a grant could only name
    /// someone the board had already heard from.
    #[test]
    fn a_member_can_be_granted_before_they_ever_open_the_board() {
        let mut app = new_board();
        let stranger = AccountId::from([0x5Au8; 32]).to_string();
        app.call(|s| s.grant_editor(stranger.clone())).unwrap();
        assert_eq!(app.view(|s| s.get_role(stranger)), "editor");
        let err = format!(
            "{:?}",
            app.call(|s| s.grant_editor("not-an-account-id".to_owned()))
                .unwrap_err()
        );
        assert!(err.contains("not a member id"), "unexpected: {err}");
    }

    #[test]
    fn list_roles_carries_both_ids_so_the_ui_can_join_its_two_sources() {
        let mut app = new_board();
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.join("bob".to_owned(), None, 1));

        let bob_account = AccountId::from(OTHER_ACCOUNT).to_string();
        let roles = app.view(|s| s.list_roles());
        let bob = roles
            .iter()
            .find(|r| r.member == bob_account)
            .expect("bob is on the board");
        assert_eq!(
            bob.account.as_deref(),
            Some(bob_account.as_str()),
            "without the account the settings UI cannot match this row to a \
             namespace member, and falls back to showing a raw id"
        );
    }

    #[test]
    fn non_admin_cannot_grant_roles() {
        let mut app = new_board();
        let third = AccountId::from([0x33u8; 32]).to_string();
        // OTHER is not an admin → the fail-fast guard refuses (and a forged
        // grant delta would be rejected at merge).
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.grant_editor(third))
            .is_err());
    }

    #[test]
    fn only_owner_renames_board() {
        let mut app = new_board();
        app.call(|s| s.update_board(Some("Renamed".to_owned()), None))
            .unwrap();
        assert_eq!(app.view(|s| s.get_board()).name, "Renamed");
        // A non-owner rename is refused.
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s
                .update_board(Some("Hijacked".to_owned()), None))
            .is_err());
        assert_eq!(app.view(|s| s.get_board()).name, "Renamed");
    }

    #[test]
    fn username_merge_uses_dedicated_clock() {
        // Two divergent copies of the same member; the one with the newer
        // username_updated_at wins regardless of joined_at.
        let mut a = Member {
            id: "m".to_owned(),
            username: "old".to_owned(),
            avatar: None,
            joined_at: 100,
            username_updated_at: 100,
        };
        let b = Member {
            id: "m".to_owned(),
            username: "new".to_owned(),
            avatar: None,
            joined_at: 100,
            username_updated_at: 200,
        };
        a.merge(&b).unwrap();
        assert_eq!(a.username, "new");
    }

    #[test]
    fn ownership_transfer_moves_control() {
        let mut app = new_board();
        let other = AccountId::from(OTHER_ACCOUNT).to_string();
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.join("bob".to_owned(), None, 1));
        app.call(|s| s.transfer_ownership(other.clone())).unwrap();
        assert_eq!(app.view(|s| s.get_board()).owner, Some(other.clone()));
        // The new owner can rename; the old owner can no longer.
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| {
            s.update_board(Some("Owned".to_owned()), None)
        })
        .unwrap();
        assert_eq!(app.view(|s| s.get_board()).name, "Owned");
        assert!(app
            .call(|s| s.update_board(Some("nope".to_owned()), None))
            .is_err());
        // The new owner is admin; the former owner relinquished admin entirely.
        assert_eq!(app.view(|s| s.get_role(other)), "admin");
        assert_eq!(app.view(|s| s.my_role()), "viewer");
        assert!(!app.view(|s| s.can_edit()));
    }

    /// Regression: the board must report the name and description it was created
    /// with.
    ///
    /// `Ownable::insert` inside `init` is silently dropped on rc.20 (see
    /// `initial_name`), so before this test nothing here read either value back
    /// and every board since the rc.20 bump has been reporting `""` for both.
    #[test]
    fn the_board_reports_its_name_and_description_before_and_after_an_update() {
        let mut app = new_board();
        let fresh = app.view(|s| s.get_board());
        assert_eq!(
            (fresh.name.as_str(), fresh.description.as_str()),
            ("Board", "desc"),
            "a freshly created board must report what init was given"
        );

        // A partial update must move only the field it names — the other keeps
        // falling back to its init value rather than going blank.
        app.call(|s| s.update_board(Some("Renamed".to_owned()), None))
            .unwrap();
        let after = app.view(|s| s.get_board());
        assert_eq!(
            (after.name.as_str(), after.description.as_str()),
            ("Renamed", "desc")
        );

        app.call(|s| s.update_board(None, Some("new desc".to_owned())))
            .unwrap();
        let both = app.view(|s| s.get_board());
        assert_eq!(
            (both.name.as_str(), both.description.as_str()),
            ("Renamed", "new desc")
        );
    }

    /// The owner gate still holds. Ownership is keyed by ACCOUNT since rc.20 and
    /// `call_as` keeps the caller's account, so a second PERSON needs their own.
    #[test]
    fn a_non_owner_cannot_update_the_board() {
        let mut app = new_board();
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s
                .update_board(Some("hijacked".to_owned()), None))
            .is_err());
        assert_eq!(app.view(|s| s.get_board()).name, "Board");
    }
    // ── item 4: one-step layer moves must survive a sync ──────────────────────

    fn seed(app: &mut TestHost<MeroDesign>, ids: &[&str]) {
        for (i, id) in ids.iter().enumerate() {
            let mut el = sample_element(id);
            el.layer_index = i as u32;
            app.call(|s| s.add_element(el.clone())).unwrap();
        }
    }

    fn order(app: &TestHost<MeroDesign>) -> Vec<String> {
        let mut got: Vec<(String, u32)> = app
            .view(|s| s.get_elements())
            .into_iter()
            .map(|e| (e.id, e.layer_index))
            .collect();
        got.sort_by_key(|(_, l)| *l);
        got.into_iter().map(|(id, _)| id).collect()
    }

    #[test]
    fn set_layer_index_moves_one_step_and_renumbers_densely() {
        let mut app = new_board();
        seed(&mut app, &["a", "b", "c"]);
        app.call(|s| s.set_layer_index("b".to_owned(), 2, 99))
            .unwrap();
        assert_eq!(order(&app), vec!["a", "c", "b"], "one step up");
        let layers: Vec<u32> = app
            .view(|s| s.get_elements())
            .into_iter()
            .map(|e| e.layer_index)
            .collect();
        let mut sorted = layers.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, vec![0, 1, 2], "indices stay dense — no duplicates");
    }

    #[test]
    fn set_layer_index_clamps_past_the_end() {
        let mut app = new_board();
        seed(&mut app, &["a", "b"]);
        app.call(|s| s.set_layer_index("a".to_owned(), 99, 1))
            .unwrap();
        assert_eq!(order(&app), vec!["b", "a"], "clamped to the last slot");
    }

    #[test]
    fn set_layer_index_ignores_an_unknown_id() {
        let mut app = new_board();
        seed(&mut app, &["a", "b"]);
        app.call(|s| s.set_layer_index("nope".to_owned(), 0, 1))
            .unwrap();
        assert_eq!(order(&app), vec!["a", "b"], "unchanged, and no panic");
    }

    #[test]
    fn set_layer_index_at_the_bottom_is_a_noop() {
        let mut app = new_board();
        seed(&mut app, &["a", "b", "c"]);
        app.call(|s| s.set_layer_index("a".to_owned(), 0, 1))
            .unwrap();
        assert_eq!(order(&app), vec!["a", "b", "c"]);
    }

    #[test]
    fn set_layer_index_is_refused_for_viewers() {
        let mut app = new_board();
        seed(&mut app, &["a", "b"]);
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.join("bob".to_owned(), None, 1));
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.set_layer_index(
                "a".to_owned(),
                1,
                2
            ))
            .is_err());
        assert_eq!(order(&app), vec!["a", "b"]);
    }

    // ── item 14: corner radius ───────────────────────────────────────────────

    #[test]
    fn corner_radius_round_trips_and_zero_is_a_real_value() {
        let mut app = new_board();
        app.call(|s| s.add_element(sample_element("a"))).unwrap();
        assert_eq!(
            app.view(|s| s.get_element("a".to_owned()))
                .unwrap()
                .corner_radius,
            None
        );

        app.call(|s| {
            s.update_element(
                "a".to_owned(),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(12),
                2,
            )
        })
        .unwrap();
        assert_eq!(
            app.view(|s| s.get_element("a".to_owned()))
                .unwrap()
                .corner_radius,
            Some(12)
        );

        // 0 means square corners, not "leave alone"
        app.call(|s| {
            s.update_element(
                "a".to_owned(),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(0),
                3,
            )
        })
        .unwrap();
        assert_eq!(
            app.view(|s| s.get_element("a".to_owned()))
                .unwrap()
                .corner_radius,
            Some(0)
        );

        // None leaves it untouched while other fields change
        app.call(|s| {
            s.update_element(
                "a".to_owned(),
                Some(5),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                4,
            )
        })
        .unwrap();
        let el = app.view(|s| s.get_element("a".to_owned())).unwrap();
        assert_eq!(el.corner_radius, Some(0));
        assert_eq!(el.x, 5);
    }

    // ── item 2: lines carry their endpoints ──────────────────────────────────

    #[test]
    fn line_points_round_trip() {
        let mut app = new_board();
        let mut el = sample_element("l");
        el.data = ElementData::Line {
            points: "0,40 60,0".to_owned(),
        };
        app.call(|s| s.add_element(el.clone())).unwrap();
        match app.view(|s| s.get_element("l".to_owned())).unwrap().data {
            ElementData::Line { points } => assert_eq!(points, "0,40 60,0"),
            other => panic!("expected a line, got {other:?}"),
        }
    }

    #[test]
    fn a_line_with_no_points_still_deserializes() {
        // Older clients send a bare {"kind":"line"}; serde(default) keeps them working.
        let json = r#"{"kind":"line"}"#;
        let data: ElementData = calimero_sdk::serde_json::from_str(json).unwrap();
        match data {
            ElementData::Line { points } => assert!(points.is_empty()),
            other => panic!("expected a line, got {other:?}"),
        }
    }

    // ── Batches ─────────────────────────────────────────────────────────────

    fn ids(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("e{i}")).collect()
    }

    fn many(n: usize) -> Vec<Element> {
        ids(n).iter().map(|id| sample_element(id)).collect()
    }

    #[test]
    fn add_elements_stores_the_whole_batch_in_one_call() {
        let mut app = new_board();
        let _ = app.take_events();
        let added = app.call(|s| s.add_elements(many(3))).unwrap();
        assert_eq!(added, ids(3));
        assert_eq!(app.view(|s| s.get_elements()).len(), 3);
    }

    /// The client parses these payloads (CanvasPage's SSE handler): one event
    /// per call, its data a JSON array of every id.
    #[test]
    fn each_batch_emits_one_event_carrying_every_id() {
        let mut app = new_board();
        let _ = app.take_events();
        let expect = |app: &TestHost<MeroDesign>, kind: &str, ids: &[&str]| {
            let events = app.take_events();
            assert_eq!(
                events.len(),
                1,
                "{kind}: {:?}",
                events.iter().map(|e| &e.kind).collect::<Vec<_>>()
            );
            assert_eq!(events[0].kind, kind);
            let got: Vec<String> = calimero_sdk::serde_json::from_slice(&events[0].data).unwrap();
            assert_eq!(got, ids.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        };
        app.call(|s| s.add_elements(many(3))).unwrap();
        expect(&app, "ElementsAdded", &["e0", "e1", "e2"]);
        app.call(|s| {
            s.update_elements(
                vec![
                    ElementPatch {
                        id: "e0".to_owned(),
                        x: Some(1),
                        ..Default::default()
                    },
                    ElementPatch {
                        id: "gone".to_owned(),
                        x: Some(1),
                        ..Default::default()
                    },
                ],
                2,
            )
        })
        .unwrap();
        expect(&app, "ElementsUpdated", &["e0"]);
        app.call(|s| {
            s.update_element_labels(
                vec![LabelUpdate {
                    id: "e1".to_owned(),
                    label: None,
                }],
                3,
            )
        })
        .unwrap();
        expect(&app, "ElementsUpdated", &["e1"]);
        app.call(|s| s.delete_elements(vec!["e0".to_owned(), "e2".to_owned()]))
            .unwrap();
        expect(&app, "ElementsDeleted", &["e0", "e2"]);
        // A batch that touched nothing says nothing.
        app.call(|s| {
            s.update_elements(
                vec![ElementPatch {
                    id: "gone".to_owned(),
                    ..Default::default()
                }],
                4,
            )
        })
        .unwrap();
        assert!(app.take_events().is_empty());
    }

    #[test]
    fn add_elements_overwrites_an_existing_id_like_add_element_does() {
        let mut app = new_board();
        app.call(|s| s.add_element(sample_element("e0"))).unwrap();
        let mut again = sample_element("e0");
        again.fill = "#123456".to_owned();
        app.call(|s| s.add_elements(vec![again])).unwrap();
        let els = app.view(|s| s.get_elements());
        assert_eq!(els.len(), 1);
        assert_eq!(els[0].fill, "#123456");
    }

    #[test]
    fn a_batch_over_the_cap_is_refused_whole() {
        let mut app = new_board();
        assert!(app.call(|s| s.add_elements(many(MAX_BATCH + 1))).is_err());
        assert!(app.view(|s| s.get_elements()).is_empty());
        app.call(|s| s.add_elements(many(MAX_BATCH))).unwrap();
        assert!(app.call(|s| s.delete_elements(ids(MAX_BATCH + 1))).is_err());
        assert_eq!(app.view(|s| s.get_elements()).len(), MAX_BATCH);
        let patches: Vec<ElementPatch> = ids(MAX_BATCH + 1)
            .into_iter()
            .map(|id| ElementPatch {
                id,
                ..Default::default()
            })
            .collect();
        assert!(app.call(|s| s.update_elements(patches, 2)).is_err());
    }

    #[test]
    fn viewers_cannot_run_any_batch() {
        let mut app = new_board();
        app.call(|s| s.add_elements(many(2))).unwrap();
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.join("bob".to_owned(), None, 1));
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.add_elements(many(1)))
            .is_err());
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.delete_elements(ids(2)))
            .is_err());
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.update_elements(
                vec![ElementPatch {
                    id: "e0".to_owned(),
                    x: Some(5),
                    ..Default::default()
                }],
                2
            ))
            .is_err());
        assert!(app
            .call_as_account(OTHER_ACCOUNT, OTHER, |s| s.update_element_labels(
                vec![LabelUpdate {
                    id: "e0".to_owned(),
                    label: Some("g".to_owned())
                }],
                2
            ))
            .is_err());
        assert_eq!(app.view(|s| s.get_elements()).len(), 2);
    }

    #[test]
    fn update_elements_patches_only_the_fields_given() {
        let mut app = new_board();
        app.call(|s| s.add_elements(many(2))).unwrap();
        app.call(|s| {
            s.update_elements(
                vec![
                    ElementPatch {
                        id: "e0".to_owned(),
                        x: Some(40),
                        y: Some(50),
                        ..Default::default()
                    },
                    ElementPatch {
                        id: "e1".to_owned(),
                        fill: Some("#f00".to_owned()),
                        ..Default::default()
                    },
                    ElementPatch {
                        id: "gone".to_owned(),
                        x: Some(1),
                        ..Default::default()
                    },
                ],
                7,
            )
        })
        .unwrap();
        let e0 = app.view(|s| s.get_element("e0".to_owned())).unwrap();
        let e1 = app.view(|s| s.get_element("e1".to_owned())).unwrap();
        assert_eq!(
            (e0.x, e0.y, e0.fill.as_str(), e0.updated_at),
            (40, 50, "#fff", 7)
        );
        assert_eq!((e1.x, e1.fill.as_str(), e1.updated_at), (0, "#f00", 7));
        assert!(app.view(|s| s.get_element("gone".to_owned())).is_none());
    }

    #[test]
    fn update_elements_matches_update_element_field_for_field() {
        // The batch is the single-element method applied N times; the single
        // path now goes through the same helper, so the two cannot drift.
        // One TestHost at a time: they share the thread's mock state.
        let single = {
            let mut app = new_board();
            app.call(|s| s.add_element(sample_element("e0"))).unwrap();
            app.call(|s| {
                s.update_element(
                    "e0".to_owned(),
                    Some(1),
                    Some(2),
                    Some(3),
                    Some(4),
                    Some(5),
                    Some("#a".to_owned()),
                    Some("#b".to_owned()),
                    Some(6),
                    Some(7),
                    Some(0),
                    9,
                )
            })
            .unwrap();
            app.view(|s| s.get_element("e0".to_owned())).unwrap()
        };
        let batched = {
            let mut app = new_board();
            app.call(|s| s.add_element(sample_element("e0"))).unwrap();
            app.call(|s| {
                s.update_elements(
                    vec![ElementPatch {
                        id: "e0".to_owned(),
                        x: Some(1),
                        y: Some(2),
                        width: Some(3),
                        height: Some(4),
                        rotation: Some(5),
                        fill: Some("#a".to_owned()),
                        stroke: Some("#b".to_owned()),
                        stroke_width: Some(6),
                        opacity: Some(7),
                        corner_radius: Some(0),
                    }],
                    9,
                )
            })
            .unwrap();
            app.view(|s| s.get_element("e0".to_owned())).unwrap()
        };
        assert_eq!(
            calimero_sdk::serde_json::to_string(&single).unwrap(),
            calimero_sdk::serde_json::to_string(&batched).unwrap()
        );
    }

    #[test]
    fn an_element_patch_with_only_an_id_deserializes() {
        let patch: ElementPatch =
            calimero_sdk::serde_json::from_str(r#"{"id":"e0","x":3}"#).unwrap();
        assert_eq!(
            (patch.id.as_str(), patch.x, patch.fill),
            ("e0", Some(3), None)
        );
    }

    #[test]
    fn update_element_labels_sets_and_clears_labels() {
        let mut app = new_board();
        app.call(|s| s.add_elements(many(2))).unwrap();
        app.call(|s| {
            s.update_element_labels(
                vec![
                    LabelUpdate {
                        id: "e0".to_owned(),
                        label: Some("Group/a".to_owned()),
                    },
                    LabelUpdate {
                        id: "e1".to_owned(),
                        label: None,
                    },
                    LabelUpdate {
                        id: "gone".to_owned(),
                        label: Some("x".to_owned()),
                    },
                ],
                4,
            )
        })
        .unwrap();
        let e0 = app.view(|s| s.get_element("e0".to_owned())).unwrap();
        let e1 = app.view(|s| s.get_element("e1".to_owned())).unwrap();
        assert_eq!((e0.label.as_deref(), e0.updated_at), (Some("Group/a"), 4));
        assert_eq!((e1.label.as_deref(), e1.updated_at), (None, 4));
    }

    #[test]
    fn delete_elements_removes_the_batch_and_tolerates_missing_ids() {
        let mut app = new_board();
        app.call(|s| s.add_elements(many(4))).unwrap();
        app.call(|s| s.delete_elements(vec!["e1".to_owned(), "e3".to_owned(), "gone".to_owned()]))
            .unwrap();
        let left: Vec<String> = app
            .view(|s| s.get_elements())
            .into_iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(left.len(), 2);
        assert!(left.contains(&"e0".to_owned()) && left.contains(&"e2".to_owned()));
    }

    #[test]
    fn get_elements_by_ids_returns_only_what_exists() {
        let mut app = new_board();
        app.call(|s| s.add_elements(many(3))).unwrap();
        let got: Vec<String> = app
            .view(|s| {
                s.get_elements_by_ids(vec!["e2".to_owned(), "gone".to_owned(), "e0".to_owned()])
            })
            .into_iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(got, vec!["e2".to_owned(), "e0".to_owned()]);
    }

    #[test]
    fn empty_batches_are_no_ops() {
        let mut app = new_board();
        assert!(app.call(|s| s.add_elements(Vec::new())).unwrap().is_empty());
        app.call(|s| s.delete_elements(Vec::new())).unwrap();
        app.call(|s| s.update_elements(Vec::new(), 1)).unwrap();
        app.call(|s| s.update_element_labels(Vec::new(), 1))
            .unwrap();
        assert!(app.view(|s| s.get_elements()).is_empty());
    }

    // ── what every node enforces ─────────────────────────────────────────────
    //
    // These write straight into the collections, the way a patched node that
    // skips every method check would, and assert that storage still refuses —
    // or, for the canvas, that the capability map every node checks a write
    // against says so.

    use calimero_storage::collections::Op;

    /// The poisoning attack the old `accounts` table allowed: a member claimed
    /// someone else's device key for their own account, so a grant or an
    /// ownership transfer naming that member went to the attacker instead.
    /// Member ids are accounts now, so a grant names exactly who it says.
    #[test]
    fn a_grant_names_exactly_the_account_it_says() {
        let mut app = new_board();
        let bob = AccountId::from(OTHER_ACCOUNT).to_string();
        app.call(|s| s.grant_editor(bob.clone())).unwrap();
        let mallory = AccountId::from([0x66u8; 32]);
        assert!(!app.view(|s| s.elements.can(&mallory, Op::Write)));
        assert!(app.view(|s| s.elements.can(&AccountId::from(OTHER_ACCOUNT), Op::Write)));
    }

    #[test]
    fn canvas_write_rights_follow_the_roles_on_every_node() {
        let mut app = new_board();
        let bob = AccountId::from(OTHER_ACCOUNT);
        let can = |app: &TestHost<MeroDesign>, op| {
            app.view(|s| {
                s.elements.can(&bob, op) && s.comments.can(&bob, op) && s.replies.can(&bob, op)
            })
        };
        assert!(!can(&app, Op::Write), "a viewer holds no canvas capability");

        let bob_id = bob.to_string();
        app.call(|s| s.grant_editor(bob_id.clone())).unwrap();
        assert!(can(&app, Op::Write) && can(&app, Op::Delete));
        assert!(!can(&app, Op::Admin), "an editor cannot rotate the writers");

        app.call(|s| s.revoke_editor(bob_id)).unwrap();
        assert!(
            !can(&app, Op::Write),
            "revoking the role revokes the capability"
        );
    }

    #[test]
    fn a_transfer_moves_canvas_admin_to_the_new_owner() {
        let mut app = new_board();
        let me = app.view(|_| MeroDesign::caller_account());
        assert!(
            app.view(|s| s.elements.can(&me, Op::Admin)),
            "the creator starts with FULL"
        );
        app.call(|s| s.transfer_ownership(AccountId::from(OTHER_ACCOUNT).to_string()))
            .unwrap();
        assert!(app.view(|s| s.elements.can(&AccountId::from(OTHER_ACCOUNT), Op::Admin)));
        assert!(!app.view(|s| s.elements.can(&me, Op::Write)));
    }

    #[test]
    fn created_by_is_the_caller_not_the_client() {
        let mut app = new_board();
        let mut el = sample_element("e1");
        el.created_by = "someone-else".to_owned();
        app.call(|s| s.add_element(el)).unwrap();
        let me = app.view(|_| MeroDesign::caller_id());
        assert_eq!(
            app.view(|s| s.get_element("e1".to_owned()))
                .unwrap()
                .created_by,
            me
        );

        // Overwriting the id keeps the original creator.
        let bob = AccountId::from(OTHER_ACCOUNT).to_string();
        app.call(|s| s.grant_editor(bob)).unwrap();
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| {
            s.add_element(sample_element("e1"))
        })
        .unwrap();
        assert_eq!(
            app.view(|s| s.get_element("e1".to_owned()))
                .unwrap()
                .created_by,
            me
        );
    }

    #[test]
    fn concurrent_replies_to_one_comment_both_survive() {
        let mut app = new_board();
        let bob = AccountId::from(OTHER_ACCOUNT).to_string();
        app.call(|s| s.grant_editor(bob)).unwrap();
        app.call(|s| s.add_comment("c1".to_owned(), 0, 0, "hi".to_owned(), 1))
            .unwrap();
        app.call(|s| s.add_reply("c1".to_owned(), "r1".to_owned(), "one".to_owned(), 5))
            .unwrap();
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| {
            s.add_reply("c1".to_owned(), "r2".to_owned(), "two".to_owned(), 5)
        })
        .unwrap();
        let comments = app.view(|s| s.get_comments());
        let ids: Vec<&str> = comments[0].replies.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids.len(), 2, "each reply is its own entry");
        assert!(ids.contains(&"r1") && ids.contains(&"r2"));

        app.call(|s| s.delete_reply("c1".to_owned(), "r1".to_owned()))
            .unwrap();
        assert_eq!(app.view(|s| s.get_comments())[0].replies.len(), 1);
        app.call(|s| s.delete_comment("c1".to_owned())).unwrap();
        assert!(app.view(|s| s.replies.get().unwrap().is_empty().unwrap()));
    }

    #[test]
    fn nobody_renames_another_member() {
        let mut app = new_board();
        app.call(|s| s.join("alice".to_owned(), None, 1));
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.join("bob".to_owned(), None, 1));
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| {
            s.update_member_username("alice".to_owned(), 9)
        });
        let me = app.view(|_| MeroDesign::caller_id());
        let members = app.view(|s| s.get_members());
        let mine = members.iter().find(|m| m.id == me).unwrap();
        assert_eq!(mine.username_updated_at, 1);
    }

    #[test]
    fn a_cursor_belongs_to_whoever_wrote_it() {
        let mut app = new_board();
        const LAPTOP: [u8; 32] = [0x01; 32];
        app.call_as(LAPTOP, |s| s.update_cursor(1, 1, 1));
        let laptop = String::from(PublicKey::from(LAPTOP));
        let me = app.view(|_| MeroDesign::caller_id());

        let moved = app.call_as_account(OTHER_ACCOUNT, OTHER, |s| {
            s.cursors.update(
                &laptop,
                CursorState {
                    identity: laptop.clone(),
                    account: me.clone(),
                    x: 99,
                    y: 99,
                    updated_at: 2,
                },
            )
        });
        assert!(moved.is_err(), "another account cannot move my pointer");
        let cursors = app.view(|s| s.get_cursors());
        assert_eq!((cursors[0].x, cursors[0].account.clone()), (1, me.clone()));
        // Another account reads the same owner: keys are per owner, so the
        // label comes from the entry's own stamp, not a key-only lookup.
        let seen = app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.get_cursors());
        assert_eq!((seen[0].x, seen[0].account.clone()), (1, me));
    }

    #[test]
    fn send_to_back_with_room_below_moves_only_that_element() {
        let mut app = new_board();
        for (id, index) in [("a", 5), ("b", 6), ("c", 7)] {
            let mut el = sample_element(id);
            el.layer_index = index;
            app.call(|s| s.add_element(el)).unwrap();
        }
        app.call(|s| s.send_to_back("c".to_owned())).unwrap();
        let got: Vec<(String, u32)> = app
            .view(|s| s.get_elements())
            .into_iter()
            .map(|e| (e.id, e.layer_index))
            .collect();
        assert_eq!(
            got,
            [
                ("c".to_owned(), 4),
                ("a".to_owned(), 5),
                ("b".to_owned(), 6)
            ]
        );
        app.call(|s| s.bring_to_front("c".to_owned())).unwrap();
        assert_eq!(
            app.view(|s| s.get_element("c".to_owned()))
                .unwrap()
                .layer_index,
            7
        );
    }
}
