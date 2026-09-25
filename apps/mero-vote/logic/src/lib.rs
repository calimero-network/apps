//! # mero-vote — private polls with verifiable tallies
//!
//! A context is a group that votes. A poll in it moves through three phases:
//!
//! 1. **Key ceremony.** The creator names the trustees. Each trustee's browser
//!    generates a secret `xᵢ`, publishes `hᵢ = xᵢ·G` with a proof of knowledge,
//!    and keeps `xᵢ`. When every trustee has published, the creator opens the
//!    poll and the election key `H = Σ hᵢ` is frozen.
//! 2. **Voting.** Each voter's *browser* encrypts one 0/1 ciphertext per option
//!    under `H` and proves, in zero knowledge, that each is 0 or 1 and that the
//!    count chosen is within the poll's bounds. The node never sees a
//!    plaintext — which is what makes the ballot secret from a node operator as
//!    well as from the other members. Voting again replaces the ballot.
//! 3. **Closed.** The creator freezes the set of ballots to count. Every
//!    trustee publishes a partial decryption of the per-option *aggregate*
//!    (never of a ballot) with a proof it is honest. With all of them in, the
//!    counts fall out.
//!
//! ## Who can see what
//!
//! | | sees |
//! | --- | --- |
//! | every member | who voted, the encrypted ballots, every proof, the final counts |
//! | a node operator | the same — nothing more, because encryption happens in the browser |
//! | all trustees together | could decrypt individual ballots if they colluded off-protocol |
//! | any one trustee | nothing |
//!
//! ## Why the tally is verifiable
//!
//! Nothing in [`MeroVote::get_result`] trusts a stored conclusion. It reloads
//! the frozen ballots, re-checks every proof, recomputes the aggregate,
//! re-checks every partial decryption and solves for the counts — on the
//! reader's own node, every time. The same inputs come out of
//! [`MeroVote::get_transcript`] for an independent verifier (the frontend ships
//! one in TypeScript), and the transcript digest can be anchored publicly.
//!
//! ## What Calimero provides and what it doesn't
//!
//! * **Authorship** — ballots, key shares and partials live in the author's
//!   [`UserStorage`] slot, and polls in an [`AuthoredMap`] owned by their
//!   creator. Both are signed and checked at MERGE, so a modified node cannot
//!   write into someone else's slot. That is what makes "one account, one
//!   ballot" hold without any signature code in this contract.
//! * **Immutability** — ballot bodies are content-addressed in
//!   [`FrozenStorage`], so a ballot counted at close cannot be altered or
//!   removed afterwards, even by its author.
//! * **Replication** — every member holds the whole ballot box, so every member
//!   can audit it.
//! * **Secrecy from co-members** — NOT provided. Replicated means replicated to
//!   everyone. That is the one property this app adds with cryptography
//!   (`mero-vote-crypto`), and it needs no SNARK: sigma-protocol proofs suffice.

#![allow(clippy::len_without_is_empty)]

use std::collections::{BTreeMap, BTreeSet};

use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::{app, env, AccountId};
use calimero_storage::collections::{
    AuthoredMap, FrozenStorage, LwwRegister, Mergeable, UnorderedMap, UserStorage,
};
use mero_vote_crypto as crypto;
use sha2::{Digest, Sha256};
use thiserror::Error;

/// Upper bound on trustees. Each one costs every verifier a DLEQ check per
/// option, and n-of-n decryption means each one is also a party who can stall
/// the tally by never showing up.
pub const MAX_TRUSTEES: usize = 8;
/// Upper bound on an explicit voter roll.
pub const MAX_VOTERS: usize = 1024;

// ── wire types (what the browser sends and reads) ───────────────────────────

/// One `(c, z)` pair of a proof, as 64-hex scalars.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct WireBranch {
    pub c: String,
    pub z: String,
}

/// One option's ciphertext and its 0-or-1 proof.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct WireChoice {
    pub a: String,
    pub b: String,
    pub proof: Vec<WireBranch>,
}

/// An encrypted ballot exactly as the browser built it.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct WireBallot {
    pub choices: Vec<WireChoice>,
    pub sum_proof: Vec<WireBranch>,
}

/// A trustee's partial decryption of one option's aggregate.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct WirePartial {
    pub d: String,
    pub proof: WireBranch,
}

/// A ciphertext pair.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct WireCiphertext {
    pub a: String,
    pub b: String,
}

// ── stored types ────────────────────────────────────────────────────────────

/// The immutable part of a poll. Stored content-addressed; its SHA-256 IS the
/// poll id, so the options voters saw can never be edited under them.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PollDefinition {
    pub title: String,
    pub description: String,
    pub options: Vec<String>,
    pub min_choices: u32,
    pub max_choices: u32,
    /// Accounts whose key shares make up the election key. All of them must
    /// publish a partial decryption before the result exists.
    pub trustees: Vec<String>,
    /// Accounts allowed to vote. Empty means any member of the context.
    pub voters: Vec<String>,
    pub creator: String,
    /// Milliseconds. Also makes two otherwise identical polls distinct.
    pub created_at: u64,
    /// Informational deadline in milliseconds. Closing is an explicit act of
    /// the creator: node clocks are not a consensus source.
    pub closes_at: Option<u64>,
}

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum Phase {
    KeyCeremony,
    Voting,
    Closed,
}

/// A trustee's published share, as frozen into the election at open.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct KeyShare {
    pub trustee: String,
    pub share: String,
    pub proof: WireBranch,
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Election {
    pub key: String,
    pub shares: Vec<KeyShare>,
    pub opened_at: u64,
}

