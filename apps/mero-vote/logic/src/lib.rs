//! # mero-vote — private polls with verifiable tallies
//!
//! A context is a group that votes. A poll in it moves through four phases:
//!
//! 1. **Key ceremony** (t-of-n). The creator names `n` trustees and a threshold
//!    `t`. Each trustee's browser publishes a transport key, then *deals*: a
//!    random polynomial of degree `t−1`, public commitments to it, and one
//!    share encrypted to every trustee. A trustee sent a bad share files a
//!    public, verifiable complaint and the cheating dealer is left out. The
//!    creator opens voting once at least `t` honest dealings are in, and the
//!    election key — the sum of the qualified dealers' constant terms — is
//!    frozen. Nobody ever holds the whole decryption key.
//! 2. **Voting.** Each voter's *browser* encrypts one 0/1 ciphertext per option
//!    under that key and proves, in zero knowledge, that each is 0 or 1 and
//!    that the count chosen is within the poll's bounds. The node never sees a
//!    plaintext. Voting again replaces the ballot.
//! 3. **Closing.** The creator announces the close. Every node refuses new
//!    ballots from the moment it sees the announcement, but ballots cast before
//!    that still arrive by sync — which is why the count is not frozen yet.
//! 4. **Closed.** The creator seals the count, freezing the set of ballots.
//!    Any `t` trustees publish partial decryptions of the per-option
//!    *aggregates* (never of a ballot) with proofs; the counts fall out.
//!
//! ## Who can see what
//!
//! | | sees |
//! | --- | --- |
//! | every member | who voted, the encrypted ballots, every proof, the final counts |
//! | a node operator | the same — nothing more, because encryption happens in the browser |
//! | `t` or more trustees colluding off-protocol | individual ballots |
//! | fewer than `t` trustees | nothing |
//!
//! ## Why the tally is verifiable
//!
//! Nothing in [`MeroVote::get_result`] trusts a stored conclusion. It re-checks
//! the dealings, the complaints, the key, every ballot proof, every partial
//! decryption, and solves for the counts — on the reader's own node, every
//! time. The same inputs come out of [`MeroVote::get_transcript`] for an
//! independent verifier (the frontend ships one in TypeScript), and the
//! transcript digest can be anchored publicly.
//!
//! ## What Calimero provides and what it doesn't
//!
//! * **Authorship** — ballots, transport keys, dealings, complaints and
//!   partials live in the author's [`UserStorage`] slot, and polls in an
//!   [`AuthoredMap`] owned by their creator. Both are signed and checked at
//!   MERGE, so a modified node cannot write into someone else's slot.
//! * **Immutability** — ballot bodies and poll definitions are
//!   content-addressed in [`FrozenStorage`].
//! * **Replication** — every member holds the whole ballot box.
//! * **Secrecy from co-members** — NOT provided. That is what the
//!   cryptography in `mero-vote-crypto` adds, with sigma protocols — no SNARK.

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

/// Upper bound on trustees. Every dealing carries one encrypted share per
/// trustee, so the ceremony is quadratic in this.
pub const MAX_TRUSTEES: usize = 8;
/// Upper bound on an explicit voter roll.
pub const MAX_VOTERS: usize = 1024;

/// Everything that crosses the wire or is stored: borsh for storage, serde for
/// JSON-RPC, `AbiType` for the generated client.
macro_rules! wire {
    ($($item:item)*) => {$(
        #[derive(
            Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
            calimero_sdk::abi::AbiType,
        )]
        #[borsh(crate = "calimero_sdk::borsh")]
        #[serde(crate = "calimero_sdk::serde")]
        $item
    )*};
}

/// Read-only views: serde + ABI only.
macro_rules! view {
    ($($item:item)*) => {$(
        #[derive(Debug, Clone, Serialize, calimero_sdk::abi::AbiType)]
        #[serde(crate = "calimero_sdk::serde")]
        $item
    )*};
}

// ── wire types ──────────────────────────────────────────────────────────────

