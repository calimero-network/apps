//! Cross-implementation test vectors.
//!
//! The browser encrypts and proves; the contract verifies and tallies. They are
//! two implementations of one protocol in two languages, and "the tally is
//! reproducible by every member" is only true if they agree to the byte.
//!
//! This test renders a deterministic election — seeded, so every scalar is
//! fixed — into `vectors.json`, and fails if the committed file differs. The
//! frontend's `src/crypto/vectors.test.ts` replays the same seeds through the
//! TypeScript prover and must produce the identical JSON, then verifies it.
//!
//! Regenerate after an intentional protocol change with
//!
//!     UPDATE_VECTORS=1 cargo test -p mero-vote-crypto --test vectors

use mero_vote_crypto::*;
use serde_json::{json, Value};

fn branches(proof: &[Branch]) -> Value {
    proof
        .iter()
        .map(|b| json!({ "c": encode_scalar(&b.c), "z": encode_scalar(&b.z) }))
        .collect()
}

fn ballot_json(b: &Ballot) -> Value {
    json!({
        "choices": b.choices.iter().map(|c| json!({
            "a": encode_point(&c.ct.a),
            "b": encode_point(&c.ct.b),
            "proof": branches(&c.proof),
        })).collect::<Vec<_>>(),
        "sum_proof": branches(&b.sum_proof),
    })
}

fn b(x: &Branch) -> Value {
    json!({ "c": encode_scalar(&x.c), "z": encode_scalar(&x.z) })
}

fn dealing_json(d: &Dealing) -> Value {
    json!({
        "commitments": d.commitments.iter().map(encode_point).collect::<Vec<_>>(),
        "proof": b(&d.proof),
        "shares": d.shares.iter().map(|s| json!({ "r": encode_point(&s.r), "v": encode_scalar(&s.v) })).collect::<Vec<_>>(),
    })
}

