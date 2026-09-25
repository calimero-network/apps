//! The ballot cryptography behind mero-vote.
//!
//! # Why this crate exists at all
//!
//! Calimero already gives a poll most of what it needs: every write is signed
//! by its author's account and checked at merge, every member holds the whole
//! ballot box, and every member runs the same contract over it — so a tally is
//! reproducible by anyone in the context, with no server to trust.
//!
//! What Calimero does NOT give is secrecy *from the other members*. Replicated
//! state is replicated to everyone; a plaintext ballot in a context is a ballot
//! every member (and every member's node operator) can read. So the secrecy has
//! to come from cryptography inside the app, and this is it.
//!
//! # The scheme (Helios-style, no SNARKs)
//!
//! * **Exponential ElGamal on ristretto255.** A choice `m ∈ {0,1}` is
//!   `(A, B) = (r·G, m·G + r·H)` under the election key `H`. Ciphertexts add, so
//!   the product of every ballot's ciphertext for an option encrypts that
//!   option's count, and no single ballot is ever decrypted.
//! * **Distributed key.** `H = Σ hᵢ` over the trustees' shares `hᵢ = xᵢ·G`, each
//!   published with a Schnorr proof of knowledge (which is what stops a trustee
//!   choosing a share that cancels the others). Decrypting needs every trustee.
//! * **Disjunctive Chaum–Pedersen proofs** (CDS94) that each ciphertext encrypts
//!   0 or 1, and that the ballot's sum lies in `[min, max]`. Without them one
//!   voter could encrypt `1000` and nobody could tell.
//! * **Chaum–Pedersen DLEQ proofs** that each trustee's partial decryption
//!   `Dᵢ = xᵢ·A` uses the same `xᵢ` as their published share.
//!
//! All proofs are made non-interactive with Fiat–Shamir over SHA-512, and every
//! challenge binds the poll id, the author's account and the election key, so a
//! ballot cannot be replayed into another poll or re-submitted under another
//! voter's name.
//!
//! These are zero-knowledge proofs — sigma protocols, not zk-SNARKs. No trusted
//! setup, no circuit, verification is a handful of scalar multiplications per
//! choice, and it runs inside the contract's WASM.
//!
//! # Determinism
//!
//! Nothing here draws randomness. Every prover takes an `rng` closure, which the
//! browser backs with `crypto.getRandomValues` and the tests back with a seeded
//! hash. That is what lets `vectors.json` pin the TypeScript implementation to
//! this one byte for byte: the same seed must produce the same proof in both.
//!
//! The consumption order of `rng` is therefore part of the wire format, and is
//! documented on every prover.

#![forbid(unsafe_code)]

use core::fmt;

use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT as G;
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::Identity;
use sha2::{Digest, Sha256, Sha512};

pub use curve25519_dalek::ristretto::RistrettoPoint as Point;
pub use curve25519_dalek::scalar::Scalar as FieldScalar;

/// Prefix of every hash this protocol computes. Bump the version and every
/// proof, digest and transcript changes with it.
pub const PROTOCOL: &[u8] = b"mero-vote/v1/";

/// Largest option list a poll may carry. Bounds the work a single ballot can
/// demand of every verifier.
pub const MAX_OPTIONS: usize = 16;

