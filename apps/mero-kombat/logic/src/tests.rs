//! The contract's own rules: who may take a corner, what a blow is worth, and
//! how rounds and matches are decided — driven through `TestHost` as two
//! different PEOPLE.

use calimero_sdk::testing::TestHost;

use crate::{ArenaView, MeroKombat, MAX_HP};

const ALICE: [u8; 32] = [0xA1; 32];
const ALICE_PHONE: [u8; 32] = [0xA2; 32];
const BOB: [u8; 32] = [0xB0; 32];
const CAROL: [u8; 32] = [0xC0; 32];

fn at(step: u64) -> u64 {
    1_700_000_000_000 + step * 10
}

fn arena_as(app: &mut TestHost<MeroKombat>, account: [u8; 32], now: u64) -> ArenaView {
    app.set_account(account);
    app.view(|s| s.arena(now)).expect("arena")
}

/// Alice in the left corner as Kinetic, Bob in the right as Cryo.
fn seated() -> TestHost<MeroKombat> {
    let mut app = TestHost::new(|| MeroKombat::init("Test arena".to_owned(), at(0)));
    app.call_as_account(ALICE, ALICE, |s| {
        s.sit(
            "p1".to_owned(),
            "Alice".to_owned(),
            "kinetic".to_owned(),
            at(1),
        )
    })
    .expect("alice sits");
    app.call_as_account(BOB, BOB, |s| {
        s.sit("p2".to_owned(), "Bob".to_owned(), "cryo".to_owned(), at(2))
    })
    .expect("bob sits");
    app
}

struct Fight {
    app: TestHost<MeroKombat>,
    clock: u64,
    seq: u32,
}

impl Fight {
    fn new() -> Self {
        Self {
            app: seated(),
            clock: 10,
            seq: 0,
        }
    }

    fn act(&mut self, who: [u8; 32], kind: &str, hit: bool, blocked: bool) -> Result<(), String> {
        let view = arena_as(&mut self.app, who, at(self.clock));
        self.clock += 1;
        self.seq += 1;
        let (m, r, id, now) = (view.match_index, view.round, self.seq, at(self.clock));
        self.app
            .call_as_account(who, who, |s| {
                s.act(m, r, id, kind.to_owned(), hit, blocked, now)
            })
            .map_err(|e| format!("{e:?}"))
    }

    /// Uppercut until the other corner falls: 13 a blow, so eight of them.
    fn knock_out(&mut self, who: [u8; 32]) {
        let start = arena_as(&mut self.app, who, at(self.clock))
            .round_results
            .len();
        while arena_as(&mut self.app, who, at(self.clock))
            .round_results
            .len()
            == start
        {
            self.act(who, "uppercut", true, false)
                .expect("uppercut lands");
        }
    }

    fn view(&mut self, who: [u8; 32]) -> ArenaView {
        arena_as(&mut self.app, who, at(self.clock))
    }
}

#[test]
fn a_new_arena_is_waiting_for_fighters() {
    let app = TestHost::new(|| MeroKombat::init("  ".to_owned(), at(0)));
    let view = app.view(|s| s.arena(at(1))).expect("arena");
    assert_eq!(view.title, "Arena");
    assert_eq!(view.status, "waiting");
    assert_eq!(view.p1.hp, MAX_HP);
    assert_eq!(view.p2.hp, MAX_HP);
    assert!(view.p1.member.is_empty());
    assert_eq!(view.total_actions, 0);
}

#[test]
fn two_people_take_the_corners() {
    let mut app = seated();
    let view = arena_as(&mut app, ALICE, at(3));
    assert_eq!(view.status, "fighting");
    assert_eq!(view.my_seat, "p1");
    assert_eq!(view.p1.name, "Alice");
    assert_eq!(view.p1.fighter, "kinetic");
    assert_eq!(view.p2.fighter, "cryo");
    assert!(view.p1.online);

    // Carol is too late for either corner.
    assert!(app
        .call_as_account(CAROL, CAROL, |s| s.sit(
            "p1".to_owned(),
            "Carol".to_owned(),
            "inferno".to_owned(),
            at(4)
        ))
        .is_err());
    assert_eq!(arena_as(&mut app, CAROL, at(5)).my_seat, "");
}

#[test]
fn one_person_cannot_fight_themselves() {
    let mut app = TestHost::new(|| MeroKombat::init("Solo".to_owned(), at(0)));
    app.call_as_account(ALICE, ALICE, |s| {
        s.sit(
            "p1".to_owned(),
            "Alice".to_owned(),
            "kinetic".to_owned(),
            at(1),
        )
    })
    .expect("p1");
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.sit(
            "p2".to_owned(),
            "Alice".to_owned(),
            "kinetic".to_owned(),
            at(2)
        ))
        .is_err());
}

#[test]
fn nobody_can_act_before_an_opponent_arrives() {
    let mut app = TestHost::new(|| MeroKombat::init("Arena".to_owned(), at(0)));
    app.call_as_account(ALICE, ALICE, |s| {
        s.sit(
            "p1".to_owned(),
            "Alice".to_owned(),
            "kinetic".to_owned(),
            at(1),
        )
    })
    .expect("p1");
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.act(
            0,
            0,
            1,
            "punch".to_owned(),
            true,
            false,
            at(2)
        ))
        .is_err());
}