/// One ballot the closure commits to count.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct CountedBallot {
    pub voter: String,
    /// The protocol digest — the voter's receipt.
    pub digest: String,
    /// Where the body lives in `ballot_bodies`.
    pub frozen: String,
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Closure {
    pub counted: Vec<CountedBallot>,
    pub closed_at: u64,
}

/// A pointer from the context to a public record of the transcript digest —
/// a transaction hash, a signed tag, a URL. The anchoring itself happens
/// outside Calimero; this records where, and which digest.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct Anchor {
    pub digest: String,
    pub network: String,
    pub reference: String,
    pub anchored_at: u64,
}

/// The mutable part of a poll, owned by its creator.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PollState {
    pub phase: Phase,
    pub election: Option<Election>,
    pub closure: Option<Closure>,
    pub anchor: Option<Anchor>,
}

/// A ballot body, content-addressed.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, calimero_sdk::abi::AbiType)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct StoredBallot {
    pub poll_id: String,
    pub voter: String,
    pub ballot: WireBallot,
}

/// What a voter's slot holds for a poll: which body is theirs.
#[derive(
    Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct BallotPointer {
    pub digest: String,
    pub frozen: String,
    pub cast_at: u64,
}

/// A trustee's partial decryptions for every option of one poll.
#[derive(
    Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct StoredPartials {
    pub options: Vec<WirePartial>,
}

/// Everything one account authors. Lives in [`UserStorage`], so only that
/// account can write it — enforced at merge, not just by this contract.
#[derive(
    Debug, BorshSerialize, BorshDeserialize, Default, Mergeable, calimero_sdk::abi::AbiType,
)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MemberSlot {
    name: LwwRegister<String>,
    ballots: UnorderedMap<String, LwwRegister<BallotPointer>>,
    shares: UnorderedMap<String, LwwRegister<KeyShare>>,
    partials: UnorderedMap<String, LwwRegister<StoredPartials>>,
}

// ── views ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Member {
    pub account: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PollSummary {
    pub poll_id: String,
    pub title: String,
    pub creator: String,
    pub phase: Phase,
    pub created_at: u64,
    pub ballots: u32,
}

#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TrusteeStatus {
    pub account: String,
    pub share_published: bool,
    pub partial_published: bool,
}

/// Who has voted — never what.
#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Turnout {
    pub voter: String,
    pub digest: String,
    pub cast_at: u64,
}

#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct PollView {
    pub poll_id: String,
    pub definition: PollDefinition,
    pub state: PollState,
    pub trustees: Vec<TrusteeStatus>,
    pub turnout: Vec<Turnout>,
    /// The caller's own receipt, if they have voted.
    pub my_digest: Option<String>,
    pub can_vote: bool,
}

/// What a trustee's browser needs to compute its partial decryptions.
#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TallyInputs {
    pub aggregate: Vec<WireCiphertext>,
    pub counted: u32,
}

/// One named check of the audit and whether it held.
#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Check {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

/// Result of re-verifying a poll from its raw inputs.
#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AuditReport {
    pub poll_id: String,
    pub phase: Phase,
    /// Every check held. A poll is only as good as its worst check.
    pub verified: bool,
    pub checks: Vec<Check>,
    /// Per-option counts, once every trustee has published and all checks hold.
    pub counts: Option<Vec<u64>>,
    pub counted_ballots: u32,
    /// Digest of the canonical transcript. What gets anchored.
    pub transcript_digest: Option<String>,
    pub anchor: Option<Anchor>,
}

#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TranscriptBallot {
    pub voter: String,
    pub digest: String,
    pub ballot: WireBallot,
    /// Whether the voter's own signed slot still points at this ballot.
    pub endorsed: bool,
}

#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct TranscriptPartial {
    pub trustee: String,
    pub options: Vec<WirePartial>,
}

/// Every input of the tally, for verification somewhere other than this node.
#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Transcript {
    pub protocol: String,
    pub poll_id: String,
    pub definition: PollDefinition,
    pub state: PollState,
    pub ballots: Vec<TranscriptBallot>,
    pub partials: Vec<TranscriptPartial>,
    pub report: AuditReport,
}

#[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
#[serde(crate = "calimero_sdk::serde")]
pub struct Identity {
    pub account: String,
}

// ── events & errors ─────────────────────────────────────────────────────────

#[app::event]
pub enum Event {
    PollCreated { poll_id: String },
    KeySharePublished { poll_id: String, trustee: String },
    VotingOpened { poll_id: String },
    BallotCast { poll_id: String, voter: String },
    PollClosed { poll_id: String, counted: u32 },
    PartialPublished { poll_id: String, trustee: String },
    Anchored { poll_id: String },
    MemberNamed { account: String },
}

#[derive(Debug, Error, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(tag = "kind", content = "data")]
pub enum VoteError {
    #[error("poll not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("not allowed: {0}")]
    Forbidden(String),
    #[error("wrong phase: {0}")]
    Phase(String),
    #[error("crypto: {0}")]
    Crypto(String),
}

impl From<crypto::CryptoError> for VoteError {
    fn from(e: crypto::CryptoError) -> Self {
        VoteError::Crypto(e.to_string())
    }
}

// ── state ───────────────────────────────────────────────────────────────────

