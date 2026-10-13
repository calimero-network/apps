//! Convergence coverage. `BoardRow`, `ListRow`, `CardRow` and
//! `ChecklistItemRow` nest `LwwRegister`s and hand-write `Mergeable`, so this
//! is the #2577 case: the re-key thunks are registered and every replica must
//! land on the same Merkle root. Replicas write as distinct accounts; the
//! delete-vs-edit case uses `Script` so only the creator's replica deletes.

use calimero_storage::testing::{converge_app, Script};
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
            // The harness gives every replica its own account (first byte
            // r + 1), so replicas 0, 1, 2 pick lists 1, 0, 1 and ranks "r",
            // "n", "r": the three writes genuinely diverge in both fields.
            let who = calimero_sdk::env::account_id()[0] as usize;
            let list = d.lists[who % d.lists.len()].id.clone();
            let rank = if who.is_multiple_of(2) { "n" } else { "r" };
            s.move_card(card, list, rank.into()).unwrap();
        })
        .invariant(
            "the single card is in exactly one of the board's lists",
            |s| {
                let d = only_board(s);
                d.cards.len() == 1
                    && d.lists.iter().any(|l| l.id == d.cards[0].list_id)
                    && s.list_cards(None, None, None, None, true).unwrap().len() == 1
            },
        )
        .assert_all_replicas_equal();
}

#[test]
#[serial]
fn a_deleted_card_stays_deleted_under_a_concurrent_body_edit() {
    Board::__calimero_register_rekey();
    // `converge_app` runs every op on every replica, so it cannot have one
    // replica delete while another edits. `Script` can: the founder replica
    // writes as the genesis account (the card's creator) and deletes; a member
    // replica, its own account, edits the body concurrently. Every delivery
    // order is replayed on a fresh replica and must reach one root.
    let mut script = Script::new(seeded);
    calimero_sdk::event::register::<Board>();
    let creator = script.founder();
    let editor = script.member();
    let card = script.view(creator, |s| only_board(s).cards[0].id.clone());
    let deleted = script
        .run(creator, |s| s.delete_card(card.clone()).unwrap())
        .expect("the delete wrote a delta");
    let edited = script
        .run(editor, |s| {
            s.set_card_description(card.clone(), "concurrent body".into())
                .unwrap()
        })
        .expect("the edit wrote a delta");
    assert_eq!(script.deliver(creator, edited), 0);
    assert_eq!(script.deliver(editor, deleted), 0);
    let gone = |s: &Board| {
        s.get_card(card.clone()).is_err()
            && s.list_cards(None, None, None, None, true)
                .unwrap()
                .is_empty()
    };
    assert!(
        script.view(creator, gone),
        "the creator still sees the card"
    );
    assert!(script.view(editor, gone), "the editor still sees the card");
    let orders = script.assert_every_order_converges(gone);
    assert_eq!(orders, 2, "both delivery orders were replayed");
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
