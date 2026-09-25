//! A whole poll, in process: key ceremony, encrypted voting, close, threshold
//! decryption, audit, anchor — as three people, with the browser's half of the
//! protocol played by `mero-vote-crypto` directly.
//!
//! This is the only tier that runs the full cryptographic happy path against
//! the contract with several accounts. merobox cannot (it has no way to build
//! a proof for an account it only learns at run time) and the browser suite
//! drives one account. What this cannot show is replication; `converge.rs`
//! and the merobox scenario cover that.

//!
//! In-crate rather than under `tests/`: the `#[app::state]` macro implements
//! `TestState` under `#[cfg(test)]` only, so an integration test cannot build a
//! `TestHost` for this type.

use calimero_sdk::testing::TestHost;

use super::*;

const ALICE: [u8; 32] = [0xa1; 32];
const BOB: [u8; 32] = [0xb2; 32];
const CAROL: [u8; 32] = [0xc3; 32];
const MALLORY: [u8; 32] = [0xd4; 32];

fn dev(account: [u8; 32]) -> [u8; 32] {
    let mut d = account;
    d[0] ^= 0xff;
    d
}

fn account(app: &mut TestHost<MeroVote>, who: [u8; 32]) -> String {
    app.call_as_account(who, dev(who), |s| s.whoami().account)
}

fn wire_branch(b: &crypto::Branch) -> WireBranch {
    WireBranch {
        c: crypto::encode_scalar(&b.c),
        z: crypto::encode_scalar(&b.z),
    }
}

fn wire_ballot(b: &crypto::Ballot) -> WireBallot {
    WireBallot {
        choices: b
            .choices
            .iter()
            .map(|c| WireChoice {
                a: crypto::encode_point(&c.ct.a),
                b: crypto::encode_point(&c.ct.b),
                proof: c.proof.iter().map(wire_branch).collect(),
            })
            .collect(),
        sum_proof: b.sum_proof.iter().map(wire_branch).collect(),
    }
}

struct Poll {
    app: TestHost<MeroVote>,
    id: String,
    accounts: [String; 3],
    secrets: [crypto::FieldScalar; 2],
}

fn setup() -> Poll {
    let mut app = TestHost::new(MeroVote::init);
    let accounts = [
        account(&mut app, ALICE),
        account(&mut app, BOB),
        account(&mut app, CAROL),
    ];
    assert_eq!(
        accounts[0],
        hex::encode(ALICE),
        "an account is its 64-hex bytes"
    );

    let id = app
        .call_as_account(ALICE, dev(ALICE), |s| {
            s.create_poll(
                "Lunch".into(),
                "Where do we eat on Friday?".into(),
                vec!["Pizza".into(), "Sushi".into(), "Tacos".into()],
                1,
                1,
                vec![accounts[0].clone(), accounts[1].clone()],
                accounts.to_vec(),
                None,
            )
        })
        .expect("create_poll");

    let mut secrets = [crypto::FieldScalar::ZERO; 2];
    for (i, who) in [ALICE, BOB].into_iter().enumerate() {
        let seed = format!("trustee-{i}");
        let mut rng = crypto::seeded_rng(seed.as_bytes());
        let x = rng();
        let (h, proof) = crypto::make_key_share(&id, &accounts[i], &x, &mut rng);
        let pid = id.clone();
        app.call_as_account(who, dev(who), |s| {
            s.publish_key_share(pid, crypto::encode_point(&h), wire_branch(&proof))
        })
        .expect("publish_key_share");
        secrets[i] = x;
    }
    Poll {
        app,
        id,
        accounts,
        secrets,
    }
}

fn election_key(p: &mut Poll) -> crypto::Point {
    let pid = p.id.clone();
    let view = p
        .app
        .call_as_account(ALICE, dev(ALICE), |s| s.get_poll(pid))
        .unwrap();
    crypto::decode_point(&view.state.election.unwrap().key, "key").unwrap()
}