#[app::state(emits = Event)]
pub struct MeroVote {
    /// Immutable definitions; the key is the poll id.
    definitions: FrozenStorage<PollDefinition>,
    /// Lifecycle, owned by the creator (checked at merge).
    polls: AuthoredMap<String, LwwRegister<PollState>>,
    /// Ballot bodies, content-addressed and immutable.
    ballot_bodies: FrozenStorage<StoredBallot>,
    /// One signed slot per account.
    slots: UserStorage<MemberSlot>,
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn me() -> String {
    AccountId::from(env::account_id()).to_string()
}

fn now_ms() -> u64 {
    env::time_now() / 1_000_000
}

fn is_hex32(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn parse_hash(s: &str) -> Result<[u8; 32], VoteError> {
    hex::decode(s)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| VoteError::Invalid(format!("not a 64-hex id: {s}")))
}

fn branch(w: &WireBranch, what: &'static str) -> Result<crypto::Branch, crypto::CryptoError> {
    Ok(crypto::Branch {
        c: crypto::decode_scalar(&w.c, what)?,
        z: crypto::decode_scalar(&w.z, what)?,
    })
}

fn branches(
    ws: &[WireBranch],
    what: &'static str,
) -> Result<Vec<crypto::Branch>, crypto::CryptoError> {
    ws.iter().map(|w| branch(w, what)).collect()
}

/// Wire → crypto, rejecting any non-canonical encoding along the way.
pub fn decode_ballot(w: &WireBallot) -> Result<crypto::Ballot, crypto::CryptoError> {
    let choices = w
        .choices
        .iter()
        .map(|c| {
            Ok(crypto::EncryptedChoice {
                ct: crypto::Ciphertext {
                    a: crypto::decode_point(&c.a, "ciphertext")?,
                    b: crypto::decode_point(&c.b, "ciphertext")?,
                },
                proof: branches(&c.proof, "choice proof")?,
            })
        })
        .collect::<Result<Vec<_>, crypto::CryptoError>>()?;
    Ok(crypto::Ballot {
        choices,
        sum_proof: branches(&w.sum_proof, "sum proof")?,
    })
}

fn rules(def: &PollDefinition) -> crypto::Rules {
    crypto::Rules {
        options: def.options.len(),
        min: def.min_choices,
        max: def.max_choices,
    }
}

fn eligible(def: &PollDefinition, account: &str) -> bool {
    def.voters.is_empty() || def.voters.iter().any(|v| v == account)
}

/// The canonical transcript text. One line per fact, free text hex-encoded so
/// a newline in a title cannot forge a line. Its SHA-256 is the digest a poll
/// is anchored by; the TypeScript verifier rebuilds it byte for byte.
pub fn transcript_text(
    poll_id: &str,
    def: &PollDefinition,
    election: &Election,
    counted: &[CountedBallot],
    partials: &[(String, Vec<WirePartial>)],
    counts: &[u64],
) -> String {
    let mut out = String::from("mero-vote/v1/transcript\n");
    out.push_str(&format!("poll {poll_id}\n"));
    out.push_str(&format!("title {}\n", hex::encode(def.title.as_bytes())));
    for (i, o) in def.options.iter().enumerate() {
        out.push_str(&format!("option {i} {}\n", hex::encode(o.as_bytes())));
    }
    out.push_str(&format!(
        "rules {} {} {}\n",
        def.options.len(),
        def.min_choices,
        def.max_choices
    ));
    out.push_str(&format!("key {}\n", election.key));
    for s in &election.shares {
        out.push_str(&format!("share {} {}\n", s.trustee, s.share));
    }
    for b in counted {
        out.push_str(&format!("ballot {} {}\n", b.voter, b.digest));
    }
    for (trustee, ps) in partials {
        for (j, p) in ps.iter().enumerate() {
            out.push_str(&format!("partial {trustee} {j} {}\n", p.d));
        }
    }
    for (j, n) in counts.iter().enumerate() {
        out.push_str(&format!("count {j} {n}\n"));
    }
    out
}

pub fn transcript_digest(text: &str) -> String {
    hex::encode(Sha256::digest(text.as_bytes()))
}

struct Checks {
    checks: Vec<Check>,
}

impl Checks {
    fn push(&mut self, name: &str, ok: bool, detail: impl Into<String>) -> bool {
        self.checks.push(Check {
            name: name.to_owned(),
            ok,
            detail: detail.into(),
        });
        ok
    }
    fn all_ok(&self) -> bool {
        self.checks.iter().all(|c| c.ok)
    }
}

// ── logic ───────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroVote {
    #[app::init]
    pub fn init() -> MeroVote {
        MeroVote {
            definitions: FrozenStorage::new(),
            polls: AuthoredMap::new(),
            ballot_bodies: FrozenStorage::new(),
            slots: UserStorage::new(),
        }
    }

    // ── identity & roster ──────────────────────────────────────────────────

    /// The caller's ACCOUNT — the id trustees and voter rolls are written in.
    pub fn whoami(&self) -> Identity {
        Identity { account: me() }
    }

    /// Put a display name in your slot. Doubles as "I'm here": the roster is
    /// how a creator finds the accounts to name as trustees or voters.
    pub fn set_name(&mut self, name: String) -> app::Result<()> {
        let name = name.trim().to_owned();
        if name.is_empty() || name.chars().count() > 64 {
            app::bail!(VoteError::Invalid("a name is 1..=64 characters".into()));
        }
        let mut slot = self.slots.get()?.unwrap_or_default();
        slot.name.set(name);
        self.slots.insert(slot)?;
        app::emit!(Event::MemberNamed { account: me() });
        Ok(())
    }

