use std::str::FromStr;

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, BlobId, PublicKey};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AccessControl, LwwRegister, Mergeable as MergeableTrait, Ownable, UnorderedMap,
};

// ── Types ─────────────────────────────────────────────────────────────────────

type ElementId  = String;
type MemberId   = String;
type CommentId  = String;

/// Named role granted on top of the admin tier. Editors may mutate the canvas;
/// everyone else is read-only ("viewer"). The board creator is the sole initial
/// admin and is implicitly an editor + owner.
const ROLE_EDITOR: &str = "editor";

// ── Element data ──────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "lowercase")]
#[serde(tag = "kind")]
pub enum ElementData {
    Rect,
    Circle,
    Line,
    Arrow,
    Path { points: String },
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

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub id:             ElementId,
    pub data:           ElementData,
    pub x:              i64,
    pub y:              i64,
    pub width:          u32,
    pub height:         u32,
    pub rotation:       i32,
    pub fill:           String,
    pub stroke:         String,
    pub stroke_width:   u32,
    pub opacity:        u8,
    pub layer_index:    u32,
    pub created_by:     MemberId,
    pub created_at:     u64,
    pub updated_at:     u64,
    pub shadow_color:   Option<String>,
    pub shadow_offset_x: Option<i32>,
    pub shadow_offset_y: Option<i32>,
    pub shadow_blur:    Option<u32>,
    pub label:          Option<String>,
}

impl MergeableTrait for Element {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.updated_at > self.updated_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Member ────────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id:                 MemberId,
    pub username:           String,
    pub avatar:             Option<String>,
    pub joined_at:          u64,
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
            self.username            = other.username.clone();
            self.avatar              = other.avatar.clone();
            self.username_updated_at = other.username_updated_at;
        }
        Ok(())
    }
}

// ── Board info ────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub name:          String,
    pub description:   String,
    pub element_count: u32,
    pub member_count:  u32,
    pub owner:         Option<String>,
}

/// A member paired with their effective role, for the settings/members UI.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct MemberRole {
    pub member: String,
    pub role:   String,
}

// ── Comments ──────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct CommentReply {
    pub id:         String,
    pub content:    String,
    pub author:     String,
    pub created_at: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id:         CommentId,
    pub x:          i64,
    pub y:          i64,
    pub content:    String,
    pub author:     String,
    pub created_at: u64,
    pub replies:    Vec<CommentReply>,
}

impl MergeableTrait for Comment {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.created_at > self.created_at { *self = other.clone(); }
        Ok(())
    }
}

// ── Cursor state (ephemeral — last known position per identity) ────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct CursorState {
    pub identity:   String,
    pub x:          i64,
    pub y:          i64,
    pub updated_at: u64,
}

impl MergeableTrait for CursorState {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.updated_at > self.updated_at { *self = other.clone(); }
        Ok(())
    }
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
}