// ── errors ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CryptoError {
    /// A hex string was not 64 characters of hex.
    BadHex(&'static str),
    /// 32 bytes that are not a canonical ristretto255 encoding.
    BadPoint(&'static str),
    /// 32 bytes that are not a canonical scalar (>= the group order).
    BadScalar(&'static str),
    /// The ballot's shape does not match the poll's rules.
    Shape(&'static str),
    /// A proof did not verify.
    Proof(&'static str),
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CryptoError::BadHex(what) => write!(f, "{what}: not 32 bytes of hex"),
            CryptoError::BadPoint(what) => write!(f, "{what}: not a valid ristretto255 point"),
            CryptoError::BadScalar(what) => write!(f, "{what}: not a canonical scalar"),
            CryptoError::Shape(what) => write!(f, "malformed: {what}"),
            CryptoError::Proof(what) => write!(f, "proof rejected: {what}"),
        }
    }
}

// ── encoding ────────────────────────────────────────────────────────────────

fn hex32(s: &str, what: &'static str) -> Result<[u8; 32], CryptoError> {
    let bytes = hex::decode(s).map_err(|_| CryptoError::BadHex(what))?;
    bytes.try_into().map_err(|_| CryptoError::BadHex(what))
}

/// Parse a point, rejecting non-canonical encodings. Canonicity matters: a
/// ballot digest is computed over the bytes, so two encodings of one point
/// would give one ballot two identities.
pub fn decode_point(s: &str, what: &'static str) -> Result<RistrettoPoint, CryptoError> {
    CompressedRistretto(hex32(s, what)?)
        .decompress()
        .ok_or(CryptoError::BadPoint(what))
}

pub fn decode_scalar(s: &str, what: &'static str) -> Result<Scalar, CryptoError> {
    Option::from(Scalar::from_canonical_bytes(hex32(s, what)?)).ok_or(CryptoError::BadScalar(what))
}

pub fn point_bytes(p: &RistrettoPoint) -> [u8; 32] {
    p.compress().to_bytes()
}

pub fn encode_point(p: &RistrettoPoint) -> String {
    hex::encode(point_bytes(p))
}

pub fn encode_scalar(s: &Scalar) -> String {
    hex::encode(s.to_bytes())
}

// ── hashing ─────────────────────────────────────────────────────────────────

/// `SHA-512(PROTOCOL ‖ domain ‖ 0x00 ‖ (u32le(len) ‖ part)*)`, reduced mod ℓ.
///
/// Length-prefixing every part is what makes the encoding injective: without
/// it `("ab", "c")` and `("a", "bc")` would hash alike.
pub fn hash_to_scalar(domain: &str, parts: &[&[u8]]) -> Scalar {
    let mut h = Sha512::new();
    h.update(PROTOCOL);
    h.update(domain.as_bytes());
    h.update([0u8]);
    for p in parts {
        h.update((p.len() as u32).to_le_bytes());
        h.update(p);
    }
    let out: [u8; 64] = h.finalize().into();
    Scalar::from_bytes_mod_order_wide(&out)
}

/// The same framing as [`hash_to_scalar`], as a SHA-256 digest. Used for
/// identities (ballot digests), never for challenges.
pub fn hash_to_digest(domain: &str, parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(PROTOCOL);
    h.update(domain.as_bytes());
    h.update([0u8]);
    for p in parts {
        h.update((p.len() as u32).to_le_bytes());
        h.update(p);
    }
    h.finalize().into()
}

/// A deterministic scalar stream, for tests and test vectors only.
///
/// `k`-th output is `hash_to_scalar("test-rng", [seed, u64le(k)])`.
pub fn seeded_rng(seed: &[u8]) -> impl FnMut() -> Scalar + '_ {
    let mut k: u64 = 0;
    move || {
        let s = hash_to_scalar("test-rng", &[seed, &k.to_le_bytes()]);
        k += 1;
        s
    }
}

// ── ElGamal ─────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ciphertext {
    pub a: RistrettoPoint,
    pub b: RistrettoPoint,
}

impl Ciphertext {
    pub fn zero() -> Self {
        Self {
            a: RistrettoPoint::identity(),
            b: RistrettoPoint::identity(),
        }
    }

    pub fn add(&self, other: &Self) -> Self {
        Self {
            a: self.a + other.a,
            b: self.b + other.b,
        }
    }
}

/// `(r·G, m·G + r·H)`.
pub fn encrypt(pk: &RistrettoPoint, m: u64, r: &Scalar) -> Ciphertext {
    Ciphertext {
        a: r * G,
        b: Scalar::from(m) * G + r * pk,
    }
}

/// Sum of the trustees' shares. Order-independent, so every member derives the
/// same key from the same set.
pub fn combine_keys(shares: &[RistrettoPoint]) -> RistrettoPoint {
    shares
        .iter()
        .fold(RistrettoPoint::identity(), |acc, h| acc + h)
}

/// Recover `m` from `m·G` by walking `0..=max`. `max` is the number of counted
/// ballots, so this is linear in turnout and never unbounded.
pub fn small_dlog(target: &RistrettoPoint, max: u64) -> Option<u64> {
    let mut acc = RistrettoPoint::identity();
    for m in 0..=max {
        if acc == *target {
            return Some(m);
        }
        acc += G;
    }
    None
}