fn vote(
    p: &mut Poll,
    who: [u8; 32],
    voter: &str,
    sel: [bool; 3],
    seed: &str,
) -> Result<String, String> {
    let pk = election_key(p);
    let rules = crypto::Rules {
        options: 3,
        min: 1,
        max: 1,
    };
    let mut rng = crypto::seeded_rng(seed.as_bytes());
    let ballot = crypto::cast_ballot(&pk, &p.id, voter, &rules, &sel, &mut rng).unwrap();
    let pid = p.id.clone();
    p.app
        .call_as_account(who, dev(who), |s| s.cast_ballot(pid, wire_ballot(&ballot)))
        .map_err(|e| format!("{e:?}"))
}

#[test]
fn a_poll_runs_end_to_end_and_audits_clean() {
    let mut p = setup();
    let pid = p.id.clone();

    // Only the creator opens, and only once every trustee has published.
    assert!(p
        .app
        .call_as_account(BOB, dev(BOB), |s| s.open_voting(pid.clone()))
        .is_err());
    p.app
        .call_as_account(ALICE, dev(ALICE), |s| s.open_voting(pid.clone()))
        .unwrap();

    let [a, b, c] = p.accounts.clone();
    vote(&mut p, ALICE, &a, [true, false, false], "va").unwrap();
    vote(&mut p, BOB, &b, [false, false, true], "vb").unwrap();
    vote(&mut p, CAROL, &c, [false, true, false], "vc1").unwrap();
    // Carol changes her mind. The later ballot replaces the earlier one.
    let carol_receipt = vote(&mut p, CAROL, &c, [true, false, false], "vc2").unwrap();

    // Not on the roll.
    let m = hex::encode(MALLORY);
    assert!(vote(&mut p, MALLORY, &m, [true, false, false], "vm").is_err());
    // A ballot built for Alice, submitted by Carol: the proof binds the voter.
    assert!(vote(&mut p, CAROL, &a, [true, false, false], "replay").is_err());

    let view = p
        .app
        .call_as_account(CAROL, dev(CAROL), |s| s.get_poll(pid.clone()))
        .unwrap();
    assert_eq!(view.turnout.len(), 3, "turnout shows who voted");
    assert_eq!(view.my_digest.as_deref(), Some(carol_receipt.as_str()));

    // Only the creator closes.
    assert!(p
        .app
        .call_as_account(CAROL, dev(CAROL), |s| s.close_poll(pid.clone()))
        .is_err());
    let counted = p
        .app
        .call_as_account(ALICE, dev(ALICE), |s| s.close_poll(pid.clone()))
        .unwrap();
    assert_eq!(counted, 3);
    assert!(
        vote(&mut p, CAROL, &c, [false, false, true], "late").is_err(),
        "closed means closed"
    );

    // Before any partial: the audit holds, but there is no result.
    let report = p
        .app
        .call_as_account(CAROL, dev(CAROL), |s| s.get_result(pid.clone()))
        .unwrap();
    assert!(report.verified, "{:?}", report.checks);
    assert!(report.counts.is_none());

    // Trustees decrypt the aggregates, never a ballot.
    let inputs = p
        .app
        .call_as_account(ALICE, dev(ALICE), |s| s.tally_inputs(pid.clone()))
        .unwrap();
    assert_eq!(inputs.counted, 3);
    for (i, who) in [ALICE, BOB].into_iter().enumerate() {
        let seed = format!("partial-{i}");
        let mut rng = crypto::seeded_rng(seed.as_bytes());
        let partials: Vec<WirePartial> = inputs
            .aggregate
            .iter()
            .enumerate()
            .map(|(j, ct)| {
                let a = crypto::decode_point(&ct.a, "a").unwrap();
                let (d, proof) = crypto::partial_decrypt(
                    &pid,
                    &p.accounts[i],
                    j as u32,
                    &p.secrets[i],
                    &a,
                    &mut rng,
                );
                WirePartial {
                    d: crypto::encode_point(&d),
                    proof: wire_branch(&proof),
                }
            })
            .collect();

        // A partial for the wrong trustee's key is refused.
        if i == 1 {
            let forged = partials.clone();
            assert!(p
                .app
                .call_as_account(ALICE, dev(ALICE), |s| s
                    .publish_partial(pid.clone(), forged))
                .is_err());
        }
        p.app
            .call_as_account(who, dev(who), |s| s.publish_partial(pid.clone(), partials))
            .unwrap();
    }

    let report = p
        .app
        .call_as_account(CAROL, dev(CAROL), |s| s.get_result(pid.clone()))
        .unwrap();
    assert!(report.verified, "{:?}", report.checks);
    assert_eq!(report.phase, Phase::Closed);
    assert_eq!(
        report.counts,
        Some(vec![2, 0, 1]),
        "Carol's second ballot is the one counted"
    );
    let digest = report.transcript_digest.clone().unwrap();

    // The transcript carries exactly what the audit checked.
    let t = p
        .app
        .call_as_account(BOB, dev(BOB), |s| s.get_transcript(pid.clone()))
        .unwrap();
    assert_eq!(t.ballots.len(), 3);
    assert!(t.ballots.iter().all(|b| b.endorsed));
    assert_eq!(t.partials.len(), 2);
    assert_eq!(t.report.transcript_digest.as_deref(), Some(digest.as_str()));

    // Anchoring: creator only, and it records the digest the node computed.
    assert!(p
        .app
        .call_as_account(BOB, dev(BOB), |s| s.anchor_result(
            pid.clone(),
            "git".into(),
            "abc".into()
        ))
        .is_err());
    let anchored = p
        .app
        .call_as_account(ALICE, dev(ALICE), |s| {
            s.anchor_result(pid.clone(), "ethereum:sepolia".into(), "0xfeed".into())
        })
        .unwrap();
    assert_eq!(anchored, digest);
    let report = p
        .app
        .call_as_account(CAROL, dev(CAROL), |s| s.get_result(pid.clone()))
        .unwrap();
    assert!(report.verified);
    assert!(report.checks.iter().any(|c| c.name == "anchor" && c.ok));
}

