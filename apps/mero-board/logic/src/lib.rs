//! Board service: a folder of kanban boards for one team.
//!
//! One context = one folder. The state holds every board in the folder with
//! its lists, cards, checklist items, labels and comments.
//!
//! - `Authored<IndexedMap<String, BoardHeader>>` / `CardHeader`: who created a
//!   board or card. The creator is the owner stamp, so only they can delete it
//!   and nobody can reattribute it. A board or card exists while its header does.
//! - `IndexedMap<String, BoardRow / ListRow / CardRow / ChecklistItemRow>`:
//!   the shared fields any member may edit, every field an `LwwRegister`.
//! - `IndexedMap<String, LabelTag>` keyed `"{card_id}\u{1}{label}"`.
//! - `Authored<IndexedMap<String, Comment>>`: each comment owned by its author.
//!
//! Shared rows are public on purpose, exactly like the tracker's triage state:
//! a patched node can rewrite or remove them, as an honest member could. A
//! removed shared row reads back as a default row (see `*Row::missing`).

use std::collections::BTreeSet;

use board_types::{generate_id, validate_label, validate_tag, Error};
use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::env;
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_sdk::AccountId;
use calimero_storage::collections::{Authored, IndexedMap, LwwRegister, StoreError};
use calimero_storage::env as storage_env;

pub mod events;
pub mod model;
pub mod rank;

use events::Event;
use model::{
    BoardHeader, BoardRow, CardHeader, CardRow, ChecklistItemRow, Comment, LabelTag, ListRow,
};
use rank::{rank_after, validate_rank};