// ── proofs ──────────────────────────────────────────────────────────────────

/// One branch of a disjunctive proof, or the whole of a single proof.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Branch {
    pub c: Scalar,
    pub z: Scalar,
}

/// Proof that a ciphertext encrypts one of `values`, without saying which.
pub type MembershipProof = Vec<Branch>;

fn membership_challenge(
    domain: &str,
    ctx: &[&[u8]],
    pk: &RistrettoPoint,
    ct: &Ciphertext,
    values: &[u64],
    commitments: &[(RistrettoPoint, RistrettoPoint)],
) -> Scalar {
    let pk_b = point_bytes(pk);
    let a_b = point_bytes(&ct.a);
    let b_b = point_bytes(&ct.b);
    let vals: Vec<[u8; 8]> = values.iter().map(|v| v.to_le_bytes()).collect();
    let comms: Vec<[u8; 32]> = commitments
        .iter()
        .flat_map(|(t1, t2)| [point_bytes(t1), point_bytes(t2)])
        .collect();

    let mut parts: Vec<&[u8]> = ctx.to_vec();
    parts.push(&pk_b);
    parts.push(&a_b);
    parts.push(&b_b);
    parts.extend(vals.iter().map(|v| v.as_slice()));
    parts.extend(comms.iter().map(|c| c.as_slice()));
    hash_to_scalar(domain, &parts)
}

/// CDS94 OR-proof that `ct` encrypts `values[real]` under `pk`, with witness `r`.
///
/// `rng` is consumed in this order, which is part of the wire format: for each
/// `i` in `0..values.len()` other than `real`, first `cᵢ` then `zᵢ`; then the
/// real branch's nonce `w`.
#[allow(clippy::too_many_arguments)]
pub fn prove_membership(
    domain: &str,
    ctx: &[&[u8]],
    pk: &RistrettoPoint,
    ct: &Ciphertext,
    values: &[u64],
    real: usize,
    r: &Scalar,
    rng: &mut dyn FnMut() -> Scalar,
) -> MembershipProof {
    let n = values.len();
    let mut branches = vec![
        Branch {
            c: Scalar::ZERO,
            z: Scalar::ZERO
        };
        n
    ];
    let mut commitments = vec![(RistrettoPoint::identity(), RistrettoPoint::identity()); n];

    for i in 0..n {
        if i == real {
            continue;
        }
        let c = rng();
        let z = rng();
        let shifted = ct.b - Scalar::from(values[i]) * G;
        commitments[i] = (z * G - c * ct.a, z * pk - c * shifted);
        branches[i] = Branch { c, z };
    }
    let w = rng();
    commitments[real] = (w * G, w * pk);

    let challenge = membership_challenge(domain, ctx, pk, ct, values, &commitments);
    let others: Scalar = branches
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != real)
        .map(|(_, b)| b.c)
        .sum();
    let c_real = challenge - others;
    branches[real] = Branch {
        c: c_real,
        z: w + c_real * r,
    };
    branches
}

pub fn verify_membership(
    domain: &str,
    ctx: &[&[u8]],
    pk: &RistrettoPoint,
    ct: &Ciphertext,
    values: &[u64],
    proof: &MembershipProof,
) -> bool {
    if values.is_empty() || proof.len() != values.len() {
        return false;
    }
    let commitments: Vec<_> = proof
        .iter()
        .zip(values)
        .map(|(br, v)| {
            let shifted = ct.b - Scalar::from(*v) * G;
            (br.z * G - br.c * ct.a, br.z * pk - br.c * shifted)
        })
        .collect();
    let sum: Scalar = proof.iter().map(|b| b.c).sum();
    sum == membership_challenge(domain, ctx, pk, ct, values, &commitments)
}

/// Chaum–Pedersen: `log_G(pub_g) == log_base(pub_base)`.
///
/// `rng` is consumed once, for the nonce.
pub fn prove_dleq(
    domain: &str,
    ctx: &[&[u8]],
    base: &RistrettoPoint,
    x: &Scalar,
    rng: &mut dyn FnMut() -> Scalar,
) -> (RistrettoPoint, RistrettoPoint, Branch) {
    let pub_g = x * G;
    let pub_base = x * base;
    let w = rng();
    let c = dleq_challenge(domain, ctx, base, &pub_g, &pub_base, &(w * G), &(w * base));
    (pub_g, pub_base, Branch { c, z: w + c * x })
}

