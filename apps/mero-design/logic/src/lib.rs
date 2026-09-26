use std::str::FromStr;

use calimero_sdk::abi::AbiType;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, AccountId, BlobId, PublicKey};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AccessControl, LwwRegister, Mergeable as MergeableTrait, Ownable, UnorderedMap,
};

// ── Types ─────────────────────────────────────────────────────────────────────

type ElementId = String;
type MemberId = String;
type CommentId = String;

/// Named role granted on top of the admin tier. Editors may mutate the canvas;
/// everyone else is read-only ("viewer"). The board creator is the sole initial
/// admin and is implicitly an editor + owner.
const ROLE_EDITOR: &str = "editor";

// ── Element data ──────────────────────────────────────────────────────────────

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "lowercase")]
#[serde(tag = "kind")]
pub enum ElementData {
    Rect,
    Circle,
    /// `points` is "x1,y1 x2,y2" in element-local space. A bounding box cannot
    /// express which way a line was drawn, so a line drawn bottom-left to
    /// top-right came back mirrored. Defaulted so pre-existing elements and older
    /// clients that send a bare `{"kind":"line"}` still deserialize.
    Line {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        points: String,
    },
    Arrow {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        points: String,
    },
    Path {
        points: String,
    },
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
    Image {
        #[serde(rename = "naturalWidth")]
        natural_width: u32,
        #[serde(rename = "naturalHeight")]
        natural_height: u32,
        #[serde(rename = "blobId", default, skip_serializing_if = "String::is_empty")]
        blob_id: String,
    },
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

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub id: ElementId,
    pub data: ElementData,
    pub x: i64,
    pub y: i64,
    pub width: u32,
    pub height: u32,
    pub rotation: i32,
    pub fill: String,
    pub stroke: String,
    pub stroke_width: u32,
    pub opacity: u8,
    pub layer_index: u32,
    pub created_by: MemberId,
    pub created_at: u64,
    pub updated_at: u64,
    pub shadow_color: Option<String>,
    pub shadow_offset_x: Option<i32>,
    pub shadow_offset_y: Option<i32>,
    pub shadow_blur: Option<u32>,
    pub label: Option<String>,
    /// Corner radius in px, clamped by the client to min(width, height) / 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_radius: Option<u32>,
}

// Whole-record LWW by the monotonic `updated_at`; a leaf value with no nested
// collections, so this also emits the required no-op `RekeyTarget`.
calimero_storage::impl_atomic_lww_leaf!(Element, updated_at);

// ── Member ────────────────────────────────────────────────────────────────────

#[app::mergeable(id = "mero_design::Member")]
#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: MemberId,
    pub username: String,
    pub avatar: Option<String>,
    pub joined_at: u64,
    /// Dedicated LWW clock for username/avatar edits. Merging on `joined_at`
    /// (which never changes after the first join) would freeze a member's
    /// username at its first value across nodes; this field is the real
    /// last-writer-wins timestamp for profile edits.
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

#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub name: String,
    pub description: String,
    pub element_count: u32,
    pub member_count: u32,
    pub owner: Option<String>,
}

/// A member paired with their effective role, for the settings/members UI.
///
/// Carries BOTH ids on purpose. `member` is the board's device-scoped id — what
/// elements are authored by, and what `get_members` keys usernames on. `account`
/// is the authorization subject, and it is what `/groups/{id}/members` lists, so
/// it is the only field the settings UI can join its two sources on. Without it
/// the UI has an account id in one hand and a device key in the other, and since
/// rc.27 both are 64 hex — indistinguishable, so the mismatch reads as a missing
/// member rather than a type error.
///
/// `None` means this member has never written to the board, so the pairing is
/// genuinely unknown; a grant cannot name them yet.
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct MemberRole {
    pub member: String,
    pub role: String,
    pub account: Option<String>,
}

// ── Comments ──────────────────────────────────────────────────────────────────

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct CommentReply {
    pub id: String,
    pub content: String,
    pub author: String,
    pub created_at: u64,
}

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: CommentId,
    pub x: i64,
    pub y: i64,
    pub content: String,
    pub author: String,
    pub created_at: u64,
    pub replies: Vec<CommentReply>,
}

// Whole-record LWW by the monotonic `created_at`; a leaf value with no nested
// collections, so this also emits the required no-op `RekeyTarget`.
calimero_storage::impl_atomic_lww_leaf!(Comment, created_at);