#[test]
fn a_trustee_cannot_publish_a_share_it_cannot_prove() {
    let mut app = TestHost::new(MeroVote::init);
    let alice = account(&mut app, ALICE);
    let bob = account(&mut app, BOB);
    let pid = app
        .call_as_account(ALICE, dev(ALICE), |s| {
            s.create_poll(
                "Q".into(),
                "".into(),
                vec!["y".into(), "n".into()],
                1,
                1,
                vec![alice.clone(), bob.clone()],
                vec![],
                None,
            )
        })
        .unwrap();

    let mut rng = crypto::seeded_rng(b"alice");
    let x = rng();
    let (h, proof) = crypto::make_key_share(&pid, &alice, &x, &mut rng);

    // Bob copies Alice's share and proof: bound to Alice's account, refused.
    let (h2, p2) = (crypto::encode_point(&h), wire_branch(&proof));
    assert!(app
        .call_as_account(BOB, dev(BOB), |s| s.publish_key_share(pid.clone(), h2, p2))
        .is_err());
    // A non-trustee cannot publish at all.
    let (h3, p3) = (crypto::encode_point(&h), wire_branch(&proof));
    assert!(app
        .call_as_account(CAROL, dev(CAROL), |s| s.publish_key_share(
            pid.clone(),
            h3,
            p3
        ))
        .is_err());
    // Voting cannot open with a trustee missing.
    app.call_as_account(ALICE, dev(ALICE), |s| {
        s.publish_key_share(pid.clone(), crypto::encode_point(&h), wire_branch(&proof))
    })
    .unwrap();
    assert!(app
        .call_as_account(ALICE, dev(ALICE), |s| s.open_voting(pid.clone()))
        .is_err());
}