pub fn verify_dleq(
    domain: &str,
    ctx: &[&[u8]],
    base: &RistrettoPoint,
    pub_g: &RistrettoPoint,
    pub_base: &RistrettoPoint,
    proof: &Branch,
) -> bool {
    let t1 = proof.z * G - proof.c * pub_g;
    let t2 = proof.z * base - proof.c * pub_base;
    proof.c == dleq_challenge(domain, ctx, base, pub_g, pub_base, &t1, &t2)
}

fn dleq_challenge(
    domain: &str,
    ctx: &[&[u8]],
    base: &RistrettoPoint,
    pub_g: &RistrettoPoint,
    pub_base: &RistrettoPoint,
    t1: &RistrettoPoint,
    t2: &RistrettoPoint,
) -> Scalar {
    let bytes = [
        point_bytes(pub_g),
        point_bytes(base),
        point_bytes(pub_base),
        point_bytes(t1),
        point_bytes(t2),
    ];
    let mut parts: Vec<&[u8]> = ctx.to_vec();
    parts.extend(bytes.iter().map(|b| b.as_slice()));
    hash_to_scalar(domain, &parts)
}

/// Schnorr proof of knowledge of `x` in `h = x·G`. `rng` is consumed once.
pub fn prove_knowledge(
    domain: &str,
    ctx: &[&[u8]],
    x: &Scalar,
    rng: &mut dyn FnMut() -> Scalar,
) -> (RistrettoPoint, Branch) {
    let h = x * G;
    let w = rng();
    let c = knowledge_challenge(domain, ctx, &h, &(w * G));
    (h, Branch { c, z: w + c * x })
}

pub fn verify_knowledge(domain: &str, ctx: &[&[u8]], h: &RistrettoPoint, proof: &Branch) -> bool {
    let t = proof.z * G - proof.c * h;
    proof.c == knowledge_challenge(domain, ctx, h, &t)
}

fn knowledge_challenge(
    domain: &str,
    ctx: &[&[u8]],
    h: &RistrettoPoint,
    t: &RistrettoPoint,
) -> Scalar {
    let bytes = [point_bytes(h), point_bytes(t)];
    let mut parts: Vec<&[u8]> = ctx.to_vec();
    parts.extend(bytes.iter().map(|b| b.as_slice()));
    hash_to_scalar(domain, &parts)
}

// ── the protocol ────────────────────────────────────────────────────────────

/// What a ballot must satisfy: one ciphertext per option, each 0 or 1, and
/// between `min` and `max` of them set.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rules {
    pub options: usize,
    pub min: u32,
    pub max: u32,
}

impl Rules {
    pub fn check(&self) -> Result<(), CryptoError> {
        if self.options < 2 || self.options > MAX_OPTIONS {
            return Err(CryptoError::Shape("a poll needs 2..=16 options"));
        }
        if self.min > self.max || self.max as usize > self.options || self.max == 0 {
            return Err(CryptoError::Shape(
                "choice bounds must satisfy 0 <= min <= max <= options, max >= 1",
            ));
        }
        Ok(())
    }