// Used from the card/label tasks onward.
#[allow(dead_code)]
const LABEL_SEP: char = '\u{1}';

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct BoardView {
    pub id: String,
    pub name: String,
    pub archived: bool,
    pub rank: String,
    /// The creator's account id (64 hex).
    pub created_by: String,
    /// Unix milliseconds.
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ListView {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub rank: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CardView {
    pub id: String,
    pub board_id: String,
    /// Empty when the card's shared row is missing.
    pub list_id: String,
    pub title: String,
    pub description: String,
    pub assignee: Option<String>,
    pub due_at: Option<u64>,
    pub archived: bool,
    pub rank: String,
    /// Sorted.
    pub labels: Vec<String>,
    pub checklist_done: u64,
    pub checklist_total: u64,
    pub created_by: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct ChecklistItemView {
    pub id: String,
    pub card_id: String,
    pub text: String,
    pub done: bool,
    pub rank: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CommentView {
    pub id: String,
    pub card_id: String,
    pub author: String,
    pub body: String,
    pub created_at: u64,
    pub edited_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct BoardDetail {
    pub board: BoardView,
    /// Sorted by rank.
    pub lists: Vec<ListView>,
    /// Unarchived cards, sorted by rank.
    pub cards: Vec<CardView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CardDetail {
    pub card: CardView,
    pub checklist: Vec<ChecklistItemView>,
    pub comments: Vec<CommentView>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
pub struct Board {
    board_headers: Authored<IndexedMap<String, BoardHeader>>,
    boards: IndexedMap<String, BoardRow>,
    lists: IndexedMap<String, ListRow>,
    card_headers: Authored<IndexedMap<String, CardHeader>>,
    cards: IndexedMap<String, CardRow>,
    checklist: IndexedMap<String, ChecklistItemRow>,
    labels: IndexedMap<String, LabelTag>,
    comments: Authored<IndexedMap<String, Comment>>,
}

fn store_err(what: &'static str) -> impl FnOnce(StoreError) -> AppError {
    move |e| AppError::msg(format!("{what}: {e}"))
}

fn now_ms() -> u64 {
    storage_env::time_now() / 1_000_000
}

fn new_id(prefix: &str, now: u64) -> String {
    let mut nonce = [0u8; 4];
    env::random_bytes(&mut nonce);
    generate_id(prefix, now, &nonce)
}

/// Hex of the calling ACCOUNT (the person, not the device).
fn caller() -> String {
    AccountId::from(env::account_id()).to_string()
}

#[allow(dead_code)] // used from the card tasks onward
fn label_key(card_id: &str, label: &str) -> String {
    format!("{card_id}{LABEL_SEP}{label}")
}

fn validate_name(field: &str, value: &str) -> app::Result<()> {
    validate_label(field, value).map_err(AppError::from)
}

#[allow(dead_code)] // used from the card tasks onward
fn validate_text(field: &str, value: &str) -> app::Result<()> {
    if value.trim().is_empty() {
        app::bail!(Error::Invalid(format!("{field} must not be empty")));
    }
    Ok(())
}

#[allow(dead_code)] // used from the card tasks onward
fn validate_user_label(label: &str) -> app::Result<()> {
    validate_tag(label).map_err(AppError::from)?;
    if label.contains(LABEL_SEP) {
        app::bail!(Error::Invalid("label contains a reserved character".into()));
    }
    Ok(())
}

fn check_rank(rank: &str) -> app::Result<()> {
    validate_rank(rank).map_err(AppError::from)
}

fn by_rank<T>(items: &mut [T], key: impl Fn(&T) -> (String, String)) {
    items.sort_by_key(key);
}

#[app::logic]
impl Board {
    /// Create an empty folder. Runs once, when the folder's context is created.
    ///
    /// # Examples
    /// ```json
    /// {}
    /// ```
    #[app::init]
    pub fn init() -> Board {
        Board {
            board_headers: Authored::new_with_field_name("board:board_headers"),
            boards: IndexedMap::new_with_field_name("board:boards"),
            lists: IndexedMap::new_with_field_name("board:lists"),
            card_headers: Authored::new_with_field_name("board:card_headers"),
            cards: IndexedMap::new_with_field_name("board:cards"),
            checklist: IndexedMap::new_with_field_name("board:checklist"),
            labels: IndexedMap::new_with_field_name("board:labels"),
            comments: Authored::new_with_field_name("board:comments"),
        }
    }

    // ----- boards ---------------------------------------------------------

    /// Create a board in this folder and return its id (`board-<ms>-<8 hex>`).
    ///
    /// # Arguments
    /// * `name` - 1 to 64 characters.
    /// * `rank` - optional position among the folder's boards; omitted appends last.
    ///
    /// # Examples
    /// ```json
    /// {"name":"Q4 launch","rank":null}
    /// ```
    pub fn create_board(&mut self, name: String, rank: Option<String>) -> app::Result<String> {
        validate_name("name", &name)?;
        let rank = match rank {
            Some(r) => {
                check_rank(&r)?;
                r
            }
            None => rank_after(self.last_board_rank()?.as_deref()),
        };
        let now = now_ms();
        let id = new_id("board", now);
        let created_by = caller();
        self.board_headers
            .insert(id.clone(), BoardHeader { created_at: now })
            .map_err(store_err("board_headers.insert"))?;
        let _ = self
            .boards
            .insert(id.clone(), BoardRow::new(name, rank))
            .map_err(store_err("boards.insert"))?;
        app::emit!(Event::BoardCreated {
            id: &id,
            created_by: &created_by
        });
        Ok(id)
    }

    /// Rename a board. Any member may call it.
    ///
    /// # Examples
    /// ```json
    /// {"board_id":"<board id>","name":"Q4 launch (final)"}
    /// ```
    #[app::idempotent]
    pub fn rename_board(&mut self, board_id: String, name: String) -> app::Result<()> {
        validate_name("name", &name)?;
        self.edit_board(&board_id, |b| b.name.set(name))?;
        app::emit!(Event::BoardChanged { id: &board_id });
        Ok(())
    }

    /// Archive or unarchive a board. Archived boards are hidden from `list_boards` by default.
    ///
    /// # Examples
    /// ```json
    /// {"board_id":"<board id>","archived":true}
    /// ```
    #[app::idempotent]
    pub fn set_board_archived(&mut self, board_id: String, archived: bool) -> app::Result<()> {
        self.edit_board(&board_id, |b| b.archived.set(archived))?;
        app::emit!(Event::BoardChanged { id: &board_id });
        Ok(())
    }

    /// Reorder a board among the folder's boards.
    ///
    /// # Arguments
    /// * `rank` - a rank strictly between its new neighbours' ranks.
    ///
    /// # Examples
    /// ```json
    /// {"board_id":"<board id>","rank":"n"}
    /// ```
    #[app::idempotent]
    pub fn move_board(&mut self, board_id: String, rank: String) -> app::Result<()> {
        check_rank(&rank)?;
        self.edit_board(&board_id, |b| b.rank.set(rank))?;
        app::emit!(Event::BoardChanged { id: &board_id });
        Ok(())
    }

    /// The folder's boards sorted by rank.
    ///
    /// # Arguments
    /// * `include_archived` - `false` hides archived boards.
    ///
    /// # Examples
    /// ```json
    /// {"include_archived":false}
    /// ```
    pub fn list_boards(&self, include_archived: bool) -> app::Result<Vec<BoardView>> {
        let ids: BTreeSet<String> = self
            .board_headers
            .entries()
            .map_err(store_err("board_headers.entries"))?
            .map(|(id, _)| id)
            .collect();
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            let Some(view) = self.board_view(id)? else {
                continue;
            };
            if !include_archived && view.archived {
                continue;
            }
            out.push(view);
        }
        by_rank(&mut out, |b| (b.rank.clone(), b.id.clone()));
        Ok(out)
    }

    // ----- lists ----------------------------------------------------------

    /// Add a list (column) to a board and return its id (`list-<ms>-<8 hex>`).
    ///
    /// # Arguments
    /// * `name` - 1 to 64 characters.
    /// * `rank` - optional position among the board's lists; omitted appends last.
    ///
    /// # Examples
    /// ```json
    /// {"board_id":"<board id>","name":"In progress","rank":null}
    /// ```
    pub fn create_list(
        &mut self,
        board_id: String,
        name: String,
        rank: Option<String>,
    ) -> app::Result<String> {
        validate_name("name", &name)?;
        if !self.board_exists(&board_id)? {
            app::bail!(Error::NotFound(board_id));
        }
        let rank = match rank {
            Some(r) => {
                check_rank(&r)?;
                r
            }
            None => rank_after(
                self.lists_of_board(&board_id)?
                    .last()
                    .map(|l| l.rank.as_str()),
            ),
        };
        let id = new_id("list", now_ms());
        let _ = self
            .lists
            .insert(
                id.clone(),
                ListRow {
                    board_id: LwwRegister::new(board_id.clone()),
                    name: LwwRegister::new(name),
                    rank: LwwRegister::new(rank),
                },
            )
            .map_err(store_err("lists.insert"))?;
        app::emit!(Event::ListCreated {
            id: &id,
            board_id: &board_id
        });
        Ok(id)
    }

    /// Rename a list.
    ///
    /// # Examples
    /// ```json
    /// {"list_id":"<list id>","name":"Doing"}
    /// ```
    #[app::idempotent]
    pub fn rename_list(&mut self, list_id: String, name: String) -> app::Result<()> {
        validate_name("name", &name)?;
        let board_id = self.require_list(&list_id)?;
        let _ = self
            .lists
            .update(&list_id, |l| l.name.set(name))
            .map_err(store_err("lists.update"))?;
        app::emit!(Event::ListChanged {
            id: &list_id,
            board_id: &board_id
        });
        Ok(())
    }

    /// Reorder a list among its board's lists.
    ///
    /// # Examples
    /// ```json
    /// {"list_id":"<list id>","rank":"n"}
    /// ```
    #[app::idempotent]
    pub fn move_list(&mut self, list_id: String, rank: String) -> app::Result<()> {
        check_rank(&rank)?;
        let board_id = self.require_list(&list_id)?;
        let _ = self
            .lists
            .update(&list_id, |l| l.rank.set(rank))
            .map_err(store_err("lists.update"))?;
        app::emit!(Event::ListChanged {
            id: &list_id,
            board_id: &board_id
        });
        Ok(())
    }

    /// Delete a list. Fails while it still holds an unarchived card.
    ///
    /// # Examples
    /// ```json
    /// {"list_id":"<list id>"}
    /// ```
    #[app::destructive]
    pub fn delete_list(&mut self, list_id: String) -> app::Result<()> {
        let board_id = self.require_list(&list_id)?;
        if self.live_cards_in_list(&list_id)? > 0 {
            app::bail!(Error::Invalid(
                "list still holds cards; move or archive them first".into()
            ));
        }
        let _ = self
            .lists
            .remove(&list_id)
            .map_err(store_err("lists.remove"))?;
        app::emit!(Event::ListDeleted {
            id: &list_id,
            board_id: &board_id
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

impl Board {
    fn board_holder(&self, id: &String) -> app::Result<Option<(AccountId, BoardHeader)>> {
        Ok(self
            .board_headers
            .entries_at(id)
            .map_err(store_err("board_headers.entries_at"))?
            .into_iter()
            .min_by_key(|(owner, _)| *owner))
    }

    fn board_exists(&self, id: &str) -> app::Result<bool> {
        Ok(self.board_holder(&id.to_owned())?.is_some())
    }

    fn board_view(&self, id: String) -> app::Result<Option<BoardView>> {
        let Some((creator, header)) = self.board_holder(&id)? else {
            return Ok(None);
        };
        let row = match self.boards.get(&id).map_err(store_err("boards.get"))? {
            Some(row) => row.clone(),
            None => BoardRow::missing(),
        };
        Ok(Some(BoardView {
            id,
            name: row.name.get().clone(),
            archived: *row.archived.get(),
            rank: row.rank.get().clone(),
            created_by: creator.to_string(),
            created_at: header.created_at,
        }))
    }

    fn last_board_rank(&self) -> app::Result<Option<String>> {
        Ok(self.list_boards(true)?.last().map(|b| b.rank.clone()))
    }

    /// Edit a board's shared row, re-creating it first if a peer removed it.
    fn edit_board(&mut self, id: &str, edit: impl FnOnce(&mut BoardRow)) -> app::Result<()> {
        if !self.board_exists(id)? {
            app::bail!(Error::NotFound(id.to_owned()));
        }
        if !self
            .boards
            .contains(id)
            .map_err(store_err("boards.contains"))?
        {
            let _ = self
                .boards
                .insert(id.to_owned(), BoardRow::missing())
                .map_err(store_err("boards.insert"))?;
        }
        let _ = self
            .boards
            .update(id, edit)
            .map_err(store_err("boards.update"))?;
        Ok(())
    }

    fn list_row(&self, list_id: &str) -> app::Result<Option<ListRow>> {
        Ok(self
            .lists
            .get(list_id)
            .map_err(store_err("lists.get"))?
            .map(|row| row.clone()))
    }

    /// The list's board id, or NotFound.
    fn require_list(&self, list_id: &str) -> app::Result<String> {
        match self.list_row(list_id)? {
            Some(row) => Ok(row.board_id.get().clone()),
            None => Err(AppError::from(Error::NotFound(list_id.to_owned()))),
        }
    }

    pub(crate) fn lists_of_board(&self, board_id: &str) -> app::Result<Vec<ListView>> {
        let mut out: Vec<ListView> = self
            .lists
            .query("board_id")
            .eq(board_id)
            .entries()
            .map_err(store_err("lists.query"))?
            .into_iter()
            .map(|(id, row)| ListView {
                id,
                board_id: row.board_id.get().clone(),
                name: row.name.get().clone(),
                rank: row.rank.get().clone(),
            })
            .collect();
        by_rank(&mut out, |l| (l.rank.clone(), l.id.clone()));
        Ok(out)
    }

    /// Unarchived cards in a list. Filled in with cards in the next task; a
    /// list with no card rows at all reports 0.
    fn live_cards_in_list(&self, list_id: &str) -> app::Result<u64> {
        let mut n = 0u64;
        for (id, row) in self
            .cards
            .query("list_id")
            .eq(list_id)
            .entries()
            .map_err(store_err("cards.query"))?
        {
            if !*row.archived.get() && self.card_exists(&id)? {
                n += 1;
            }
        }
        Ok(n)
    }

    fn card_holder(&self, id: &String) -> app::Result<Option<(AccountId, CardHeader)>> {
        Ok(self
            .card_headers
            .entries_at(id)
            .map_err(store_err("card_headers.entries_at"))?
            .into_iter()
            .min_by_key(|(owner, _)| *owner))
    }

    fn card_exists(&self, id: &str) -> app::Result<bool> {
        Ok(self.card_holder(&id.to_owned())?.is_some())
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    pub(crate) const OTHER: [u8; 32] = [0x22; 32];
    pub(crate) const OTHER_ACCOUNT: [u8; 32] = [0xA2; 32];

    pub(crate) fn host() -> TestHost<Board> {
        TestHost::new(Board::init)
    }

    #[test]
    fn create_board_lists_in_rank_order_with_creator() {
        let mut app = host();
        let a = app.call(|s| s.create_board("A".into(), None)).unwrap();
        let b = app.call(|s| s.create_board("B".into(), None)).unwrap();
        let me = app.view(|_| caller());
        let boards = app.view(|s| s.list_boards(false)).unwrap();
        assert_eq!(
            boards.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(),
            vec![a.as_str(), b.as_str()]
        );
        assert!(boards[0].rank < boards[1].rank);
        assert_eq!(boards[0].created_by, me);
        assert_eq!(boards[0].name, "A");
        assert!(!boards[0].archived);
    }

    #[test]
    fn create_board_rejects_bad_name_and_rank() {
        let mut app = host();
        assert!(app.call(|s| s.create_board("  ".into(), None)).is_err());
        assert!(app.call(|s| s.create_board("x".repeat(65), None)).is_err());
        assert!(app
            .call(|s| s.create_board("ok".into(), Some("A".into())))
            .is_err());
        assert!(app
            .call(|s| s.create_board("ok".into(), Some("a0".into())))
            .is_err());
    }

    #[test]
    fn rename_archive_and_move_board() {
        let mut app = host();
        let a = app.call(|s| s.create_board("A".into(), None)).unwrap();
        let b = app.call(|s| s.create_board("B".into(), None)).unwrap();
        app.call(|s| s.rename_board(a.clone(), "A2".into()))
            .unwrap();
        app.call(|s| s.move_board(a.clone(), "z".into())).unwrap();
        let boards = app.view(|s| s.list_boards(false)).unwrap();
        assert_eq!(boards[0].id, b);
        assert_eq!(boards[1].name, "A2");
        app.call(|s| s.set_board_archived(a.clone(), true)).unwrap();
        assert_eq!(app.view(|s| s.list_boards(false)).unwrap().len(), 1);
        assert_eq!(app.view(|s| s.list_boards(true)).unwrap().len(), 2);
        assert!(app
            .call(|s| s.rename_board("board-nope".into(), "x".into()))
            .is_err());
    }

    #[test]
    fn a_board_outlives_its_shared_row() {
        let mut app = host();
        let a = app.call(|s| s.create_board("A".into(), None)).unwrap();
        app.call_as_account(OTHER_ACCOUNT, OTHER, |s| s.boards.remove(&a))
            .unwrap();
        let boards = app.view(|s| s.list_boards(false)).unwrap();
        assert_eq!(boards.len(), 1);
        assert_eq!(boards[0].name, "");
        app.call(|s| s.rename_board(a.clone(), "Back".into()))
            .unwrap();
        assert_eq!(app.view(|s| s.list_boards(false)).unwrap()[0].name, "Back");
    }

    pub(crate) fn board_with_list(app: &mut TestHost<Board>) -> (String, String) {
        let b = app.call(|s| s.create_board("B".into(), None)).unwrap();
        let l = app
            .call(|s| s.create_list(b.clone(), "Todo".into(), None))
            .unwrap();
        (b, l)
    }

    #[test]
    fn lists_are_created_in_rank_order_per_board() {
        let mut app = host();
        let (b, todo) = board_with_list(&mut app);
        let doing = app
            .call(|s| s.create_list(b.clone(), "Doing".into(), None))
            .unwrap();
        let other = app.call(|s| s.create_board("Other".into(), None)).unwrap();
        let _ = app
            .call(|s| s.create_list(other.clone(), "Elsewhere".into(), None))
            .unwrap();
        let lists = app.view(|s| s.lists_of_board(&b)).unwrap();
        assert_eq!(
            lists.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(),
            vec![todo.as_str(), doing.as_str()]
        );
        assert!(lists[0].rank < lists[1].rank);
        assert!(app
            .call(|s| s.create_list("board-nope".into(), "x".into(), None))
            .is_err());
        assert!(app
            .call(|s| s.create_list(b.clone(), "".into(), None))
            .is_err());
    }

    #[test]
    fn rename_move_and_delete_list() {
        let mut app = host();
        let (b, todo) = board_with_list(&mut app);
        let doing = app
            .call(|s| s.create_list(b.clone(), "Doing".into(), None))
            .unwrap();
        app.call(|s| s.rename_list(todo.clone(), "Backlog".into()))
            .unwrap();
        app.call(|s| s.move_list(todo.clone(), "z".into())).unwrap();
        let lists = app.view(|s| s.lists_of_board(&b)).unwrap();
        assert_eq!(lists[0].id, doing);
        assert_eq!(lists[1].name, "Backlog");
        app.call(|s| s.delete_list(doing.clone())).unwrap();
        assert_eq!(app.view(|s| s.lists_of_board(&b)).unwrap().len(), 1);
        assert!(app.call(|s| s.delete_list(doing.clone())).is_err());
        assert!(app.call(|s| s.move_list(todo.clone(), "".into())).is_err());
    }
}