#[test]
fn every_action_is_counted_and_only_hits_hurt() {
    let mut fight = Fight::new();
    fight.act(ALICE, "jump", false, false).expect("jump");
    fight.act(ALICE, "punch", false, false).expect("whiff");
    fight.act(ALICE, "kick", true, false).expect("kick lands");
    fight.act(BOB, "punch", true, true).expect("blocked punch");

    let view = fight.view(BOB);
    assert_eq!(view.total_actions, 4);
    assert_eq!(view.match_actions, 4);
    assert_eq!(view.p2.hp, MAX_HP - 7);
    // A guarded blow chips; it does not do its full damage.
    assert_eq!(view.p1.hp, MAX_HP - 1);
    assert_eq!(view.hits.len(), 2);
    assert!(view
        .hits
        .iter()
        .any(|h| h.by == "p1" && h.kind == "kick" && h.damage == 7));
}

#[test]
fn a_jump_cannot_be_claimed_as_a_hit() {
    let mut fight = Fight::new();
    fight.act(ALICE, "jump", true, false).expect("jump");
    assert_eq!(fight.view(ALICE).p2.hp, MAX_HP);
}

#[test]
fn unknown_moves_and_spectators_are_refused() {
    let mut fight = Fight::new();
    assert!(fight.act(ALICE, "fatality", true, false).is_err());
    assert!(fight.act(CAROL, "punch", true, false).is_err());
}

#[test]
fn best_of_three_decides_the_match() {
    let mut fight = Fight::new();
    fight.knock_out(ALICE);
    let view = fight.view(ALICE);
    assert_eq!(view.round_results, vec!["p1".to_owned()]);
    assert_eq!(view.round, 1);
    // Fresh health for round two.
    assert_eq!(view.p2.hp, MAX_HP);
    assert_eq!(view.status, "fighting");

    fight.knock_out(BOB);
    fight.knock_out(ALICE);
    let view = fight.view(BOB);
    assert_eq!(view.status, "finished");
    assert_eq!(view.winner, "p1");
    assert_eq!(view.p1.rounds_won, 2);
    assert_eq!(view.p1.matches_won, 1);
    // Bob never touched Alice in the deciding round.
    assert!(view.flawless);

    // Nothing more lands once the match is over.
    assert!(fight.act(BOB, "punch", true, false).is_err());
}

#[test]
fn a_blow_for_a_finished_round_is_refused() {
    let mut fight = Fight::new();
    fight.knock_out(ALICE);
    let late = fight.app.call_as_account(BOB, BOB, |s| {
        s.act(0, 0, 999, "punch".to_owned(), true, false, at(900))
    });
    assert!(late.is_err());
}

#[test]
fn a_rematch_resets_the_fight_and_keeps_the_score() {
    let mut fight = Fight::new();
    assert!(fight
        .app
        .call_as_account(ALICE, ALICE, |s| s.rematch(at(50)))
        .is_err());
    fight.knock_out(BOB);
    fight.knock_out(BOB);
    assert_eq!(fight.view(ALICE).winner, "p2");

    let next = fight
        .app
        .call_as_account(ALICE, ALICE, |s| s.rematch(at(500)))
        .expect("rematch");
    assert_eq!(next, 1);
    let view = fight.view(ALICE);
    assert_eq!(view.match_index, 1);
    assert_eq!(view.status, "fighting");
    assert_eq!(view.round, 0);
    assert_eq!(view.p1.hp, MAX_HP);
    assert_eq!(view.p2.matches_won, 1);
    assert_eq!(view.match_actions, 0);
    assert!(view.total_actions > 0);

    let history = fight.app.view(|s| s.history()).expect("history");
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].winner, "p2");
}

#[test]
fn corners_lock_once_both_fighters_have_acted() {
    let mut fight = Fight::new();
    fight.act(ALICE, "punch", true, false).expect("alice");
    fight.act(BOB, "punch", true, false).expect("bob");
    // Carol claims a corner dated before everyone's. She does not get it.
    let _refused = fight.app.call_as_account(CAROL, CAROL, |s| {
        s.sit("p1".to_owned(), "Carol".to_owned(), "jinzo".to_owned(), 1)
    });
    let view = fight.view(ALICE);
    assert_eq!(view.p1.name, "Alice");
    assert_eq!(view.my_seat, "p1");
}

#[test]
fn a_fighter_can_switch_character() {
    let mut app = seated();
    app.call_as_account(ALICE, ALICE, |s| s.pick("jinzo".to_owned(), at(5)))
        .expect("pick");
    assert_eq!(arena_as(&mut app, BOB, at(6)).p1.fighter, "jinzo");
    assert!(app
        .call_as_account(ALICE, ALICE, |s| s.pick("goro".to_owned(), at(7)))
        .is_err());
}

#[test]
fn standing_up_is_only_allowed_before_fighting() {
    let mut app = seated();
    app.call_as_account(BOB, BOB, |s| s.stand(at(3)))
        .expect("bob stands");
    assert_eq!(arena_as(&mut app, ALICE, at(4)).status, "waiting");
    app.call_as_account(CAROL, CAROL, |s| {
        s.sit(
            "p2".to_owned(),
            "Carol".to_owned(),
            "inferno".to_owned(),
            at(5),
        )
    })
    .expect("carol takes the free corner");

    let mut fight = Fight {
        app,
        clock: 10,
        seq: 0,
    };
    fight.act(ALICE, "punch", true, false).expect("alice");
    assert!(fight
        .app
        .call_as_account(ALICE, ALICE, |s| s.stand(at(99)))
        .is_err());
}

#[test]
fn one_person_fights_from_two_devices() {
    let mut app = seated();
    // Alice's phone is the same account on another device.
    app.call_as_account(ALICE, ALICE_PHONE, |s| {
        s.act(0, 0, 1, "kick".to_owned(), true, false, at(20))
    })
    .expect("alice's phone fights for alice");
    assert_eq!(arena_as(&mut app, ALICE, at(21)).p2.hp, MAX_HP - 7);
}