wire! {
    /// One `(c, z)` pair of a proof, as 64-hex scalars.
    pub struct WireBranch {
        pub c: String,
        pub z: String,
    }

    /// One option's ciphertext and its 0-or-1 proof.
    pub struct WireChoice {
        pub a: String,
        pub b: String,
        pub proof: Vec<WireBranch>,
    }

    /// An encrypted ballot exactly as the browser built it.
    pub struct WireBallot {
        pub choices: Vec<WireChoice>,
        pub sum_proof: Vec<WireBranch>,
    }

    /// A trustee's partial decryption of one option's aggregate.
    pub struct WirePartial {
        pub d: String,
        pub proof: WireBranch,
    }

    pub struct WireCiphertext {
        pub a: String,
        pub b: String,
    }

    /// One share of a dealing, encrypted to its recipient's transport key.
    pub struct WireEncShare {
        pub r: String,
        pub v: String,
    }

    /// A trustee's contribution to the distributed key.
    pub struct WireDealing {
        /// `t` Feldman commitments, constant term first.
        pub commitments: Vec<String>,
        /// Proof of knowledge of the constant term.
        pub proof: WireBranch,
        /// One per trustee, in the poll's trustee order.
        pub shares: Vec<WireEncShare>,
    }

    /// A trustee's transport key and its proof of knowledge.
    pub struct TransportKey {
        pub key: String,
        pub proof: WireBranch,
    }

    /// "Dealer X sent me a share that does not match its commitments", with
    /// the ECDH secret for that one share and a DLEQ proof it is genuine.
    pub struct Complaint {
        pub poll_id: String,
        pub dealer: String,
        pub secret: String,
        pub proof: WireBranch,
    }

    /// The immutable part of a poll. Stored content-addressed; its SHA-256 IS
    /// the poll id, so nothing voters relied on can be edited under them.
    pub struct PollDefinition {
        pub title: String,
        pub description: String,
        pub options: Vec<String>,
        pub min_choices: u32,
        pub max_choices: u32,
        /// Accounts that hold the decryption key between them, in index order
        /// (trustee `i` in this list has Shamir index `i + 1`).
        pub trustees: Vec<String>,
        /// How many trustees it takes to decrypt. 1..=trustees.len().
        pub threshold: u32,
        /// Accounts allowed to vote. Empty means any member of the context.
        pub voters: Vec<String>,
        pub creator: String,
        /// Milliseconds. Also makes two otherwise identical polls distinct.
        pub created_at: u64,
        /// Informational deadline in milliseconds. Node clocks are not a
        /// consensus source, so closing is an explicit act of the creator.
        pub closes_at: Option<u64>,
    }

    pub enum Phase {
        KeyCeremony,
        Voting,
        Closing,
        Closed,
    }

    pub struct QualifiedDealing {
        pub dealer: String,
        pub dealing: WireDealing,
    }

    /// The key ceremony's outcome, frozen at open.
    pub struct Election {
        pub key: String,
        pub threshold: u32,
        /// Transport keys, in trustee order. Frozen because complaints are
        /// adjudicated against them.
        pub transport: Vec<String>,
        /// Dealings that make up the key, in trustee order.
        pub qualified: Vec<QualifiedDealing>,
        /// Dealers left out because a complaint proved they cheated.
        pub disqualified: Vec<String>,
        pub opened_at: u64,
    }

    /// One ballot the seal commits to count.
    pub struct CountedBallot {
        pub voter: String,
        /// The protocol digest — the voter's receipt.
        pub digest: String,
        /// Where the body lives in `ballot_bodies`.
        pub frozen: String,
    }

    pub struct Closure {
        pub counted: Vec<CountedBallot>,
        pub closed_at: u64,
    }

    /// A pointer from the context to a public record of the transcript digest.
    pub struct Anchor {
        pub digest: String,
        pub network: String,
        pub reference: String,
        pub anchored_at: u64,
    }

    /// The mutable part of a poll, owned by its creator.
    pub struct PollState {
        pub phase: Phase,
        pub election: Option<Election>,
        /// When the close was announced (phase Closing onward).
        pub closing_at: Option<u64>,
        pub closure: Option<Closure>,
        pub anchor: Option<Anchor>,
    }

    /// A ballot body, content-addressed.
    pub struct StoredBallot {
        pub poll_id: String,
        pub voter: String,
        pub ballot: WireBallot,
    }

    /// What a voter's slot holds for a poll: which body is theirs.
    pub struct BallotPointer {
        pub digest: String,
        pub frozen: String,
        pub cast_at: u64,
    }

    pub struct StoredPartials {
        pub options: Vec<WirePartial>,
    }
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
    transport: UnorderedMap<String, LwwRegister<TransportKey>>,
    dealings: UnorderedMap<String, LwwRegister<WireDealing>>,
    /// Keyed `"{poll_id}/{dealer}"`.
    complaints: UnorderedMap<String, LwwRegister<Complaint>>,
    partials: UnorderedMap<String, LwwRegister<StoredPartials>>,
}

// ── views ───────────────────────────────────────────────────────────────────

