//! Storage rows. Owned headers carry the creator stamp and decide existence;
//! shared rows hold every field anyone may edit, each an `LwwRegister`.
//! Callers never see these: every read returns a `*View` from `lib.rs`.

use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_storage::collections::crdt_meta::MergeError;
use calimero_storage::collections::{LwwRegister, Mergeable};

/// Who created a board. Owned by the creator: only they can delete the board.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct BoardHeader {
    #[index]
    pub created_at: u64,
}

/// A board's shared fields.
#[app::mergeable(id = "mero_board::BoardRow")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct BoardRow {
    pub name: LwwRegister<String>,
    #[index]
    pub archived: LwwRegister<bool>,
    pub rank: LwwRegister<String>,
}

impl BoardRow {
    pub fn new(name: String, rank: String) -> Self {
        BoardRow {
            name: LwwRegister::new(name),
            archived: LwwRegister::new(false),
            rank: LwwRegister::new(rank),
        }
    }
    /// What a board reads as when a peer removed its shared row.
    pub fn missing() -> Self {
        Self::new(String::new(), "i".into())
    }
}

impl Mergeable for BoardRow {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.name.merge(&other.name);
        self.archived.merge(&other.archived);
        self.rank.merge(&other.rank);
        Ok(())
    }
}

/// A list (column) on a board. Shared.
#[app::mergeable(id = "mero_board::ListRow")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct ListRow {
    #[index]
    pub board_id: LwwRegister<String>,
    pub name: LwwRegister<String>,
    pub rank: LwwRegister<String>,
}

impl Mergeable for ListRow {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.board_id.merge(&other.board_id);
        self.name.merge(&other.name);
        self.rank.merge(&other.rank);
        Ok(())
    }
}

/// Who created a card and on which board. Owned by the creator.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct CardHeader {
    #[index]
    pub board_id: String,
    #[index]
    pub created_at: u64,
}

/// A card's shared fields.
#[app::mergeable(id = "mero_board::CardRow")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct CardRow {
    #[index]
    pub board_id: LwwRegister<String>,
    #[index]
    pub list_id: LwwRegister<String>,
    pub title: LwwRegister<String>,
    pub description: LwwRegister<String>,
    #[index]
    pub assignee: LwwRegister<Option<String>>,
    pub due_at: LwwRegister<Option<u64>>,
    pub archived: LwwRegister<bool>,
    pub rank: LwwRegister<String>,
}

impl CardRow {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        board_id: String,
        list_id: String,
        title: String,
        description: String,
        assignee: Option<String>,
        due_at: Option<u64>,
        rank: String,
    ) -> Self {
        CardRow {
            board_id: LwwRegister::new(board_id),
            list_id: LwwRegister::new(list_id),
            title: LwwRegister::new(title),
            description: LwwRegister::new(description),
            assignee: LwwRegister::new(assignee),
            due_at: LwwRegister::new(due_at),
            archived: LwwRegister::new(false),
            rank: LwwRegister::new(rank),
        }
    }
    /// What a card reads as when a peer removed its shared row: on its
    /// header's board, in no list.
    pub fn missing(board_id: String) -> Self {
        Self::new(
            board_id,
            String::new(),
            String::new(),
            String::new(),
            None,
            None,
            "i".into(),
        )
    }
}

impl Mergeable for CardRow {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.board_id.merge(&other.board_id);
        self.list_id.merge(&other.list_id);
        self.title.merge(&other.title);
        self.description.merge(&other.description);
        self.assignee.merge(&other.assignee);
        self.due_at.merge(&other.due_at);
        self.archived.merge(&other.archived);
        self.rank.merge(&other.rank);
        Ok(())
    }
}

/// One checklist line on a card. Shared.
#[app::mergeable(id = "mero_board::ChecklistItemRow")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct ChecklistItemRow {
    #[index]
    pub card_id: LwwRegister<String>,
    pub text: LwwRegister<String>,
    pub done: LwwRegister<bool>,
    pub rank: LwwRegister<String>,
}

impl Mergeable for ChecklistItemRow {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        self.card_id.merge(&other.card_id);
        self.text.merge(&other.text);
        self.done.merge(&other.done);
        self.rank.merge(&other.rank);
        Ok(())
    }
}

/// One label on one card, keyed `"{card_id}\u{1}{label}"`.
#[derive(Debug, BorshSerialize, BorshDeserialize, AbiType, app::Mergeable, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct LabelTag {
    #[index]
    pub card_id: LwwRegister<String>,
    #[index]
    pub label: LwwRegister<String>,
    pub added_at: LwwRegister<u64>,
}

/// A comment on a card. Owned by its author; `thread` is one card's comments.
#[app::mergeable(id = "mero_board::Comment")]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, AbiType, app::Indexed)]
#[borsh(crate = "calimero_sdk::borsh")]
#[index(thread(card_id, created_at))]
pub struct Comment {
    pub id: String,
    pub card_id: String,
    pub body: LwwRegister<String>,
    pub created_at: u64,
    pub edited_at: LwwRegister<Option<u64>>,
}

impl Mergeable for Comment {
    fn merge(&mut self, other: &Self) -> Result<(), MergeError> {
        if (other.created_at, &other.id) < (self.created_at, &self.id) {
            self.id = other.id.clone();
            self.card_id = other.card_id.clone();
            self.created_at = other.created_at;
        }
        self.body.merge(&other.body);
        self.edited_at.merge(&other.edited_at);
        Ok(())
    }
}
