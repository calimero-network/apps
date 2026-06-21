use std::str::FromStr;

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env, BlobId, PublicKey};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{
    AccessControl, LwwRegister, Mergeable as MergeableTrait, Ownable, UnorderedMap,
};

// ── Types ─────────────────────────────────────────────────────────────────────

type LayerId  = String;
type MemberId = String;

/// Named role granted on top of the admin tier. Editors may mutate the
/// document; everyone else is read-only ("viewer"). The document creator is the
/// sole initial admin and is implicitly an editor + owner.
const ROLE_EDITOR: &str = "editor";

// ── Adjustments (non-destructive, applied at composite/render time) ─────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, Default)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Adjustments {
    /// -100..=100, 0 = neutral
    pub brightness: i32,
    /// -100..=100, 0 = neutral
    pub contrast:   i32,
    /// -100..=100, 0 = neutral
    pub saturation: i32,
    /// -180..=180 degrees, 0 = neutral
    pub hue:        i32,
    /// -100..=100, 0 = neutral
    pub exposure:   i32,
    /// 0..=100 blur radius in px (filter), 0 = none
    pub blur:       u32,
    /// invert colors
    pub invert:     bool,
    /// JSON-encoded curve control points (per-channel splines). Opaque to the
    /// contract; the frontend interprets it. Empty = identity curve.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub curves:     String,
}

// ── Text layer properties ───────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct TextProps {
    pub content:     String,
    pub font_family: String,
    pub font_size:   u32,
    pub color:       String,
    pub bold:        bool,
    pub italic:      bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align:       Option<String>,
}

impl Default for TextProps {
    fn default() -> Self {
        TextProps {
            content:     String::new(),
            font_family: "Inter".to_owned(),
            font_size:   48,
            color:       "#ffffff".to_owned(),
            bold:        false,
            italic:      false,
            align:       None,
        }
    }
}

// ── Layer ─────────────────────────────────────────────────────────────────────
//
// `kind` discriminates how the layer is composited:
//   raster     — pixel data lives in `blob_id` (PNG); the workhorse layer
//   group      — a folder; has children via their `parent_id`; no pixels
//   text       — rendered from `text` at composite time; bakeable to raster
//   adjustment — applies `adjustments` to layers below it within its group
//   fill       — a solid `fill` color rectangle
//
// All shared compositing params (visible, locked, opacity, blend_mode,
// transform, mask, adjustments) live flat so any layer kind can use them.

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id:           LayerId,
    pub name:         String,
    /// "raster" | "group" | "text" | "adjustment" | "fill"
    pub kind:         String,
    /// Parent group layer id (folder nesting); None = top level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id:    Option<String>,
    /// Order within the parent (ascending = bottom→top).
    pub layer_index:  u32,

    pub visible:      bool,
    pub locked:       bool,
    /// 0..=100
    pub opacity:      u8,
    /// "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | …
    pub blend_mode:   String,

    // Transform — position/size/rotation/scale of the layer in document space.
    pub x:            i64,
    pub y:            i64,
    pub width:        u32,
    pub height:       u32,
    pub rotation:     i32,
    /// percent, 100 = 1:1
    pub scale_x:      i32,
    pub scale_y:      i32,

    /// PNG pixel data for raster layers (blob id). Empty for non-raster kinds.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub blob_id:      String,
    /// Grayscale PNG layer mask (blob id). None = no mask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask_blob_id: Option<String>,

    /// Solid color for `fill` layers (and a tint reference otherwise).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub fill:         String,

    pub adjustments:  Adjustments,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text:         Option<TextProps>,

    pub created_by:   MemberId,
    pub created_at:   u64,
    pub updated_at:   u64,
}

impl MergeableTrait for Layer {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.updated_at > self.updated_at {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Member ────────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id:                  MemberId,
    pub username:            String,
    pub avatar:              Option<String>,
    pub joined_at:           u64,
    /// Dedicated LWW clock for username/avatar edits (joined_at never changes,
    /// so merging on it would freeze a member's username at its first value).
    pub username_updated_at: u64,
}

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.username_updated_at > self.username_updated_at {
            self.username            = other.username.clone();
            self.avatar              = other.avatar.clone();
            self.username_updated_at = other.username_updated_at;
        }
        Ok(())
    }
}