view! {
    pub struct Member {
        pub account: String,
        pub name: String,
    }

    pub struct PollSummary {
        pub poll_id: String,
        pub title: String,
        pub creator: String,
        pub phase: Phase,
        pub created_at: u64,
        pub ballots: u32,
    }

    pub struct TrusteeStatus {
        pub account: String,
        /// 1-based Shamir index.
        pub index: u32,
        pub transport_published: bool,
        pub dealing_published: bool,
        /// Valid complaints filed against this trustee's dealing.
        pub complaints_against: u32,
        /// Whether this trustee's dealing is part of the key (after open).
        pub qualified: Option<bool>,
        pub partial_published: bool,
    }

    /// Who has voted — never what.
    pub struct Turnout {
        pub voter: String,
        pub digest: String,
        pub cast_at: u64,
    }

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

    pub struct CeremonyTrustee {
        pub account: String,
        pub index: u32,
        pub transport: Option<String>,
        pub dealing: Option<WireDealing>,
    }

    pub struct ComplaintView {
        pub recipient: String,
        pub dealer: String,
        /// Proves the dealer cheated. An invalid complaint disqualifies no one.
        pub valid: bool,
    }

    /// What a trustee's browser needs during the key ceremony.
    pub struct Ceremony {
        pub threshold: u32,
        pub trustees: Vec<CeremonyTrustee>,
        pub complaints: Vec<ComplaintView>,
    }

    /// What a trustee's browser needs to compute its partial decryptions.
    pub struct TallyInputs {
        pub aggregate: Vec<WireCiphertext>,
        pub counted: u32,
    }

    pub struct Check {
        pub name: String,
        pub ok: bool,
        pub detail: String,
    }

    /// Result of re-verifying a poll from its raw inputs.
    pub struct AuditReport {
        pub poll_id: String,
        pub phase: Phase,
        /// Every check held. A poll is only as good as its worst check.
        pub verified: bool,
        pub checks: Vec<Check>,
        /// Per-option counts, once `t` trustees have published and all checks hold.
        pub counts: Option<Vec<u64>>,
        pub counted_ballots: u32,
        /// Trustees whose partials were combined, in index order.
        pub decrypted_by: Vec<String>,
        /// Digest of the canonical transcript. What gets anchored.
        pub transcript_digest: Option<String>,
        pub anchor: Option<Anchor>,
    }

    pub struct TranscriptBallot {
        pub voter: String,
        pub digest: String,
        pub ballot: WireBallot,
        /// Whether the voter's own signed slot still points at this ballot.
        pub endorsed: bool,
    }

    pub struct TranscriptPartial {
        pub trustee: String,
        pub index: u32,
        pub options: Vec<WirePartial>,
    }

    /// Every input of the tally, for verification somewhere other than this node.
    pub struct Transcript {
        pub protocol: String,
        pub poll_id: String,
        pub definition: PollDefinition,
        pub state: PollState,
        pub ballots: Vec<TranscriptBallot>,
        pub partials: Vec<TranscriptPartial>,
        pub report: AuditReport,
    }

    pub struct Identity {
        pub account: String,
    }
}

// ── events & errors ─────────────────────────────────────────────────────────

