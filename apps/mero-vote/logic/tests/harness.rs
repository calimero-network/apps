//! Whole polls on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests (`src/tests.rs`) method for method — the t-of-n key ceremony with a
//! cheating dealer caught by a complaint, encrypted voting, close → seal,
//! threshold decryption with a trustee missing, audit, anchor — with the
//! browser's half of the protocol played by `mero-vote-crypto`. Then what v1
//! kept in storage-level write rules, as method checks: the same calls made as
//! someone the method refuses. Then the access and wire checks v1 could not
//! express.
//!
//! The harness's accounts are names (`owner`, `bob`, …), and an account id is
//! what every proof binds, so the proofs here are built for those names. On a
//! cluster the same ids are 64-hex account ids, which is why the JSON
//! scenarios (`scenarios/*.json`, also run on `merod local`) stop short of a
//! valid proof: a browser builds those (see the README).

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use mero_vote_crypto as crypto;
use serde_json::{json, Value};

const OWNER: &str = "owner";
const BOB: &str = "bob";
const CAROL: &str = "carol";
const MALLORY: &str = "mallory";
const GUEST: &str = "gus";

/// The owner (who creates the polls), three members and a guest.
fn org() -> Org {
    Org::new().members([BOB, CAROL, MALLORY]).guests([GUEST])
}

fn wire_branch(b: &crypto::Branch) -> Value {
    json!({ "c": crypto::encode_scalar(&b.c), "z": crypto::encode_scalar(&b.z) })
}

