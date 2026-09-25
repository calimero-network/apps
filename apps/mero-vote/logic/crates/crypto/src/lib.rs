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
//! * **Threshold key (t-of-n).** A Pedersen distributed key generation with
//!   Feldman commitments: every trustee deals shares of a random polynomial to
//!   the others, encrypted to their transport keys; a trustee sent a bad share
//!   can prove it with a public complaint. Any `t` trustees can decrypt the
//!   totals, fewer than `t` learn nothing, and no one ever holds the whole key.
//! * **Disjunctive Chaum–Pedersen proofs** (CDS94) that each ciphertext encrypts
//!   0 or 1, and that the ballot's sum lies in `[min, max]`. Without them one
//!   voter could encrypt `1000` and nobody could tell.
//! * **Chaum–Pedersen DLEQ proofs** that each trustee's partial decryption
//!   `Dⱼ = xⱼ·A` uses the key share `hⱼ` everyone can derive from the
//!   commitments, and that a complaint reveals the right secret.
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
pub const PROTOCOL: &[u8] = b"mero-vote/v2/";

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

// ── distributed key generation (Pedersen, with Feldman commitments) ────────
//
// t-of-n: any `t` trustees can decrypt a tally, fewer than `t` learn nothing.
//
// 1. Every trustee publishes a TRANSPORT key `Eⱼ = eⱼ·G` (with a proof of
//    knowledge). It exists only so dealers can send them shares privately.
// 2. Every trustee DEALS: a random polynomial `fᵢ` of degree `t−1`, Feldman
//    commitments `Cᵢₖ = aᵢₖ·G` to its coefficients, a proof of knowledge of
//    `aᵢ₀`, and `fᵢ(j)` encrypted to each trustee `j`'s transport key.
// 3. A trustee whose share does not match the dealer's commitments files a
//    COMPLAINT: it reveals the ECDH secret for that one share with a DLEQ
//    proof, and anyone can then see the dealer cheated. Cheating dealers are
//    left out of the qualified set.
// 4. Election key `H = Σ_{i∈QUAL} Cᵢ₀`. Trustee `j`'s decryption key is
//    `xⱼ = Σ_{i∈QUAL} fᵢ(j)`, and anyone can compute its public half
//    `hⱼ = Σ_{i∈QUAL} Σₖ jᵏ·Cᵢₖ` from the commitments alone — which is what a
//    partial decryption is proven against.
//
// Trustee indices are 1-based positions in the poll's trustee list; index 0
// is where the secret lives, so it is never anyone's.

/// A trustee's transport key and its proof of knowledge. `rng` once.
pub fn make_transport_key(
    poll_id: &str,
    trustee: &str,
    e: &Scalar,
    rng: &mut dyn FnMut() -> Scalar,
) -> (RistrettoPoint, Branch) {
    prove_knowledge(
        "transport",
        &[poll_id.as_bytes(), trustee.as_bytes()],
        e,
        rng,
    )
}

pub fn verify_transport_key(
    poll_id: &str,
    trustee: &str,
    key: &RistrettoPoint,
    proof: &Branch,
) -> bool {
    verify_knowledge(
        "transport",
        &[poll_id.as_bytes(), trustee.as_bytes()],
        key,
        proof,
    )
}

/// One share, hashed-ElGamal encrypted to its recipient's transport key:
/// `R = k·G`, `v = fᵢ(j) + H(R, k·Eⱼ)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EncryptedShare {
    pub r: RistrettoPoint,
    pub v: Scalar,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dealing {
    /// `t` Feldman commitments, constant term first.
    pub commitments: Vec<RistrettoPoint>,
    /// Proof of knowledge of the constant term. Blocks the rogue-key attack:
    /// without it, the last dealer could publish `H_evil − Σ others`.
    pub proof: Branch,
    /// One per trustee, in trustee order (the dealer's own included).
    pub shares: Vec<EncryptedShare>,
}

fn share_mask(
    poll_id: &str,
    dealer: &str,
    index: u32,
    r: &RistrettoPoint,
    secret: &RistrettoPoint,
) -> Scalar {
    let idx = index.to_le_bytes();
    hash_to_scalar(
        "sharemask",
        &[
            poll_id.as_bytes(),
            dealer.as_bytes(),
            &idx,
            &point_bytes(r),
            &point_bytes(secret),
        ],
    )
}