// ── App state ─────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroDesign {
    // Board metadata lives inside `Ownable` so a rename only converges from the
    // owner — a forged board-name delta from a non-owner is rejected at merge,
    // not merely by the fail-fast API guard.
    board_name:        Ownable<LwwRegister<String>>,
    board_description: Ownable<LwwRegister<String>>,
    elements:          UnorderedMap<ElementId, Element>,
    members:           UnorderedMap<MemberId, Member>,
    comments:          UnorderedMap<CommentId, Comment>,
    cursors:           UnorderedMap<String, CursorState>,
    // Role registry whose admin tier is a signed writer set. Grants/revokes are
    // admin-gated at merge; the creator is the sole initial admin.
    roles:             AccessControl,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroDesign {
    #[app::init]
    pub fn init(name: String, description: String) -> MeroDesign {
        let me = Self::caller();
        let mut board_name = Ownable::new_owned_by(me);
        let _ = board_name.insert(LwwRegister::new(name));
        let mut board_description = Ownable::new_owned_by(me);
        let _ = board_description.insert(LwwRegister::new(description));
        MeroDesign {
            board_name,
            board_description,
            elements:          UnorderedMap::new(),
            members:           UnorderedMap::new(),
            comments:          UnorderedMap::new(),
            cursors:           UnorderedMap::new(),
            roles:             AccessControl::new(me),
        }
    }

    // ── Identity & authorization helpers ────────────────────────────────────────

    /// The real signer of this invocation. Never trust a client-supplied id.
    fn caller() -> PublicKey {
        sdk_env::executor_id().into()
    }

    /// Base58 string form of the caller — matches the identity the frontend
    /// reads from `/contexts/{id}/identities-owned`.
    fn caller_id() -> String {
        String::from(Self::caller())
    }

    /// True if `who` may mutate the canvas (admin or explicit editor).
    fn is_editor(&self, who: &PublicKey) -> bool {
        self.roles.is_admin(who) || self.roles.has_role(ROLE_EDITOR, who).unwrap_or(false)
    }

    /// Gate a canvas mutation. Viewers (no admin/editor role) are read-only.
    fn require_editor(&self) -> app::Result<()> {
        if self.is_editor(&Self::caller()) {
            return Ok(());
        }
        app::bail!("view-only: editor or admin access is required to modify this board");
    }

    /// Gate a board-level / destructive operation on admin.
    fn require_admin(&self) -> app::Result<()> {
        if self.roles.is_admin(&Self::caller()) {
            return Ok(());
        }
        app::bail!("admin access is required for this operation");
    }

    fn parse_pk(value: &str) -> app::Result<PublicKey> {
        PublicKey::from_str(value).map_err(|_| app::err!("invalid member public key"))
    }

    // ── Board ─────────────────────────────────────────────────────────────────

    pub fn get_board(&self) -> BoardInfo {
        BoardInfo {
            name:          self.board_name.get().map(|r| r.get().clone()).unwrap_or_default(),
            description:   self.board_description.get().map(|r| r.get().clone()).unwrap_or_default(),
            element_count: self.elements.len().unwrap_or(0) as u32,
            member_count:  self.members.len().unwrap_or(0) as u32,
            owner:         self.board_name.owner().map(String::from),
        }
    }

    /// Rename / re-describe the board. Owner-only — the rename only converges
    /// from the board owner.
    pub fn update_board(&mut self, name: Option<String>, description: Option<String>) -> app::Result<()> {
        self.board_name.only_owner()?;
        if let Some(n) = name        { self.board_name.insert(LwwRegister::new(n))?; }
        if let Some(d) = description { self.board_description.insert(LwwRegister::new(d))?; }
        app::emit!(Event::BoardUpdated());
        Ok(())
    }

    /// Hand the board (and its owner-gated config) to another member. Owner-only.
    pub fn transfer_ownership(&mut self, new_owner: String) -> app::Result<()> {
        let owner = Self::parse_pk(&new_owner)?;
        // Only the current owner can pass the `Ownable` transfer guards below,
        // so the caller IS the previous owner.
        let previous = Self::caller();
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
        let who = Self::parse_pk(&member)?;
        self.roles.grant(ROLE_EDITOR, who)?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    /// Revoke a member's editor role (downgrade to viewer). Admin-only.
    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        let who = Self::parse_pk(&member)?;
        self.roles.revoke(ROLE_EDITOR, &who)?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    /// Effective role of a member: "admin", "editor", or "viewer".
    pub fn get_role(&self, member: String) -> String {
        match Self::parse_pk(&member) {
            Ok(pk) => self.role_label(&pk),
            Err(_) => "viewer".to_string(),
        }
    }

    /// Effective role of the caller — convenience for the frontend's edit gate.
    pub fn my_role(&self) -> String {
        self.role_label(&Self::caller())
    }

    /// Whether the caller may edit the canvas.
    pub fn can_edit(&self) -> bool {
        self.is_editor(&Self::caller())
    }

    /// Every member with their effective role, for the members/settings UI.
    pub fn list_roles(&self) -> Vec<MemberRole> {
        let mut out = Vec::new();
        if let Ok(entries) = self.members.entries() {
            for (id, _) in entries {
                let role = match Self::parse_pk(&id) {
                    Ok(pk) => self.role_label(&pk),
                    Err(_) => "viewer".to_string(),
                };
                out.push(MemberRole { member: id, role });
            }
        }
        out
    }

    fn role_label(&self, who: &PublicKey) -> String {
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
        let member_id = Self::caller_id();
        if self.members.contains(&member_id).unwrap_or(false) { return; }
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
            m.username            = username;
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
            ElementData::Image { blob_id, .. } | ElementData::Svg { blob_id, .. } => blob_id.as_str(),
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
        x: Option<i64>, y: Option<i64>,
        width: Option<u32>, height: Option<u32>,
        rotation: Option<i32>,
        fill: Option<String>, stroke: Option<String>,
        stroke_width: Option<u32>, opacity: Option<u8>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
            if let Some(v) = x            { el.x            = v; }
            if let Some(v) = y            { el.y            = v; }
            if let Some(v) = width        { el.width        = v; }
            if let Some(v) = height       { el.height       = v; }
            if let Some(v) = rotation     { el.rotation     = v; }
            if let Some(v) = fill         { el.fill         = v; }
            if let Some(v) = stroke       { el.stroke       = v; }
            if let Some(v) = stroke_width { el.stroke_width = v; }
            if let Some(v) = opacity      { el.opacity      = v; }
            el.updated_at = updated_at;
            drop(el);
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

    pub fn update_element_label(&mut self, id: String, label: Option<String>, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
            el.label      = label;
            el.updated_at = updated_at;
            drop(el);
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

    pub fn update_text_style(
        &mut self,
        id: String,
        content: Option<String>, font_family: Option<String>,
        font_size: Option<u32>, bold: Option<bool>, italic: Option<bool>,
        text_align: Option<String>, vertical_align: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
            if let ElementData::Text {
                content: ref mut c, font_family: ref mut ff,
                font_size: ref mut fs, bold: ref mut b, italic: ref mut i,
                text_align: ref mut ta, vertical_align: ref mut va,
            } = el.data {
                if let Some(v) = content        { *c  = v; }
                if let Some(v) = font_family    { *ff = v; }
                if let Some(v) = font_size      { *fs = v; }
                if let Some(v) = bold           { *b  = v; }
                if let Some(v) = italic         { *i  = v; }
                if let Some(v) = text_align     { *ta = Some(v); }
                if let Some(v) = vertical_align { *va = Some(v); }
            }
            el.updated_at = updated_at;
            drop(el);
            app::emit!(Event::ElementUpdated(id));
        }
        Ok(())
    }

    pub fn clear_elements(&mut self) -> app::Result<()> {
        self.require_admin()?;
        let ids: Vec<String> = self.elements.entries()
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
        let ids: Vec<String> = self.comments.entries()
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
        shadow_color: Option<String>, shadow_offset_x: Option<i32>,
        shadow_offset_y: Option<i32>, shadow_blur: Option<u32>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
            el.shadow_color    = shadow_color;
            el.shadow_offset_x = shadow_offset_x;
            el.shadow_offset_y = shadow_offset_y;
            el.shadow_blur     = shadow_blur;
            el.updated_at      = updated_at;
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

    pub fn bring_to_front(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let max_layer = self.elements.entries().unwrap().map(|(_, v)| v.layer_index).max().unwrap_or(0);
        if let Ok(Some(mut el)) = self.elements.get_mut(&id) {
            el.layer_index = max_layer + 1;
        }
        app::emit!(Event::LayerReordered());
        Ok(())
    }

    pub fn send_to_back(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        let other_ids: Vec<String> = self.elements.entries().unwrap()
            .filter(|(k, _)| *k != id).map(|(k, _)| k).collect();
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

    pub fn add_comment(&mut self, id: String, x: i64, y: i64, content: String, author: String, created_at: u64) -> app::Result<()> {
        self.require_editor()?;
        let c = Comment { id: id.clone(), x, y, content, author, created_at, replies: vec![] };
        let _ = self.comments.insert(id.clone(), c);
        app::emit!(Event::CommentAdded(id));
        Ok(())
    }

    pub fn add_reply(&mut self, comment_id: String, reply_id: String, content: String, author: String, created_at: u64) -> app::Result<()> {
        self.require_editor()?;
        if let Ok(Some(mut c)) = self.comments.get_mut(&comment_id) {
            c.replies.push(CommentReply { id: reply_id, content, author, created_at });
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
        let identity = Self::caller_id();
        let cs = CursorState { identity: identity.clone(), x, y, updated_at };
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

    fn new_board() -> TestHost<MeroDesign> {
        TestHost::new(|| MeroDesign::init("Board".to_owned(), "desc".to_owned()))
    }

    fn sample_element(id: &str) -> Element {
        Element {
            id: id.to_owned(),
            data: ElementData::Rect,
            x: 0, y: 0, width: 10, height: 10, rotation: 0,
            fill: "#fff".to_owned(), stroke: "#000".to_owned(),
            stroke_width: 1, opacity: 100, layer_index: 0,
            created_by: "creator".to_owned(), created_at: 1, updated_at: 1,
            shadow_color: None, shadow_offset_x: None, shadow_offset_y: None,
            shadow_blur: None, label: None,
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
        // A second identity joins; with no grant it is a viewer and is refused.
        app.call_as(OTHER, |s| s.join("bob".to_owned(), None, 1));
        assert!(app.call_as(OTHER, |s| s.add_element(sample_element("e1"))).is_err());
        assert_eq!(app.view(|s| s.get_elements()).len(), 0);

        // Admin grants editor → now the same identity may add elements.
        let bob = String::from(PublicKey::from(OTHER));
        app.call(|s| s.grant_editor(bob.clone())).unwrap();
        assert_eq!(app.view(|s| s.get_role(bob.clone())), "editor");
        app.call_as(OTHER, |s| s.add_element(sample_element("e1"))).unwrap();
        assert_eq!(app.view(|s| s.get_elements()).len(), 1);

        // Revoke → back to viewer, refused again.
        app.call(|s| s.revoke_editor(bob.clone())).unwrap();
        assert!(app.call_as(OTHER, |s| s.delete_element("e1".to_owned())).is_err());
    }

    #[test]
    fn non_admin_cannot_grant_roles() {
        let mut app = new_board();
        let third = String::from(PublicKey::from([0x33u8; 32]));
        // OTHER is not an admin → the fail-fast guard refuses (and a forged
        // grant delta would be rejected at merge).
        assert!(app.call_as(OTHER, |s| s.grant_editor(third)).is_err());
    }

    #[test]
    fn only_owner_renames_board() {
        let mut app = new_board();
        app.call(|s| s.update_board(Some("Renamed".to_owned()), None)).unwrap();
        assert_eq!(app.view(|s| s.get_board()).name, "Renamed");
        // A non-owner rename is refused.
        assert!(app.call_as(OTHER, |s| s.update_board(Some("Hijacked".to_owned()), None)).is_err());
        assert_eq!(app.view(|s| s.get_board()).name, "Renamed");
    }

    #[test]
    fn username_merge_uses_dedicated_clock() {
        // Two divergent copies of the same member; the one with the newer
        // username_updated_at wins regardless of joined_at.
        let mut a = Member {
            id: "m".to_owned(), username: "old".to_owned(), avatar: None,
            joined_at: 100, username_updated_at: 100,
        };
        let b = Member {
            id: "m".to_owned(), username: "new".to_owned(), avatar: None,
            joined_at: 100, username_updated_at: 200,
        };
        a.merge(&b).unwrap();
        assert_eq!(a.username, "new");
    }

    #[test]
    fn ownership_transfer_moves_control() {
        let mut app = new_board();
        let other = String::from(PublicKey::from(OTHER));
        app.call(|s| s.transfer_ownership(other.clone())).unwrap();
        assert_eq!(app.view(|s| s.get_board()).owner, Some(other.clone()));
        // The new owner can rename; the old owner can no longer.
        app.call_as(OTHER, |s| s.update_board(Some("Owned".to_owned()), None)).unwrap();
        assert_eq!(app.view(|s| s.get_board()).name, "Owned");
        assert!(app.call(|s| s.update_board(Some("nope".to_owned()), None)).is_err());
        // The new owner is admin; the former owner relinquished admin entirely.
        assert_eq!(app.view(|s| s.get_role(other)), "admin");
        assert_eq!(app.view(|s| s.my_role()), "viewer");
        assert!(!app.view(|s| s.can_edit()));
    }
}
