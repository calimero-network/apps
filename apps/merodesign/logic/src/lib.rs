use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::app;
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{LwwRegister, Mergeable as MergeableTrait, UnorderedMap};

// ── Types ─────────────────────────────────────────────────────────────────────

type ElementId = String;
type MemberId = String;

// ── Element data ──────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind")]
pub enum ElementData {
    Rect,
    Circle,
    Line,
    Arrow,
    Path {
        points: String,
    },
    Text {
        content: String,
        font_size: u32,
        font_family: String,
        bold: bool,
        italic: bool,
    },
    Image {
        natural_width: u32,
        natural_height: u32,
    },
    Svg {
        natural_width: u32,
        natural_height: u32,
    },
}

// ── Element ───────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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
}

impl MergeableTrait for Element {
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
    pub id: MemberId,
    pub username: String,
    pub avatar: Option<String>,
    pub joined_at: u64,
}

impl MergeableTrait for Member {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if other.joined_at > self.joined_at {
            *self = other.clone();
        }
        Ok(())
    }
}

// ── Board info (returned by get_board) ────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub name: String,
    pub description: String,
    pub element_count: u32,
    pub member_count: u32,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[app::event]
pub enum Event {
    ElementAdded(String),
    ElementUpdated(String),
    ElementDeleted(String),
    LayerReordered(),
    MemberJoined(String),
    BoardUpdated(),
}

// ── App state ─────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MeroDesign {
    board_name: LwwRegister<String>,
    board_description: LwwRegister<String>,
    elements: UnorderedMap<ElementId, Element>,
    members: UnorderedMap<MemberId, Member>,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroDesign {
    #[app::init]
    pub fn init(name: String, description: String) -> MeroDesign {
        MeroDesign {
            board_name: LwwRegister::new(name),
            board_description: LwwRegister::new(description),
            elements: UnorderedMap::new(),
            members: UnorderedMap::new(),
        }
    }

    // ── Board ─────────────────────────────────────────────────────────────────

    pub fn get_board(&self) -> BoardInfo {
        let element_count = self.elements.len().unwrap_or(0) as u32;
        let member_count = self.members.len().unwrap_or(0) as u32;
        BoardInfo {
            name: self.board_name.get().clone(),
            description: self.board_description.get().clone(),
            element_count,
            member_count,
        }
    }

    pub fn update_board(&mut self, name: Option<String>, description: Option<String>) {
        if let Some(n) = name {
            self.board_name.set(n);
        }
        if let Some(d) = description {
            self.board_description.set(d);
        }
        app::emit!(Event::BoardUpdated());
    }

    // ── Members ───────────────────────────────────────────────────────────────

    pub fn join(
        &mut self,
        member_id: String,
        username: String,
        avatar: Option<String>,
        timestamp: u64,
    ) {
        if self.members.contains(&member_id).unwrap_or(false) {
            return;
        }
        let m = Member {
            id: member_id.clone(),
            username,
            avatar,
            joined_at: timestamp,
        };
        let _ = self.members.insert(member_id.clone(), m);
        app::emit!(Event::MemberJoined(member_id));
    }

    pub fn get_members(&self) -> Vec<Member> {
        self.members
            .entries()
            .unwrap()
            .map(|(_, v)| v)
            .collect()
    }

    // ── Elements ──────────────────────────────────────────────────────────────

    pub fn add_element(&mut self, element: Element) -> String {
        let id = element.id.clone();
        let _ = self.elements.insert(id.clone(), element);
        app::emit!(Event::ElementAdded(id.clone()));
        id
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
        updated_at: u64,
    ) {
        if let Ok(Some(mut el)) = self.elements.get(&id) {
            if let Some(v) = x { el.x = v; }
            if let Some(v) = y { el.y = v; }
            if let Some(v) = width { el.width = v; }
            if let Some(v) = height { el.height = v; }
            if let Some(v) = rotation { el.rotation = v; }
            if let Some(v) = fill { el.fill = v; }
            if let Some(v) = stroke { el.stroke = v; }
            if let Some(v) = stroke_width { el.stroke_width = v; }
            if let Some(v) = opacity { el.opacity = v; }
            el.updated_at = updated_at;
            let _ = self.elements.insert(id.clone(), el);
            app::emit!(Event::ElementUpdated(id));
        }
    }

    pub fn update_text_content(&mut self, id: String, content: String, updated_at: u64) {
        if let Ok(Some(mut el)) = self.elements.get(&id) {
            if let ElementData::Text { content: ref mut c, .. } = el.data {
                *c = content;
            }
            el.updated_at = updated_at;
            let _ = self.elements.insert(id.clone(), el);
            app::emit!(Event::ElementUpdated(id));
        }
    }

    pub fn delete_element(&mut self, id: String) {
        let _ = self.elements.remove(&id);
        app::emit!(Event::ElementDeleted(id));
    }

    pub fn get_elements(&self) -> Vec<Element> {
        let mut els: Vec<Element> = self
            .elements
            .entries()
            .unwrap()
            .map(|(_, v)| v)
            .collect();
        els.sort_by_key(|e| e.layer_index);
        els
    }

    pub fn get_element(&self, id: String) -> Option<Element> {
        self.elements.get(&id).unwrap_or(None)
    }

    // ── Layer order ───────────────────────────────────────────────────────────

    pub fn bring_to_front(&mut self, id: String) {
        let max_layer = self
            .elements
            .entries()
            .unwrap()
            .map(|(_, v)| v.layer_index)
            .max()
            .unwrap_or(0);
        if let Ok(Some(mut el)) = self.elements.get(&id) {
            el.layer_index = max_layer + 1;
            let _ = self.elements.insert(id, el);
        }
        app::emit!(Event::LayerReordered());
    }

    pub fn send_to_back(&mut self, id: String) {
        let other_ids: Vec<String> = self
            .elements
            .entries()
            .unwrap()
            .filter(|(k, _)| *k != id)
            .map(|(k, _)| k)
            .collect();

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
}