// ── Cursor state (ephemeral — last known position per identity) ────────────────

#[derive(AbiType, BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct CursorState {
    pub identity: String,
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
    ElementAdded(String),
    ElementUpdated(String),
    ElementDeleted(String),
    LayerReordered(),
    MemberJoined(String),
    MemberUsernameUpdated(String),
    BoardUpdated(),
    CommentAdded(String),
    CommentUpdated(String),
    CommentDeleted(String),
    CursorMoved(String),
    RoleUpdated(String),
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
    // without seeding it, so nothing upstream exercises seed-at-init. A plain
    // `UnorderedMap`/`LwwRegister` write at init is unaffected — this is specific
    // to the permissioned cell's writer-set guard.
    //
    // So the init values live here, in plain registers that persist normally, and
    // the `Ownable` cells take over from the first owner edit onwards. Written
    // once at init and never again.
    initial_name: LwwRegister<String>,
    initial_description: LwwRegister<String>,
    elements: UnorderedMap<ElementId, Element>,
    members: UnorderedMap<MemberId, Member>,
    comments: UnorderedMap<CommentId, Comment>,
    cursors: UnorderedMap<String, CursorState>,
    // Role registry whose admin tier is a signed writer set. Grants/revokes are
    // admin-gated at merge; the creator is the sole initial admin.
    roles: AccessControl,
    /// member key → the account that device speaks for, self-registered on join
    /// and on every cursor move.
    ///
    /// `AccessControl` and `Ownable` are keyed by `AccountId` since core rc.20
    /// (one person, many devices — the gate is the person), while the ids this
    /// board shows and the frontend passes are device keys. Nothing on the wire
    /// maps one to the other, and a device can only ever assert its OWN pairing
    /// (both halves come from the host), so this is a self-registration rather
    /// than an admin-maintained table.
    accounts: UnorderedMap<MemberId, LwwRegister<AccountId>>,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroDesign {
    #[app::init]
    pub fn init(name: String, description: String) -> MeroDesign {
        // Ownership and the admin tier are ACCOUNT-scoped; the board's member
        // ids stay device-scoped (see `accounts`).
        let me = Self::caller_account();
        // Deliberately NOT seeding the `Ownable` cells here — see `initial_name`.
        // The values would be silently dropped and the board would come up with
        // no name and no description.
        let board_name = Ownable::new_owned_by(me);
        let board_description = Ownable::new_owned_by(me);
        let mut accounts = UnorderedMap::new();
        let _ = accounts.insert(Self::caller_id(), LwwRegister::new(me));
        MeroDesign {
            board_name,
            board_description,
            initial_name: LwwRegister::new(name),
            initial_description: LwwRegister::new(description),
            elements: UnorderedMap::new(),
            members: UnorderedMap::new(),
            comments: UnorderedMap::new(),
            cursors: UnorderedMap::new(),
            roles: AccessControl::new(me),
            accounts,
        }
    }

    // ── Identity & authorization helpers ────────────────────────────────────────

    /// The real signer of this invocation. Never trust a client-supplied id.
    ///
    /// A member id here is a DEVICE key, and stays one: it is what the frontend
    /// reads back from `identities-owned`, and it is what every element in an
    /// already-published document is authored by. Re-keying it would rewrite
    /// stored state for no gain, because authorization does not run through it
    /// — [`Self::caller_account`] does, resolved via `accounts`, so two devices
    /// of one person already share one set of permissions.
    ///
    /// Do NOT reach for `env::executor_id()` to get this. It used to be the
    /// same bytes; at rc.23 that shim resolves to the ACCOUNT (core #3510), so
    /// it now means the opposite of what this function returns.
    fn caller() -> PublicKey {
        sdk_env::device_id().into()
    }

    /// The account this call is authorized as — what `AccessControl` and
    /// `Ownable` gate on. Distinct from [`Self::caller`]: two devices of one
    /// person report the same account and different device keys.
    fn caller_account() -> AccountId {
        AccountId::from(sdk_env::account_id())
    }

    /// A member id belonging to `account`, or the account's own string form when
    /// none is known. Reverse of [`Self::account_of`].
    fn member_of(&self, account: &AccountId) -> String {
        if let Ok(entries) = self.accounts.entries() {
            for (id, known) in entries {
                if known.get() == account {
                    return id;
                }
            }
        }
        account.to_string()
    }

    /// The account a member's device speaks for, if that member has ever
    /// written to this board.
    fn account_of(&self, member: &str) -> Option<AccountId> {
        match self.accounts.get(member) {
            Ok(Some(reg)) => Some(*reg.get()),
            _ => None,
        }
    }

    /// An account this board has already recorded for some member, matched by
    /// its string form. Reverse lookup over `accounts`' VALUES, where
    /// [`Self::account_of`] looks up its keys.
    fn account_if_known(&self, candidate: &str) -> Option<AccountId> {
        let entries = self.accounts.entries().ok()?;
        for (_, known) in entries {
            let account = *known.get();
            if account.to_string() == candidate {
                return Some(account);
            }
        }
        None
    }

    /// Resolve a client-supplied id to the account a grant can name.
    ///
    /// Accepts either id a caller can hold, because since rc.27 they are the
    /// same shape — 64 hex — and nothing about the string says which it is:
    ///
    ///   * a board MEMBER key (device-scoped), resolved through `accounts`;
    ///   * an ACCOUNT id, which is what `/groups/{id}/members` lists and
    ///     therefore what the settings UI has for every row.
    ///
    /// The account form is accepted ONLY when this board already recorded it
    /// for some member. That restraint is the whole point: `AccessControl` will
    /// happily store a grant for 32 arbitrary bytes, and a grant naming an
    /// account no one here speaks for authorizes nobody, silently — it looks
    /// like it worked and the member still cannot edit.
    fn require_account(&self, member: &str) -> app::Result<AccountId> {
        // Validate the shape first, so a typo reads as "invalid key" rather
        // than "hasn't opened the board".
        let _ = Self::parse_pk(member)?;
        if let Some(account) = self.account_of(member) {
            return Ok(account);
        }
        if let Some(account) = self.account_if_known(member) {
            return Ok(account);
        }
        app::bail!(
            "that member hasn't opened this board yet, so their account is unknown — \
             ask them to open it once, then set the role"
        )
    }

    /// Record the caller's device→account pairing. Idempotent: an unchanged
    /// pairing writes nothing, so the hot paths add no CRDT delta.
    fn remember_account(&mut self) {
        let me = Self::caller_id();
        let account = Self::caller_account();
        if matches!(self.accounts.get(&me), Ok(Some(known)) if *known.get() == account) {
            return;
        }
        let _ = self.accounts.insert(me, LwwRegister::new(account));
    }

    /// Base58 string form of the caller — matches the identity the frontend
    /// reads from `/contexts/{id}/identities-owned`.
    fn caller_id() -> String {
        String::from(Self::caller())
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

    fn parse_pk(value: &str) -> app::Result<PublicKey> {
        PublicKey::from_str(value).map_err(|_| app::err!("invalid member public key"))
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
            self.initial_name.get().clone()
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
            self.initial_description.get().clone()
        } else {
            edited
        }
    }

    pub fn get_board(&self) -> BoardInfo {
        BoardInfo {
            name: self.board_name_str(),
            description: self.board_description_str(),
            element_count: self.elements.len().unwrap_or(0) as u32,
            member_count: self.members.len().unwrap_or(0) as u32,
            // The owner is an account; report it as the member id clients
            // already know, falling back to the account's own string when no
            // device of that account has written here yet.
            owner: self.board_name.owner().map(|a| self.member_of(&a)),
        }
    }

    /// Rename / re-describe the board. Owner-only — the rename only converges
    /// from the board owner.
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

    /// Hand the board (and its owner-gated config) to another member. Owner-only.
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
        app::emit!(Event::OwnerTransferred(new_owner));
        Ok(())
    }

    // ── Roles ───────────────────────────────────────────────────────────────────

    /// Grant a member the editor role. Admin-only (enforced at merge).
    pub fn grant_editor(&mut self, member: String) -> app::Result<()> {
        let who = self.require_account(&member)?;
        self.roles.grant(ROLE_EDITOR, who)?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    /// Revoke a member's editor role (downgrade to viewer). Admin-only.
    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        let who = self.require_account(&member)?;
        self.roles.revoke(ROLE_EDITOR, &who)?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    /// Effective role of a member: "admin", "editor", or "viewer".
    pub fn get_role(&self, member: String) -> String {
        // Unknown account = no grant can name them = viewer.
        match self.account_of(&member) {
            Some(account) => self.role_label(&account),
            None => "viewer".to_string(),
        }
    }

    /// Effective role of the caller — convenience for the frontend's edit gate.
    pub fn my_role(&self) -> String {
        self.role_label(&Self::caller_account())
    }

    /// Whether the caller may edit the canvas.
    pub fn can_edit(&self) -> bool {
        self.is_editor(&Self::caller_account())
    }

    /// Every member with their effective role, for the members/settings UI.
    pub fn list_roles(&self) -> Vec<MemberRole> {
        let mut out = Vec::new();
        if let Ok(entries) = self.members.entries() {
            for (id, _) in entries {
                let known = self.account_of(&id);
                let role = match known {
                    Some(account) => self.role_label(&account),
                    None => "viewer".to_string(),
                };
                out.push(MemberRole {
                    member: id,
                    role,
                    account: known.map(|a| a.to_string()),
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

    pub fn join(&mut self, username: String, avatar: Option<String>, timestamp: u64) {
        // Register the pairing even for a repeat join: it is what lets an admin
        // name this member in a grant at all.
        self.remember_account();
        let member_id = Self::caller_id();
        if self.members.contains(&member_id).unwrap_or(false) {
            return;
        }
        let m = Member {
            id: member_id.clone(),
            username,
            avatar,
            joined_at: timestamp,
            username_updated_at: timestamp,
        };
        let _ = self.members.insert(member_id.clone(), m);
        app::emit!(Event::MemberJoined(member_id));
    }

    pub fn get_members(&self) -> Vec<Member> {
        self.members.entries().unwrap().map(|(_, v)| v).collect()
    }

    /// Rename the caller's own member entry. Identity is the real signer, so a
    /// member can only rename themselves — not anyone else.
    pub fn update_member_username(&mut self, username: String, timestamp: u64) {
        let member_id = Self::caller_id();
        if let Ok(Some(mut m)) = self.members.get_mut(&member_id) {
            m.username = username;
            m.username_updated_at = timestamp;
            drop(m);
            app::emit!(Event::MemberUsernameUpdated(member_id));
        }
    }

    // ── Elements ──────────────────────────────────────────────────────────────

    pub fn add_element(&mut self, element: Element) -> app::Result<String> {
        self.require_editor()?;
        let id = self.insert_element(element);
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
        let ids: Vec<String> = elements
            .into_iter()
            .map(|el| self.insert_element(el))
            .collect();
        app::emit!(Event::ElementsAdded(ids.clone()));
        Ok(ids)
    }

    /// Stores one element and announces its blob, if it has one. No event and
    /// no permission check: the public methods own both.
    fn insert_element(&mut self, element: Element) -> String {
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
        let _ = self.elements.insert(id.clone(), element);
        id
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
        if let Some(id) = self.patch_element(patch, updated_at) {
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
        let ids: Vec<String> = patches
            .into_iter()
            .filter_map(|patch| self.patch_element(patch, updated_at))
            .collect();
        if !ids.is_empty() {
            app::emit!(Event::ElementsUpdated(ids));
        }
        Ok(())
    }

    /// Applies one patch. Returns the id when the element exists.
    fn patch_element(&mut self, patch: ElementPatch, updated_at: u64) -> Option<String> {
        let Ok(Some(mut el)) = self.elements.get_mut(&patch.id) else {
            return None;
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
        // None means "leave alone"; 0 means "square corners".
        if let Some(v) = patch.corner_radius {
            el.corner_radius = Some(v);
        }
        el.updated_at = updated_at;
        drop(el);
        Some(patch.id)
    }

    pub fn update_element_label(
        &mut self,
        id: String,
        label: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if self.set_label(&id, label, updated_at) {
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
        let ids: Vec<String> = labels
            .into_iter()
            .filter(|u| self.set_label(&u.id, u.label.clone(), updated_at))
            .map(|u| u.id)
            .collect();
        if !ids.is_empty() {
            app::emit!(Event::ElementsUpdated(ids));
        }
        Ok(())
    }

    fn set_label(&mut self, id: &str, label: Option<String>, updated_at: u64) -> bool {
        let Ok(Some(mut el)) = self.elements.get_mut(id) else {
            return false;
        };
        el.label = label;
        el.updated_at = updated_at;
        true
    }

    // Clippy's 7-argument limit, allowed rather than refactored: this is a
    // partial-update method on the CONTRACT's public API, so every parameter is
    // an `Option<T>` field a caller may or may not be changing. Collapsing them
    // into a struct would change the ABI — and therefore the generated client
    // and the published contract — which a migration must not do.
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
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
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
            drop(el);
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

    pub fn clear_elements(&mut self) -> app::Result<()> {
        self.require_admin()?;
        let ids: Vec<String> = self
            .elements
            .entries()
            .map(|iter| iter.map(|(k, _)| k).collect())
            .unwrap_or_default();
        for id in ids {
            let _ = self.elements.remove(&id);
        }
        app::emit!(Event::LayerReordered());
        Ok(())
    }

    pub fn clear_comments(&mut self) -> app::Result<()> {
        self.require_admin()?;
        let ids: Vec<String> = self
            .comments
            .entries()
            .map(|iter| iter.map(|(k, _)| k).collect())
            .unwrap_or_default();
        for id in ids {
            let _ = self.comments.remove(&id);
        }
        Ok(())
    }

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
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
            el.shadow_color = shadow_color;
            el.shadow_offset_x = shadow_offset_x;
            el.shadow_offset_y = shadow_offset_y;
            el.shadow_blur = shadow_blur;
            el.updated_at = updated_at;
            drop(el);
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

    pub fn delete_element(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let _ = self.elements.remove(&id);
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
        for id in &ids {
            let _ = self.elements.remove(id);
        }
        app::emit!(Event::ElementsDeleted(ids));
        Ok(())
    }

    pub fn get_elements(&self) -> Vec<Element> {
        let mut els: Vec<Element> = self.elements.entries().unwrap().map(|(_, v)| v).collect();
        els.sort_by_key(|e| e.layer_index);
        els
    }

    pub fn get_element(&self, id: String) -> Option<Element> {
        self.elements.get(&id).ok().flatten().map(|v| v.clone())
    }

    /// The elements a batch event named, in one read instead of one
    /// `get_element` each. Ids that no longer exist are left out.
    pub fn get_elements_by_ids(&self, ids: Vec<String>) -> Vec<Element> {
        ids.iter()
            .filter_map(|id| self.elements.get(id).ok().flatten().map(|v| v.clone()))
            .collect()
    }

    // ── Layer order ───────────────────────────────────────────────────────────

    /// Moves one element to an explicit position in the layer order and renumbers
    /// the rest densely, so "up one" and "down one" survive a sync.
    /// `bring_to_front` / `send_to_back` remain the all-the-way jumps.
    pub fn set_layer_index(&mut self, id: String, index: u32, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;

        let mut order: Vec<(String, u32)> = self
            .elements
            .entries()
            .unwrap()
            .map(|(k, v)| (k, v.layer_index))
            .collect();
        if !order.iter().any(|(k, _)| *k == id) {
            return Ok(());
        }
        order.sort_by_key(|(_, layer)| *layer);

        let ids: Vec<String> = order.into_iter().map(|(k, _)| k).collect();
        let from = ids.iter().position(|k| *k == id).unwrap();
        let to = (index as usize).min(ids.len().saturating_sub(1));

        let mut next = ids;
        let moved = next.remove(from);
        next.insert(to, moved);

        for (i, key) in next.iter().enumerate() {
            if let Ok(Some(mut el)) = self.elements.get_mut(key) {
                el.layer_index = i as u32;
                if *key == id {
                    el.updated_at = updated_at;
                }
            }
        }
        app::emit!(Event::LayerReordered());
        Ok(())
    }

    pub fn bring_to_front(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let max_layer = self
            .elements
            .entries()
            .unwrap()
            .map(|(_, v)| v.layer_index)
            .max()
            .unwrap_or(0);
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
            el.layer_index = max_layer + 1;
        }
        app::emit!(Event::LayerReordered());
        Ok(())
    }

    pub fn send_to_back(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let other_ids: Vec<String> = self
            .elements
            .entries()
            .unwrap()
            .filter(|(k, _)| *k != id)
            .map(|(k, _)| k)
            .collect();
        for other_id in &other_ids {
            if let Ok(Some(mut other)) = self.elements.get_mut(other_id) {
                other.layer_index = other.layer_index.saturating_add(1);
            }
        }
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
            el.layer_index = 0;
        }
        app::emit!(Event::LayerReordered());
        Ok(())
    }

    // ── Comments ──────────────────────────────────────────────────────────────

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
        let _ = self.comments.insert(id.clone(), c);
        app::emit!(Event::CommentAdded(id));
        Ok(())
    }

    pub fn add_reply(
        &mut self,
        comment_id: String,
        reply_id: String,
        content: String,
        created_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        let author = Self::caller_id();
        if let Ok(Some(mut c)) = self.comments.get_mut(&comment_id) {
            c.replies.push(CommentReply {
                id: reply_id,
                content,
                author,
                created_at,
            });
            drop(c);
            app::emit!(Event::CommentUpdated(comment_id));
        }
        Ok(())
    }

    pub fn delete_reply(&mut self, comment_id: String, reply_id: String) -> app::Result<()> {
        self.require_editor()?;
        if let Ok(Some(mut c)) = self.comments.get_mut(&comment_id) {
            c.replies.retain(|r| r.id != reply_id);
            drop(c);
            app::emit!(Event::CommentUpdated(comment_id));
        }
        Ok(())
    }

    pub fn delete_comment(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let _ = self.comments.remove(&id);
        app::emit!(Event::CommentDeleted(id));
        Ok(())
    }

    pub fn get_comments(&self) -> Vec<Comment> {
        self.comments.entries().unwrap().map(|(_, v)| v).collect()
    }

    // ── Cursor tracking ───────────────────────────────────────────────────────

    /// Broadcast the caller's cursor. Presence is open to all members
    /// (including viewers); the identity is the real signer, not client-supplied.
    pub fn update_cursor(&mut self, x: i64, y: i64, updated_at: u64) {
        // Every client moves its cursor, so this is where a member's
        // device→account pairing reliably becomes known to the rest of the board.
        self.remember_account();
        let identity = Self::caller_id();
        let cs = CursorState {
            identity: identity.clone(),
            x,
            y,
            updated_at,
        };
        let _ = self.cursors.insert(identity.clone(), cs);
        app::emit!(Event::CursorMoved(identity));
    }

    pub fn get_cursors(&self) -> Vec<CursorState> {
        self.cursors.entries().unwrap().map(|(_, v)| v).collect()
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
        let bob = String::from(PublicKey::from(OTHER));
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

    #[test]
    fn a_role_can_be_granted_by_account_id_not_just_member_key() {
        // The settings UI lists namespace members from `/groups/{id}/members`,
        // and those rows are ACCOUNT-keyed — it never sees a device key. Since
        // rc.27 both ids are 64 hex, so passing the account here parsed fine and
        // then missed the `accounts` lookup, failing as "hasn't opened this
        // board yet" for a member who was demonstrably sitting on it.
        let mut app = new_board();
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.join("bob".to_owned(), None, 1));

        let bob_account = AccountId::from(OTHER_ACCOUNT).to_string();
        let bob_member = String::from(PublicKey::from(OTHER));
        assert_ne!(bob_account, bob_member, "the two ids must not be the same");

        app.call(|s| s.grant_editor(bob_account.clone())).unwrap();
        // Granting by account authorizes the same person the member key names.
        assert_eq!(app.view(|s| s.get_role(bob_member.clone())), "editor");
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| {
            s.add_element(sample_element("e1"))
        })
        .unwrap();

        // And revoking by the same account id undoes it.
        app.call(|s| s.revoke_editor(bob_account)).unwrap();
        assert_eq!(app.view(|s| s.get_role(bob_member)), "viewer");
    }

    #[test]
    fn list_roles_carries_both_ids_so_the_ui_can_join_its_two_sources() {
        let mut app = new_board();
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.join("bob".to_owned(), None, 1));

        let roles = app.view(|s| s.list_roles());
        let bob = roles
            .iter()
            .find(|r| r.member == String::from(PublicKey::from(OTHER)))
            .expect("bob is on the board");
        assert_eq!(
            bob.account.as_deref(),
            Some(AccountId::from(OTHER_ACCOUNT).to_string().as_str()),
            "without the account the settings UI cannot match this row to a \
             namespace member, and falls back to showing a raw id"
        );
    }

    #[test]
    fn an_account_this_board_never_saw_is_still_refused() {
        // The restraint that makes accepting an account id safe: AccessControl
        // stores a grant for arbitrary bytes quite happily, and one naming an
        // account nobody here speaks for authorizes no one, silently.
        let mut app = new_board();
        let stranger = AccountId::from([0x5Au8; 32]).to_string();
        assert!(app.call(|s| s.grant_editor(stranger)).is_err());
    }

    #[test]
    fn non_admin_cannot_grant_roles() {
        let mut app = new_board();
        let third = String::from(PublicKey::from([0x33u8; 32]));
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
        let other = String::from(PublicKey::from(OTHER));
        // The board must know which account that member key speaks for before it
        // can hand ownership over — joining is what records the pairing.
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
}