    pub fn roster(&self) -> app::Result<Vec<Member>> {
        let mut out: Vec<Member> = self
            .slots
            .entries()?
            .map(|(account, slot)| Member {
                account: account.to_string(),
                name: slot.name.get().clone(),
            })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name).then(a.account.cmp(&b.account)));
        Ok(out)
    }

    // ── polls ──────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn create_poll(
        &mut self,
        title: String,
        description: String,
        options: Vec<String>,
        min_choices: u32,
        max_choices: u32,
        trustees: Vec<String>,
        voters: Vec<String>,
        closes_at: Option<u64>,
    ) -> app::Result<String> {
        let title = title.trim().to_owned();
        if title.is_empty() || title.chars().count() > 200 {
            app::bail!(VoteError::Invalid("a title is 1..=200 characters".into()));
        }
        if description.chars().count() > 4000 {
            app::bail!(VoteError::Invalid(
                "description is at most 4000 characters".into()
            ));
        }
        let options: Vec<String> = options.into_iter().map(|o| o.trim().to_owned()).collect();
        if options
            .iter()
            .any(|o| o.is_empty() || o.chars().count() > 200)
        {
            app::bail!(VoteError::Invalid(
                "every option is 1..=200 characters".into()
            ));
        }
        if options.iter().collect::<BTreeSet<_>>().len() != options.len() {
            app::bail!(VoteError::Invalid("options must be distinct".into()));
        }
        let r = crypto::Rules {
            options: options.len(),
            min: min_choices,
            max: max_choices,
        };
        r.check().map_err(VoteError::from)?;

        let dedup = |list: Vec<String>, what: &str, max: usize| -> Result<Vec<String>, VoteError> {
            let mut seen = BTreeSet::new();
            let mut out = Vec::new();
            for a in list {
                let a = a.trim().to_ascii_lowercase();
                if !is_hex32(&a) {
                    return Err(VoteError::Invalid(format!(
                        "{what} must be 64-hex account ids"
                    )));
                }
                if seen.insert(a.clone()) {
                    out.push(a);
                }
            }
            if out.len() > max {
                return Err(VoteError::Invalid(format!("at most {max} {what}")));
            }
            Ok(out)
        };
        let trustees = dedup(trustees, "trustees", MAX_TRUSTEES)?;
        if trustees.is_empty() {
            app::bail!(VoteError::Invalid(
                "a poll needs at least one trustee".into()
            ));
        }
        let voters = dedup(voters, "voters", MAX_VOTERS)?;

        let def = PollDefinition {
            title,
            description,
            options,
            min_choices,
            max_choices,
            trustees,
            voters,
            creator: me(),
            created_at: now_ms(),
            closes_at,
        };
        let poll_id = hex::encode(self.definitions.insert(def)?);
        self.polls.insert(
            poll_id.clone(),
            LwwRegister::new(PollState {
                phase: Phase::KeyCeremony,
                election: None,
                closure: None,
                anchor: None,
            }),
        )?;
        app::emit!(Event::PollCreated {
            poll_id: poll_id.clone()
        });
        Ok(poll_id)
    }

    pub fn list_polls(&self) -> app::Result<Vec<PollSummary>> {
        let counts = self.ballot_counts()?;
        let mut out = Vec::new();
        for (poll_id, state) in self.polls.entries()? {
            let Some(def) = self.definition(&poll_id)? else {
                continue;
            };
            let state = state.get().clone();
            let ballots = match &state.closure {
                Some(c) => c.counted.len() as u32,
                None => counts.get(&poll_id).copied().unwrap_or(0),
            };
            out.push(PollSummary {
                poll_id,
                title: def.title,
                creator: def.creator,
                phase: state.phase,
                created_at: def.created_at,
                ballots,
            });
        }
        out.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then(a.poll_id.cmp(&b.poll_id))
        });
        Ok(out)
    }

    pub fn get_poll(&self, poll_id: String) -> app::Result<PollView> {
        let (def, state) = self.load(&poll_id)?;
        let mut trustees = Vec::new();
        for t in &def.trustees {
            let slot = self.slot_of(t)?;
            trustees.push(TrusteeStatus {
                account: t.clone(),
                share_published: match &slot {
                    Some(s) => s.shares.contains(&poll_id)?,
                    None => false,
                },
                partial_published: match &slot {
                    Some(s) => s.partials.contains(&poll_id)?,
                    None => false,
                },
            });
        }
        let turnout = self
            .current_ballots(&poll_id)?
            .into_iter()
            .map(|(voter, p)| Turnout {
                voter,
                digest: p.digest,
                cast_at: p.cast_at,
            })
            .collect();
        let my_digest = match self.slots.get()? {
            Some(s) => s.ballots.get(&poll_id)?.map(|p| p.get().digest.clone()),
            None => None,
        };
        let can_vote = state.phase == Phase::Voting && eligible(&def, &me());
        Ok(PollView {
            poll_id,
            definition: def,
            state,
            trustees,
            turnout,
            my_digest,
            can_vote,
        })
    }

    // ── key ceremony ───────────────────────────────────────────────────────

    /// A trustee publishes `h = x·G` and a Schnorr proof of knowledge of `x`.
    /// The proof is what prevents a rogue-key attack: without it, the last
    /// trustee could publish `h_evil − Σ others` and decrypt everything alone.
    pub fn publish_key_share(
        &mut self,
        poll_id: String,
        share: String,
        proof: WireBranch,
    ) -> app::Result<()> {
        let (def, state) = self.load(&poll_id)?;
        let caller = me();
        if !def.trustees.contains(&caller) {
            app::bail!(VoteError::Forbidden(
                "only a named trustee can publish a key share".into()
            ));
        }
        if state.phase != Phase::KeyCeremony {
            app::bail!(VoteError::Phase(
                "the election key is already frozen".into()
            ));
        }
        let h = crypto::decode_point(&share, "share").map_err(VoteError::from)?;
        let p = branch(&proof, "share proof").map_err(VoteError::from)?;
        if !crypto::verify_key_share(&poll_id, &caller, &h, &p) {
            app::bail!(VoteError::Crypto(
                "key share proof of knowledge does not verify".into()
            ));
        }
        let mut slot = self.slots.get()?.unwrap_or_default();
        slot.shares.insert(
            poll_id.clone(),
            LwwRegister::new(KeyShare {
                trustee: caller.clone(),
                share,
                proof,
            }),
        )?;
        self.slots.insert(slot)?;
        app::emit!(Event::KeySharePublished {
            poll_id,
            trustee: caller
        });
        Ok(())
    }

    /// Freeze the election key from every trustee's share and open voting.
    pub fn open_voting(&mut self, poll_id: String) -> app::Result<String> {
        let (def, mut state) = self.load(&poll_id)?;
        self.require_creator(&def)?;
        if state.phase != Phase::KeyCeremony {
            app::bail!(VoteError::Phase("voting is already open".into()));
        }
        let mut shares = Vec::new();
        let mut points = Vec::new();
        for t in &def.trustees {
            let Some(share) = self.share_of(t, &poll_id)? else {
                app::bail!(VoteError::Phase(format!(
                    "trustee {t} has not published a key share"
                )));
            };
            let h = crypto::decode_point(&share.share, "share").map_err(VoteError::from)?;
            let p = branch(&share.proof, "share proof").map_err(VoteError::from)?;
            if share.trustee != *t || !crypto::verify_key_share(&poll_id, t, &h, &p) {
                app::bail!(VoteError::Crypto(format!(
                    "trustee {t}'s key share does not verify"
                )));
            }
            points.push(h);
            shares.push(share);
        }
        let key = crypto::encode_point(&crypto::combine_keys(&points));
        state.phase = Phase::Voting;
        state.election = Some(Election {
            key: key.clone(),
            shares,
            opened_at: now_ms(),
        });
        self.polls.update(&poll_id, LwwRegister::new(state))?;
        app::emit!(Event::VotingOpened { poll_id });
        Ok(key)
    }

    // ── voting ─────────────────────────────────────────────────────────────

    /// Submit a ballot the browser encrypted. Verified here before it is
    /// stored — and again by every reader, on every audit.
    pub fn cast_ballot(&mut self, poll_id: String, ballot: WireBallot) -> app::Result<String> {
        let (def, state) = self.load(&poll_id)?;
        if state.phase != Phase::Voting {
            app::bail!(VoteError::Phase(
                "this poll is not accepting ballots".into()
            ));
        }
        let voter = me();
        if !eligible(&def, &voter) {
            app::bail!(VoteError::Forbidden(
                "you are not on this poll's voter roll".into()
            ));
        }
        let election = state.election.as_ref().expect("voting implies an election");
        let pk = crypto::decode_point(&election.key, "election key").map_err(VoteError::from)?;
        let decoded = decode_ballot(&ballot).map_err(VoteError::from)?;
        crypto::verify_ballot(&pk, &poll_id, &voter, &rules(&def), &decoded)
            .map_err(VoteError::from)?;
        let digest = hex::encode(crypto::ballot_digest(&poll_id, &voter, &decoded));

        let frozen = hex::encode(self.ballot_bodies.insert(StoredBallot {
            poll_id: poll_id.clone(),
            voter: voter.clone(),
            ballot,
        })?);
        let mut slot = self.slots.get()?.unwrap_or_default();
        slot.ballots.insert(
            poll_id.clone(),
            LwwRegister::new(BallotPointer {
                digest: digest.clone(),
                frozen,
                cast_at: now_ms(),
            }),
        )?;
        self.slots.insert(slot)?;
        app::emit!(Event::BallotCast { poll_id, voter });
        Ok(digest)
    }

    /// Freeze the ballots to count: every eligible voter's current ballot, as
    /// this node sees it now. A ballot still in flight from another node is
    /// not in the set — which the voter can see, because their receipt is
    /// either in `closure.counted` or it is not.
    pub fn close_poll(&mut self, poll_id: String) -> app::Result<u32> {
        let (def, mut state) = self.load(&poll_id)?;
        self.require_creator(&def)?;
        if state.phase != Phase::Voting {
            app::bail!(VoteError::Phase("only an open poll can be closed".into()));
        }
        let election = state.election.as_ref().expect("voting implies an election");
        let pk = crypto::decode_point(&election.key, "election key").map_err(VoteError::from)?;
        let r = rules(&def);

        let mut counted = Vec::new();
        for (voter, pointer) in self.current_ballots(&poll_id)? {
            if !eligible(&def, &voter) {
                continue;
            }
            // Re-verify rather than trust the author's node: a ballot that got
            // here through a modified node is left out, not counted.
            let Some(body) = self.ballot_bodies.get(&parse_hash(&pointer.frozen)?)? else {
                continue;
            };
            if body.voter != voter || body.poll_id != poll_id {
                continue;
            }
            let Ok(decoded) = decode_ballot(&body.ballot) else {
                continue;
            };
            if crypto::verify_ballot(&pk, &poll_id, &voter, &r, &decoded).is_err() {
                continue;
            }
            if hex::encode(crypto::ballot_digest(&poll_id, &voter, &decoded)) != pointer.digest {
                continue;
            }
            counted.push(CountedBallot {
                voter,
                digest: pointer.digest,
                frozen: pointer.frozen,
            });
        }
        let n = counted.len() as u32;
        state.phase = Phase::Closed;
        state.closure = Some(Closure {
            counted,
            closed_at: now_ms(),
        });
        self.polls.update(&poll_id, LwwRegister::new(state))?;
        app::emit!(Event::PollClosed {
            poll_id,
            counted: n
        });
        Ok(n)
    }

    // ── tally ──────────────────────────────────────────────────────────────

    /// The per-option aggregates a trustee decrypts. Recomputed from the
    /// frozen ballots every call; nothing stored is trusted.
    pub fn tally_inputs(&self, poll_id: String) -> app::Result<TallyInputs> {
        let (def, state) = self.load(&poll_id)?;
        let Some(closure) = &state.closure else {
            app::bail!(VoteError::Phase("the poll is not closed yet".into()));
        };
        let aggregate = self.aggregate(&def, closure)?;
        Ok(TallyInputs {
            aggregate: aggregate
                .iter()
                .map(|c| WireCiphertext {
                    a: crypto::encode_point(&c.a),
                    b: crypto::encode_point(&c.b),
                })
                .collect(),
            counted: closure.counted.len() as u32,
        })
    }

    /// A trustee publishes `Dⱼ = x·Aⱼ` for every option's aggregate `Aⱼ`, each
    /// with a DLEQ proof tying it to their frozen share.
    pub fn publish_partial(
        &mut self,
        poll_id: String,
        partials: Vec<WirePartial>,
    ) -> app::Result<()> {
        let (def, state) = self.load(&poll_id)?;
        let caller = me();
        let Some(closure) = &state.closure else {
            app::bail!(VoteError::Phase("the poll is not closed yet".into()));
        };
        let election = state.election.as_ref().expect("closed implies an election");
        let Some(share) = election.shares.iter().find(|s| s.trustee == caller) else {
            app::bail!(VoteError::Forbidden(
                "only a trustee can publish a partial decryption".into()
            ));
        };
        if partials.len() != def.options.len() {
            app::bail!(VoteError::Invalid(
                "one partial decryption per option".into()
            ));
        }
        let h = crypto::decode_point(&share.share, "share").map_err(VoteError::from)?;
        let aggregate = self.aggregate(&def, closure)?;
        for (j, (p, ct)) in partials.iter().zip(&aggregate).enumerate() {
            let d = crypto::decode_point(&p.d, "partial").map_err(VoteError::from)?;
            let proof = branch(&p.proof, "partial proof").map_err(VoteError::from)?;
            if !crypto::verify_partial(&poll_id, &caller, j as u32, &h, &ct.a, &d, &proof) {
                app::bail!(VoteError::Crypto(format!(
                    "partial decryption for option {j} does not verify"
                )));
            }
        }
        let mut slot = self.slots.get()?.unwrap_or_default();
        slot.partials.insert(
            poll_id.clone(),
            LwwRegister::new(StoredPartials { options: partials }),
        )?;
        self.slots.insert(slot)?;
        app::emit!(Event::PartialPublished {
            poll_id,
            trustee: caller
        });
        Ok(())
    }

    /// Re-verify everything and, if every trustee has published, the counts.
    pub fn get_result(&self, poll_id: String) -> app::Result<AuditReport> {
        Ok(self.audit(&poll_id)?.0)
    }

    /// Every input of the tally plus this node's audit of it.
    pub fn get_transcript(&self, poll_id: String) -> app::Result<Transcript> {
        let (report, ballots, partials) = self.audit(&poll_id)?;
        let (def, state) = self.load(&poll_id)?;
        Ok(Transcript {
            protocol: String::from_utf8_lossy(crypto::PROTOCOL).into_owned(),
            poll_id,
            definition: def,
            state,
            ballots,
            partials,
            report,
        })
    }

    /// Record where the transcript digest was published. Only for a fully
    /// verified result, and only with the digest this node computes — so an
    /// anchor can never point at a tally the context does not reproduce.
    pub fn anchor_result(
        &mut self,
        poll_id: String,
        network: String,
        reference: String,
    ) -> app::Result<String> {
        let (def, mut state) = self.load(&poll_id)?;
        self.require_creator(&def)?;
        let network = network.trim().to_owned();
        let reference = reference.trim().to_owned();
        if network.is_empty() || network.len() > 64 || reference.is_empty() || reference.len() > 512
        {
            app::bail!(VoteError::Invalid(
                "network is 1..=64 and reference 1..=512 characters".into()
            ));
        }
        let report = self.audit(&poll_id)?.0;
        let (true, Some(digest)) = (
            report.verified && report.counts.is_some(),
            report.transcript_digest,
        ) else {
            app::bail!(VoteError::Phase(
                "only a complete, verified result can be anchored".into()
            ));
        };
        state.anchor = Some(Anchor {
            digest: digest.clone(),
            network,
            reference,
            anchored_at: now_ms(),
        });
        self.polls.update(&poll_id, LwwRegister::new(state))?;
        app::emit!(Event::Anchored { poll_id });
        Ok(digest)
    }
}

