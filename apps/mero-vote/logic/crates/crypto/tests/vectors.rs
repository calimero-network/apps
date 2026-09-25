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

fn render() -> Value {
    let poll_id = "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";
    let trustees = [
        (
            "1111111111111111111111111111111111111111111111111111111111111111",
            b"trustee-1".as_slice(),
        ),
        (
            "2222222222222222222222222222222222222222222222222222222222222222",
            b"trustee-2".as_slice(),
        ),
    ];
    let rules = Rules {
        options: 3,
        min: 1,
        max: 2,
    };

    let mut shares = vec![];
    let mut secrets = vec![];
    for (account, seed) in trustees {
        let mut rng = seeded_rng(seed);
        let x = rng();
        let (h, proof) = make_key_share(poll_id, account, &x, &mut rng);
        assert!(verify_key_share(poll_id, account, &h, &proof));
        secrets.push(x);
        shares.push(json!({
            "trustee": account,
            "seed": String::from_utf8_lossy(seed),
            "secret": encode_scalar(&x),
            "share": encode_point(&h),
            "proof": { "c": encode_scalar(&proof.c), "z": encode_scalar(&proof.z) },
        }));
    }
    let share_points: Vec<_> = shares
        .iter()
        .map(|s| decode_point(s["share"].as_str().unwrap(), "share").unwrap())
        .collect();
    let pk = combine_keys(&share_points);

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
            "voter": voter,
            "seed": seed,
            "selection": selection,
            "ballot": ballot_json(&ballot),
            "digest": hex::encode(ballot_digest(poll_id, voter, &ballot)),
        }));
    }

    let mut partials = vec![];
    for ((account, _), x) in trustees.iter().zip(&secrets) {
        let seed = format!("partial-{account}");
        let mut rng = seeded_rng(seed.as_bytes());
        let mut per_option = vec![];
        for (j, ct) in aggregate.iter().enumerate() {
            let (d, proof) = partial_decrypt(poll_id, account, j as u32, x, &ct.a, &mut rng);
            per_option.push(json!({
                "d": encode_point(&d),
                "proof": { "c": encode_scalar(&proof.c), "z": encode_scalar(&proof.z) },
            }));
        }
        partials.push(json!({ "trustee": account, "seed": seed, "options": per_option }));
    }

    let counts: Vec<u64> = aggregate
        .iter()
        .enumerate()
        .map(|(j, ct)| {
            let ds: Vec<_> = partials
                .iter()
                .map(|p| decode_point(p["options"][j]["d"].as_str().unwrap(), "d").unwrap())
                .collect();
            open_count(ct, &ds, votes.len() as u64).unwrap()
        })
        .collect();
    assert_eq!(counts, vec![2, 1, 1]);

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
        "poll_id": poll_id,
        "rules": { "options": rules.options, "min": rules.min, "max": rules.max },
        "shares": shares,
        "election_key": encode_point(&pk),
        "ballots": ballots,
        "aggregate": aggregate.iter().map(|c| json!({
            "a": encode_point(&c.a), "b": encode_point(&c.b)
        })).collect::<Vec<_>>(),
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