fn wire_ballot(b: &crypto::Ballot) -> Value {
    json!({
        "choices": b.choices.iter().map(|c| json!({
            "a": crypto::encode_point(&c.ct.a),
            "b": crypto::encode_point(&c.ct.b),
            "proof": c.proof.iter().map(wire_branch).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "sum_proof": b.sum_proof.iter().map(wire_branch).collect::<Vec<_>>(),
    })
}

fn wire_dealing(d: &crypto::Dealing) -> Value {
    json!({
        "commitments": d.commitments.iter().map(crypto::encode_point).collect::<Vec<_>>(),
        "proof": wire_branch(&d.proof),
        "shares": d.shares.iter().map(|s| json!({
            "r": crypto::encode_point(&s.r),
            "v": crypto::encode_scalar(&s.v),
        })).collect::<Vec<_>>(),
    })
}

fn decode_dealing(w: &Value) -> crypto::Dealing {
    let point = |v: &Value| crypto::decode_point(v.as_str().unwrap(), "p").unwrap();
    let scalar = |v: &Value| crypto::decode_scalar(v.as_str().unwrap(), "s").unwrap();
    crypto::Dealing {
        commitments: w["commitments"]
            .as_array()
            .unwrap()
            .iter()
            .map(point)
            .collect(),
        proof: crypto::Branch {
            c: scalar(&w["proof"]["c"]),
            z: scalar(&w["proof"]["z"]),
        },
        shares: w["shares"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| crypto::EncryptedShare {
                r: point(&s["r"]),
                v: scalar(&s["v"]),
            })
            .collect(),
    }
}

fn code(r: Result<Value, Failure>) -> String {
    match r {
        Err(Failure::App { code, .. }) => code,
        other => panic!("expected an app error, got {other:?}"),
    }
}

struct Poll {
    t: TestApp,
    id: String,
    trustees: Vec<&'static str>,
    /// Transport secrets, by trustee position.
    es: Vec<crypto::FieldScalar>,
}

impl Poll {
    fn call(&mut self, who: &str, method: &str, args: Value) -> Result<Value, Failure> {
        self.t.as_(who).call(method, args)
    }

    fn view(&mut self, who: &str, method: &str, args: Value) -> Value {
        self.t
            .as_(who)
            .view(method, args)
            .unwrap_or_else(|e| panic!("{method}: {e:?}"))
    }

    fn poll(&mut self, who: &str) -> Value {
        let id = self.id.clone();
        self.view(who, "getPoll", json!({ "pollId": id }))
    }

    fn report(&mut self) -> Value {
        let id = self.id.clone();
        // Anyone the app reaches can audit; a member who is no trustee here.
        self.view(MALLORY, "getResult", json!({ "pollId": id }))
    }

    fn action(&mut self, who: &str, method: &str) -> Result<Value, Failure> {
        let id = self.id.clone();
        self.call(who, method, json!({ "pollId": id }))
    }

    /// Round 1 for every trustee.
    fn publish_transport_keys(&mut self) {
        for (i, who) in self.trustees.clone().into_iter().enumerate() {
            let seed = format!("transport-{i}");
            let mut rng = crypto::seeded_rng(seed.as_bytes());
            let e = rng();
            let (key, proof) = crypto::make_transport_key(&self.id, who, &e, &mut rng);
            let id = self.id.clone();
            self.call(
                who,
                "publishTransportKey",
                json!({ "pollId": id, "key": crypto::encode_point(&key), "proof": wire_branch(&proof) }),
            )
            .expect("publishTransportKey");
            self.es.push(e);
        }
    }

    /// Round 2 for `dealers` (positions). `corrupt` = (dealer, recipient)
    /// positions whose share gets tampered with.
    fn deal(&mut self, dealers: &[usize], corrupt: Option<(usize, usize)>) {
        let id = self.id.clone();
        let cer = self.view(OWNER, "ceremony", json!({ "pollId": id }));
        let keys: Vec<_> = cer["trustees"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| crypto::decode_point(t["transport"].as_str().unwrap(), "t").unwrap())
            .collect();
        let threshold = cer["threshold"].as_u64().unwrap() as u32;
        for &i in dealers {
            let who = self.trustees[i];
            let seed = format!("dealing-{i}");
            let mut rng = crypto::seeded_rng(seed.as_bytes());
            let mut d = crypto::deal(&self.id, who, threshold, &keys, &mut rng).unwrap();
            if let Some((dealer, recipient)) = corrupt {
                if dealer == i {
                    d.shares[recipient].v += crypto::FieldScalar::ONE;
                }
            }
            self.call(
                who,
                "publishDealing",
                json!({ "pollId": id, "dealing": wire_dealing(&d) }),
            )
            .expect("publishDealing");
        }
    }

    fn election(&mut self) -> Value {
        self.poll(OWNER)["state"]["election"].clone()
    }

    /// Trustee `i`'s combined key over the frozen qualified dealings.
    fn combined_secret(&mut self, i: usize) -> crypto::FieldScalar {
        let election = self.election();
        election["qualified"]
            .as_array()
            .unwrap()
            .iter()
            .map(|q| {
                let d = decode_dealing(&q["dealing"]);
                crypto::open_share(
                    &self.id,
                    q["dealer"].as_str().unwrap(),
                    i as u32 + 1,
                    &self.es[i],
                    &d,
                )
                .expect("an honest dealer's share opens")
            })
            .sum()
    }

    /// `who` submits a ballot proven for `voter` (a forgery when they differ).
    fn vote(
        &mut self,
        who: &str,
        voter: &str,
        sel: [bool; 3],
        seed: &str,
    ) -> Result<Value, Failure> {
        let key = self.election()["key"].as_str().unwrap().to_owned();
        let pk = crypto::decode_point(&key, "key").unwrap();
        let rules = crypto::Rules {
            options: 3,
            min: 1,
            max: 1,
        };
        let mut rng = crypto::seeded_rng(seed.as_bytes());
        let ballot = crypto::cast_ballot(&pk, &self.id, voter, &rules, &sel, &mut rng).unwrap();
        let id = self.id.clone();
        self.call(
            who,
            "castBallot",
            json!({ "pollId": id, "ballot": wire_ballot(&ballot) }),
        )
    }

    fn partials(&mut self, i: usize) -> Value {
        let who = self.trustees[i];
        let x = self.combined_secret(i);
        let id = self.id.clone();
        let inputs = self.view(who, "tallyInputs", json!({ "pollId": id }));
        let seed = format!("partial-{i}");
        let mut rng = crypto::seeded_rng(seed.as_bytes());
        inputs["aggregate"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(j, ct)| {
                let a = crypto::decode_point(ct["a"].as_str().unwrap(), "a").unwrap();
                let (d, proof) = crypto::partial_decrypt(&id, who, j as u32, &x, &a, &mut rng);
                json!({ "d": crypto::encode_point(&d), "proof": wire_branch(&proof) })
            })
            .collect()
    }

    fn decrypt(&mut self, i: usize) -> Result<Value, Failure> {
        let partials = self.partials(i);
        let id = self.id.clone();
        self.call(
            self.trustees[i],
            "publishPartial",
            json!({ "pollId": id, "partials": partials }),
        )
    }
}

fn create(t: &mut TestApp, trustees: &[&str], threshold: u32, voters: &[&str]) -> String {
    t.as_(OWNER)
        .call(
            "createPoll",
            json!({
                "title": "Lunch",
                "description": "Where do we eat on Friday?",
                "options": ["Pizza", "Sushi", "Tacos"],
                "minChoices": 1,
                "maxChoices": 1,
                "trustees": trustees,
                "threshold": threshold,
                "voters": voters,
                "closesAt": null,
            }),
        )
        .expect("createPoll")
        .as_str()
        .unwrap()
        .to_owned()
}

fn new_poll(trustees: &[&'static str], threshold: u32, voters: &[&str]) -> Poll {
    let mut t = common::app(org());
    assert_eq!(
        t.as_(OWNER).view("whoami", json!({})).unwrap(),
        json!({ "account": OWNER }),
        "an account is the id the app sees"
    );
    let id = create(&mut t, trustees, threshold, voters);
    Poll {
        t,
        id,
        trustees: trustees.to_vec(),
        es: Vec::new(),
    }
}

fn counts(report: &Value) -> Value {
    report["counts"].clone()
}

// ── v1's TestHost tests ──────────────────────────────────────────────────────

#[test]
fn a_two_of_three_poll_runs_end_to_end_with_a_trustee_missing() {
    let mut p = new_poll(&[OWNER, BOB, CAROL], 2, &[OWNER, BOB, CAROL]);
    let id = p.id.clone();
    assert_eq!(id.len(), 64, "the poll id is the definition's hex SHA-256");

    p.publish_transport_keys();
    p.deal(&[0, 1, 2], None);

    // Only the creator opens.
    assert_eq!(code(p.action(BOB, "openVoting")), "Forbidden");
    let key = p.action(OWNER, "openVoting").unwrap();
    let e = p.election();
    assert_eq!(e["key"], key);
    assert_eq!(e["qualified"].as_array().unwrap().len(), 3);
    assert_eq!(e["disqualified"], json!([]));
    assert!(
        e["opened_at"].is_string(),
        "u64 travels as a decimal string"
    );

    p.vote(OWNER, OWNER, [true, false, false], "va").unwrap();
    p.vote(BOB, BOB, [false, false, true], "vb").unwrap();
    p.vote(CAROL, CAROL, [false, true, false], "vc1").unwrap();
    // Carol changes her mind. The later ballot replaces the earlier one.
    let carol_receipt = p.vote(CAROL, CAROL, [true, false, false], "vc2").unwrap();

    // Not on the roll.
    assert_eq!(
        code(p.vote(MALLORY, MALLORY, [true, false, false], "vm")),
        "Forbidden"
    );
    // A ballot built for the owner, submitted by Carol: the proof binds the voter.
    assert_eq!(
        code(p.vote(CAROL, OWNER, [true, false, false], "replay")),
        "Crypto"
    );

    let view = p.poll(CAROL);
    assert_eq!(
        view["turnout"].as_array().unwrap().len(),
        3,
        "turnout shows who voted"
    );
    assert_eq!(view["my_digest"], carol_receipt);
    assert_eq!(view["can_vote"], json!(true));
    assert_eq!(p.poll(MALLORY)["can_vote"], json!(false));

    // Two-step close. Only the creator, and sealing needs closing first.
    assert_eq!(code(p.action(CAROL, "closePoll")), "Forbidden");
    assert_eq!(code(p.action(OWNER, "sealPoll")), "Phase");
    p.action(OWNER, "closePoll").unwrap();
    assert_eq!(p.poll(OWNER)["state"]["phase"], json!("Closing"));
    assert_eq!(
        code(p.vote(CAROL, CAROL, [false, false, true], "late")),
        "Phase",
        "a closed poll refuses new ballots"
    );
    assert_eq!(
        code(p.t.as_(OWNER).view("tallyInputs", json!({ "pollId": id }))),
        "Phase",
        "not sealed"
    );
    assert_eq!(p.action(OWNER, "sealPoll").unwrap(), json!(3));

    let report = p.report();
    assert_eq!(report["verified"], json!(true), "{report:#}");
    assert_eq!(counts(&report), json!(null), "no partials yet");

    // The owner decrypts: 1 of 2 — still no result.
    p.decrypt(0).unwrap();
    let report = p.report();
    assert_eq!(report["verified"], json!(true), "{report:#}");
    assert_eq!(
        counts(&report),
        json!(null),
        "one partial is below the threshold"
    );

    // Carol decrypts; Bob never shows up. Two of three is enough.
    p.decrypt(2).unwrap();
    let report = p.report();
    assert_eq!(report["verified"], json!(true), "{report:#}");
    assert_eq!(
        counts(&report),
        json!([2, 0, 1]),
        "Carol's second ballot is the one counted"
    );
    assert_eq!(report["decrypted_by"], json!([OWNER, CAROL]));
    let digest = report["transcript_digest"].clone();
    assert!(digest.is_string());

    // Anchor now, before Bob shows up.
    let anchor = json!({ "pollId": id, "network": "git", "reference": "abc" });
    assert_eq!(
        code(p.call(BOB, "anchorResult", anchor.clone())),
        "Forbidden"
    );
    let anchored = p
        .call(
            OWNER,
            "anchorResult",
            json!({ "pollId": id, "network": "ethereum:sepolia", "reference": "0xfeed" }),
        )
        .unwrap();
    assert_eq!(anchored, digest);

    // Bob arrives late. The combined set moves to the lowest indices — and
    // the digest, which does not cover partials, stays put, so the anchor holds.
    p.decrypt(1).unwrap();
    let report = p.report();
    assert_eq!(report["verified"], json!(true), "{report:#}");
    assert_eq!(counts(&report), json!([2, 0, 1]));
    assert_eq!(report["decrypted_by"], json!([OWNER, BOB]));
    assert_eq!(report["transcript_digest"], digest);
    assert!(report["checks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["name"] == "anchor" && c["ok"] == json!(true)));

    // The transcript carries what the audit checked.
    let t = p.view(BOB, "getTranscript", json!({ "pollId": id }));
    assert_eq!(t["ballots"].as_array().unwrap().len(), 3);
    assert!(t["ballots"]
        .as_array()
        .unwrap()
        .iter()
        .all(|b| b["endorsed"] == json!(true)));
    assert_eq!(t["partials"].as_array().unwrap().len(), 3);
    assert_eq!(t["protocol"], json!("mero-vote/v2/"));
    assert_eq!(t["report"]["transcript_digest"], digest);

    // The summary lists it once, sealed with three ballots.
    let polls = p.view(BOB, "listPolls", json!({}));
    assert_eq!(polls.as_array().unwrap().len(), 1);
    assert_eq!(polls[0]["phase"], json!("Closed"));
    assert_eq!(polls[0]["ballots"], json!(3));
}

#[test]
fn a_cheating_dealer_is_disqualified_by_a_proven_complaint() {
    let mut p = new_poll(&[OWNER, BOB, CAROL], 2, &[]);
    let id = p.id.clone();
    p.publish_transport_keys();
    // Carol (position 2) sends Bob (position 1) a bad share.
    p.deal(&[0, 1, 2], Some((2, 1)));

    let cer = p.view(BOB, "ceremony", json!({ "pollId": id }));
    let carols = decode_dealing(&cer["trustees"][2]["dealing"]);
    let owners = decode_dealing(&cer["trustees"][0]["dealing"]);
    assert!(
        crypto::open_share(&id, CAROL, 2, &p.es[1], &carols).is_none(),
        "Bob notices"
    );

    let complain = |dealer: &str, s: &crypto::Point, pr: &crypto::Branch| {
        json!({
            "pollId": id,
            "dealer": dealer,
            "secret": crypto::encode_point(s),
            "proof": wire_branch(pr),
        })
    };
    let mut rng = crypto::seeded_rng(b"complaints");
    // The owner cannot frame Carol with a complaint about a share that is fine…
    let (s0, p0) =
        crypto::make_complaint(&id, OWNER, CAROL, 1, &p.es[0], &carols, &mut rng).unwrap();
    assert_eq!(
        code(p.call(OWNER, "fileComplaint", complain(CAROL, &s0, &p0))),
        "Crypto"
    );
    // …nor Bob complain about the owner's good share.
    let (s1, p1) = crypto::make_complaint(&id, BOB, OWNER, 2, &p.es[1], &owners, &mut rng).unwrap();
    assert_eq!(
        code(p.call(BOB, "fileComplaint", complain(OWNER, &s1, &p1))),
        "Crypto"
    );
    // Nor can Mallory file Bob's real complaint in her own name: she is no
    // trustee (v1: a complaint is read from its recipient's own entries).
    let (s2, p2) = crypto::make_complaint(&id, BOB, CAROL, 2, &p.es[1], &carols, &mut rng).unwrap();
    assert_eq!(
        code(p.call(MALLORY, "fileComplaint", complain(CAROL, &s2, &p2))),
        "Forbidden"
    );
    // …and the owner cannot file it as theirs: the proof binds Bob.
    assert_eq!(
        code(p.call(OWNER, "fileComplaint", complain(CAROL, &s2, &p2))),
        "Crypto"
    );
    // Bob's real complaint is accepted, once.
    p.call(BOB, "fileComplaint", complain(CAROL, &s2, &p2))
        .unwrap();
    assert_eq!(
        code(p.call(BOB, "fileComplaint", complain(CAROL, &s2, &p2))),
        "Phase"
    );
    let view = p.poll(OWNER);
    assert_eq!(view["trustees"][2]["complaints_against"], json!(1));
    let cer = p.view(OWNER, "ceremony", json!({ "pollId": id }));
    assert_eq!(
        cer["complaints"],
        json!([{ "recipient": BOB, "dealer": CAROL, "valid": true }])
    );

    p.action(OWNER, "openVoting").unwrap();
    let e = p.election();
    let dealers: Vec<&str> = e["qualified"]
        .as_array()
        .unwrap()
        .iter()
        .map(|q| q["dealer"].as_str().unwrap())
        .collect();
    assert_eq!(dealers, [OWNER, BOB]);
    assert_eq!(e["disqualified"], json!([CAROL]));
    assert_eq!(p.poll(OWNER)["trustees"][2]["qualified"], json!(false));

    p.vote(OWNER, OWNER, [false, true, false], "a").unwrap();
    p.vote(BOB, BOB, [false, true, false], "b").unwrap();
    p.action(OWNER, "closePoll").unwrap();
    p.action(OWNER, "sealPoll").unwrap();

    // Carol was disqualified as a DEALER, but she still holds valid shares
    // from the owner and Bob and can help decrypt.
    p.decrypt(1).unwrap();
    p.decrypt(2).unwrap();
    let report = p.report();
    assert_eq!(report["verified"], json!(true), "{report:#}");
    assert_eq!(counts(&report), json!([0, 2, 0]));
    assert!(report["checks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["name"] == "complaints"
            && c["ok"] == json!(true)
            && c["detail"].as_str().unwrap().contains(CAROL)));
}

#[test]
fn the_ceremony_refuses_what_it_must() {
    let mut p = new_poll(&[OWNER, BOB], 2, &[]);
    let id = p.id.clone();

    // A non-trustee takes no part.
    let mut rng = crypto::seeded_rng(b"m");
    let e = rng();
    let (k, pr) = crypto::make_transport_key(&id, MALLORY, &e, &mut rng);
    let mallorys =
        json!({ "pollId": id, "key": crypto::encode_point(&k), "proof": wire_branch(&pr) });
    assert_eq!(
        code(p.call(MALLORY, "publishTransportKey", mallorys.clone())),
        "Forbidden"
    );
    // A transport key proven for someone else is refused.
    assert_eq!(
        code(p.call(OWNER, "publishTransportKey", mallorys)),
        "Crypto"
    );

    // A dealing before every transport key is in.
    p.publish_transport_keys();
    // Written once.
    let (k2, pr2) = crypto::make_transport_key(&id, OWNER, &e, &mut rng);
    let again =
        json!({ "pollId": id, "key": crypto::encode_point(&k2), "proof": wire_branch(&pr2) });
    assert_eq!(
        code(p.call(OWNER, "publishTransportKey", again.clone())),
        "Phase"
    );

    // One dealing is below the 2-of-2 threshold.
    p.deal(&[0], None);
    assert_eq!(code(p.action(OWNER, "openVoting")), "Phase");
    // Bob cannot republish the owner's dealing as his own (the proof binds the owner).
    let owners = p.view(BOB, "ceremony", json!({ "pollId": id }))["trustees"][0]["dealing"].clone();
    assert_eq!(
        code(p.call(
            BOB,
            "publishDealing",
            json!({ "pollId": id, "dealing": owners })
        )),
        "Crypto"
    );
    p.deal(&[1], None);
    // Dealings are written once.
    let bobs = p.view(BOB, "ceremony", json!({ "pollId": id }))["trustees"][1]["dealing"].clone();
    assert_eq!(
        code(p.call(
            BOB,
            "publishDealing",
            json!({ "pollId": id, "dealing": bobs })
        )),
        "Phase"
    );

    p.action(OWNER, "openVoting").unwrap();
    // After open the ceremony is over, and voting opens once.
    assert_eq!(code(p.call(BOB, "publishTransportKey", again)), "Phase");
    assert_eq!(code(p.action(OWNER, "openVoting")), "Phase");
}

#[test]
fn dealing_needs_every_transport_key_first() {
    let mut p = new_poll(&[OWNER, BOB], 1, &[]);
    let id = p.id.clone();
    let mut rng = crypto::seeded_rng(b"x");
    let e = rng();
    let (k, pr) = crypto::make_transport_key(&id, OWNER, &e, &mut rng);
    p.call(
        OWNER,
        "publishTransportKey",
        json!({ "pollId": id, "key": crypto::encode_point(&k), "proof": wire_branch(&pr) }),
    )
    .unwrap();
    let d = crypto::deal(&id, OWNER, 1, &[k, k], &mut rng).unwrap();
    assert_eq!(
        code(p.call(
            OWNER,
            "publishDealing",
            json!({ "pollId": id, "dealing": wire_dealing(&d) })
        )),
        "Phase"
    );
    // A complaint about a dealer who has not dealt.
    assert_eq!(
        code(p.call(
            OWNER,
            "fileComplaint",
            json!({ "pollId": id, "dealer": BOB, "secret": "00", "proof": { "c": "00", "z": "00" } })
        )),
        "Invalid"
    );
}

#[test]
fn poll_definitions_are_validated() {
    let mut t = common::app(org());
    let mut make = |opts: Vec<&str>, min: u32, max: u32, trustees: Vec<&str>, th: u32| {
        t.as_(OWNER).call(
            "createPoll",
            json!({
                "title": "T", "description": "", "options": opts,
                "minChoices": min, "maxChoices": max,
                "trustees": trustees, "threshold": th, "voters": [], "closesAt": null,
            }),
        )
    };
    assert_eq!(
        code(make(vec!["only"], 1, 1, vec![OWNER], 1)),
        "Crypto",
        "one option"
    );
    assert_eq!(
        code(make(vec!["a", "a"], 1, 1, vec![OWNER], 1)),
        "Invalid",
        "duplicates"
    );
    assert_eq!(
        code(make(vec!["a", "b"], 2, 1, vec![OWNER], 1)),
        "Crypto",
        "min > max"
    );
    assert_eq!(
        code(make(vec!["a", "b"], 1, 3, vec![OWNER], 1)),
        "Crypto",
        "max > options"
    );
    assert_eq!(
        code(make(vec!["a", "b"], 1, 1, vec![], 1)),
        "Invalid",
        "no trustee"
    );
    assert_eq!(
        code(make(vec!["a", "b"], 1, 1, vec!["not an id"], 1)),
        "Invalid",
        "bad account"
    );
    assert_eq!(
        code(make(vec!["a", "b"], 1, 1, vec!["eve"], 1)),
        "Invalid",
        "an account outside the org"
    );
    assert_eq!(
        code(make(vec!["a", "b"], 1, 1, vec![OWNER], 0)),
        "Invalid",
        "threshold 0"
    );
    assert_eq!(
        code(make(vec!["a", "b"], 1, 1, vec![OWNER], 2)),
        "Invalid",
        "threshold > trustees"
    );
    assert!(
        make(vec!["a", "b"], 0, 2, vec![OWNER, GUEST], 1).is_ok(),
        "approval poll; a guest may be a trustee"
    );
    // The same definition at the same instant is the same poll id.
    assert_eq!(
        code(make(vec!["a", "b"], 0, 2, vec![OWNER, GUEST], 1)),
        "Invalid",
        "an identical poll"
    );

    let polls = t.as_(GUEST).view("listPolls", json!({})).unwrap();
    assert_eq!(polls.as_array().unwrap().len(), 1);
    assert_eq!(polls[0]["phase"], json!("KeyCeremony"));
    assert_eq!(polls[0]["created_at"], json!(common::T0.to_string()));
    assert_eq!(polls[0]["ballots"], json!(0));
}

#[test]
fn the_roster_lists_named_members() {
    let mut t = common::app(org());
    t.as_(OWNER)
        .call("setName", json!({ "name": "Alice" }))
        .unwrap();
    t.as_(BOB)
        .call("setName", json!({ "name": " Bob " }))
        .unwrap();
    t.as_(GUEST)
        .call("setName", json!({ "name": "Gus" }))
        .unwrap();
    assert_eq!(
        code(t.as_(BOB).call("setName", json!({ "name": "   " }))),
        "Invalid"
    );
    assert_eq!(
        code(
            t.as_(BOB)
                .call("setName", json!({ "name": "x".repeat(65) }))
        ),
        "Invalid"
    );
    assert_eq!(
        t.as_(CAROL).view("roster", json!({})).unwrap(),
        json!([
            { "account": OWNER, "name": "Alice" },
            { "account": BOB, "name": "Bob" },
            { "account": GUEST, "name": "Gus" },
        ])
    );
    // Renaming replaces the name, never anyone else's.
    t.as_(BOB)
        .call("setName", json!({ "name": "Robert" }))
        .unwrap();
    let roster = t.as_(OWNER).view("roster", json!({})).unwrap();
    assert_eq!(roster[2], json!({ "account": BOB, "name": "Robert" }));
    assert_eq!(
        t.events_for(CAROL)
            .into_iter()
            .map(|(n, d)| (n, d["account"].as_str().unwrap().to_owned()))
            .collect::<Vec<_>>(),
        [
            ("MemberNamed".to_owned(), OWNER.to_owned()),
            ("MemberNamed".to_owned(), BOB.to_owned()),
            ("MemberNamed".to_owned(), GUEST.to_owned()),
            ("MemberNamed".to_owned(), BOB.to_owned()),
        ]
    );
}

// ── what v1 kept in storage write rules, as method checks ────────────────────

/// A 2-of-3 poll, voted on by the owner and Bob and sealed, not yet decrypted.
fn sealed_poll() -> Poll {
    let mut p = new_poll(&[OWNER, BOB, CAROL], 2, &[]);
    p.publish_transport_keys();
    p.deal(&[0, 1, 2], None);
    p.action(OWNER, "openVoting").unwrap();
    p.vote(OWNER, OWNER, [true, false, false], "a").unwrap();
    p.vote(BOB, BOB, [false, false, true], "b").unwrap();
    p.action(OWNER, "closePoll").unwrap();
    p.action(OWNER, "sealPoll").unwrap();
    p
}

/// v1 relied on write-once, author-stamped entries so that nobody could
/// rewrite their own part of a sealed poll and fail its audit. Here every such
/// write is a method, and each refuses after its phase.
#[test]
fn nobody_can_rewrite_their_part_of_a_sealed_poll() {
    let mut p = sealed_poll();
    let id = p.id.clone();
    let before = p.view(OWNER, "getTranscript", json!({ "pollId": id }));

    // Bob cannot re-deal or re-key.
    let bobs = before["state"]["election"]["qualified"][1]["dealing"].clone();
    assert_eq!(
        code(p.call(
            BOB,
            "publishDealing",
            json!({ "pollId": id, "dealing": bobs })
        )),
        "Phase"
    );
    // Bob cannot re-point his ballot, and Carol cannot add one, after the seal.
    assert_eq!(code(p.vote(BOB, BOB, [true, false, false], "b2")), "Phase");
    assert_eq!(
        code(p.vote(CAROL, CAROL, [true, false, false], "c")),
        "Phase"
    );
    // The creator cannot close, seal or open again: the phase only moves forward.
    assert_eq!(code(p.action(OWNER, "closePoll")), "Phase");
    assert_eq!(code(p.action(OWNER, "sealPoll")), "Phase");
    assert_eq!(code(p.action(OWNER, "openVoting")), "Phase");
    // A non-trustee cannot publish a partial, even a valid-looking one.
    let partials = p.partials(0);
    assert_eq!(
        code(p.call(
            MALLORY,
            "publishPartial",
            json!({ "pollId": id, "partials": partials })
        )),
        "Forbidden"
    );
    // …nor the owner publish Bob's partials as their own: the proof binds Bob.
    let bobs_partials = p.partials(1);
    assert_eq!(
        code(p.call(
            OWNER,
            "publishPartial",
            json!({ "pollId": id, "partials": bobs_partials })
        )),
        "Crypto"
    );
    // One partial per option.
    assert_eq!(
        code(p.call(
            OWNER,
            "publishPartial",
            json!({ "pollId": id, "partials": [] })
        )),
        "Invalid"
    );

    // None of that changed what the audit sees.
    let after = p.view(OWNER, "getTranscript", json!({ "pollId": id }));
    assert_eq!(before, after);

    // A trustee publishing again replaces their own partial; the result holds.
    p.decrypt(0).unwrap();
    p.decrypt(1).unwrap();
    p.decrypt(1).unwrap();
    let report = p.report();
    assert_eq!(report["verified"], json!(true), "{report:#}");
    assert_eq!(counts(&report), json!([1, 0, 1]));
    assert_eq!(report["uncounted"], json!([]));
}

/// Membership replaces v1's "any member of the context": a guest reads, and
/// is named on rolls and trustee lists, but neither creates polls nor votes in
/// one without a roll.
#[test]
fn guests_vote_only_when_named_on_the_roll() {
    let mut t = common::app(org());
    assert_eq!(
        code(t.as_(GUEST).call(
            "createPoll",
            json!({
                "title": "T", "description": "", "options": ["a", "b"],
                "minChoices": 1, "maxChoices": 1,
                "trustees": [OWNER], "threshold": 1, "voters": [], "closesAt": null,
            })
        )),
        "Forbidden"
    );

    for (voters, guest_may) in [(vec![], false), (vec![GUEST, BOB], true)] {
        let mut p = Poll {
            id: String::new(),
            t: common::app(org()),
            trustees: vec![OWNER],
            es: Vec::new(),
        };
        p.id = create(&mut p.t, &[OWNER], 1, &voters);
        p.publish_transport_keys();
        p.deal(&[0], None);
        p.action(OWNER, "openVoting").unwrap();
        assert_eq!(p.poll(GUEST)["can_vote"], json!(guest_may));
        let r = p.vote(GUEST, GUEST, [true, false, false], "g");
        if guest_may {
            r.unwrap();
        } else {
            assert_eq!(code(r), "Forbidden");
            // Any member may, when there is no roll.
            p.vote(MALLORY, MALLORY, [true, false, false], "m").unwrap();
        }
    }
    let _ = &mut t;
}

// ── access and wire checks ───────────────────────────────────────────────────

#[test]
fn the_platform_refuses_anonymous_callers_and_outsiders() {
    let mut p = new_poll(&[OWNER], 1, &[]);
    let id = p.id.clone();
    assert_eq!(
        p.t.anonymous().view("listPolls", json!({})),
        Err(Failure::Refused {
            status: 401,
            code: "UNAUTHENTICATED".to_owned()
        })
    );
    assert_eq!(
        p.t.as_("eve").view("getPoll", json!({ "pollId": id })),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
    assert_eq!(
        p.t.as_("eve").call("setName", json!({ "name": "Eve" })),
        Err(Failure::Refused {
            status: 404,
            code: "NOT_FOUND".to_owned()
        })
    );
}

#[test]
fn wire_errors() {
    let mut p = new_poll(&[OWNER], 1, &[]);
    let id = p.id.clone();
    assert_eq!(
        p.t.as_(OWNER).view("getPoll", json!({ "pollId": "nope" })),
        Err(Failure::App {
            code: "NotFound".to_owned(),
            fields: json!({ "pollId": "nope" })
        })
    );
    assert_eq!(
        code(p.t.as_(OWNER).view("noSuchMethod", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(p.t.as_(OWNER).view("closePoll", json!({ "pollId": id }))),
        "NotAView"
    );
    // v1's snake_case argument names are refused: unknown keys.
    assert_eq!(
        code(p.t.as_(OWNER).view("getPoll", json!({ "poll_id": id }))),
        "BadArgs"
    );
    // `closesAt` is a u64: a decimal string, not a number.
    assert_eq!(
        code(p.t.as_(OWNER).call(
            "createPoll",
            json!({
                "title": "T", "description": "", "options": ["a", "b"],
                "minChoices": 1, "maxChoices": 1,
                "trustees": [OWNER], "threshold": 1, "voters": [], "closesAt": 5,
            })
        )),
        "BadArgs"
    );
    let with_deadline =
        p.t.as_(OWNER)
            .call(
                "createPoll",
                json!({
                    "title": "T", "description": "", "options": ["a", "b"],
                    "minChoices": 1, "maxChoices": 1,
                    "trustees": [OWNER], "threshold": 1, "voters": [], "closesAt": "1700000600000",
                }),
            )
            .unwrap();
    let view = p.view(OWNER, "getPoll", json!({ "pollId": with_deadline }));
    assert_eq!(view["definition"]["closes_at"], json!("1700000600000"));
    assert_eq!(
        view["definition"]["created_at"],
        json!(common::T0.to_string())
    );
    // Errors carry a message.
    assert_eq!(
        p.t.as_(BOB).call("openVoting", json!({ "pollId": id })),
        Err(Failure::App {
            code: "Forbidden".to_owned(),
            fields: json!({ "message": "only the poll's creator can do this" })
        })
    );
}

#[test]
fn every_change_emits_its_event() {
    let mut p = new_poll(&[OWNER, BOB], 2, &[]);
    let id = p.id.clone();
    p.publish_transport_keys();
    p.deal(&[0, 1], None);
    p.action(OWNER, "openVoting").unwrap();
    p.vote(BOB, BOB, [true, false, false], "b").unwrap();
    p.action(OWNER, "closePoll").unwrap();
    p.action(OWNER, "sealPoll").unwrap();
    p.decrypt(0).unwrap();
    p.decrypt(1).unwrap();
    p.call(
        OWNER,
        "anchorResult",
        json!({ "pollId": id, "network": "git", "reference": "v1" }),
    )
    .unwrap();
    // A refused call emits nothing.
    let _ = p.action(BOB, "closePoll");
    let events = p.t.events_for(GUEST);
    let names: Vec<&str> = events.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(
        names,
        [
            "PollCreated",
            "TransportKeyPublished",
            "TransportKeyPublished",
            "DealingPublished",
            "DealingPublished",
            "VotingOpened",
            "BallotCast",
            "PollClosing",
            "PollSealed",
            "PartialPublished",
            "PartialPublished",
            "Anchored",
        ]
    );
    assert_eq!(events[0].1, json!({ "pollId": id }));
    assert_eq!(events[1].1, json!({ "pollId": id, "trustee": OWNER }));
    assert_eq!(events[6].1, json!({ "pollId": id, "voter": BOB }));
    assert_eq!(events[8].1, json!({ "pollId": id, "counted": 1 }));
    // Anchoring needs a complete result.
    let mut q = new_poll(&[OWNER], 1, &[]);
    let qid = q.id.clone();
    assert_eq!(
        code(q.call(
            OWNER,
            "anchorResult",
            json!({ "pollId": qid, "network": "git", "reference": "v1" })
        )),
        "Phase"
    );
    assert_eq!(
        code(q.call(
            OWNER,
            "anchorResult",
            json!({ "pollId": qid, "network": "", "reference": "v1" })
        )),
        "Invalid"
    );
}

/// What fits a call's fuel (200M): the largest ballot `createPoll` allows is
/// cast, and a bigger one is refused when the poll is defined, not when a
/// voter's ballot would run out of fuel.
#[test]
fn the_largest_allowed_ballot_fits_one_call() {
    for (n, min, max, allowed) in [
        (16usize, 1u32, 1u32, true),
        (12, 0, 12, true),
        (16, 0, 5, true),
        (16, 0, 6, false),
        (16, 0, 16, false),
    ] {
        let mut t = common::app(org());
        let opts: Vec<String> = (0..n).map(|i| format!("o{i}")).collect();
        let created = t.as_(OWNER).call(
            "createPoll",
            json!({
                "title": "T", "description": "", "options": opts,
                "minChoices": min, "maxChoices": max,
                "trustees": [OWNER], "threshold": 1, "voters": [], "closesAt": null,
            }),
        );
        if !allowed {
            assert_eq!(code(created), "Invalid", "{n} options, {min}..={max}");
            continue;
        }
        let id = created.unwrap().as_str().unwrap().to_owned();
        let mut p = Poll {
            t,
            id: id.clone(),
            trustees: vec![OWNER],
            es: vec![],
        };
        p.publish_transport_keys();
        p.deal(&[0], None);
        p.action(OWNER, "openVoting").unwrap();
        let key = p.election()["key"].as_str().unwrap().to_owned();
        let pk = crypto::decode_point(&key, "key").unwrap();
        let rules = crypto::Rules {
            options: n,
            min,
            max,
        };
        let mut rng = crypto::seeded_rng(b"big");
        let sel: Vec<bool> = (0..n).map(|i| (i as u32) < max).collect();
        let ballot = crypto::cast_ballot(&pk, &id, OWNER, &rules, &sel, &mut rng).unwrap();
        p.call(
            OWNER,
            "castBallot",
            json!({ "pollId": id, "ballot": wire_ballot(&ballot) }),
        )
        .unwrap_or_else(|e| panic!("{n} options, {min}..={max}: {e:?}"));
        assert!(
            p.t.last_usage().fuel < 195_000_000,
            "{:?}",
            p.t.last_usage()
        );
    }
}

/// Sealing and auditing do not re-run every proof, so they stay cheap as the
/// ballot box grows; the full audit of a decrypted poll with ten ballots runs
/// in one view.
#[test]
fn seal_and_audit_scale_with_the_ballot_box() {
    let voters: Vec<String> = (0..10).map(|i| format!("v{i}")).collect();
    let mut members = voters.clone();
    members.push(BOB.to_owned());
    members.push(MALLORY.to_owned());
    let mut t = common::app(Org::new().members(members));
    let id = create(&mut t, &[OWNER, BOB], 2, &[]);
    let mut p = Poll {
        t,
        id: id.clone(),
        trustees: vec![OWNER, BOB],
        es: vec![],
    };
    p.publish_transport_keys();
    p.deal(&[0, 1], None);
    p.action(OWNER, "openVoting").unwrap();
    for (i, v) in voters.iter().enumerate() {
        let mut sel = [false; 3];
        sel[i % 3] = true;
        p.vote(v, v, sel, v).unwrap();
    }
    p.action(OWNER, "closePoll").unwrap();
    assert_eq!(p.action(OWNER, "sealPoll").unwrap(), json!(10));
    let seal = p.t.last_usage().fuel;
    p.decrypt(0).unwrap();
    p.decrypt(1).unwrap();
    let report = p.report();
    let audit = p.t.last_usage().fuel;
    assert_eq!(report["verified"], json!(true), "{report:#}");
    assert_eq!(counts(&report), json!([4, 3, 3]));
    assert!(seal < 20_000_000, "seal {seal}");
    assert!(audit < 100_000_000, "audit {audit}");
    eprintln!("seal {seal} audit {audit}");
}

/// The largest poll `createPoll` allows — 8 trustees, all needed to decrypt,
/// 16 options — runs every step, each in one call's fuel.
#[test]
fn the_largest_ceremony_fits_one_call_per_step() {
    let trustees: [&'static str; 8] = [OWNER, BOB, CAROL, MALLORY, "t4", "t5", "t6", "t7"];
    let mut t = common::app(Org::new().members(trustees[1..].to_vec()));
    let opts: Vec<String> = (0..16).map(|i| format!("o{i}")).collect();
    let id = t
        .as_(OWNER)
        .call(
            "createPoll",
            json!({
                "title": "Big", "description": "", "options": opts,
                "minChoices": 1, "maxChoices": 1,
                "trustees": trustees, "threshold": 8, "voters": [], "closesAt": null,
            }),
        )
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned();
    let mut p = Poll {
        t,
        id: id.clone(),
        trustees: trustees.to_vec(),
        es: vec![],
    };
    let mut worst: Vec<(String, u64)> = Vec::new();
    let mut note = |p: &Poll, what: &str| worst.push((what.to_owned(), p.t.last_usage().fuel));
    p.publish_transport_keys();
    note(&p, "publishTransportKey");
    p.deal(&[0, 1, 2, 3, 4, 5, 6, 7], None);
    note(&p, "publishDealing");
    p.view(OWNER, "ceremony", json!({ "pollId": id }));
    note(&p, "ceremony");
    p.action(OWNER, "openVoting").unwrap();
    note(&p, "openVoting");
    let key = p.election()["key"].as_str().unwrap().to_owned();
    let pk = crypto::decode_point(&key, "key").unwrap();
    let rules = crypto::Rules {
        options: 16,
        min: 1,
        max: 1,
    };
    for (i, who) in [BOB, CAROL].into_iter().enumerate() {
        let mut rng = crypto::seeded_rng(who.as_bytes());
        let sel: Vec<bool> = (0..16).map(|j| j == i).collect();
        let ballot = crypto::cast_ballot(&pk, &id, who, &rules, &sel, &mut rng).unwrap();
        p.call(
            who,
            "castBallot",
            json!({ "pollId": id, "ballot": wire_ballot(&ballot) }),
        )
        .unwrap();
        note(&p, "castBallot");
    }
    p.action(OWNER, "closePoll").unwrap();
    p.action(OWNER, "sealPoll").unwrap();
    note(&p, "sealPoll");
    for i in 0..8 {
        p.decrypt(i).unwrap();
        note(&p, "publishPartial");
    }
    let report = p.report();
    note(&p, "getResult");
    assert_eq!(report["verified"], json!(true), "{report:#}");
    let mut expected = vec![0; 16];
    expected[0] = 1;
    expected[1] = 1;
    assert_eq!(counts(&report), json!(expected));
    p.view(OWNER, "getTranscript", json!({ "pollId": id }));
    note(&p, "getTranscript");
    p.view(OWNER, "getPoll", json!({ "pollId": id }));
    note(&p, "getPoll");
    for (what, fuel) in &worst {
        assert!(*fuel < 190_000_000, "{what}: {fuel}");
    }
    eprintln!("{worst:?}");
}
