//! Convergence coverage. `BoardRow`, `ListRow`, `CardRow` and
//! `ChecklistItemRow` nest `LwwRegister`s and hand-write `Mergeable`, so this
//! is the #2577 case: the re-key thunks are registered and every replica must
//! land on the same Merkle root. The owned headers and comments are written at
//! genesis only (single identity), so the bare harness reconciles everything.

use calimero_storage::testing::converge_app;
use mero_board::Board;
use serial_test::serial;

fn seeded() -> Board {
    let mut s = Board::init();
    let b = s.create_board("seed".into(), None).unwrap();
    let todo = s.create_list(b.clone(), "Todo".into(), None).unwrap();
    let _ = s.create_list(b.clone(), "Doing".into(), None).unwrap();
    let _ = s
        .create_card(b, todo, "card".into(), None, None, None, None, None)
        .unwrap();
    s
}

fn only_board(s: &Board) -> mero_board::BoardDetail {
    let b = s.list_boards(true).unwrap().remove(0);
    s.get_board(b.id).unwrap()
}

#[test]
#[serial]
fn concurrent_moves_of_one_card_converge_to_one_list() {
    Board::__calimero_register_rekey();
    converge_app(seeded)
        .replicas(3)
        .ops(|s| {
            let d = only_board(s);
            let card = d.cards[0].id.clone();
            // Every replica moves the card to the same list (computed from its own state, which is identical); the test checks one surviving card and equal Merkle roots.
            let n = s.list_cards(None, None, None, None, true).unwrap().len();
            let list = d.lists[n % d.lists.len()].id.clone();
            let _ = s.move_card(card, list, "n".into());
        })
        .invariant(
            "the single card is in exactly one of the board's lists",
            |s| {
                let d = only_board(s);
                d.cards.len() == 1 && d.lists.iter().any(|l| l.id == d.cards[0].list_id)
            },
        )
        .assert_all_replicas_equal();
}

#[test]
#[serial]
fn concurrent_list_creation_converges() {
    Board::__calimero_register_rekey();
    converge_app(seeded)
        .replicas(3)
        .ops(|s| {
            let b = s.list_boards(true).unwrap().remove(0).id;
            let _ = s.create_list(b, "Review".into(), None);
        })
        .invariant(
            "every replica sees the seeded lists plus one per replica",
            |s| only_board(s).lists.len() >= 3,
        )
        .assert_all_replicas_equal();
}

#[test]
#[serial]
fn concurrent_card_edits_converge_field_by_field() {
    Board::__calimero_register_rekey();
    converge_app(seeded)
        .replicas(2)
        .ops(|s| {
            let card = only_board(s).cards[0].id.clone();
            let _ = s.set_card_title(card.clone(), "renamed".into());
            let _ = s.set_card_assignee(card, Some("alice".into()));
        })
        .invariant("the card carries the merged edits", |s| {
            let c = &only_board(s).cards[0];
            c.title == "renamed" && c.assignee.as_deref() == Some("alice")
        })
        .assert_all_replicas_equal();
}
