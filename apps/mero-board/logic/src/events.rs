//! Events emitted by the board service. Borrowed fields keep emission
//! allocation-free.

#[calimero_sdk::app::event]
pub enum Event<'a> {
    BoardCreated {
        id: &'a str,
        created_by: &'a str,
    },
    BoardChanged {
        id: &'a str,
    },
    BoardDeleted {
        id: &'a str,
    },
    ListCreated {
        id: &'a str,
        board_id: &'a str,
    },
    ListChanged {
        id: &'a str,
        board_id: &'a str,
    },
    ListDeleted {
        id: &'a str,
        board_id: &'a str,
    },
    CardCreated {
        id: &'a str,
        board_id: &'a str,
        created_by: &'a str,
    },
    CardMoved {
        id: &'a str,
        board_id: &'a str,
        list_id: &'a str,
    },
    CardChanged {
        id: &'a str,
        board_id: &'a str,
    },
    CardDeleted {
        id: &'a str,
        board_id: &'a str,
    },
    ChecklistChanged {
        card_id: &'a str,
    },
    CommentAdded {
        id: &'a str,
        card_id: &'a str,
    },
    CommentEdited {
        id: &'a str,
    },
    CommentDeleted {
        id: &'a str,
    },
}
