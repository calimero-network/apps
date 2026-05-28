use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env};
use calimero_storage::collections::{UnorderedMap, Vector};

// ── IDs ──────────────────────────────────────────────────────────────────────

type ElementId = String;
type MemberId = String;

const BLOB_ID_SIZE: usize = 32;

fn encode_blob_id(bytes: &[u8; BLOB_ID_SIZE]) -> String {
    let mut buf = [0u8; 44];
    let len = bs58::encode(bytes).onto(&mut buf[..]).unwrap();
    std::str::from_utf8(&buf[..len]).unwrap().to_owned()
}

fn decode_blob_id(s: &str) -> Result<[u8; BLOB_ID_SIZE], String> {
    match bs58::decode(s).into_vec() {
        Ok(b) if b.len() == BLOB_ID_SIZE => {
            let mut out = [0u8; BLOB_ID_SIZE];
            out.copy_from_slice(&b);
            Ok(out)
        }
        Ok(b) => Err(format!("bad blob id length: {}", b.len())),
        Err(e) => Err(format!("decode error: {e}")),
    }
}

// ── Element types ─────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind")]
pub enum ElementData {
    Rect,
    Circle,
    Line,
    Arrow,
    Path { points: String },
    Text { content: String, font_size: u32, font_family: String, bold: bool, italic: bool },
    Image { blob_id: String, natural_width: u32, natural_height: u32 },
    Svg { blob_id: String },
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
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

// ── Member ────────────────────────────────────────────────────────────────────

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: MemberId,
    pub username: String,
    pub avatar: Option<String>,
    pub joined_at: u64,
}

// ── App state ─────────────────────────────────────────────────────────────────

#[app::state(emits = Events)]
#[derive(BorshSerialize, BorshDeserialize, Default)]
pub struct MeroDesign {
    board_name: String,
    board_description: String,
    elements: UnorderedMap<ElementId, Element>,
    layer_order: Vector<ElementId>,
    members: UnorderedMap<MemberId, Member>,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[app::events]
pub enum Events {
    ElementAdded { element_id: String },
    ElementUpdated { element_id: String },
    ElementDeleted { element_id: String },
    LayerReordered,
    MemberJoined { member_id: String },
    BoardUpdated,
}

// ── Logic ─────────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroDesign {
    #[app::init]
    pub fn init(name: String, description: String) -> Self {
        let mut state = Self::default();
        state.board_name = name;
        state.board_description = description;
        state
    }

    // ── Board info ────────────────────────────────────────────────────────────

    pub fn get_board(&self) -> serde_json::Value {
        serde_json::json!({
            "name": self.board_name,
            "description": self.board_description,
            "element_count": self.elements.len(),
            "member_count": self.members.len(),
        })
    }

    pub fn update_board(&mut self, name: Option<String>, description: Option<String>) {
        if let Some(n) = name { self.board_name = n; }
        if let Some(d) = description { self.board_description = d; }
        app::emit!(BoardUpdated);
    }

    // ── Members ───────────────────────────────────────────────────────────────

    pub fn join(&mut self, member_id: String, username: String, avatar: Option<String>, timestamp: u64) {
        if self.members.contains(&member_id).unwrap_or(false) {
            return;
        }
        let m = Member { id: member_id.clone(), username, avatar, joined_at: timestamp };
        self.members.insert(member_id.clone(), m).unwrap();
        app::emit!(MemberJoined { member_id });
    }

    pub fn get_members(&self) -> Vec<Member> {
        self.members.entries().unwrap().map(|(_, v)| v).collect()
    }

    // ── Elements ──────────────────────────────────────────────────────────────

    pub fn add_element(&mut self, element: Element) -> String {
        let id = element.id.clone();
        self.layer_order.push(id.clone()).unwrap();
        self.elements.insert(id.clone(), element).unwrap();
        app::emit!(ElementAdded { element_id: id.clone() });
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
        if let Some(mut el) = self.elements.get(&id).unwrap() {
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
            self.elements.insert(id.clone(), el).unwrap();
            app::emit!(ElementUpdated { element_id: id });
        }
    }

    pub fn update_text_content(&mut self, id: String, content: String, updated_at: u64) {
        if let Some(mut el) = self.elements.get(&id).unwrap() {
            if let ElementData::Text { content: ref mut c, .. } = el.data {
                *c = content;
            }
            el.updated_at = updated_at;
            self.elements.insert(id.clone(), el).unwrap();
            app::emit!(ElementUpdated { element_id: id });
        }
    }

    pub fn delete_element(&mut self, id: String) {
        self.elements.remove(&id).unwrap();
        app::emit!(ElementDeleted { element_id: id });
    }

    pub fn get_elements(&self) -> Vec<Element> {
        let mut els: Vec<Element> = self.elements.entries().unwrap().map(|(_, v)| v).collect();
        els.sort_by_key(|e| e.layer_index);
        els
    }

    pub fn get_element(&self, id: String) -> Option<Element> {
        self.elements.get(&id).unwrap()
    }

    // ── Layer order ───────────────────────────────────────────────────────────

    pub fn bring_to_front(&mut self, id: String) {
        let max_layer = self.elements.entries().unwrap()
            .map(|(_, v)| v.layer_index)
            .max()
            .unwrap_or(0);
        if let Some(mut el) = self.elements.get(&id).unwrap() {
            el.layer_index = max_layer + 1;
            self.elements.insert(id, el).unwrap();
        }
        app::emit!(LayerReordered);
    }

    pub fn send_to_back(&mut self, id: String) {
        if let Some(mut el) = self.elements.get(&id).unwrap() {
            el.layer_index = 0;
            // shift everything else up
            let ids: Vec<String> = self.elements.entries().unwrap()
                .filter(|(k, _)| *k != id)
                .map(|(k, _)| k)
                .collect();
            for other_id in ids {
                if let Some(mut other) = self.elements.get(&other_id).unwrap() {
                    other.layer_index += 1;
                    self.elements.insert(other_id, other).unwrap();
                }
            }
            el.layer_index = 0;
            self.elements.insert(id, el).unwrap();
        }
        app::emit!(LayerReordered);
    }

    // ── Blob helpers ──────────────────────────────────────────────────────────

    pub fn store_blob(&mut self, data: Vec<u8>) -> String {
        let blob_id_bytes = env::blob::store_sized(&data).unwrap();
        encode_blob_id(&blob_id_bytes)
    }

    pub fn fetch_blob(&self, blob_id_str: String) -> Vec<u8> {
        let blob_id = decode_blob_id(&blob_id_str).expect("invalid blob id");
        env::blob::fetch_sized(&blob_id).unwrap()
    }
}