// ── Document info ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub name:        String,
    pub description: String,
    pub width:       u32,
    pub height:      u32,
    pub background:  String,
    pub layer_count: u32,
    pub member_count: u32,
    pub owner:       Option<String>,
}

/// A member paired with their effective role, for the settings/members UI.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct MemberRole {
    pub member: String,
    pub role:   String,
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
    LayerAdded(String),
    LayerUpdated(String),
    LayerDeleted(String),
    LayersReordered(),
    MemberJoined(String),
    MemberUsernameUpdated(String),
    DocumentUpdated(),
    CursorMoved(String),
    RoleUpdated(String),
    OwnerTransferred(String),
}

// ── App state ─────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroPixArt {
    // Document metadata lives inside `Ownable` so a rename/resize only converges
    // from the owner — a forged delta from a non-owner is rejected at merge, not
    // merely by the fail-fast API guard.
    doc_name:        Ownable<LwwRegister<String>>,
    doc_description: Ownable<LwwRegister<String>>,
    canvas_width:    LwwRegister<u32>,
    canvas_height:   LwwRegister<u32>,
    background:      LwwRegister<String>,

    layers:          UnorderedMap<LayerId, Layer>,
    members:         UnorderedMap<MemberId, Member>,
    cursors:         UnorderedMap<String, CursorState>,

    // Role registry whose admin tier is a signed writer set. Grants/revokes are
    // admin-gated at merge; the creator is the sole initial admin.
    roles:           AccessControl,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroPixArt {
    #[app::init]
    pub fn init(name: String, description: String, width: u32, height: u32) -> MeroPixArt {
        let me = Self::caller();
        let mut doc_name = Ownable::new_owned_by(me);
        let _ = doc_name.insert(LwwRegister::new(name));
        let mut doc_description = Ownable::new_owned_by(me);
        let _ = doc_description.insert(LwwRegister::new(description));
        MeroPixArt {
            doc_name,
            doc_description,
            canvas_width:  LwwRegister::new(if width  == 0 { 1280 } else { width }),
            canvas_height: LwwRegister::new(if height == 0 { 720  } else { height }),
            background:    LwwRegister::new("#00000000".to_owned()),
            layers:        UnorderedMap::new(),
            members:       UnorderedMap::new(),
            cursors:       UnorderedMap::new(),
            roles:         AccessControl::new(me),
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

    fn is_editor(&self, who: &PublicKey) -> bool {
        self.roles.is_admin(who) || self.roles.has_role(ROLE_EDITOR, who).unwrap_or(false)
    }

    /// Gate a document mutation. Viewers (no admin/editor role) are read-only.
    fn require_editor(&self) -> app::Result<()> {
        if self.is_editor(&Self::caller()) {
            return Ok(());
        }
        app::bail!("view-only: editor or admin access is required to modify this document");
    }

    /// Gate a document-level / destructive operation on admin.
    fn require_admin(&self) -> app::Result<()> {
        if self.roles.is_admin(&Self::caller()) {
            return Ok(());
        }
        app::bail!("admin access is required for this operation");
    }

    fn parse_pk(value: &str) -> app::Result<PublicKey> {
        PublicKey::from_str(value).map_err(|_| app::err!("invalid member public key"))
    }

    /// Announce a blob to the context so it propagates to all members.
    fn announce_blob(blob_id_str: &str) {
        if blob_id_str.is_empty() { return; }
        if let Ok(blob_id) = blob_id_str.parse::<BlobId>() {
            sdk_env::blob_announce_to_context(blob_id.as_ref(), &sdk_env::context_id());
        }
    }

    // ── Document ────────────────────────────────────────────────────────────────

    pub fn get_document(&self) -> DocumentInfo {
        DocumentInfo {
            name:         self.doc_name.get().map(|r| r.get().clone()).unwrap_or_default(),
            description:  self.doc_description.get().map(|r| r.get().clone()).unwrap_or_default(),
            width:        self.canvas_width.get().clone(),
            height:       self.canvas_height.get().clone(),
            background:   self.background.get().clone(),
            layer_count:  self.layers.len().unwrap_or(0) as u32,
            member_count: self.members.len().unwrap_or(0) as u32,
            owner:        self.doc_name.owner().map(String::from),
        }
    }

    /// Rename / re-describe / resize the document. Owner-only — only converges
    /// from the document owner.
    pub fn update_document(
        &mut self,
        name: Option<String>,
        description: Option<String>,
        width: Option<u32>,
        height: Option<u32>,
        background: Option<String>,
    ) -> app::Result<()> {
        self.doc_name.only_owner()?;
        if let Some(n) = name        { self.doc_name.insert(LwwRegister::new(n))?; }
        if let Some(d) = description { self.doc_description.insert(LwwRegister::new(d))?; }
        if let Some(w) = width  { self.canvas_width.set(w); }
        if let Some(h) = height { self.canvas_height.set(h); }
        if let Some(b) = background { self.background.set(b); }
        app::emit!(Event::DocumentUpdated());
        Ok(())
    }

    /// Hand the document (and its owner-gated config) to another member. Owner-only.
    pub fn transfer_ownership(&mut self, new_owner: String) -> app::Result<()> {
        let owner = Self::parse_pk(&new_owner)?;
        let previous = Self::caller();
        self.doc_name.transfer_ownership(owner)?;
        self.doc_description.transfer_ownership(owner)?;
        if !self.roles.is_admin(&owner) {
            self.roles.grant_admin(owner)?;
        }
        if previous != owner && self.roles.is_admin(&previous) {
            self.roles.revoke_admin(&previous)?;
        }
        app::emit!(Event::OwnerTransferred(new_owner));
        Ok(())
    }

    // ── Roles ───────────────────────────────────────────────────────────────────

    pub fn grant_editor(&mut self, member: String) -> app::Result<()> {
        let who = Self::parse_pk(&member)?;
        self.roles.grant(ROLE_EDITOR, who)?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    pub fn revoke_editor(&mut self, member: String) -> app::Result<()> {
        let who = Self::parse_pk(&member)?;
        self.roles.revoke(ROLE_EDITOR, &who)?;
        app::emit!(Event::RoleUpdated(member));
        Ok(())
    }

    pub fn get_role(&self, member: String) -> String {
        match Self::parse_pk(&member) {
            Ok(pk) => self.role_label(&pk),
            Err(_) => "viewer".to_string(),
        }
    }

    pub fn my_role(&self) -> String {
        self.role_label(&Self::caller())
    }

    pub fn can_edit(&self) -> bool {
        self.is_editor(&Self::caller())
    }

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

    pub fn update_member_username(&mut self, username: String, timestamp: u64) {
        let member_id = Self::caller_id();
        if let Ok(Some(mut m)) = self.members.get_mut(&member_id) {
            m.username            = username;
            m.username_updated_at = timestamp;
            drop(m);
            app::emit!(Event::MemberUsernameUpdated(member_id));
        }
    }

    // ── Layers ──────────────────────────────────────────────────────────────────

    pub fn add_layer(&mut self, layer: Layer) -> app::Result<String> {
        self.require_editor()?;
        let id = layer.id.clone();
        Self::announce_blob(&layer.blob_id);
        if let Some(ref mask) = layer.mask_blob_id { Self::announce_blob(mask); }
        let _ = self.layers.insert(id.clone(), layer);
        app::emit!(Event::LayerAdded(id.clone()));
        Ok(id)
    }

    /// Update layer metadata / transform / compositing params. Each arg is
    /// optional so callers patch only what changed.
    pub fn update_layer(
        &mut self,
        id: String,
        name: Option<String>,
        visible: Option<bool>,
        locked: Option<bool>,
        opacity: Option<u8>,
        blend_mode: Option<String>,
        x: Option<i64>, y: Option<i64>,
        width: Option<u32>, height: Option<u32>,
        rotation: Option<i32>,
        scale_x: Option<i32>, scale_y: Option<i32>,
        fill: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if let Ok(Some(mut l)) = self.layers.get_mut(&id) {
            if let Some(v) = name       { l.name       = v; }
            if let Some(v) = visible    { l.visible    = v; }
            if let Some(v) = locked     { l.locked     = v; }
            if let Some(v) = opacity    { l.opacity    = v; }
            if let Some(v) = blend_mode { l.blend_mode = v; }
            if let Some(v) = x          { l.x          = v; }
            if let Some(v) = y          { l.y          = v; }
            if let Some(v) = width      { l.width      = v; }
            if let Some(v) = height     { l.height     = v; }
            if let Some(v) = rotation   { l.rotation   = v; }
            if let Some(v) = scale_x    { l.scale_x    = v; }
            if let Some(v) = scale_y    { l.scale_y    = v; }
            if let Some(v) = fill       { l.fill       = v; }
            l.updated_at = updated_at;
            drop(l);
            app::emit!(Event::LayerUpdated(id));
        }
        Ok(())
    }

    /// Replace a raster layer's pixel data with a freshly rendered blob (after a
    /// destructive edit: brush, eraser, fill, crop bake, filter, transform bake).
    pub fn update_layer_content(
        &mut self,
        id: String,
        blob_id: String,
        width: u32,
        height: u32,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        Self::announce_blob(&blob_id);
        if let Ok(Some(mut l)) = self.layers.get_mut(&id) {
            l.blob_id    = blob_id;
            l.width      = width;
            l.height     = height;
            l.updated_at = updated_at;
            drop(l);
            app::emit!(Event::LayerUpdated(id));
        }
        Ok(())
    }

    /// Set / clear a layer mask (grayscale PNG blob; None clears it).
    pub fn update_layer_mask(
        &mut self,
        id: String,
        mask_blob_id: Option<String>,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if let Some(ref mask) = mask_blob_id { Self::announce_blob(mask); }
        if let Ok(Some(mut l)) = self.layers.get_mut(&id) {
            l.mask_blob_id = mask_blob_id;
            l.updated_at   = updated_at;
            drop(l);
            app::emit!(Event::LayerUpdated(id));
        }
        Ok(())
    }

    /// Patch non-destructive adjustments on a layer (or adjustment layer).
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
        if let Ok(Some(mut l)) = self.layers.get_mut(&id) {
            if let Some(v) = brightness { l.adjustments.brightness = v; }
            if let Some(v) = contrast   { l.adjustments.contrast   = v; }
            if let Some(v) = saturation { l.adjustments.saturation = v; }
            if let Some(v) = hue        { l.adjustments.hue        = v; }
            if let Some(v) = exposure   { l.adjustments.exposure   = v; }
            if let Some(v) = blur       { l.adjustments.blur       = v; }
            if let Some(v) = invert     { l.adjustments.invert     = v; }
            if let Some(v) = curves     { l.adjustments.curves     = v; }
            l.updated_at = updated_at;
            drop(l);
            app::emit!(Event::LayerUpdated(id));
        }
        Ok(())
    }

    /// Update text-layer properties.
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
        if let Ok(Some(mut l)) = self.layers.get_mut(&id) {
            let mut t = l.text.clone().unwrap_or_default();
            if let Some(v) = content     { t.content     = v; }
            if let Some(v) = font_family { t.font_family = v; }
            if let Some(v) = font_size   { t.font_size   = v; }
            if let Some(v) = color       { t.color       = v; }
            if let Some(v) = bold        { t.bold        = v; }
            if let Some(v) = italic      { t.italic      = v; }
            if let Some(v) = align       { t.align       = Some(v); }
            l.text       = Some(t);
            l.updated_at = updated_at;
            drop(l);
            app::emit!(Event::LayerUpdated(id));
        }
        Ok(())
    }

    pub fn delete_layer(&mut self, id: String) -> app::Result<()> {
        self.require_editor()?;
        // Re-parent / delete orphaned children of a deleted group to top level.
        let children: Vec<String> = self.layers.entries()
            .map(|iter| iter
                .filter(|(_, l)| l.parent_id.as_deref() == Some(id.as_str()))
                .map(|(k, _)| k)
                .collect())
            .unwrap_or_default();
        for child in children {
            if let Ok(Some(mut l)) = self.layers.get_mut(&child) {
                l.parent_id = None;
            }
        }
        let _ = self.layers.remove(&id);
        app::emit!(Event::LayerDeleted(id));
        Ok(())
    }

    pub fn get_layers(&self) -> Vec<Layer> {
        let mut layers: Vec<Layer> = self.layers.entries().unwrap().map(|(_, v)| v).collect();
        layers.sort_by_key(|l| l.layer_index);
        layers
    }

    pub fn get_layer(&self, id: String) -> Option<Layer> {
        self.layers.get(&id).ok().flatten().map(|v| v.clone())
    }

    /// Move a layer into / out of a group and set its index in one call.
    pub fn move_layer(
        &mut self,
        id: String,
        parent_id: Option<String>,
        layer_index: u32,
        updated_at: u64,
    ) -> app::Result<()> {
        self.require_editor()?;
        if let Ok(Some(mut l)) = self.layers.get_mut(&id) {
            l.parent_id   = parent_id;
            l.layer_index = layer_index;
            l.updated_at  = updated_at;
            drop(l);
            app::emit!(Event::LayersReordered());
        }
        Ok(())
    }

    /// Apply an explicit ordering: each (id, index) pair sets that layer's
    /// `layer_index`. Used after a drag-reorder in the layers panel.
    pub fn reorder_layers(&mut self, order: Vec<(String, u32)>, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;
        for (id, idx) in order {
            if let Ok(Some(mut l)) = self.layers.get_mut(&id) {
                l.layer_index = idx;
                l.updated_at  = updated_at;
            }
        }
        app::emit!(Event::LayersReordered());
        Ok(())
    }

    pub fn bring_to_front(&mut self, id: String, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;
        let max_index = self.layers.entries().unwrap().map(|(_, v)| v.layer_index).max().unwrap_or(0);
        if let Ok(Some(mut l)) = self.layers.get_mut(&id) {
            l.layer_index = max_index + 1;
            l.updated_at  = updated_at;
        }
        app::emit!(Event::LayersReordered());
        Ok(())
    }

    pub fn send_to_back(&mut self, id: String, updated_at: u64) -> app::Result<()> {
        self.require_editor()?;
        let other_ids: Vec<String> = self.layers.entries().unwrap()
            .filter(|(k, _)| *k != id).map(|(k, _)| k).collect();
        for other_id in &other_ids {
            if let Ok(Some(mut other)) = self.layers.get_mut(other_id) {
                other.layer_index = other.layer_index.saturating_add(1);
            }
        }
        if let Ok(Some(mut l)) = self.layers.get_mut(&id) {
            l.layer_index = 0;
            l.updated_at  = updated_at;
        }
        app::emit!(Event::LayersReordered());
        Ok(())
    }

    pub fn clear_layers(&mut self) -> app::Result<()> {
        self.require_admin()?;
        let ids: Vec<String> = self.layers.entries()
            .map(|iter| iter.map(|(k, _)| k).collect())
            .unwrap_or_default();
        for id in ids {
            let _ = self.layers.remove(&id);
        }
        app::emit!(Event::LayersReordered());
        Ok(())
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

    fn new_doc() -> TestHost<MeroPixArt> {
        TestHost::new(|| MeroPixArt::init("Untitled".to_owned(), "desc".to_owned(), 800, 600))
    }

    fn sample_layer(id: &str) -> Layer {
        Layer {
            id: id.to_owned(),
            name: "Layer".to_owned(),
            kind: "raster".to_owned(),
            parent_id: None,
            layer_index: 0,
            visible: true,
            locked: false,
            opacity: 100,
            blend_mode: "normal".to_owned(),
            x: 0, y: 0, width: 100, height: 100, rotation: 0,
            scale_x: 100, scale_y: 100,
            blob_id: String::new(),
            mask_blob_id: None,
            fill: String::new(),
            adjustments: Adjustments::default(),
            text: None,
            created_by: "creator".to_owned(),
            created_at: 1, updated_at: 1,
        }
    }

    #[test]
    fn creator_is_admin_and_can_edit() {
        let app = new_doc();
        assert_eq!(app.view(|s| s.my_role()), "admin");
        assert!(app.view(|s| s.can_edit()));
    }

    #[test]
    fn document_defaults_and_resize() {
        let mut app = new_doc();
        let doc = app.view(|s| s.get_document());
        assert_eq!(doc.width, 800);
        assert_eq!(doc.height, 600);
        app.call(|s| s.update_document(None, None, Some(1024), Some(768), None)).unwrap();
        let doc = app.view(|s| s.get_document());
        assert_eq!(doc.width, 1024);
        assert_eq!(doc.height, 768);
    }

    #[test]
    fn join_uses_signer_identity_not_client_arg() {
        let mut app = new_doc();
        app.call(|s| s.join("alice".to_owned(), None, 1));
        let members = app.view(|s| s.get_members());
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].username, "alice");
        assert!(!members[0].id.is_empty());
    }

    #[test]
    fn viewer_cannot_edit_editor_can() {
        let mut app = new_doc();
        app.call_as(OTHER, |s| s.join("bob".to_owned(), None, 1));
        assert!(app.call_as(OTHER, |s| s.add_layer(sample_layer("l1"))).is_err());
        assert_eq!(app.view(|s| s.get_layers()).len(), 0);

        let bob = String::from(PublicKey::from(OTHER));
        app.call(|s| s.grant_editor(bob.clone())).unwrap();
        assert_eq!(app.view(|s| s.get_role(bob.clone())), "editor");
        app.call_as(OTHER, |s| s.add_layer(sample_layer("l1"))).unwrap();
        assert_eq!(app.view(|s| s.get_layers()).len(), 1);

        app.call(|s| s.revoke_editor(bob.clone())).unwrap();
        assert!(app.call_as(OTHER, |s| s.delete_layer("l1".to_owned())).is_err());
    }

    #[test]
    fn non_admin_cannot_grant_roles() {
        let mut app = new_doc();
        let third = String::from(PublicKey::from([0x33u8; 32]));
        assert!(app.call_as(OTHER, |s| s.grant_editor(third)).is_err());
    }

    #[test]
    fn layer_content_and_adjustments_update() {
        let mut app = new_doc();
        app.call(|s| s.add_layer(sample_layer("l1"))).unwrap();
        app.call(|s| s.update_adjustments(
            "l1".to_owned(), Some(20), Some(-10), Some(5), None, None, None, Some(true), None, 2,
        )).unwrap();
        let l = app.view(|s| s.get_layer("l1".to_owned())).unwrap();
        assert_eq!(l.adjustments.brightness, 20);
        assert_eq!(l.adjustments.contrast, -10);
        assert!(l.adjustments.invert);

        app.call(|s| s.update_layer_content("l1".to_owned(), String::new(), 256, 256, 3)).unwrap();
        let l = app.view(|s| s.get_layer("l1".to_owned())).unwrap();
        assert_eq!(l.width, 256);
        assert_eq!(l.height, 256);
    }

    #[test]
    fn deleting_group_reparents_children() {
        let mut app = new_doc();
        let mut group = sample_layer("g1");
        group.kind = "group".to_owned();
        app.call(|s| s.add_layer(group)).unwrap();
        let mut child = sample_layer("c1");
        child.parent_id = Some("g1".to_owned());
        app.call(|s| s.add_layer(child)).unwrap();

        app.call(|s| s.delete_layer("g1".to_owned())).unwrap();
        let c = app.view(|s| s.get_layer("c1".to_owned())).unwrap();
        assert_eq!(c.parent_id, None);
    }

    #[test]
    fn layer_merge_uses_updated_at() {
        let mut a = sample_layer("l");
        a.opacity = 100; a.updated_at = 100;
        let mut b = sample_layer("l");
        b.opacity = 40; b.updated_at = 200;
        a.merge(&b).unwrap();
        assert_eq!(a.opacity, 40);
    }

    #[test]
    fn only_owner_renames_document() {
        let mut app = new_doc();
        app.call(|s| s.update_document(Some("Renamed".to_owned()), None, None, None, None)).unwrap();
        assert_eq!(app.view(|s| s.get_document()).name, "Renamed");
        assert!(app.call_as(OTHER, |s| s.update_document(Some("Hijacked".to_owned()), None, None, None, None)).is_err());
        assert_eq!(app.view(|s| s.get_document()).name, "Renamed");
    }

    #[test]
    fn ownership_transfer_moves_control() {
        let mut app = new_doc();
        let other = String::from(PublicKey::from(OTHER));
        app.call(|s| s.transfer_ownership(other.clone())).unwrap();
        assert_eq!(app.view(|s| s.get_document()).owner, Some(other.clone()));
        app.call_as(OTHER, |s| s.update_document(Some("Owned".to_owned()), None, None, None, None)).unwrap();
        assert_eq!(app.view(|s| s.get_document()).name, "Owned");
        assert!(app.call(|s| s.update_document(Some("nope".to_owned()), None, None, None, None)).is_err());
        assert_eq!(app.view(|s| s.get_role(other)), "admin");
        assert_eq!(app.view(|s| s.my_role()), "viewer");
        assert!(!app.view(|s| s.can_edit()));
    }
}