#[test]
fn poll_definitions_are_validated() {
    let mut app = TestHost::new(MeroVote::init);
    let alice = account(&mut app, ALICE);
    let mut make = |opts: Vec<&str>, min: u32, max: u32, trustees: Vec<String>| {
        app.call_as_account(ALICE, dev(ALICE), |s| {
            s.create_poll(
                "T".into(),
                "".into(),
                opts.into_iter().map(String::from).collect(),
                min,
                max,
                trustees,
                vec![],
                None,
            )
        })
    };
    assert!(
        make(vec!["only"], 1, 1, vec![alice.clone()]).is_err(),
        "one option"
    );
    assert!(
        make(vec!["a", "a"], 1, 1, vec![alice.clone()]).is_err(),
        "duplicate options"
    );
    assert!(
        make(vec!["a", "b"], 2, 1, vec![alice.clone()]).is_err(),
        "min > max"
    );
    assert!(
        make(vec!["a", "b"], 1, 3, vec![alice.clone()]).is_err(),
        "max > options"
    );
    assert!(make(vec!["a", "b"], 1, 1, vec![]).is_err(), "no trustee");
    assert!(
        make(vec!["a", "b"], 1, 1, vec!["nope".into()]).is_err(),
        "bad account"
    );
    assert!(
        make(vec!["a", "b"], 0, 2, vec![alice.clone()]).is_ok(),
        "approval poll"
    );

    let polls = app
        .call_as_account(ALICE, dev(ALICE), |s| s.list_polls())
        .unwrap();
    assert_eq!(polls.len(), 1);
    assert_eq!(polls[0].phase, Phase::KeyCeremony);
}

#[test]
fn the_roster_lists_named_members() {
    let mut app = TestHost::new(MeroVote::init);
    app.call_as_account(ALICE, dev(ALICE), |s| s.set_name("Alice".into()))
        .unwrap();
    app.call_as_account(BOB, dev(BOB), |s| s.set_name("Bob".into()))
        .unwrap();
    assert!(app
        .call_as_account(BOB, dev(BOB), |s| s.set_name("   ".into()))
        .is_err());
    let roster = app
        .call_as_account(CAROL, dev(CAROL), |s| s.roster())
        .unwrap();
    let names: Vec<_> = roster.iter().map(|m| m.name.as_str()).collect();
    assert_eq!(names, vec!["Alice", "Bob"]);
    assert_eq!(roster[0].account, hex::encode(ALICE));
}

/// The transcript text is the one thing both implementations must build
/// identically that `vectors.json` does not cover, because it lives in this
/// crate rather than the crypto one. Same fixed inputs here and in the
/// frontend's `verify.test.ts`, same digest asserted in both.
#[test]
fn transcript_digest_is_pinned() {
    let def = PollDefinition {
        title: "Lunch\nnext: forged line".into(),
        description: String::new(),
        options: vec!["Pizza".into(), "Sushi 🍣".into(), "Tacos".into()],
        min_choices: 1,
        max_choices: 2,
        trustees: vec!["11".repeat(32), "22".repeat(32)],
        voters: vec![],
        creator: "11".repeat(32),
        created_at: 0,
        closes_at: None,
    };
    let election = Election {
        key: "aa".repeat(32),
        shares: vec![
            KeyShare {
                trustee: "11".repeat(32),
                share: "bb".repeat(32),
                proof: WireBranch {
                    c: String::new(),
                    z: String::new(),
                },
            },
            KeyShare {
                trustee: "22".repeat(32),
                share: "cc".repeat(32),
                proof: WireBranch {
                    c: String::new(),
                    z: String::new(),
                },
            },
        ],
        opened_at: 0,
    };
    let counted = vec![CountedBallot {
        voter: "33".repeat(32),
        digest: "dd".repeat(32),
        frozen: String::new(),
    }];
    let partial = |d: &str| WirePartial {
        d: d.repeat(32),
        proof: WireBranch {
            c: String::new(),
            z: String::new(),
        },
    };
    let partials = vec![
        (
            "11".repeat(32),
            vec![partial("e1"), partial("e2"), partial("e3")],
        ),
        (
            "22".repeat(32),
            vec![partial("f1"), partial("f2"), partial("f3")],
        ),
    ];
    let text = transcript_text(
        &"00".repeat(32),
        &def,
        &election,
        &counted,
        &partials,
        &[1, 0, 1],
    );
    assert!(text.starts_with("mero-vote/v1/transcript\npoll 0000"));
    assert!(!text.contains("forged"), "free text is hex-encoded");
    assert_eq!(transcript_digest(&text), PINNED_TRANSCRIPT_DIGEST, "{text}");
}

const PINNED_TRANSCRIPT_DIGEST: &str =
    "54f905551c4dbf1a70ac8f6d87a3063ec15f5cef3f6b550ff9fb0e173c3b6195";
