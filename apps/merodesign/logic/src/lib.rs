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
        if other.username_updated_at > self.username_updated_at {
            self.username = other.username.clone();
            self.avatar = other.avatar.clone();
            self.username_updated_at = other.username_updated_at;
        }
        Ok(())
    }
}

// `Member` uses a custom selective (not whole-record) merge, so it can't use
// `impl_atomic_lww_leaf!`. It is still a leaf value with no nested collections,
// so `RekeyTarget` (the new `Mergeable` supertrait) is a no-op.
impl calimero_storage::collections::rekey::RekeyTarget for Member {
    fn rekey_relative_to(&mut self, _parent_id: calimero_storage::address::Id) {}
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
#[derive(AbiType, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct MemberRole {
    pub member: String,
    pub role: String,
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

    /// Resolve a client-supplied member key to the account a grant can name.
    fn require_account(&self, member: &str) -> app::Result<AccountId> {
        // Validate the key shape first, so a typo reads as "invalid key" rather
        // than "hasn't opened the board".
        let _ = Self::parse_pk(member)?;
        match self.account_of(member) {
            Some(account) => Ok(account),
            None => app::bail!(
                "that member hasn't opened this board yet, so their account is unknown — \
                 ask them to open it once, then set the role"
            ),
        }
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
                let role = match self.account_of(&id) {
                    Some(account) => self.role_label(&account),
                    None => "viewer".to_string(),
                };
                out.push(MemberRole { member: id, role });
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
        app::emit!(Event::ElementAdded(id.clone()));
        Ok(id)
    }

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
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
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
            drop(el);
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

    pub fn update_element_label(
        &mut self,
        id: String,
        label: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
            el.label = label;
            el.updated_at = updated_at;
            drop(el);
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

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

    pub fn get_elements(&self) -> Vec<Element> {
        let mut els: Vec<Element> = self.elements.entries().unwrap().map(|(_, v)| v).collect();
        els.sort_by_key(|e| e.layer_index);
        els
    }

    pub fn get_element(&self, id: String) -> Option<Element> {
        self.elements.get(&id).ok().flatten().map(|v| v.clone())
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
}