/// `Σₖ xᵏ·Cₖ` — the public image of `f(x)`.
pub fn eval_commitments(commitments: &[RistrettoPoint], x: u32) -> RistrettoPoint {
    let x = Scalar::from(x);
    let mut acc = RistrettoPoint::identity();
    let mut pow = Scalar::ONE;
    for c in commitments {
        acc += pow * c;
        pow *= x;
    }
    acc
}

/// Deal a fresh polynomial of degree `threshold − 1` to `recipients`
/// (transport keys, in trustee order).
///
/// `rng` order: the `threshold` coefficients, constant first; the proof
/// nonce; then one `k` per recipient in order.
pub fn deal(
    poll_id: &str,
    dealer: &str,
    threshold: u32,
    recipients: &[RistrettoPoint],
    rng: &mut dyn FnMut() -> Scalar,
) -> Result<Dealing, CryptoError> {
    if threshold == 0 || threshold as usize > recipients.len() {
        return Err(CryptoError::Shape("threshold must be 1..=trustees"));
    }
    let coeffs: Vec<Scalar> = (0..threshold).map(|_| rng()).collect();
    let (_, proof) = prove_knowledge(
        "keyshare",
        &[poll_id.as_bytes(), dealer.as_bytes()],
        &coeffs[0],
        rng,
    );
    let commitments = coeffs.iter().map(|a| a * G).collect();
    let shares = recipients
        .iter()
        .enumerate()
        .map(|(pos, e)| {
            let index = pos as u32 + 1;
            let x = Scalar::from(index);
            let f = coeffs.iter().rev().fold(Scalar::ZERO, |acc, a| acc * x + a);
            let k = rng();
            let r = k * G;
            EncryptedShare {
                r,
                v: f + share_mask(poll_id, dealer, index, &r, &(k * e)),
            }
        })
        .collect();
    Ok(Dealing {
        commitments,
        proof,
        shares,
    })
}

/// The checks anyone can make on a dealing without any secret: its shape and
/// the proof of knowledge of its constant term.
pub fn verify_dealing(
    poll_id: &str,
    dealer: &str,
    threshold: u32,
    trustees: usize,
    d: &Dealing,
) -> Result<(), CryptoError> {
    if d.commitments.len() != threshold as usize || d.shares.len() != trustees || threshold == 0 {
        return Err(CryptoError::Shape(
            "a dealing has t commitments and one share per trustee",
        ));
    }
    if !verify_knowledge(
        "keyshare",
        &[poll_id.as_bytes(), dealer.as_bytes()],
        &d.commitments[0],
        &d.proof,
    ) {
        return Err(CryptoError::Proof(
            "dealing: no proof of knowledge of the constant term",
        ));
    }
    Ok(())
}

/// Recipient side: decrypt share `index` with the transport secret `e`, and
/// check it against the commitments. `None` means the dealer cheated.
pub fn open_share(
    poll_id: &str,
    dealer: &str,
    index: u32,
    e: &Scalar,
    d: &Dealing,
) -> Option<Scalar> {
    let enc = d.shares.get(index.checked_sub(1)? as usize)?;
    let s = enc.v - share_mask(poll_id, dealer, index, &enc.r, &(e * enc.r));
    (s * G == eval_commitments(&d.commitments, index)).then_some(s)
}

/// A complaint: the recipient reveals `S = eⱼ·R` for one share, proven with a
/// DLEQ against its transport key, so anyone can decrypt that share and see it
/// does not match. `rng` once.
pub fn make_complaint(
    poll_id: &str,
    recipient: &str,
    dealer: &str,
    index: u32,
    e: &Scalar,
    d: &Dealing,
    rng: &mut dyn FnMut() -> Scalar,
) -> Option<(RistrettoPoint, Branch)> {
    let enc = d.shares.get(index.checked_sub(1)? as usize)?;
    let ctx: [&[u8]; 3] = [poll_id.as_bytes(), recipient.as_bytes(), dealer.as_bytes()];
    let (_, secret, proof) = prove_dleq("complaint", &ctx, &enc.r, e, rng);
    Some((secret, proof))
}

/// Whether a complaint proves the dealer cheated the recipient at `index`.
/// `false` for a complaint whose proof fails *or* whose share turns out fine —
/// either way it does not disqualify anyone.
#[allow(clippy::too_many_arguments)]
pub fn complaint_is_valid(
    poll_id: &str,
    recipient: &str,
    dealer: &str,
    index: u32,
    transport: &RistrettoPoint,
    d: &Dealing,
    secret: &RistrettoPoint,
    proof: &Branch,
) -> bool {
    let Some(enc) = index.checked_sub(1).and_then(|i| d.shares.get(i as usize)) else {
        return false;
    };
    let ctx: [&[u8]; 3] = [poll_id.as_bytes(), recipient.as_bytes(), dealer.as_bytes()];
    if !verify_dleq("complaint", &ctx, &enc.r, transport, secret, proof) {
        return false;
    }
    let s = enc.v - share_mask(poll_id, dealer, index, &enc.r, secret);
    s * G != eval_commitments(&d.commitments, index)
}