// ── private ─────────────────────────────────────────────────────────────────

impl MeroVote {
    fn definition(&self, poll_id: &str) -> Result<Option<PollDefinition>, VoteError> {
        let Ok(hash) = parse_hash(poll_id) else {
            return Ok(None);
        };
        self.definitions
            .get(&hash)
            .map_err(|e| VoteError::Invalid(e.to_string()))
    }

    fn load(&self, poll_id: &str) -> app::Result<(PollDefinition, PollState)> {
        let def = self.definition(poll_id)?;
        let state = self.polls.get(&poll_id.to_owned())?;
        match (def, state) {
            (Some(d), Some(s)) => Ok((d, s.get().clone())),
            _ => app::bail!(VoteError::NotFound(poll_id.to_owned())),
        }
    }

    fn require_creator(&self, def: &PollDefinition) -> app::Result<()> {
        if def.creator != me() {
            app::bail!(VoteError::Forbidden(
                "only the poll's creator can do this".into()
            ));
        }
        Ok(())
    }

    fn slot_of(&self, account: &str) -> app::Result<Option<MemberSlot>> {
        let Ok(bytes) = parse_hash(account) else {
            return Ok(None);
        };
        Ok(self.slots.get_for_user(&AccountId::from(bytes))?)
    }

    fn share_of(&self, account: &str, poll_id: &str) -> app::Result<Option<KeyShare>> {
        match self.slot_of(account)? {
            Some(slot) => Ok(slot
                .shares
                .get(&poll_id.to_owned())?
                .map(|s| s.get().clone())),
            None => Ok(None),
        }
    }

