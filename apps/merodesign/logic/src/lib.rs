use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env as sdk_env};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{LwwRegister, Mergeable as MergeableTrait, UnorderedMap};

// ── Types ─────────────────────────────────────────────────────────────────────

type ElementId  = String;
type MemberId   = String;
type CommentId  = String;

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
    pub id:         MemberId,
    pub username:   String,
    pub avatar:     Option<String>,
    pub joined_at:  u64,
}

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.joined_at > self.joined_at { *self = other.clone(); }
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
}

// ── App state ─────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MeroDesign {
    board_name:        LwwRegister<String>,
    board_description: LwwRegister<String>,
    elements:          UnorderedMap<ElementId, Element>,
    members:           UnorderedMap<MemberId, Member>,
    comments:          UnorderedMap<CommentId, Comment>,
    cursors:           UnorderedMap<String, CursorState>,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroDesign {
    #[app::init]
    pub fn init(name: String, description: String) -> MeroDesign {
        MeroDesign {
            board_name:        LwwRegister::new(name),
            board_description: LwwRegister::new(description),
            elements:          UnorderedMap::new(),
            members:           UnorderedMap::new(),
            comments:          UnorderedMap::new(),
            cursors:           UnorderedMap::new(),
        }
    }

    // ── Board ─────────────────────────────────────────────────────────────────

    pub fn get_board(&self) -> BoardInfo {
        BoardInfo {
            name:          self.board_name.get().clone(),
            description:   self.board_description.get().clone(),
            element_count: self.elements.len().unwrap_or(0) as u32,
            member_count:  self.members.len().unwrap_or(0) as u32,
        }
    }

    pub fn update_board(&mut self, name: Option<String>, description: Option<String>) {
        if let Some(n) = name         { self.board_name.set(n); }
        if let Some(d) = description  { self.board_description.set(d); }
        app::emit!(Event::BoardUpdated());
    }

    // ── Members ───────────────────────────────────────────────────────────────

    pub fn join(&mut self, member_id: String, username: String, avatar: Option<String>, timestamp: u64) {
        if self.members.contains(&member_id).unwrap_or(false) { return; }
        let m = Member { id: member_id.clone(), username, avatar, joined_at: timestamp };
        let _ = self.members.insert(member_id.clone(), m);
        app::emit!(Event::MemberJoined(member_id));
    }

    pub fn get_members(&self) -> Vec<Member> {
        self.members.entries().unwrap().map(|(_, v)| v).collect()
    }

    pub fn update_member_username(&mut self, member_id: String, username: String) {
        if let Ok(Some(mut m)) = self.members.get(&member_id) {
            m.username = username;
            let _ = self.members.insert(member_id.clone(), m);
            app::emit!(Event::MemberUsernameUpdated(member_id));
        }
    }

    // ── Elements ──────────────────────────────────────────────────────────────

    pub fn add_element(&mut self, element: Element) -> String {
        let id = element.id.clone();
        // Announce image/svg blobs to context so they propagate to all members
        let blob_id_str = match &element.data {
            ElementData::Image { blob_id, .. } | ElementData::Svg { blob_id, .. } => blob_id.as_str(),
            _ => "",
        };
        if !blob_id_str.is_empty() {
            if let Ok(bytes) = bs58::decode(blob_id_str).into_vec() {
                if bytes.len() == 32 {
                    let ctx = sdk_env::context_id();
                    let mut bid = [0u8; 32];
                    bid.copy_from_slice(&bytes);
                    sdk_env::blob_announce_to_context(&bid, &ctx);
                }
            }
        }
        let _ = self.elements.insert(id.clone(), element);
        app::emit!(Event::ElementAdded(id.clone()));
        id
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
    ) {
        if let Ok(Some(mut el)) = self.elements.get(&id) {
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
            let _ = self.elements.insert(id.clone(), el);
            app::emit!(Event::ElementUpdated(id));
        }
    }

    pub fn update_element_label(&mut self, id: String, label: Option<String>, updated_at: u64) {
        if let Ok(Some(mut el)) = self.elements.get(&id) {
            el.label      = label;
            el.updated_at = updated_at;
            let _ = self.elements.insert(id.clone(), el);
            app::emit!(Event::ElementUpdated(id));
        }
    }

    pub fn update_text_style(
        &mut self,
        id: String,
        content: Option<String>, font_family: Option<String>,
        font_size: Option<u32>, bold: Option<bool>, italic: Option<bool>,
        text_align: Option<String>, vertical_align: Option<String>,
        updated_at: u64,
    ) {
        if let Ok(Some(mut el)) = self.elements.get(&id) {
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
            let _ = self.elements.insert(id.clone(), el);
            app::emit!(Event::ElementUpdated(id));
        }
    }

    pub fn clear_elements(&mut self) {
        let ids: Vec<String> = self.elements.entries()
            .map(|iter| iter.map(|(k, _)| k).collect())
            .unwrap_or_default();
        for id in ids {
            let _ = self.elements.remove(&id);
        }
        app::emit!(Event::LayerReordered());
    }

    pub fn clear_comments(&mut self) {
        let ids: Vec<String> = self.comments.entries()
            .map(|iter| iter.map(|(k, _)| k).collect())
            .unwrap_or_default();
        for id in ids {
            let _ = self.comments.remove(&id);
        }
    }

    pub fn update_shadow(
        &mut self,
        id: String,
        shadow_color: Option<String>, shadow_offset_x: Option<i32>,
        shadow_offset_y: Option<i32>, shadow_blur: Option<u32>,
        updated_at: u64,
    ) {
        if let Ok(Some(mut el)) = self.elements.get(&id) {
            el.shadow_color    = shadow_color;
            el.shadow_offset_x = shadow_offset_x;
            el.shadow_offset_y = shadow_offset_y;
            el.shadow_blur     = shadow_blur;
            el.updated_at      = updated_at;
            let _ = self.elements.insert(id.clone(), el);
            app::emit!(Event::ElementUpdated(id));
        }
    }

    pub fn delete_element(&mut self, id: String) {
        let _ = self.elements.remove(&id);
        app::emit!(Event::ElementDeleted(id));
    }

    pub fn get_elements(&self) -> Vec<Element> {
        let mut els: Vec<Element> = self.elements.entries().unwrap().map(|(_, v)| v).collect();
        els.sort_by_key(|e| e.layer_index);
        els
    }

    pub fn get_element(&self, id: String) -> Option<Element> {
        self.elements.get(&id).unwrap_or(None)
    }

    // ── Layer order ───────────────────────────────────────────────────────────

    pub fn bring_to_front(&mut self, id: String) {
        let max_layer = self.elements.entries().unwrap().map(|(_, v)| v.layer_index).max().unwrap_or(0);
        if let Ok(Some(mut el)) = self.elements.get(&id) {
            el.layer_index = max_layer + 1;
            let _ = self.elements.insert(id, el);
        }
        app::emit!(Event::LayerReordered());
    }

    pub fn send_to_back(&mut self, id: String) {
        let other_ids: Vec<String> = self.elements.entries().unwrap()
            .filter(|(k, _)| *k != id).map(|(k, _)| k).collect();
        for other_id in other_ids {
            if let Ok(Some(mut other)) = self.elements.get(&other_id) {
                other.layer_index = other.layer_index.saturating_add(1);
                let _ = self.elements.insert(other_id, other);
            }
        }
        if let Ok(Some(mut el)) = self.elements.get(&id) {
            el.layer_index = 0;
            let _ = self.elements.insert(id, el);
        }
        app::emit!(Event::LayerReordered());
    }

    // ── Comments ──────────────────────────────────────────────────────────────

    pub fn add_comment(&mut self, id: String, x: i64, y: i64, content: String, author: String, created_at: u64) {
        let c = Comment { id: id.clone(), x, y, content, author, created_at, replies: vec![] };
        let _ = self.comments.insert(id.clone(), c);
        app::emit!(Event::CommentAdded(id));
    }

    pub fn add_reply(&mut self, comment_id: String, reply_id: String, content: String, author: String, created_at: u64) {
        if let Ok(Some(mut c)) = self.comments.get(&comment_id) {
            c.replies.push(CommentReply { id: reply_id, content, author, created_at });
            let _ = self.comments.insert(comment_id.clone(), c);
            app::emit!(Event::CommentUpdated(comment_id));
        }
    }

    pub fn delete_reply(&mut self, comment_id: String, reply_id: String) {
        if let Ok(Some(mut c)) = self.comments.get(&comment_id) {
            c.replies.retain(|r| r.id != reply_id);
            let _ = self.comments.insert(comment_id.clone(), c);
            app::emit!(Event::CommentUpdated(comment_id));
        }
    }

    pub fn delete_comment(&mut self, id: String) {
        let _ = self.comments.remove(&id);
        app::emit!(Event::CommentDeleted(id));
    }

    pub fn get_comments(&self) -> Vec<Comment> {
        self.comments.entries().unwrap().map(|(_, v)| v).collect()
    }

    // ── Cursor tracking ───────────────────────────────────────────────────────

    pub fn update_cursor(&mut self, identity: String, x: i64, y: i64, updated_at: u64) {
        let cs = CursorState { identity: identity.clone(), x, y, updated_at };
        let _ = self.cursors.insert(identity.clone(), cs);
        app::emit!(Event::CursorMoved(identity));
    }

    pub fn get_cursors(&self) -> Vec<CursorState> {
        self.cursors.entries().unwrap().map(|(_, v)| v).collect()
    }
}