/// Election key from the qualified dealings.
pub fn joint_key(qualified: &[&Dealing]) -> RistrettoPoint {
    qualified
        .iter()
        .fold(RistrettoPoint::identity(), |acc, d| acc + d.commitments[0])
}

/// Trustee `index`'s public verification key `hⱼ`.
pub fn verification_key(qualified: &[&Dealing], index: u32) -> RistrettoPoint {
    qualified.iter().fold(RistrettoPoint::identity(), |acc, d| {
        acc + eval_commitments(&d.commitments, index)
    })
}

/// Lagrange coefficient at 0 for `index` within `set` (all 1-based, distinct).
pub fn lagrange_at_zero(index: u32, set: &[u32]) -> Scalar {
    let xi = Scalar::from(index);
    let (mut num, mut den) = (Scalar::ONE, Scalar::ONE);
    for &m in set {
        if m == index {
            continue;
        }
        let xm = Scalar::from(m);
        num *= xm;
        den *= xm - xi;
    }
    num * den.invert()
}

/// A trustee's share of the decryption of one option's aggregate, under its
/// combined key `xⱼ`. `rng` is consumed once.
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

/// `vkey` is the trustee's [`verification_key`].
pub fn verify_partial(
    poll_id: &str,
    trustee: &str,
    option: u32,
    vkey: &RistrettoPoint,
    aggregate_a: &RistrettoPoint,
    d: &RistrettoPoint,
    proof: &Branch,
) -> bool {
    let idx = option.to_le_bytes();
    let ctx: [&[u8]; 3] = [poll_id.as_bytes(), trustee.as_bytes(), &idx];
    verify_dleq("partial", &ctx, aggregate_a, vkey, d, proof)
}