    fn partials_of(&self, account: &str, poll_id: &str) -> app::Result<Option<StoredPartials>> {
        match self.slot_of(account)? {
            Some(slot) => Ok(slot
                .partials
                .get(&poll_id.to_owned())?
                .map(|s| s.get().clone())),
            None => Ok(None),
        }
    }

    /// Every account's current ballot pointer for a poll, by account.
    fn current_ballots(&self, poll_id: &str) -> app::Result<BTreeMap<String, BallotPointer>> {
        let mut out = BTreeMap::new();
        for (account, slot) in self.slots.entries()? {
            if let Some(p) = slot.ballots.get(&poll_id.to_owned())? {
                out.insert(account.to_string(), p.get().clone());
            }
        }
        Ok(out)
    }

    fn ballot_counts(&self) -> app::Result<BTreeMap<String, u32>> {
        let mut out = BTreeMap::new();
        for (_, slot) in self.slots.entries()? {
            for (poll_id, _) in slot.ballots.entries()? {
                *out.entry(poll_id).or_insert(0) += 1;
            }
        }
        Ok(out)
    }

    fn body(&self, counted: &CountedBallot) -> app::Result<Option<StoredBallot>> {
        Ok(self.ballot_bodies.get(&parse_hash(&counted.frozen)?)?)
    }