    fn sum_values(&self) -> Vec<u64> {
        (self.min as u64..=self.max as u64).collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncryptedChoice {
    pub ct: Ciphertext,
    pub proof: MembershipProof,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ballot {
    pub choices: Vec<EncryptedChoice>,
    pub sum_proof: MembershipProof,
}

const BINARY: [u64; 2] = [0, 1];

/// Encrypt `selections` into a ballot for `voter` in `poll_id`.
///
/// `rng` order: for each option in turn, its encryption randomness `r` and then
/// its membership proof's draws (see [`prove_membership`]); then the sum proof's
/// draws.
pub fn cast_ballot(
    pk: &RistrettoPoint,
    poll_id: &str,
    voter: &str,
    rules: &Rules,
    selections: &[bool],
    rng: &mut dyn FnMut() -> Scalar,
) -> Result<Ballot, CryptoError> {
    rules.check()?;
    if selections.len() != rules.options {
        return Err(CryptoError::Shape("one selection per option"));
    }
    let chosen = selections.iter().filter(|s| **s).count() as u32;
    if chosen < rules.min || chosen > rules.max {
        return Err(CryptoError::Shape(
            "selection count outside the poll's bounds",
        ));
    }

    let pk_b = point_bytes(pk);
    let mut choices = Vec::with_capacity(rules.options);
    let mut total_r = Scalar::ZERO;
    let mut total = Ciphertext::zero();
    for (i, selected) in selections.iter().enumerate() {
        let m = u64::from(*selected);
        let r = rng();
        let ct = encrypt(pk, m, &r);
        let idx = (i as u32).to_le_bytes();
        let ctx: [&[u8]; 4] = [poll_id.as_bytes(), voter.as_bytes(), &pk_b, &idx];
        let proof = prove_membership("choice", &ctx, pk, &ct, &BINARY, m as usize, &r, rng);
        total_r += r;
        total = total.add(&ct);
        choices.push(EncryptedChoice { ct, proof });
    }

    let values = rules.sum_values();
    let real = (chosen - rules.min) as usize;
    let ctx: [&[u8]; 3] = [poll_id.as_bytes(), voter.as_bytes(), &pk_b];
    let sum_proof = prove_membership("sum", &ctx, pk, &total, &values, real, &total_r, rng);
    Ok(Ballot { choices, sum_proof })
}

/// Every check a ballot must pass before it may be counted.
pub fn verify_ballot(
    pk: &RistrettoPoint,
    poll_id: &str,
    voter: &str,
    rules: &Rules,
    ballot: &Ballot,
) -> Result<(), CryptoError> {
    rules.check()?;
    if ballot.choices.len() != rules.options {
        return Err(CryptoError::Shape("one ciphertext per option"));
    }
    let pk_b = point_bytes(pk);
    let mut total = Ciphertext::zero();
    for (i, choice) in ballot.choices.iter().enumerate() {
        let idx = (i as u32).to_le_bytes();
        let ctx: [&[u8]; 4] = [poll_id.as_bytes(), voter.as_bytes(), &pk_b, &idx];
        if !verify_membership("choice", &ctx, pk, &choice.ct, &BINARY, &choice.proof) {
            return Err(CryptoError::Proof(
                "an option is not an encryption of 0 or 1",
            ));
        }
        total = total.add(&choice.ct);
    }
    let ctx: [&[u8]; 3] = [poll_id.as_bytes(), voter.as_bytes(), &pk_b];
    if !verify_membership(
        "sum",
        &ctx,
        pk,
        &total,
        &rules.sum_values(),
        &ballot.sum_proof,
    ) {
        return Err(CryptoError::Proof(
            "the number of options chosen is outside the bounds",
        ));
    }
    Ok(())
}

/// A ballot's identity: what a voter keeps as their receipt, and what a
/// closure freezes. Over the canonical bytes, so it is the same in every
/// implementation.
pub fn ballot_digest(poll_id: &str, voter: &str, ballot: &Ballot) -> [u8; 32] {
    let mut owned: Vec<[u8; 32]> = Vec::new();
    for choice in &ballot.choices {
        owned.push(point_bytes(&choice.ct.a));
        owned.push(point_bytes(&choice.ct.b));
        for br in &choice.proof {
            owned.push(br.c.to_bytes());
            owned.push(br.z.to_bytes());
        }
    }
    for br in &ballot.sum_proof {
        owned.push(br.c.to_bytes());
        owned.push(br.z.to_bytes());
    }
    let counts = [
        (ballot.choices.len() as u32).to_le_bytes(),
        (ballot.sum_proof.len() as u32).to_le_bytes(),
    ];
    let mut parts: Vec<&[u8]> = vec![poll_id.as_bytes(), voter.as_bytes(), &counts[0], &counts[1]];
    parts.extend(owned.iter().map(|b| b.as_slice()));
    hash_to_digest("ballot", &parts)
}

/// A trustee's key share and its proof of knowledge. `rng` is consumed once.
pub fn make_key_share(
    poll_id: &str,
    trustee: &str,
    x: &Scalar,
    rng: &mut dyn FnMut() -> Scalar,
) -> (RistrettoPoint, Branch) {
    prove_knowledge(
        "keyshare",
        &[poll_id.as_bytes(), trustee.as_bytes()],
        x,
        rng,
    )
}

pub fn verify_key_share(poll_id: &str, trustee: &str, h: &RistrettoPoint, proof: &Branch) -> bool {
    verify_knowledge(
        "keyshare",
        &[poll_id.as_bytes(), trustee.as_bytes()],
        h,
        proof,
    )
}

/// A trustee's share of the decryption of one option's aggregate. `rng` is
/// consumed once.
pub fn partial_decrypt(
    poll_id: &str,
    trustee: &str,
    option: u32,
    x: &Scalar,
    aggregate_a: &RistrettoPoint,
    rng: &mut dyn FnMut() -> Scalar,
) -> (RistrettoPoint, Branch) {
    let idx = option.to_le_bytes();
    let ctx: [&[u8]; 3] = [poll_id.as_bytes(), trustee.as_bytes(), &idx];
    let (_, d, proof) = prove_dleq("partial", &ctx, aggregate_a, x, rng);
    (d, proof)
}

pub fn verify_partial(
    poll_id: &str,
    trustee: &str,
    option: u32,
    share: &RistrettoPoint,
    aggregate_a: &RistrettoPoint,
    d: &RistrettoPoint,
    proof: &Branch,
) -> bool {
    let idx = option.to_le_bytes();
    let ctx: [&[u8]; 3] = [poll_id.as_bytes(), trustee.as_bytes(), &idx];
    verify_dleq("partial", &ctx, aggregate_a, share, d, proof)
}

/// `B − Σ Dᵢ = m·G`; solve for `m ≤ max`.
pub fn open_count(aggregate: &Ciphertext, partials: &[RistrettoPoint], max: u64) -> Option<u64> {
    let mask = partials
        .iter()
        .fold(RistrettoPoint::identity(), |acc, d| acc + d);
    small_dlog(&(aggregate.b - mask), max)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keypair(seed: &[u8]) -> (Scalar, RistrettoPoint) {
        let x = seeded_rng(seed)();
        (x, x * G)
    }

    fn rules(options: usize, min: u32, max: u32) -> Rules {
        Rules { options, min, max }
    }

    #[test]
    fn a_ballot_round_trips_through_verification() {
        let (_, pk) = keypair(b"k");
        let r = rules(3, 1, 1);
        let mut rng = seeded_rng(b"ballot");
        let ballot =
            cast_ballot(&pk, "poll", "alice", &r, &[false, true, false], &mut rng).unwrap();
        verify_ballot(&pk, "poll", "alice", &r, &ballot).unwrap();
    }

    #[test]
    fn a_ballot_is_bound_to_its_voter_and_poll() {
        let (_, pk) = keypair(b"k");
        let r = rules(2, 1, 1);
        let mut rng = seeded_rng(b"ballot");
        let ballot = cast_ballot(&pk, "poll", "alice", &r, &[true, false], &mut rng).unwrap();
        assert!(verify_ballot(&pk, "poll", "mallory", &r, &ballot).is_err());
        assert!(verify_ballot(&pk, "other-poll", "alice", &r, &ballot).is_err());
        let (_, other_pk) = keypair(b"other");
        assert!(verify_ballot(&other_pk, "poll", "alice", &r, &ballot).is_err());
    }

    #[test]
    fn an_overvote_cannot_be_proved() {
        // Encrypt m = 2 for one option and try to pass it off as 0/1 by using
        // the real-branch witness for "1": the equations do not hold.
        let (_, pk) = keypair(b"k");
        let mut rng = seeded_rng(b"cheat");
        let r = rng();
        let ct = encrypt(&pk, 2, &r);
        let proof = prove_membership("choice", &[b"x"], &pk, &ct, &BINARY, 1, &r, &mut rng);
        assert!(!verify_membership(
            "choice",
            &[b"x"],
            &pk,
            &ct,
            &BINARY,
            &proof
        ));
    }

    #[test]
    fn selection_count_is_enforced() {
        let (_, pk) = keypair(b"k");
        let r = rules(3, 1, 1);
        let mut rng = seeded_rng(b"b");
        assert!(cast_ballot(&pk, "p", "v", &r, &[true, true, false], &mut rng).is_err());
        assert!(cast_ballot(&pk, "p", "v", &r, &[false, false, false], &mut rng).is_err());

        // Forge: two single-choice ballots' option proofs stitched together
        // with a sum proof for the wrong total must fail.
        let a = cast_ballot(&pk, "p", "v", &r, &[true, false, false], &mut rng).unwrap();
        let b = cast_ballot(&pk, "p", "v", &r, &[false, true, false], &mut rng).unwrap();
        let forged = Ballot {
            choices: vec![
                a.choices[0].clone(),
                b.choices[1].clone(),
                a.choices[2].clone(),
            ],
            sum_proof: a.sum_proof.clone(),
        };
        assert!(verify_ballot(&pk, "p", "v", &r, &forged).is_err());
    }

    #[test]
    fn approval_ranges_verify() {
        let (_, pk) = keypair(b"k");
        let r = rules(4, 0, 3);
        let mut rng = seeded_rng(b"b");
        for sel in [
            [false, false, false, false],
            [true, false, true, false],
            [true, true, true, false],
        ] {
            let ballot = cast_ballot(&pk, "p", "v", &r, &sel, &mut rng).unwrap();
            verify_ballot(&pk, "p", "v", &r, &ballot).unwrap();
        }
    }

    #[test]
    fn two_trustees_decrypt_a_tally_neither_could_alone() {
        let (x1, h1) = keypair(b"t1");
        let (x2, h2) = keypair(b"t2");
        let pk = combine_keys(&[h1, h2]);
        let r = rules(3, 1, 1);
        let mut rng = seeded_rng(b"election");

        let votes = [
            [true, false, false],
            [false, false, true],
            [true, false, false],
            [true, false, false],
        ];
        let mut agg = vec![Ciphertext::zero(); 3];
        for (i, v) in votes.iter().enumerate() {
            let voter = format!("voter-{i}");
            let ballot = cast_ballot(&pk, "p", &voter, &r, v, &mut rng).unwrap();
            verify_ballot(&pk, "p", &voter, &r, &ballot).unwrap();
            for (j, c) in ballot.choices.iter().enumerate() {
                agg[j] = agg[j].add(&c.ct);
            }
        }

        let mut counts = vec![];
        for (j, ct) in agg.iter().enumerate() {
            let (d1, p1) = partial_decrypt("p", "t1", j as u32, &x1, &ct.a, &mut rng);
            let (d2, p2) = partial_decrypt("p", "t2", j as u32, &x2, &ct.a, &mut rng);
            assert!(verify_partial("p", "t1", j as u32, &h1, &ct.a, &d1, &p1));
            assert!(verify_partial("p", "t2", j as u32, &h2, &ct.a, &d2, &p2));
            // A partial is bound to its trustee's share.
            assert!(!verify_partial("p", "t1", j as u32, &h2, &ct.a, &d1, &p1));
            // One trustee alone recovers nothing meaningful.
            assert_ne!(open_count(ct, &[d1], 4), Some([3, 0, 1][j]));
            counts.push(open_count(ct, &[d1, d2], 4).unwrap());
        }
        assert_eq!(counts, vec![3, 0, 1]);
    }

    #[test]
    fn key_share_proof_rejects_a_rogue_key() {
        let (x1, h1) = keypair(b"t1");
        let mut rng = seeded_rng(b"r");
        let (h, proof) = make_key_share("p", "t1", &x1, &mut rng);
        assert_eq!(h, h1);
        assert!(verify_key_share("p", "t1", &h, &proof));
        assert!(!verify_key_share("p", "t2", &h, &proof));
        // The rogue-key attack: t2 publishes h_evil - h1 so the joint key is
        // h_evil. Without x for that point, no proof can be made.
        let (_, h_evil) = keypair(b"evil");
        assert!(!verify_key_share("p", "t2", &(h_evil - h1), &proof));
    }

    #[test]
    fn encodings_are_canonical() {
        let (_, h) = keypair(b"k");
        let s = encode_point(&h);
        assert_eq!(decode_point(&s, "p").unwrap(), h);
        assert!(decode_point(&"ff".repeat(32), "p").is_err());
        // ℓ itself is not canonical.
        let l = "edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010";
        assert!(decode_scalar(l, "s").is_err());
        assert!(decode_scalar("zz", "s").is_err());
    }
}