fn render() -> Value {
    let poll_id = "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";
    let trustees = [
        "1111111111111111111111111111111111111111111111111111111111111111",
        "2222222222222222222222222222222222222222222222222222222222222222",
        "3333333333333333333333333333333333333333333333333333333333333333",
    ];
    let threshold = 2u32;
    let rules = Rules {
        options: 3,
        min: 1,
        max: 2,
    };

    // Round 1: transport keys.
    let mut transport = vec![];
    let mut es = vec![];
    for (i, t) in trustees.iter().enumerate() {
        let seed = format!("transport-{i}");
        let mut rng = seeded_rng(seed.as_bytes());
        let e = rng();
        let (key, proof) = make_transport_key(poll_id, t, &e, &mut rng);
        assert!(verify_transport_key(poll_id, t, &key, &proof));
        es.push(e);
        transport.push(json!({
            "trustee": t, "seed": seed, "secret": encode_scalar(&e),
            "key": encode_point(&key), "proof": b(&proof),
        }));
    }
    let keys: Vec<_> = es
        .iter()
        .map(|e| e * curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT)
        .collect();

    // Round 2: dealings.
    let mut dealings = vec![];
    let mut dealings_json = vec![];
    for (i, t) in trustees.iter().enumerate() {
        let seed = format!("dealing-{i}");
        let mut rng = seeded_rng(seed.as_bytes());
        let d = deal(poll_id, t, threshold, &keys, &mut rng).unwrap();
        verify_dealing(poll_id, t, threshold, trustees.len(), &d).unwrap();
        dealings_json.push(json!({ "dealer": t, "seed": seed, "dealing": dealing_json(&d) }));
        dealings.push(d);
    }
    let refs: Vec<&Dealing> = dealings.iter().collect();
    let pk = joint_key(&refs);

    // Each trustee's combined key, and its public half.
    let xs: Vec<_> = (0..trustees.len())
        .map(|j| {
            dealings
                .iter()
                .zip(&trustees)
                .map(|(d, dealer)| open_share(poll_id, dealer, j as u32 + 1, &es[j], d).unwrap())
                .sum::<curve25519_dalek::scalar::Scalar>()
        })
        .collect();
    let vkeys: Vec<_> = (1..=trustees.len() as u32)
        .map(|j| encode_point(&verification_key(&refs, j)))
        .collect();

    // A cheating dealer and the complaint that exposes it.
    let mut rng = seeded_rng(b"cheater");
    let mut cheat = deal(poll_id, trustees[0], threshold, &keys, &mut rng).unwrap();
    cheat.shares[2].v += curve25519_dalek::scalar::Scalar::ONE;
    let (secret, proof) = make_complaint(
        poll_id,
        trustees[2],
        trustees[0],
        3,
        &es[2],
        &cheat,
        &mut rng,
    )
    .unwrap();
    assert!(complaint_is_valid(
        poll_id,
        trustees[2],
        trustees[0],
        3,
        &keys[2],
        &cheat,
        &secret,
        &proof
    ));
    let complaint = json!({
        "seed": "cheater", "dealer": trustees[0], "recipient": trustees[2], "index": 3,
        "dealing": dealing_json(&cheat), "secret": encode_point(&secret), "proof": b(&proof),
    });

    let votes: [(&str, [bool; 3]); 3] = [
        (
            "aaaa000000000000000000000000000000000000000000000000000000000001",
            [true, false, false],
        ),
        (
            "aaaa000000000000000000000000000000000000000000000000000000000002",
            [true, false, true],
        ),
        (
            "aaaa000000000000000000000000000000000000000000000000000000000003",
            [false, true, false],
        ),
    ];
    let mut aggregate = vec![Ciphertext::zero(); rules.options];
    let mut ballots = vec![];
    for (i, (voter, selection)) in votes.iter().enumerate() {
        let seed = format!("ballot-{i}");
        let mut rng = seeded_rng(seed.as_bytes());
        let ballot = cast_ballot(&pk, poll_id, voter, &rules, selection, &mut rng).unwrap();
        verify_ballot(&pk, poll_id, voter, &rules, &ballot).unwrap();
        for (j, c) in ballot.choices.iter().enumerate() {
            aggregate[j] = aggregate[j].add(&c.ct);
        }
        ballots.push(json!({
            "voter": voter, "seed": seed, "selection": selection,
            "ballot": ballot_json(&ballot),
            "digest": hex::encode(ballot_digest(poll_id, voter, &ballot)),
        }));
    }

    // Trustees #1 and #3 decrypt; #2 never shows up.
    let mut partials = vec![];
    let mut picked: Vec<Vec<(u32, curve25519_dalek::ristretto::RistrettoPoint)>> =
        vec![vec![]; rules.options];
    for k in [0usize, 2] {
        let seed = format!("partial-{k}");
        let mut rng = seeded_rng(seed.as_bytes());
        let mut per_option = vec![];
        for (j, ct) in aggregate.iter().enumerate() {
            let (d, proof) =
                partial_decrypt(poll_id, trustees[k], j as u32, &xs[k], &ct.a, &mut rng);
            picked[j].push((k as u32 + 1, d));
            per_option.push(json!({ "d": encode_point(&d), "proof": b(&proof) }));
        }
        partials.push(
            json!({ "trustee": trustees[k], "index": k + 1, "seed": seed, "options": per_option }),
        );
    }
    let counts: Vec<u64> = aggregate
        .iter()
        .zip(&picked)
        .map(|(ct, ps)| open_count(ct, ps, votes.len() as u64).unwrap())
        .collect();
    assert_eq!(counts, vec![2, 1, 1]);

    let lagrange: Vec<String> = [1u32, 3, 4]
        .iter()
        .map(|i| encode_scalar(&lagrange_at_zero(*i, &[1, 3, 4])))
        .collect();
    let mut rng = seeded_rng(b"abc");
    let rng_first_three = vec![
        encode_scalar(&rng()),
        encode_scalar(&rng()),
        encode_scalar(&rng()),
    ];

    json!({
        "protocol": String::from_utf8_lossy(PROTOCOL),
        "hash_to_scalar": {
            "domain": "test",
            "parts": ["", "mero", "vote"],
            "scalar": encode_scalar(&hash_to_scalar("test", &[b"", b"mero", b"vote"])),
        },
        "rng_seed": "abc",
        "rng_first_three": rng_first_three,
        "lagrange": {
            "set": [1, 3, 4],
            "coefficients": lagrange,
        },
        "poll_id": poll_id,
        "trustees": trustees,
        "threshold": threshold,
        "rules": { "options": rules.options, "min": rules.min, "max": rules.max },
        "transport": transport,
        "dealings": dealings_json,
        "combined_secrets": xs.iter().map(encode_scalar).collect::<Vec<_>>(),
        "verification_keys": vkeys,
        "election_key": encode_point(&pk),
        "complaint": complaint,
        "ballots": ballots,
        "aggregate": aggregate.iter().map(|c| json!({ "a": encode_point(&c.a), "b": encode_point(&c.b) })).collect::<Vec<_>>(),
        "partials": partials,
        "counts": counts,
    })
}

#[test]
fn vectors_are_current() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/vectors.json");
    let rendered = serde_json::to_string_pretty(&render()).unwrap() + "\n";
    if std::env::var_os("UPDATE_VECTORS").is_some() {
        std::fs::write(path, &rendered).unwrap();
        return;
    }
    let committed = std::fs::read_to_string(path).unwrap_or_default();
    assert!(
        committed == rendered,
        "vectors.json is stale — run `UPDATE_VECTORS=1 cargo test -p mero-vote-crypto --test vectors` \
         and re-run the frontend's vectors.test.ts"
    );
}