/// `B − Σ λⱼ·Dⱼ = m·G` over exactly `threshold` partials `(index, Dⱼ)`; solve
/// for `m ≤ max`. Any `t` honest partials give the same `m`.
pub fn open_count(
    aggregate: &Ciphertext,
    partials: &[(u32, RistrettoPoint)],
    max: u64,
) -> Option<u64> {
    let set: Vec<u32> = partials.iter().map(|(i, _)| *i).collect();
    let mask = partials
        .iter()
        .fold(RistrettoPoint::identity(), |acc, (i, d)| {
            acc + lagrange_at_zero(*i, &set) * d
        });
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

    /// A whole DKG among `n` trustees with threshold `t`: returns each
    /// trustee's transport secret, the dealings, and each combined key `xⱼ`.
    fn ceremony(n: usize, t: u32) -> (Vec<Scalar>, Vec<Dealing>, Vec<Scalar>) {
        let names: Vec<String> = (0..n).map(|i| format!("t{i}")).collect();
        let mut rng = seeded_rng(b"ceremony");
        let es: Vec<Scalar> = (0..n).map(|_| rng()).collect();
        let transports: Vec<_> = es.iter().map(|e| e * G).collect();
        let dealings: Vec<Dealing> = names
            .iter()
            .map(|d| deal("p", d, t, &transports, &mut rng).unwrap())
            .collect();
        for (d, name) in dealings.iter().zip(&names) {
            verify_dealing("p", name, t, n, d).unwrap();
        }
        let xs = (0..n)
            .map(|j| {
                dealings
                    .iter()
                    .zip(&names)
                    .map(|(d, name)| open_share("p", name, j as u32 + 1, &es[j], d).unwrap())
                    .sum()
            })
            .collect();
        (es, dealings, xs)
    }

    #[test]
    fn any_threshold_of_trustees_decrypts_and_fewer_cannot() {
        let (n, t) = (4, 3);
        let (_, dealings, xs) = ceremony(n, t);
        let refs: Vec<&Dealing> = dealings.iter().collect();
        let pk = joint_key(&refs);
        for (j, x) in xs.iter().enumerate() {
            assert_eq!(
                x * G,
                verification_key(&refs, j as u32 + 1),
                "hⱼ is derivable from commitments"
            );
        }

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
            for (j, c) in ballot.choices.iter().enumerate() {
                agg[j] = agg[j].add(&c.ct);
            }
        }

        let partials: Vec<Vec<(u32, RistrettoPoint)>> = agg
            .iter()
            .enumerate()
            .map(|(j, ct)| {
                xs.iter()
                    .enumerate()
                    .map(|(k, x)| {
                        let name = format!("t{k}");
                        let (d, proof) = partial_decrypt("p", &name, j as u32, x, &ct.a, &mut rng);
                        let vk = verification_key(&refs, k as u32 + 1);
                        assert!(verify_partial("p", &name, j as u32, &vk, &ct.a, &d, &proof));
                        assert!(!verify_partial("p", "t9", j as u32, &vk, &ct.a, &d, &proof));
                        (k as u32 + 1, d)
                    })
                    .collect()
            })
            .collect();

        let expected = [3, 0, 1];
        for subset in [[0usize, 1, 2], [1, 2, 3], [0, 2, 3]] {
            for (j, ct) in agg.iter().enumerate() {
                let picked: Vec<_> = subset.iter().map(|&k| partials[j][k]).collect();
                assert_eq!(
                    open_count(ct, &picked, 4),
                    Some(expected[j]),
                    "subset {subset:?}"
                );
            }
        }
        // t−1 partials: the Lagrange combination is over the wrong set and the
        // mask does not cancel.
        let short: Vec<_> = partials[0][..2].to_vec();
        assert_ne!(open_count(&agg[0], &short, 4), Some(3));
    }

    #[test]
    fn one_of_one_is_the_degenerate_case() {
        let (_, dealings, xs) = ceremony(1, 1);
        let refs: Vec<&Dealing> = dealings.iter().collect();
        assert_eq!(joint_key(&refs), xs[0] * G);
    }

    #[test]
    fn a_cheating_dealer_is_caught_by_a_public_complaint() {
        let mut rng = seeded_rng(b"cheat");
        let es: Vec<Scalar> = (0..3).map(|_| rng()).collect();
        let transports: Vec<_> = es.iter().map(|e| e * G).collect();
        let mut bad = deal("p", "mallory", 2, &transports, &mut rng).unwrap();
        bad.shares[1].v += Scalar::ONE; // corrupt trustee #2's share
        verify_dealing("p", "mallory", 2, 3, &bad).unwrap(); // looks fine from outside

        assert!(open_share("p", "mallory", 1, &es[0], &bad).is_some());
        assert!(open_share("p", "mallory", 2, &es[1], &bad).is_none());

        let (secret, proof) =
            make_complaint("p", "t2", "mallory", 2, &es[1], &bad, &mut rng).unwrap();
        assert!(complaint_is_valid(
            "p",
            "t2",
            "mallory",
            2,
            &transports[1],
            &bad,
            &secret,
            &proof
        ));
        // Someone else cannot complain in t2's name (wrong transport key)…
        assert!(!complaint_is_valid(
            "p",
            "t2",
            "mallory",
            2,
            &transports[0],
            &bad,
            &secret,
            &proof
        ));
        // …and a complaint about a GOOD share proves nothing.
        let (s1, p1) = make_complaint("p", "t1", "mallory", 1, &es[0], &bad, &mut rng).unwrap();
        assert!(!complaint_is_valid(
            "p",
            "t1",
            "mallory",
            1,
            &transports[0],
            &bad,
            &s1,
            &p1
        ));
    }

    #[test]
    fn a_dealing_needs_a_proof_of_its_constant_term() {
        let mut rng = seeded_rng(b"rogue");
        let transports = vec![rng() * G, rng() * G];
        let honest = deal("p", "t1", 1, &transports, &mut rng).unwrap();
        // The rogue-key attack: publish H_evil − C_honest as your constant term.
        let (_, h_evil) = keypair(b"evil");
        let mut rogue = deal("p", "t2", 1, &transports, &mut rng).unwrap();
        rogue.commitments[0] = h_evil - honest.commitments[0];
        assert!(verify_dealing("p", "t2", 1, 2, &rogue).is_err());
        assert!(
            verify_dealing("p", "t3", 1, 2, &honest).is_err(),
            "bound to its dealer"
        );
        assert!(deal("p", "t1", 3, &transports, &mut rng).is_err(), "t > n");
    }

    #[test]
    fn transport_keys_are_proven() {
        let mut rng = seeded_rng(b"tk");
        let e = rng();
        let (key, proof) = make_transport_key("p", "t1", &e, &mut rng);
        assert!(verify_transport_key("p", "t1", &key, &proof));
        assert!(!verify_transport_key("p", "t2", &key, &proof));
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