    fn aggregate(
        &self,
        def: &PollDefinition,
        closure: &Closure,
    ) -> app::Result<Vec<crypto::Ciphertext>> {
        let mut agg = vec![crypto::Ciphertext::zero(); def.options.len()];
        for c in &closure.counted {
            let Some(body) = self.body(c)? else {
                app::bail!(VoteError::Invalid(format!(
                    "counted ballot of {} is missing",
                    c.voter
                )));
            };
            let decoded = decode_ballot(&body.ballot).map_err(VoteError::from)?;
            if decoded.choices.len() != agg.len() {
                app::bail!(VoteError::Invalid(format!(
                    "counted ballot of {} is malformed",
                    c.voter
                )));
            }
            for (slot, choice) in agg.iter_mut().zip(&decoded.choices) {
                *slot = slot.add(&choice.ct);
            }
        }
        Ok(agg)
    }

    /// The whole audit. Returns the report plus the transcript material it
    /// verified, so `get_transcript` hands out exactly what was checked.
    #[allow(clippy::type_complexity)]
    fn audit(
        &self,
        poll_id: &str,
    ) -> app::Result<(AuditReport, Vec<TranscriptBallot>, Vec<TranscriptPartial>)> {
        let (def, state) = self.load(poll_id)?;
        let mut c = Checks { checks: Vec::new() };
        let mut ballots_out = Vec::new();
        let mut partials_out = Vec::new();
        let mut counts = None;
        let mut digest = None;

        let finish = |c: Checks, counts, digest, counted: u32, ballots, partials| {
            let verified = c.all_ok();
            Ok((
                AuditReport {
                    poll_id: poll_id.to_owned(),
                    phase: state.phase,
                    verified,
                    checks: c.checks,
                    counts: if verified { counts } else { None },
                    counted_ballots: counted,
                    transcript_digest: if verified { digest } else { None },
                    anchor: state.anchor.clone(),
                },
                ballots,
                partials,
            ))
        };

        c.push(
            "definition",
            rules(&def).check().is_ok() && !def.trustees.is_empty(),
            format!(
                "{} options, choose {}..={}",
                def.options.len(),
                def.min_choices,
                def.max_choices
            ),
        );

        // 1. The election key is the sum of trustee shares, each proven.
        let Some(election) = &state.election else {
            c.push("election key", true, "key ceremony in progress");
            return finish(c, None, None, 0, ballots_out, partials_out);
        };
        let mut share_points = BTreeMap::new();
        let mut shares_ok = election.shares.len() == def.trustees.len();
        for t in &def.trustees {
            let Some(s) = election.shares.iter().find(|s| &s.trustee == t) else {
                shares_ok = false;
                continue;
            };
            let proven = crypto::decode_point(&s.share, "share")
                .ok()
                .zip(branch(&s.proof, "share proof").ok())
                .filter(|(h, p)| crypto::verify_key_share(poll_id, t, h, p));
            match proven {
                Some((h, _)) => {
                    share_points.insert(t.clone(), h);
                }
                None => shares_ok = false,
            }
            // The trustee's own signed slot must still hold the same share —
            // that is what shows the trustee, not the creator, made it.
            if self.share_of(t, poll_id)?.as_ref().map(|x| &x.share) != Some(&s.share) {
                shares_ok = false;
            }
        }
        c.push(
            "trustee shares",
            shares_ok,
            format!(
                "{} of {} shares proven and endorsed",
                share_points.len(),
                def.trustees.len()
            ),
        );
        let points: Vec<_> = share_points.values().copied().collect();
        let key_ok =
            shares_ok && crypto::encode_point(&crypto::combine_keys(&points)) == election.key;
        c.push("election key", key_ok, "key = sum of trustee shares");
        let Ok(pk) = crypto::decode_point(&election.key, "election key") else {
            return finish(c, None, None, 0, ballots_out, partials_out);
        };

        // 2. Every counted ballot: present, unaltered, well-formed, proven,
        //    eligible, and endorsed by its voter's signed slot.
        let Some(closure) = &state.closure else {
            c.push("ballots", true, "voting in progress");
            return finish(c, None, None, 0, ballots_out, partials_out);
        };
        let r = rules(&def);
        let mut agg = vec![crypto::Ciphertext::zero(); def.options.len()];
        let mut valid = 0usize;
        let mut unendorsed = Vec::new();
        let mut voters_seen = BTreeSet::new();
        let current = self.current_ballots(poll_id)?;
        for cb in &closure.counted {
            let body = self.body(cb)?;
            let ok = body.as_ref().is_some_and(|b| {
                b.voter == cb.voter
                    && b.poll_id == poll_id
                    && eligible(&def, &cb.voter)
                    && voters_seen.insert(cb.voter.clone())
                    && decode_ballot(&b.ballot).is_ok_and(|d| {
                        crypto::verify_ballot(&pk, poll_id, &cb.voter, &r, &d).is_ok()
                            && hex::encode(crypto::ballot_digest(poll_id, &cb.voter, &d))
                                == cb.digest
                            && {
                                for (slot, ch) in agg.iter_mut().zip(&d.choices) {
                                    *slot = slot.add(&ch.ct);
                                }
                                true
                            }
                    })
            });
            if ok {
                valid += 1;
            }
            let endorsed = current
                .get(&cb.voter)
                .is_some_and(|p| p.digest == cb.digest);
            if !endorsed {
                unendorsed.push(cb.voter.clone());
            }
            if let Some(b) = body {
                ballots_out.push(TranscriptBallot {
                    voter: cb.voter.clone(),
                    digest: cb.digest.clone(),
                    ballot: b.ballot,
                    endorsed,
                });
            }
        }
        let n = closure.counted.len();
        c.push(
            "ballot proofs",
            valid == n,
            format!(
                "{valid} of {n} counted ballots verified (0-or-1 per option, count within bounds)"
            ),
        );
        c.push(
            "voter endorsement",
            unendorsed.is_empty(),
            if unendorsed.is_empty() {
                format!("all {n} counted ballots match their voters' signed slots")
            } else {
                format!(
                    "{} counted ballots no longer match their voter's slot: {}",
                    unendorsed.len(),
                    unendorsed.join(", ")
                )
            },
        );

        // 3. Partial decryptions, and the counts.
        let mut partial_rows = Vec::new();
        let mut masks = vec![Vec::new(); def.options.len()];
        let mut partials_ok = true;
        let mut published = 0usize;
        for t in &def.trustees {
            let Some(ps) = self.partials_of(t, poll_id)? else {
                continue;
            };
            published += 1;
            let Some(h) = share_points.get(t) else {
                partials_ok = false;
                continue;
            };
            let ok = ps.options.len() == agg.len()
                && ps.options.iter().zip(&agg).enumerate().all(|(j, (p, ct))| {
                    match (
                        crypto::decode_point(&p.d, "partial"),
                        branch(&p.proof, "partial proof"),
                    ) {
                        (Ok(d), Ok(proof))
                            if crypto::verify_partial(
                                poll_id, t, j as u32, h, &ct.a, &d, &proof,
                            ) =>
                        {
                            masks[j].push(d);
                            true
                        }
                        _ => false,
                    }
                });
            partials_ok &= ok;
            partial_rows.push((t.clone(), ps.options.clone()));
            partials_out.push(TranscriptPartial {
                trustee: t.clone(),
                options: ps.options,
            });
        }
        c.push(
            "partial decryptions",
            partials_ok,
            format!(
                "{published} of {} trustees published; every published one proven",
                def.trustees.len()
            ),
        );

        if published == def.trustees.len() && c.all_ok() {
            let opened: Option<Vec<u64>> = agg
                .iter()
                .zip(&masks)
                .map(|(ct, ds)| crypto::open_count(ct, ds, n as u64))
                .collect();
            let sum_ok = opened.as_ref().is_some_and(|cs| {
                let total: u64 = cs.iter().sum();
                total >= n as u64 * u64::from(def.min_choices)
                    && total <= n as u64 * u64::from(def.max_choices)
            });
            c.push(
                "decryption",
                sum_ok,
                "every option decrypts to a count within 0..=ballots",
            );
            if let (true, Some(cs)) = (sum_ok, opened) {
                let text = transcript_text(
                    poll_id,
                    &def,
                    election,
                    &closure.counted,
                    &partial_rows,
                    &cs,
                );
                let d = transcript_digest(&text);
                if let Some(a) = &state.anchor {
                    c.push(
                        "anchor",
                        a.digest == d,
                        format!("anchored on {}: {}", a.network, a.reference),
                    );
                }
                digest = Some(d);
                counts = Some(cs);
            }
        }
        finish(c, counts, digest, n as u32, ballots_out, partials_out)
    }
}

#[cfg(test)]
mod tests;
