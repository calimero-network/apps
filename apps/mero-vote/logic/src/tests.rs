//! Whole polls, in process: the t-of-n key ceremony (with a cheating dealer
//! caught by a complaint), encrypted voting, close → seal, threshold
//! decryption with a trustee missing, audit, anchor — as several people, with
//! the browser's half of the protocol played by `mero-vote-crypto` directly.
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

fn acct(who: [u8; 32]) -> String {
    hex::encode(who)
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

fn wire_dealing(d: &crypto::Dealing) -> WireDealing {
    WireDealing {
        commitments: d.commitments.iter().map(crypto::encode_point).collect(),
        proof: wire_branch(&d.proof),
        shares: d
            .shares
            .iter()
            .map(|s| WireEncShare {
                r: crypto::encode_point(&s.r),
                v: crypto::encode_scalar(&s.v),
            })
            .collect(),
    }
}

struct Poll {
    app: TestHost<MeroVote>,
    id: String,
    trustees: Vec<[u8; 32]>,
    /// Transport secrets, by trustee position.
    es: Vec<crypto::FieldScalar>,
}

impl Poll {
    fn call<R>(&mut self, who: [u8; 32], f: impl FnOnce(&mut MeroVote) -> R) -> R {
        self.app.call_as_account(who, dev(who), f)
    }

    fn view(&mut self, who: [u8; 32]) -> PollView {
        let pid = self.id.clone();
        self.call(who, |s| s.get_poll(pid)).unwrap()
    }

    fn report(&mut self) -> AuditReport {
        let pid = self.id.clone();
        self.call(MALLORY, |s| s.get_result(pid)).unwrap()
    }

    /// Round 1 for every trustee.
    fn publish_transport_keys(&mut self) {
        for (i, who) in self.trustees.clone().into_iter().enumerate() {
            let seed = format!("transport-{i}");
            let mut rng = crypto::seeded_rng(seed.as_bytes());
            let e = rng();
            let (key, proof) = crypto::make_transport_key(&self.id, &acct(who), &e, &mut rng);
            let pid = self.id.clone();
            self.call(who, |s| {
                s.publish_transport_key(pid, crypto::encode_point(&key), wire_branch(&proof))
            })
            .expect("publish_transport_key");
            self.es.push(e);
        }
    }

    /// Round 2 for `dealers` (positions). `corrupt` = (dealer, recipient)
    /// positions whose share gets tampered with.
    fn deal(&mut self, dealers: &[usize], corrupt: Option<(usize, usize)>) {
        let pid = self.id.clone();
        let cer = self.call(ALICE, |s| s.ceremony(pid.clone())).unwrap();
        let keys: Vec<_> = cer
            .trustees
            .iter()
            .map(|t| crypto::decode_point(t.transport.as_ref().unwrap(), "t").unwrap())
            .collect();
        for &i in dealers {
            let who = self.trustees[i];
            let seed = format!("dealing-{i}");
            let mut rng = crypto::seeded_rng(seed.as_bytes());
            let mut d = crypto::deal(&self.id, &acct(who), cer.threshold, &keys, &mut rng).unwrap();
            if let Some((dealer, recipient)) = corrupt {
                if dealer == i {
                    d.shares[recipient].v += crypto::FieldScalar::ONE;
                }
            }
            let w = wire_dealing(&d);
            let pid = self.id.clone();
            self.call(who, |s| s.publish_dealing(pid, w))
                .expect("publish_dealing");
        }
    }

    /// Trustee `i`'s combined key over the frozen qualified dealings.
    fn combined_secret(&mut self, i: usize) -> crypto::FieldScalar {
        let election = self.view(ALICE).state.election.unwrap();
        election
            .qualified
            .iter()
            .map(|q| {
                let d = decode_dealing(&q.dealing).unwrap();
                crypto::open_share(&self.id, &q.dealer, i as u32 + 1, &self.es[i], &d)
                    .expect("an honest dealer's share opens")
            })
            .sum()
    }

    fn vote(
        &mut self,
        who: [u8; 32],
        voter: &str,
        sel: [bool; 3],
        seed: &str,
    ) -> Result<String, String> {
        let key = self.view(ALICE).state.election.unwrap().key;
        let pk = crypto::decode_point(&key, "key").unwrap();
        let rules = crypto::Rules {
            options: 3,
            min: 1,
            max: 1,
        };
        let mut rng = crypto::seeded_rng(seed.as_bytes());
        let ballot = crypto::cast_ballot(&pk, &self.id, voter, &rules, &sel, &mut rng).unwrap();
        let pid = self.id.clone();
        self.call(who, |s| s.cast_ballot(pid, wire_ballot(&ballot)))
            .map_err(|e| format!("{e:?}"))
    }

    fn decrypt(&mut self, i: usize) -> Result<(), String> {
        let who = self.trustees[i];
        let x = self.combined_secret(i);
        let pid = self.id.clone();
        let inputs = self.call(who, |s| s.tally_inputs(pid.clone())).unwrap();
        let seed = format!("partial-{i}");
        let mut rng = crypto::seeded_rng(seed.as_bytes());
        let partials: Vec<WirePartial> = inputs
            .aggregate
            .iter()
            .enumerate()
            .map(|(j, ct)| {
                let a = crypto::decode_point(&ct.a, "a").unwrap();
                let (d, proof) =
                    crypto::partial_decrypt(&pid, &acct(who), j as u32, &x, &a, &mut rng);
                WirePartial {
                    d: crypto::encode_point(&d),
                    proof: wire_branch(&proof),
                }
            })
            .collect();
        self.call(who, |s| s.publish_partial(pid, partials))
            .map_err(|e| format!("{e:?}"))
    }
}

fn new_poll(trustees: &[[u8; 32]], threshold: u32, voters: &[[u8; 32]]) -> Poll {
    let mut app = TestHost::new(MeroVote::init);
    assert_eq!(
        app.call_as_account(ALICE, dev(ALICE), |s| s.whoami().account),
        acct(ALICE),
        "an account is its 64-hex bytes"
    );
    let t: Vec<String> = trustees.iter().map(|a| acct(*a)).collect();
    let v: Vec<String> = voters.iter().map(|a| acct(*a)).collect();
    let id = app
        .call_as_account(ALICE, dev(ALICE), |s| {
            s.create_poll(
                "Lunch".into(),
                "Where do we eat on Friday?".into(),
                vec!["Pizza".into(), "Sushi".into(), "Tacos".into()],
                1,
                1,
                t,
                threshold,
                v,
                None,
            )
        })
        .expect("create_poll");
    Poll {
        app,
        id,
        trustees: trustees.to_vec(),
        es: Vec::new(),
    }
}

#[test]
fn a_two_of_three_poll_runs_end_to_end_with_a_trustee_missing() {
    let mut p = new_poll(&[ALICE, BOB, CAROL], 2, &[ALICE, BOB, CAROL]);
    let pid = p.id.clone();

    p.publish_transport_keys();
    p.deal(&[0, 1, 2], None);

    // Only the creator opens.
    assert!(p.call(BOB, |s| s.open_voting(pid.clone())).is_err());
    p.call(ALICE, |s| s.open_voting(pid.clone())).unwrap();
    let e = p.view(ALICE).state.election.unwrap();
    assert_eq!(e.qualified.len(), 3);
    assert!(e.disqualified.is_empty());

    let [a, b, c] = [acct(ALICE), acct(BOB), acct(CAROL)];
    p.vote(ALICE, &a, [true, false, false], "va").unwrap();
    p.vote(BOB, &b, [false, false, true], "vb").unwrap();
    p.vote(CAROL, &c, [false, true, false], "vc1").unwrap();
    // Carol changes her mind. The later ballot replaces the earlier one.
    let carol_receipt = p.vote(CAROL, &c, [true, false, false], "vc2").unwrap();

    // Not on the roll.
    assert!(p
        .vote(MALLORY, &acct(MALLORY), [true, false, false], "vm")
        .is_err());
    // A ballot built for Alice, submitted by Carol: the proof binds the voter.
    assert!(p.vote(CAROL, &a, [true, false, false], "replay").is_err());

    let view = p.view(CAROL);
    assert_eq!(view.turnout.len(), 3, "turnout shows who voted");
    assert_eq!(view.my_digest.as_deref(), Some(carol_receipt.as_str()));

    // Two-step close. Only the creator, and sealing needs closing first.
    assert!(p.call(CAROL, |s| s.close_poll(pid.clone())).is_err());
    assert!(p.call(ALICE, |s| s.seal_poll(pid.clone())).is_err());
    p.call(ALICE, |s| s.close_poll(pid.clone())).unwrap();
    assert_eq!(p.view(ALICE).state.phase, Phase::Closing);
    assert!(
        p.vote(CAROL, &c, [false, false, true], "late").is_err(),
        "a node that has seen the close refuses new ballots"
    );
    assert!(
        p.call(ALICE, |s| s.tally_inputs(pid.clone())).is_err(),
        "not sealed"
    );
    assert_eq!(p.call(ALICE, |s| s.seal_poll(pid.clone())).unwrap(), 3);

    let report = p.report();
    assert!(report.verified, "{:?}", report.checks);
    assert!(report.counts.is_none(), "no partials yet");

    // Alice decrypts: 1 of 2 — still no result.
    p.decrypt(0).unwrap();
    let report = p.report();
    assert!(report.verified, "{:?}", report.checks);
    assert!(
        report.counts.is_none(),
        "one partial is below the threshold"
    );

    // Carol decrypts; Bob never shows up. Two of three is enough.
    p.decrypt(2).unwrap();
    let report = p.report();
    assert!(report.verified, "{:?}", report.checks);
    assert_eq!(
        report.counts,
        Some(vec![2, 0, 1]),
        "Carol's second ballot is the one counted"
    );
    assert_eq!(report.decrypted_by, vec![a.clone(), c.clone()]);
    let digest = report.transcript_digest.clone().unwrap();

    // Anchor now, before Bob shows up.
    assert!(p
        .call(BOB, |s| s.anchor_result(
            pid.clone(),
            "git".into(),
            "abc".into()
        ))
        .is_err());
    let anchored = p
        .call(ALICE, |s| {
            s.anchor_result(pid.clone(), "ethereum:sepolia".into(), "0xfeed".into())
        })
        .unwrap();
    assert_eq!(anchored, digest);

    // Bob arrives late. The combined set moves to the lowest indices — and
    // the digest, which does not cover partials, stays put, so the anchor holds.
    p.decrypt(1).unwrap();
    let report = p.report();
    assert!(report.verified, "{:?}", report.checks);
    assert_eq!(report.counts, Some(vec![2, 0, 1]));
    assert_eq!(report.decrypted_by, vec![a, b]);
    assert_eq!(report.transcript_digest.as_deref(), Some(digest.as_str()));
    assert!(report.checks.iter().any(|c| c.name == "anchor" && c.ok));

    // The transcript carries what the audit checked.
    let t = p.call(BOB, |s| s.get_transcript(pid.clone())).unwrap();
    assert_eq!(t.ballots.len(), 3);
    assert!(t.ballots.iter().all(|b| b.endorsed));
    assert_eq!(t.partials.len(), 3);
    assert_eq!(t.protocol, "mero-vote/v2/");
}

#[test]
fn a_cheating_dealer_is_disqualified_by_a_proven_complaint() {
    let mut p = new_poll(&[ALICE, BOB, CAROL], 2, &[]);
    let pid = p.id.clone();
    p.publish_transport_keys();
    // Carol (position 2) sends Bob (position 1) a bad share.
    p.deal(&[0, 1, 2], Some((2, 1)));

    let cer = p.call(BOB, |s| s.ceremony(pid.clone())).unwrap();
    let carols = decode_dealing(cer.trustees[2].dealing.as_ref().unwrap()).unwrap();
    let alices = decode_dealing(cer.trustees[0].dealing.as_ref().unwrap()).unwrap();
    assert!(
        crypto::open_share(&pid, &acct(CAROL), 2, &p.es[1], &carols).is_none(),
        "Bob notices"
    );

    // Alice cannot frame Carol with a complaint about a share that is fine…
    let mut rng = crypto::seeded_rng(b"complaints");
    let (s0, p0) = crypto::make_complaint(
        &pid,
        &acct(ALICE),
        &acct(CAROL),
        1,
        &p.es[0],
        &carols,
        &mut rng,
    )
    .unwrap();
    assert!(p
        .call(ALICE, |s| s.file_complaint(
            pid.clone(),
            acct(CAROL),
            crypto::encode_point(&s0),
            wire_branch(&p0)
        ))
        .is_err());
    // …nor complain about Alice's good share to Bob.
    let (s1, p1) = crypto::make_complaint(
        &pid,
        &acct(BOB),
        &acct(ALICE),
        2,
        &p.es[1],
        &alices,
        &mut rng,
    )
    .unwrap();
    assert!(p
        .call(BOB, |s| s.file_complaint(
            pid.clone(),
            acct(ALICE),
            crypto::encode_point(&s1),
            wire_branch(&p1)
        ))
        .is_err());
    // Bob's real complaint is accepted.
    let (s2, p2) = crypto::make_complaint(
        &pid,
        &acct(BOB),
        &acct(CAROL),
        2,
        &p.es[1],
        &carols,
        &mut rng,
    )
    .unwrap();
    p.call(BOB, |s| {
        s.file_complaint(
            pid.clone(),
            acct(CAROL),
            crypto::encode_point(&s2),
            wire_branch(&p2),
        )
    })
    .unwrap();
    let view = p.view(ALICE);
    assert_eq!(view.trustees[2].complaints_against, 1);

    p.call(ALICE, |s| s.open_voting(pid.clone())).unwrap();
    let e = p.view(ALICE).state.election.unwrap();
    assert_eq!(
        e.qualified
            .iter()
            .map(|q| q.dealer.clone())
            .collect::<Vec<_>>(),
        vec![acct(ALICE), acct(BOB)]
    );
    assert_eq!(e.disqualified, vec![acct(CAROL)]);
    assert_eq!(p.view(ALICE).trustees[2].qualified, Some(false));

    p.vote(ALICE, &acct(ALICE), [false, true, false], "a")
        .unwrap();
    p.vote(BOB, &acct(BOB), [false, true, false], "b").unwrap();
    p.call(ALICE, |s| s.close_poll(pid.clone())).unwrap();
    p.call(ALICE, |s| s.seal_poll(pid.clone())).unwrap();

    // Carol was disqualified as a DEALER, but she still holds valid shares
    // from Alice and Bob and can help decrypt.
    p.decrypt(1).unwrap();
    p.decrypt(2).unwrap();
    let report = p.report();
    assert!(report.verified, "{:?}", report.checks);
    assert_eq!(report.counts, Some(vec![0, 2, 0]));
    assert!(report
        .checks
        .iter()
        .any(|c| c.name == "complaints" && c.ok && c.detail.contains(&acct(CAROL))));
}

#[test]
fn the_ceremony_refuses_what_it_must() {
    let mut p = new_poll(&[ALICE, BOB], 2, &[]);
    let pid = p.id.clone();

    // A non-trustee takes no part.
    let mut rng = crypto::seeded_rng(b"m");
    let e = rng();
    let (k, pr) = crypto::make_transport_key(&pid, &acct(MALLORY), &e, &mut rng);
    assert!(p
        .call(MALLORY, |s| s.publish_transport_key(
            pid.clone(),
            crypto::encode_point(&k),
            wire_branch(&pr)
        ))
        .is_err());
    // A transport key proven for someone else is refused.
    assert!(p
        .call(ALICE, |s| s.publish_transport_key(
            pid.clone(),
            crypto::encode_point(&k),
            wire_branch(&pr)
        ))
        .is_err());

    p.publish_transport_keys();
    // Write-once.
    let (k2, pr2) = crypto::make_transport_key(&pid, &acct(ALICE), &e, &mut rng);
    assert!(p
        .call(ALICE, |s| s.publish_transport_key(
            pid.clone(),
            crypto::encode_point(&k2),
            wire_branch(&pr2)
        ))
        .is_err());

    // One dealing is below the 2-of-2 threshold.
    p.deal(&[0], None);
    assert!(p.call(ALICE, |s| s.open_voting(pid.clone())).is_err());
    // Bob cannot republish Alice's dealing as his own (the proof binds Alice).
    let alices = p.call(BOB, |s| s.ceremony(pid.clone())).unwrap().trustees[0]
        .dealing
        .clone()
        .unwrap();
    assert!(p
        .call(BOB, |s| s.publish_dealing(pid.clone(), alices))
        .is_err());
    p.deal(&[1], None);
    // Dealings are write-once.
    let again = p.call(BOB, |s| s.ceremony(pid.clone())).unwrap().trustees[1]
        .dealing
        .clone()
        .unwrap();
    assert!(p
        .call(BOB, |s| s.publish_dealing(pid.clone(), again))
        .is_err());

    p.call(ALICE, |s| s.open_voting(pid.clone())).unwrap();
    // After open the ceremony is over.
    assert!(p
        .call(BOB, |s| s.publish_transport_key(
            pid.clone(),
            crypto::encode_point(&k2),
            wire_branch(&pr2)
        ))
        .is_err());
}

#[test]
fn dealing_needs_every_transport_key_first() {
    let mut p = new_poll(&[ALICE, BOB], 1, &[]);
    let pid = p.id.clone();
    let mut rng = crypto::seeded_rng(b"x");
    let e = rng();
    let (k, pr) = crypto::make_transport_key(&pid, &acct(ALICE), &e, &mut rng);
    p.call(ALICE, |s| {
        s.publish_transport_key(pid.clone(), crypto::encode_point(&k), wire_branch(&pr))
    })
    .unwrap();
    let d = crypto::deal(&pid, &acct(ALICE), 1, &[k, k], &mut rng).unwrap();
    let w = wire_dealing(&d);
    assert!(p
        .call(ALICE, |s| s.publish_dealing(pid.clone(), w))
        .is_err());
}

#[test]
fn poll_definitions_are_validated() {
    let mut app = TestHost::new(MeroVote::init);
    let alice = acct(ALICE);
    let mut make = |opts: Vec<&str>, min: u32, max: u32, trustees: Vec<String>, t: u32| {
        app.call_as_account(ALICE, dev(ALICE), |s| {
            s.create_poll(
                "T".into(),
                "".into(),
                opts.into_iter().map(String::from).collect(),
                min,
                max,
                trustees,
                t,
                vec![],
                None,
            )
        })
    };
    assert!(
        make(vec!["only"], 1, 1, vec![alice.clone()], 1).is_err(),
        "one option"
    );
    assert!(
        make(vec!["a", "a"], 1, 1, vec![alice.clone()], 1).is_err(),
        "duplicate options"
    );
    assert!(
        make(vec!["a", "b"], 2, 1, vec![alice.clone()], 1).is_err(),
        "min > max"
    );
    assert!(
        make(vec!["a", "b"], 1, 3, vec![alice.clone()], 1).is_err(),
        "max > options"
    );
    assert!(make(vec!["a", "b"], 1, 1, vec![], 1).is_err(), "no trustee");
    assert!(
        make(vec!["a", "b"], 1, 1, vec!["nope".into()], 1).is_err(),
        "bad account"
    );
    assert!(
        make(vec!["a", "b"], 1, 1, vec![alice.clone()], 0).is_err(),
        "threshold 0"
    );
    assert!(
        make(vec!["a", "b"], 1, 1, vec![alice.clone()], 2).is_err(),
        "threshold > trustees"
    );
    assert!(
        make(vec!["a", "b"], 0, 2, vec![alice.clone()], 1).is_ok(),
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
    assert_eq!(roster[0].account, acct(ALICE));
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
        trustees: vec!["11".repeat(32), "22".repeat(32), "44".repeat(32)],
        threshold: 2,
        voters: vec![],
        creator: "11".repeat(32),
        created_at: 0,
        closes_at: None,
    };
    let dealing = |c: &str| WireDealing {
        commitments: vec![c.repeat(32), format!("{c}ff").repeat(16)],
        proof: WireBranch {
            c: String::new(),
            z: String::new(),
        },
        shares: vec![],
    };
    let election = Election {
        key: "aa".repeat(32),
        threshold: 2,
        transport: vec![],
        qualified: vec![
            QualifiedDealing {
                dealer: "11".repeat(32),
                dealing: dealing("b1"),
            },
            QualifiedDealing {
                dealer: "22".repeat(32),
                dealing: dealing("b2"),
            },
        ],
        disqualified: vec!["44".repeat(32)],
        opened_at: 0,
    };
    let counted = vec![CountedBallot {
        voter: "33".repeat(32),
        digest: "dd".repeat(32),
        frozen: String::new(),
    }];
    let text = transcript_text(&"00".repeat(32), &def, &election, &counted, &[1, 0, 1]);
    assert!(text.starts_with("mero-vote/v2/transcript\npoll 0000"));
    assert!(!text.contains("forged"), "free text is hex-encoded");
    assert_eq!(transcript_digest(&text), PINNED_TRANSCRIPT_DIGEST, "{text}");
}

const PINNED_TRANSCRIPT_DIGEST: &str =
    "e14b512be7a2a5580cbc247fd7851682f435b0b32a91045708848c29cea5abdc";