#[app::event]
pub enum Event {
    PollCreated {
        poll_id: String,
    },
    TransportKeyPublished {
        poll_id: String,
        trustee: String,
    },
    DealingPublished {
        poll_id: String,
        trustee: String,
    },
    ComplaintFiled {
        poll_id: String,
        recipient: String,
        dealer: String,
    },
    VotingOpened {
        poll_id: String,
    },
    BallotCast {
        poll_id: String,
        voter: String,
    },
    PollClosing {
        poll_id: String,
    },
    PollSealed {
        poll_id: String,
        counted: u32,
    },
    PartialPublished {
        poll_id: String,
        trustee: String,
    },
    Anchored {
        poll_id: String,
    },
    MemberNamed {
        account: String,
    },
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

fn complaint_key(poll_id: &str, dealer: &str) -> String {
    format!("{poll_id}/{dealer}")
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

pub fn decode_dealing(w: &WireDealing) -> Result<crypto::Dealing, crypto::CryptoError> {
    Ok(crypto::Dealing {
        commitments: w
            .commitments
            .iter()
            .map(|c| crypto::decode_point(c, "commitment"))
            .collect::<Result<_, _>>()?,
        proof: branch(&w.proof, "dealing proof")?,
        shares: w
            .shares
            .iter()
            .map(|s| {
                Ok(crypto::EncryptedShare {
                    r: crypto::decode_point(&s.r, "share")?,
                    v: crypto::decode_scalar(&s.v, "share")?,
                })
            })
            .collect::<Result<_, crypto::CryptoError>>()?,
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

fn trustee_index(def: &PollDefinition, account: &str) -> Option<u32> {
    def.trustees
        .iter()
        .position(|t| t == account)
        .map(|i| i as u32 + 1)
}

/// Verify a complaint against the given dealing and transport key.
fn complaint_holds(
    poll_id: &str,
    def: &PollDefinition,
    recipient: &str,
    complaint: &Complaint,
    dealing: &crypto::Dealing,
    transport: &str,
) -> bool {
    let (Some(index), Ok(key), Ok(secret), Ok(proof)) = (
        trustee_index(def, recipient),
        crypto::decode_point(transport, "transport"),
        crypto::decode_point(&complaint.secret, "complaint"),
        branch(&complaint.proof, "complaint proof"),
    ) else {
        return false;
    };
    crypto::complaint_is_valid(
        poll_id,
        recipient,
        &complaint.dealer,
        index,
        &key,
        dealing,
        &secret,
        &proof,
    )
}

/// The canonical transcript text. One line per fact, free text hex-encoded so
/// a newline in a title cannot forge a line. Its SHA-256 is the digest a poll
/// is anchored by; the TypeScript verifier rebuilds it byte for byte.
///
/// Partial decryptions are deliberately NOT in it. Any `t` honest partials
/// give the same counts, and a trustee publishing late changes which `t` get
/// combined — so a digest over them would move after it had been anchored. The
/// digest commits to the key, the ballots and the counts; the partials that
/// prove the counts travel in the transcript and are verified from there.
pub fn transcript_text(
    poll_id: &str,
    def: &PollDefinition,
    election: &Election,
    counted: &[CountedBallot],
    counts: &[u64],
) -> String {
    let mut out = String::from("mero-vote/v2/transcript\n");
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
    out.push_str(&format!(
        "threshold {} {}\n",
        election.threshold,
        def.trustees.len()
    ));
    for (i, t) in def.trustees.iter().enumerate() {
        out.push_str(&format!("trustee {} {t}\n", i + 1));
    }
    for q in &election.qualified {
        out.push_str(&format!(
            "dealer {} {}\n",
            q.dealer,
            q.dealing.commitments.join(" ")
        ));
    }
    for d in &election.disqualified {
        out.push_str(&format!("disqualified {d}\n"));
    }
    out.push_str(&format!("key {}\n", election.key));
    for b in counted {
        out.push_str(&format!("ballot {} {}\n", b.voter, b.digest));
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
            .filter(|m| !m.name.is_empty())
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
        threshold: u32,
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
        if threshold == 0 || threshold as usize > trustees.len() {
            app::bail!(VoteError::Invalid(format!(
                "the threshold must be 1..={} (the number of trustees)",
                trustees.len()
            )));
        }
        let voters = dedup(voters, "voters", MAX_VOTERS)?;

        let def = PollDefinition {
            title,
            description,
            options,
            min_choices,
            max_choices,
            trustees,
            threshold,
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
                closing_at: None,
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
        let ceremony = self.ceremony_of(&poll_id, &def)?;
        let mut trustees = Vec::new();
        for (i, t) in def.trustees.iter().enumerate() {
            let slot = self.slot_of(t)?;
            let complaints_against = ceremony
                .complaints
                .iter()
                .filter(|c| &c.dealer == t && c.valid)
                .count() as u32;
            trustees.push(TrusteeStatus {
                account: t.clone(),
                index: i as u32 + 1,
                transport_published: ceremony.trustees[i].transport.is_some(),
                dealing_published: ceremony.trustees[i].dealing.is_some(),
                complaints_against,
                qualified: state
                    .election
                    .as_ref()
                    .map(|e| e.qualified.iter().any(|q| &q.dealer == t)),
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

    /// Transport keys, dealings and complaints as they stand.
    pub fn ceremony(&self, poll_id: String) -> app::Result<Ceremony> {
        let (def, _) = self.load(&poll_id)?;
        self.ceremony_of(&poll_id, &def)
    }

    /// Round 1: a trustee publishes the key dealers will encrypt its shares
    /// to. Write-once — dealings are addressed to it.
    pub fn publish_transport_key(
        &mut self,
        poll_id: String,
        key: String,
        proof: WireBranch,
    ) -> app::Result<()> {
        let (def, state) = self.load(&poll_id)?;
        let caller = me();
        self.require_trustee_in_ceremony(&def, &state, &caller)?;
        if self.transport_of(&caller, &poll_id)?.is_some() {
            app::bail!(VoteError::Phase(
                "your transport key is already published".into()
            ));
        }
        let k = crypto::decode_point(&key, "transport key").map_err(VoteError::from)?;
        let p = branch(&proof, "transport proof").map_err(VoteError::from)?;
        if !crypto::verify_transport_key(&poll_id, &caller, &k, &p) {
            app::bail!(VoteError::Crypto(
                "transport key proof of knowledge does not verify".into()
            ));
        }
        let mut slot = self.slots.get()?.unwrap_or_default();
        slot.transport.insert(
            poll_id.clone(),
            LwwRegister::new(TransportKey { key, proof }),
        )?;
        self.slots.insert(slot)?;
        app::emit!(Event::TransportKeyPublished {
            poll_id,
            trustee: caller
        });
        Ok(())
    }

    /// Round 2: a trustee deals shares of its polynomial to every trustee.
    /// The contract checks the shape and the proof of knowledge; whether each
    /// encrypted share matches the commitments only its recipient can tell,
    /// which is what complaints are for. Write-once.
    pub fn publish_dealing(&mut self, poll_id: String, dealing: WireDealing) -> app::Result<()> {
        let (def, state) = self.load(&poll_id)?;
        let caller = me();
        self.require_trustee_in_ceremony(&def, &state, &caller)?;
        if self.dealing_of(&caller, &poll_id)?.is_some() {
            app::bail!(VoteError::Phase("your dealing is already published".into()));
        }
        for t in &def.trustees {
            if self.transport_of(t, &poll_id)?.is_none() {
                app::bail!(VoteError::Phase(format!(
                    "trustee {t} has not published a transport key yet"
                )));
            }
        }
        let d = decode_dealing(&dealing).map_err(VoteError::from)?;
        crypto::verify_dealing(&poll_id, &caller, def.threshold, def.trustees.len(), &d)
            .map_err(VoteError::from)?;
        let mut slot = self.slots.get()?.unwrap_or_default();
        slot.dealings
            .insert(poll_id.clone(), LwwRegister::new(dealing))?;
        self.slots.insert(slot)?;
        app::emit!(Event::DealingPublished {
            poll_id,
            trustee: caller
        });
        Ok(())
    }

    /// A trustee proves `dealer` sent it a share that does not match the
    /// dealer's commitments. Refused unless the proof holds AND the share is
    /// really bad — so a complaint can never frame an honest dealer.
    pub fn file_complaint(
        &mut self,
        poll_id: String,
        dealer: String,
        secret: String,
        proof: WireBranch,
    ) -> app::Result<()> {
        let (def, state) = self.load(&poll_id)?;
        let caller = me();
        self.require_trustee_in_ceremony(&def, &state, &caller)?;
        let Some(wire) = self.dealing_of(&dealer, &poll_id)? else {
            app::bail!(VoteError::Invalid(format!("{dealer} has not dealt")));
        };
        let Some(transport) = self.transport_of(&caller, &poll_id)? else {
            app::bail!(VoteError::Phase("publish your transport key first".into()));
        };
        let d = decode_dealing(&wire).map_err(VoteError::from)?;
        let complaint = Complaint {
            poll_id: poll_id.clone(),
            dealer: dealer.clone(),
            secret,
            proof,
        };
        if !complaint_holds(&poll_id, &def, &caller, &complaint, &d, &transport.key) {
            app::bail!(VoteError::Crypto(
                "the complaint does not prove a bad share".into()
            ));
        }
        let mut slot = self.slots.get()?.unwrap_or_default();
        slot.complaints.insert(
            complaint_key(&poll_id, &dealer),
            LwwRegister::new(complaint),
        )?;
        self.slots.insert(slot)?;
        app::emit!(Event::ComplaintFiled {
            poll_id,
            recipient: caller,
            dealer
        });
        Ok(())
    }

    /// Freeze the election key and open voting. The qualified set is every
    /// verified dealing with no valid complaint against it, and it must hold
    /// at least `t` dealers — otherwise fewer than `t` colluders could know
    /// the whole key.
    pub fn open_voting(&mut self, poll_id: String) -> app::Result<String> {
        let (def, mut state) = self.load(&poll_id)?;
        self.require_creator(&def)?;
        if state.phase != Phase::KeyCeremony {
            app::bail!(VoteError::Phase("voting is already open".into()));
        }
        let ceremony = self.ceremony_of(&poll_id, &def)?;
        let mut transport = Vec::new();
        for t in &ceremony.trustees {
            let Some(k) = &t.transport else {
                app::bail!(VoteError::Phase(format!(
                    "trustee {} has not published a transport key",
                    t.account
                )));
            };
            transport.push(k.clone());
        }
        let mut qualified = Vec::new();
        let mut disqualified = Vec::new();
        for t in &ceremony.trustees {
            let Some(dealing) = &t.dealing else {
                continue;
            };
            let valid = decode_dealing(dealing)
                .ok()
                .filter(|d| {
                    crypto::verify_dealing(
                        &poll_id,
                        &t.account,
                        def.threshold,
                        def.trustees.len(),
                        d,
                    )
                    .is_ok()
                })
                .is_some();
            let accused = ceremony
                .complaints
                .iter()
                .any(|c| c.dealer == t.account && c.valid);
            if valid && !accused {
                qualified.push(QualifiedDealing {
                    dealer: t.account.clone(),
                    dealing: dealing.clone(),
                });
            } else if accused {
                disqualified.push(t.account.clone());
            }
        }
        if qualified.len() < def.threshold as usize {
            app::bail!(VoteError::Phase(format!(
                "{} honest dealings; the threshold needs at least {}",
                qualified.len(),
                def.threshold
            )));
        }
        let decoded: Vec<crypto::Dealing> = qualified
            .iter()
            .map(|q| decode_dealing(&q.dealing))
            .collect::<Result<_, _>>()
            .map_err(VoteError::from)?;
        let key = crypto::encode_point(&crypto::joint_key(&decoded.iter().collect::<Vec<_>>()));
        state.phase = Phase::Voting;
        state.election = Some(Election {
            key: key.clone(),
            threshold: def.threshold,
            transport,
            qualified,
            disqualified,
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

    /// Step one of closing: stop accepting ballots. Each node refuses new
    /// ballots once it sees this; ballots cast before that keep syncing in,
    /// and the seal is what freezes the count.
    pub fn close_poll(&mut self, poll_id: String) -> app::Result<()> {
        let (def, mut state) = self.load(&poll_id)?;
        self.require_creator(&def)?;
        if state.phase != Phase::Voting {
            app::bail!(VoteError::Phase("only an open poll can be closed".into()));
        }
        state.phase = Phase::Closing;
        state.closing_at = Some(now_ms());
        self.polls.update(&poll_id, LwwRegister::new(state))?;
        app::emit!(Event::PollClosing { poll_id });
        Ok(())
    }

    /// Step two: freeze the ballots to count — every eligible voter's
    /// current, re-verified ballot as this node sees it now.
    pub fn seal_poll(&mut self, poll_id: String) -> app::Result<u32> {
        let (def, mut state) = self.load(&poll_id)?;
        self.require_creator(&def)?;
        if state.phase != Phase::Closing {
            app::bail!(VoteError::Phase(
                "close the poll before sealing the count".into()
            ));
        }
        let election = state
            .election
            .as_ref()
            .expect("closing implies an election");
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
        app::emit!(Event::PollSealed {
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
            app::bail!(VoteError::Phase("the count is not sealed yet".into()));
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

    /// A trustee publishes `Dⱼ = xⱼ·Aⱼ` for every option's aggregate, each
    /// with a DLEQ proof against its verification key `hⱼ`, which anyone can
    /// derive from the qualified commitments.
    pub fn publish_partial(
        &mut self,
        poll_id: String,
        partials: Vec<WirePartial>,
    ) -> app::Result<()> {
        let (def, state) = self.load(&poll_id)?;
        let caller = me();
        let Some(closure) = &state.closure else {
            app::bail!(VoteError::Phase("the count is not sealed yet".into()));
        };
        let election = state.election.as_ref().expect("closed implies an election");
        let Some(index) = trustee_index(&def, &caller) else {
            app::bail!(VoteError::Forbidden(
                "only a trustee can publish a partial decryption".into()
            ));
        };
        if partials.len() != def.options.len() {
            app::bail!(VoteError::Invalid(
                "one partial decryption per option".into()
            ));
        }
        let vkey = self.verification_key(election, index)?;
        let aggregate = self.aggregate(&def, closure)?;
        for (j, (p, ct)) in partials.iter().zip(&aggregate).enumerate() {
            let d = crypto::decode_point(&p.d, "partial").map_err(VoteError::from)?;
            let proof = branch(&p.proof, "partial proof").map_err(VoteError::from)?;
            if !crypto::verify_partial(&poll_id, &caller, j as u32, &vkey, &ct.a, &d, &proof) {
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

    /// Re-verify everything and, once `t` trustees have published, the counts.
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
    /// verified result, and only with the digest this node computes.
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

    fn require_trustee_in_ceremony(
        &self,
        def: &PollDefinition,
        state: &PollState,
        caller: &str,
    ) -> app::Result<()> {
        if trustee_index(def, caller).is_none() {
            app::bail!(VoteError::Forbidden(
                "only a named trustee takes part in the key ceremony".into()
            ));
        }
        if state.phase != Phase::KeyCeremony {
            app::bail!(VoteError::Phase(
                "the key ceremony is over — the election key is frozen".into()
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

    fn transport_of(&self, account: &str, poll_id: &str) -> app::Result<Option<TransportKey>> {
        match self.slot_of(account)? {
            Some(slot) => Ok(slot
                .transport
                .get(&poll_id.to_owned())?
                .map(|s| s.get().clone())),
            None => Ok(None),
        }
    }

    fn dealing_of(&self, account: &str, poll_id: &str) -> app::Result<Option<WireDealing>> {
        match self.slot_of(account)? {
            Some(slot) => Ok(slot
                .dealings
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

    /// The ceremony from live slots, with every complaint adjudicated.
    fn ceremony_of(&self, poll_id: &str, def: &PollDefinition) -> app::Result<Ceremony> {
        let mut trustees = Vec::new();
        for (i, t) in def.trustees.iter().enumerate() {
            trustees.push(CeremonyTrustee {
                account: t.clone(),
                index: i as u32 + 1,
                transport: self.transport_of(t, poll_id)?.map(|k| k.key),
                dealing: self.dealing_of(t, poll_id)?,
            });
        }
        let mut complaints = Vec::new();
        for recipient in &trustees {
            let Some(slot) = self.slot_of(&recipient.account)? else {
                continue;
            };
            for dealer in &trustees {
                let Some(c) = slot
                    .complaints
                    .get(&complaint_key(poll_id, &dealer.account))?
                else {
                    continue;
                };
                let c = c.get().clone();
                let valid = match (&dealer.dealing, &recipient.transport) {
                    (Some(w), Some(key)) => decode_dealing(w).is_ok_and(|d| {
                        complaint_holds(poll_id, def, &recipient.account, &c, &d, key)
                    }),
                    _ => false,
                };
                complaints.push(ComplaintView {
                    recipient: recipient.account.clone(),
                    dealer: dealer.account.clone(),
                    valid,
                });
            }
        }
        Ok(Ceremony {
            threshold: def.threshold,
            trustees,
            complaints,
        })
    }

    fn verification_key(&self, election: &Election, index: u32) -> app::Result<crypto::Point> {
        let decoded: Vec<crypto::Dealing> = election
            .qualified
            .iter()
            .map(|q| decode_dealing(&q.dealing))
            .collect::<Result<_, _>>()
            .map_err(VoteError::from)?;
        Ok(crypto::verification_key(
            &decoded.iter().collect::<Vec<_>>(),
            index,
        ))
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
        let mut decrypted_by = Vec::new();

        let finish = |c: Checks,
                      counts,
                      digest,
                      decrypted_by: Vec<String>,
                      counted: u32,
                      ballots,
                      partials| {
            let verified = c.all_ok();
            Ok((
                AuditReport {
                    poll_id: poll_id.to_owned(),
                    phase: state.phase.clone(),
                    verified,
                    checks: c.checks,
                    counts: if verified { counts } else { None },
                    counted_ballots: counted,
                    decrypted_by: if verified { decrypted_by } else { Vec::new() },
                    transcript_digest: if verified { digest } else { None },
                    anchor: state.anchor.clone(),
                },
                ballots,
                partials,
            ))
        };

        let n_trustees = def.trustees.len();
        c.push(
            "definition",
            rules(&def).check().is_ok()
                && n_trustees > 0
                && def.threshold >= 1
                && def.threshold as usize <= n_trustees,
            format!(
                "{} options, choose {}..={}; {}-of-{} trustees",
                def.options.len(),
                def.min_choices,
                def.max_choices,
                def.threshold,
                n_trustees
            ),
        );

        // 1. The key ceremony.
        let Some(election) = &state.election else {
            c.push("election key", true, "key ceremony in progress");
            return finish(c, None, None, decrypted_by, 0, ballots_out, partials_out);
        };
        let mut dealings = Vec::new();
        let mut dealings_ok = election.threshold == def.threshold
            && election.transport.len() == n_trustees
            && election.qualified.len() >= def.threshold as usize;
        let mut last_index = 0;
        for q in &election.qualified {
            // In trustee order, each dealer at most once.
            let idx = trustee_index(&def, &q.dealer).unwrap_or(0);
            dealings_ok &= idx > last_index;
            last_index = idx;
            match decode_dealing(&q.dealing) {
                Ok(d)
                    if crypto::verify_dealing(
                        poll_id,
                        &q.dealer,
                        def.threshold,
                        n_trustees,
                        &d,
                    )
                    .is_ok() =>
                {
                    dealings.push(d)
                }
                _ => dealings_ok = false,
            }
            // The dealer's own signed slot must hold the same dealing — that
            // is what shows the dealer, not the creator, made it.
            if self.dealing_of(&q.dealer, poll_id)?.as_ref() != Some(&q.dealing) {
                dealings_ok = false;
            }
        }
        c.push(
            "dealings",
            dealings_ok,
            format!(
                "{} qualified dealings (threshold {}), each proven and endorsed by its dealer",
                election.qualified.len(),
                def.threshold
            ),
        );

        // Complaints, against the frozen dealings and transport keys: every
        // disqualified dealer must stand accused by a valid complaint, and no
        // qualified dealer may be.
        let mut complaints_ok = true;
        let mut valid_against: BTreeSet<String> = BTreeSet::new();
        for (ri, recipient) in def.trustees.iter().enumerate() {
            let Some(slot) = self.slot_of(recipient)? else {
                continue;
            };
            for dealer in &def.trustees {
                let Some(cm) = slot.complaints.get(&complaint_key(poll_id, dealer))? else {
                    continue;
                };
                let frozen = election
                    .qualified
                    .iter()
                    .find(|q| &q.dealer == dealer)
                    .map(|q| q.dealing.clone())
                    .or(self.dealing_of(dealer, poll_id)?);
                let holds = frozen.is_some_and(|w| {
                    decode_dealing(&w).is_ok_and(|d| {
                        complaint_holds(
                            poll_id,
                            &def,
                            recipient,
                            cm.get(),
                            &d,
                            &election.transport[ri],
                        )
                    })
                });
                if holds {
                    valid_against.insert(dealer.clone());
                }
            }
        }
        for q in &election.qualified {
            complaints_ok &= !valid_against.contains(&q.dealer);
        }
        for d in &election.disqualified {
            complaints_ok &= valid_against.contains(d);
        }
        c.push(
            "complaints",
            complaints_ok,
            if election.disqualified.is_empty() && valid_against.is_empty() {
                "no dealer was accused".to_owned()
            } else {
                format!(
                    "disqualified by proven complaint: {}",
                    election.disqualified.join(", ")
                )
            },
        );

        let refs: Vec<&crypto::Dealing> = dealings.iter().collect();
        let key_ok = dealings_ok && crypto::encode_point(&crypto::joint_key(&refs)) == election.key;
        c.push(
            "election key",
            key_ok,
            "key = sum of qualified constant terms",
        );
        let Ok(pk) = crypto::decode_point(&election.key, "election key") else {
            return finish(c, None, None, decrypted_by, 0, ballots_out, partials_out);
        };

        // 2. Every counted ballot.
        let Some(closure) = &state.closure else {
            c.push(
                "ballots",
                true,
                if state.phase == Phase::Closing {
                    "closing — the count is not sealed yet"
                } else {
                    "voting in progress"
                },
            );
            return finish(c, None, None, decrypted_by, 0, ballots_out, partials_out);
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

        // 3. Partial decryptions. Robust: a bad partial (which the contract
        //    refuses, so only a modified node can produce one) is set aside and
        //    named, and any `t` good ones decrypt.
        let mut good: Vec<(u32, String, Vec<crypto::Point>)> = Vec::new();
        let mut rejected = Vec::new();
        for (i, t) in def.trustees.iter().enumerate() {
            let index = i as u32 + 1;
            let Some(ps) = self.partials_of(t, poll_id)? else {
                continue;
            };
            partials_out.push(TranscriptPartial {
                trustee: t.clone(),
                index,
                options: ps.options.clone(),
            });
            let vkey = crypto::verification_key(&refs, index);
            let mut ds = Vec::new();
            let ok = ps.options.len() == agg.len()
                && ps.options.iter().zip(&agg).enumerate().all(|(j, (p, ct))| {
                    match (
                        crypto::decode_point(&p.d, "partial"),
                        branch(&p.proof, "partial proof"),
                    ) {
                        (Ok(d), Ok(proof))
                            if crypto::verify_partial(
                                poll_id, t, j as u32, &vkey, &ct.a, &d, &proof,
                            ) =>
                        {
                            ds.push(d);
                            true
                        }
                        _ => false,
                    }
                });
            if ok {
                good.push((index, t.clone(), ds));
            } else {
                rejected.push(t.clone());
            }
        }
        let t = def.threshold as usize;
        c.push(
            "partial decryptions",
            true,
            format!(
                "{} of {} needed{}",
                good.len(),
                t,
                if rejected.is_empty() {
                    String::new()
                } else {
                    format!("; set aside as unproven: {}", rejected.join(", "))
                }
            ),
        );

        if good.len() >= t && c.all_ok() {
            // The `t` lowest indices, so every verifier combines the same set.
            let used = &good[..t];
            let opened: Option<Vec<u64>> = agg
                .iter()
                .enumerate()
                .map(|(j, ct)| {
                    let ps: Vec<(u32, crypto::Point)> =
                        used.iter().map(|(i, _, ds)| (*i, ds[j])).collect();
                    crypto::open_count(ct, &ps, n as u64)
                })
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
                let text = transcript_text(poll_id, &def, election, &closure.counted, &cs);
                let d = transcript_digest(&text);
                if let Some(a) = &state.anchor {
                    c.push(
                        "anchor",
                        a.digest == d,
                        format!("anchored on {}: {}", a.network, a.reference),
                    );
                }
                decrypted_by = used.iter().map(|(_, tr, _)| tr.clone()).collect();
                digest = Some(d);
                counts = Some(cs);
            }
        }
        finish(
            c,
            counts,
            digest,
            decrypted_by,
            n as u32,
            ballots_out,
            partials_out,
        )
    }
}

#[cfg(test)]
mod tests;
