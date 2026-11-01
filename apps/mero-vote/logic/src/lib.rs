//! # mero-vote — private polls with verifiable tallies
//!
//! One app instance is a group that votes. A poll in it moves through four
//! phases:
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
//! 3. **Closing.** The creator announces the close; ballots are refused from
//!    then on.
//! 4. **Closed.** The creator seals the count, freezing the set of ballots.
//!    Any `t` trustees publish partial decryptions of the per-option
//!    *aggregates* (never of a ballot) with proofs; the counts fall out.
//!
//! ## Who can see what
//!
//! | | sees |
//! | --- | --- |
//! | everyone the app reaches | who voted, the encrypted ballots, every proof, the final counts |
//! | a node operator | the same — nothing more, because encryption happens in the browser |
//! | `t` or more trustees colluding off-protocol | individual ballots |
//! | fewer than `t` trustees | nothing |
//!
//! ## Why the tally is verifiable
//!
//! Nothing in `getResult` trusts a stored conclusion. It re-checks the
//! dealings, the complaints, the key, every ballot proof, every partial
//! decryption, and solves for the counts, every time. The same inputs come out
//! of `getTranscript` for an independent verifier (the frontend ships one in
//! TypeScript), and the transcript digest can be anchored publicly.
//!
//! ## On the component runtime
//!
//! The app runs on its cluster's leader, which applies every write in one log.
//! v1 kept authorship and immutability in storage (`WriteOnce` entries stamped
//! with their author and checked at merge, `UserStorage` slots, an
//! `AuthoredMap`), because any member's node could write anything. Here every
//! write goes through a method, so those rules are checks in the method,
//! against `env::caller()`, before anything is written:
//!
//! | v1 (`calimero-storage`) | here |
//! | --- | --- |
//! | `FrozenStorage<PollDefinition>` | `Frozen<PollDefinition>`: the poll id is the SHA-256 of its CBOR |
//! | `AuthoredMap<poll, LwwRegister<PollControl>>` | `UnorderedMap<poll, PollControl>`; only the definition's `creator` writes it |
//! | `WriteOnce<SortedMap<"{poll}/{nonce}", Election>>` (+ `closures`) | `UnorderedMap<poll, Election>` (+ `closures`): one per poll, refused once written; the seal's counted ballots are rows of `sealed: UnorderedMap<(poll, voter), CountedBallot>`, not a list in the seal |
//! | `WriteOnce<SortedMap<"{poll}/{trustee}/{hash}", TransportKey>>` (+ `dealings`) | `UnorderedMap<(poll, trustee), …>`, written once by that trustee's own call |
//! | `WriteOnce<SortedMap<"{poll}/{recipient}/{dealer}/{hash}", Complaint>>` | `UnorderedMap<(poll, recipient, dealer), Complaint>`, once per pair |
//! | `WriteOnce<UnorderedMap<hash, StoredBallot>>` | `Frozen<StoredBallot>`: `voter` is the caller who cast it |
//! | `UserStorage<MemberSlot>` (name, ballot pointers, partials) | `names: UnorderedMap<account, String>`, `ballots` and `partials` as `UnorderedMap<(poll, account), …>`, each written only for the caller |
//!
//! * **Secrecy from co-members** — NOT provided by the platform. That is what
//!   the cryptography in `mero-vote-crypto` adds, with sigma protocols — no
//!   SNARK.
//!
//! Every change a client sees (camelCase method and argument names, 64-bit
//! integers as decimal strings, the error shape, who may do what) is listed in
//! `apps/mero-vote/README.md`, "What changed in the port".

use std::collections::{BTreeMap, BTreeSet};

use calimero_app_sdk::prelude::*;
use calimero_app_sdk::OrgRole;
use mero_vote_crypto as crypto;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Upper bound on trustees. Every dealing carries one encrypted share per
/// trustee, so the ceremony is quadratic in this.
pub const MAX_TRUSTEES: usize = 8;
/// Upper bound on an explicit voter roll.
pub const MAX_VOTERS: usize = 1024;
/// The longest account id a trustee list or voter roll may name.
pub const MAX_ACCOUNT_LEN: usize = 128;
/// The most proof branches one ballot may carry: two per option, plus one per
/// allowed count (`maxChoices − minChoices + 1`). The node verifies a ballot
/// in one call, at ~4.75M fuel per branch, and a call has 200M: 38 branches
/// leave headroom (16 options choose 1 is 33; choose 0..=12 of 12 is 37).
pub const MAX_BALLOT_BRANCHES: usize = 38;
/// Rows per storage read; multi-row reads follow the cursor to the end.
const PAGE: u32 = 1000;

// ── wire types (arguments, stored values, answers) ──────────────────────────
//
// Field names stay v1's snake_case, so every answer has v1's shape; only the
// 64-bit integers changed, to decimal strings (D20), via `u64_auto`: an
// integer in stored CBOR, a string in JSON.

/// One `(c, z)` pair of a proof, as 64-hex scalars.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireBranch {
    pub c: String,
    pub z: String,
}

/// One option's ciphertext and its 0-or-1 proof.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireChoice {
    pub a: String,
    pub b: String,
    /// Two branches (0 or 1); `castBallot` refuses any other proof.
    pub proof: Vec<WireBranch>,
}

/// An encrypted ballot exactly as the browser built it. Stored (a ballot
/// body) only after `castBallot` verified it, so its lists have the poll's
/// shape: one choice per option and one sum branch per allowed count, at most
/// [`MAX_BALLOT_BRANCHES`] branches in all.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireBallot {
    /// One per option: at most 16.
    pub choices: Vec<WireChoice>,
    /// One per allowed count, `maxChoices − minChoices + 1`: at most 17.
    pub sum_proof: Vec<WireBranch>,
}

/// A trustee's partial decryption of one option's aggregate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WirePartial {
    pub d: String,
    pub proof: WireBranch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireCiphertext {
    pub a: String,
    pub b: String,
}

/// One share of a dealing, encrypted to its recipient's transport key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireEncShare {
    pub r: String,
    pub v: String,
}

/// A trustee's contribution to the distributed key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireDealing {
    /// `t` Feldman commitments, constant term first: at most
    /// [`MAX_TRUSTEES`], checked by `publishDealing` (`verify_dealing`).
    pub commitments: Vec<String>,
    /// Proof of knowledge of the constant term.
    pub proof: WireBranch,
    /// One per trustee, in the poll's trustee order: at most [`MAX_TRUSTEES`].
    pub shares: Vec<WireEncShare>,
}

/// A trustee's transport key and its proof of knowledge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransportKey {
    pub key: String,
    pub proof: WireBranch,
}

/// "Dealer X sent me a share that does not match its commitments", with
/// the ECDH secret for that one share and a DLEQ proof it is genuine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Complaint {
    pub poll_id: String,
    pub dealer: String,
    pub secret: String,
    pub proof: WireBranch,
}

/// The immutable part of a poll. Stored content-addressed; its SHA-256 IS
/// the poll id, so nothing voters relied on can be edited under them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PollDefinition {
    pub title: String,
    pub description: String,
    /// 2..=16, checked by `createPoll`.
    pub options: Vec<String>,
    pub min_choices: u32,
    pub max_choices: u32,
    /// Accounts that hold the decryption key between them, in index order
    /// (trustee `i` in this list has Shamir index `i + 1`). At most
    /// [`MAX_TRUSTEES`], checked by `createPoll`.
    pub trustees: Vec<String>,
    /// How many trustees it takes to decrypt. 1..=trustees.len().
    pub threshold: u32,
    /// Accounts allowed to vote. Empty means any member of the app's org. At
    /// most [`MAX_VOTERS`], checked by `createPoll`; the definition is frozen.
    pub voters: Vec<String>,
    pub creator: String,
    /// Milliseconds. Also makes two otherwise identical polls distinct.
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub created_at: u64,
    /// Informational deadline in milliseconds. Closing is an explicit act of
    /// the creator.
    #[serde(with = "calimero_app_sdk::json::opt_u64_auto")]
    pub closes_at: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    KeyCeremony,
    Voting,
    Closing,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualifiedDealing {
    pub dealer: String,
    pub dealing: WireDealing,
}

/// The key ceremony's outcome, frozen at open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Election {
    pub key: String,
    pub threshold: u32,
    /// Transport keys, in trustee order (one per trustee: at most
    /// [`MAX_TRUSTEES`]). Frozen because complaints are adjudicated against
    /// them.
    pub transport: Vec<String>,
    /// Dealings that make up the key, in trustee order: at most [`MAX_TRUSTEES`].
    pub qualified: Vec<QualifiedDealing>,
    /// Dealers left out because a complaint proved they cheated: at most
    /// [`MAX_TRUSTEES`].
    pub disqualified: Vec<String>,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub opened_at: u64,
}

/// One ballot the seal commits to count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CountedBallot {
    pub voter: String,
    /// The protocol digest — the voter's receipt.
    pub digest: String,
    /// Where the body lives in `ballotBodies` (its content hash).
    pub frozen: String,
}

/// The seal as answered: the stored [`StoredClosure`] with its counted
/// ballots, read from `sealed`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Closure {
    /// In voter order.
    pub counted: Vec<CountedBallot>,
    /// Per option, the sum of the counted ballots' ciphertexts: what the
    /// trustees decrypt. Kept as ballots were cast (each verified then), and
    /// recomputed from the ballots by the browser's re-verification.
    pub aggregate: Vec<WireCiphertext>,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub closed_at: u64,
}

/// The seal as stored. The counted ballots grow with the electorate, so they
/// are rows of `sealed`, not a list in here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredClosure {
    /// How many rows of `sealed` the seal wrote for the poll.
    pub counted: u32,
    /// One per option: at most 16 (`crypto::MAX_OPTIONS`, checked by `createPoll`).
    pub aggregate: Vec<WireCiphertext>,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub closed_at: u64,
}

/// A pointer from the app to a public record of the transcript digest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Anchor {
    pub digest: String,
    pub network: String,
    pub reference: String,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub anchored_at: u64,
}

/// The part of a poll its creator may still change: the closing notice
/// and the anchor. Everything else about a poll's lifecycle is written
/// once (`elections` and `closures`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PollControl {
    /// When the close was announced (phase Closing onward).
    #[serde(with = "calimero_app_sdk::json::opt_u64_auto")]
    pub closing_at: Option<u64>,
    pub anchor: Option<Anchor>,
}

/// A poll's lifecycle as read: the phase is derived from what has been
/// written, so a sealed poll can never go back to voting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PollState {
    pub phase: Phase,
    pub election: Option<Election>,
    /// When the close was announced (phase Closing onward).
    #[serde(with = "calimero_app_sdk::json::opt_u64_auto")]
    pub closing_at: Option<u64>,
    pub closure: Option<Closure>,
    pub anchor: Option<Anchor>,
}

/// A ballot body, content-addressed. `voter` is the account whose call cast
/// it: nothing else writes one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredBallot {
    pub poll_id: String,
    pub voter: String,
    pub ballot: WireBallot,
}

/// Which body is a voter's current ballot for a poll.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BallotPointer {
    pub digest: String,
    pub frozen: String,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub cast_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredPartials {
    /// One per option (at most 16), checked by `publishPartial`.
    pub options: Vec<WirePartial>,
}

// ── views ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct Member {
    pub account: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PollSummary {
    pub poll_id: String,
    pub title: String,
    pub creator: String,
    pub phase: Phase,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub created_at: u64,
    pub ballots: u32,
}

#[derive(Debug, Clone, Serialize)]
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
#[derive(Debug, Clone, Serialize)]
pub struct Turnout {
    pub voter: String,
    pub digest: String,
    #[serde(with = "calimero_app_sdk::json::u64_auto")]
    pub cast_at: u64,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
pub struct CeremonyTrustee {
    pub account: String,
    pub index: u32,
    pub transport: Option<String>,
    pub dealing: Option<WireDealing>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComplaintView {
    pub recipient: String,
    pub dealer: String,
    /// Proves the dealer cheated. An invalid complaint disqualifies no one.
    pub valid: bool,
}

/// What a trustee's browser needs during the key ceremony.
#[derive(Debug, Clone, Serialize)]
pub struct Ceremony {
    pub threshold: u32,
    pub trustees: Vec<CeremonyTrustee>,
    pub complaints: Vec<ComplaintView>,
}

/// What a trustee's browser needs to compute its partial decryptions.
#[derive(Debug, Clone, Serialize)]
pub struct TallyInputs {
    pub aggregate: Vec<WireCiphertext>,
    pub counted: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Check {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

/// Result of re-verifying a poll from its raw inputs.
#[derive(Debug, Clone, Serialize)]
pub struct AuditReport {
    pub poll_id: String,
    pub phase: Phase,
    /// Every check held. A poll is only as good as its worst check.
    pub verified: bool,
    pub checks: Vec<Check>,
    /// Per-option counts, once `t` trustees have published and all checks
    /// hold. Each is at most the number of counted ballots.
    pub counts: Option<Vec<u32>>,
    pub counted_ballots: u32,
    /// Trustees whose partials were combined, in index order.
    pub decrypted_by: Vec<String>,
    /// Digest of the canonical transcript. What gets anchored.
    pub transcript_digest: Option<String>,
    pub anchor: Option<Anchor>,
    /// Eligible voters whose current ballot is not in the sealed count.
    /// Informational: under one log every ballot cast before the close is
    /// sealed, so this lists only voters left out by a roll change (none
    /// today) — kept for the transcript's shape.
    pub uncounted: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptBallot {
    pub voter: String,
    pub digest: String,
    pub ballot: WireBallot,
    /// Whether the voter's current ballot is still this one.
    pub endorsed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptPartial {
    pub trustee: String,
    pub index: u32,
    pub options: Vec<WirePartial>,
}

/// Every input of the tally, for verification somewhere other than this node.
#[derive(Debug, Clone, Serialize)]
pub struct Transcript {
    pub protocol: String,
    pub poll_id: String,
    pub definition: PollDefinition,
    pub state: PollState,
    pub ballots: Vec<TranscriptBallot>,
    pub partials: Vec<TranscriptPartial>,
    pub report: AuditReport,
}

#[derive(Debug, Clone, Serialize)]
pub struct Identity {
    pub account: String,
}

// ── state ───────────────────────────────────────────────────────────────────

#[app::state(version = 1)]
pub struct MeroVote {
    /// Immutable definitions; the key is the poll id.
    definitions: Frozen<PollDefinition>,
    /// Closing notice and anchor; written only by the definition's creator.
    polls: UnorderedMap<String, PollControl>,
    /// The frozen election, one per poll, written once by `openVoting`.
    elections: UnorderedMap<String, Election>,
    /// The seal, one per poll, written once by `sealPoll`.
    closures: UnorderedMap<String, StoredClosure>,
    /// `(poll, voter)`: the ballots the seal counts, written once by `sealPoll`.
    sealed: UnorderedMap<(String, String), CountedBallot>,
    /// `(poll, trustee)`, written once by that trustee.
    transport_keys: UnorderedMap<(String, String), TransportKey>,
    /// `(poll, dealer)`, written once by that dealer.
    dealings: UnorderedMap<(String, String), WireDealing>,
    /// `(poll, recipient, dealer)`, written once by the recipient.
    complaints: UnorderedMap<(String, String, String), Complaint>,
    /// Ballot bodies by the SHA-256 of their CBOR.
    ballot_bodies: Frozen<StoredBallot>,
    /// `(poll, voter)`: the voter's current ballot, written by their own call.
    ballots: UnorderedMap<(String, String), BallotPointer>,
    /// Per poll, the per-option sum of every current ballot's ciphertexts,
    /// updated by each `castBallot`: so sealing and tallying never re-read
    /// every ballot's curve points (see `MAX_BALLOT_BRANCHES` on fuel).
    /// One ciphertext per option: at most 16.
    aggregates: UnorderedMap<String, Vec<WireCiphertext>>,
    /// `(poll, trustee)`: the trustee's partial decryptions, by their own call.
    partials: UnorderedMap<(String, String), StoredPartials>,
    /// Display names, by account, each set by its own account.
    names: UnorderedMap<String, String>,
}

// ── logic ───────────────────────────────────────────────────────────────────

#[app::logic]
impl MeroVote {
    /// The empty app. The node runs it once, when the instance is created.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    // ── identity & roster ──────────────────────────────────────────────────

    /// The caller's ACCOUNT — the id trustees and voter rolls are written in,
    /// and the id every proof binds.
    #[app::view]
    pub fn whoami(&self) -> app::Result<Identity> {
        Ok(Identity { account: me()? })
    }

    /// Put a display name on your account (1..=64 characters, trimmed;
    /// `Invalid` otherwise). Doubles as "I'm here": the roster is how a
    /// creator finds the accounts to name as trustees or voters. Anyone the
    /// app reaches may, guests included. Emits `MemberNamed`.
    pub fn set_name(&mut self, name: String) -> app::Result<()> {
        let account = me()?;
        let name = name.trim().to_owned();
        if name.is_empty() || name.chars().count() > 64 {
            return Err(invalid("a name is 1..=64 characters"));
        }
        self.names.insert(&account, &name)?;
        env::emit(Event::MemberNamed { account }, Audience::All)?;
        Ok(())
    }

    /// Every named account, by name then account.
    #[app::view]
    pub fn roster(&self) -> app::Result<Vec<Member>> {
        let mut out: Vec<Member> = read_all(&self.names, &[])?
            .into_iter()
            .map(|(account, name)| Member { account, name })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name).then(a.account.cmp(&b.account)));
        Ok(out)
    }

    // ── polls ──────────────────────────────────────────────────────────────

    /// Create a poll and return its id (the hex SHA-256 of its definition).
    /// Members (not guests) may. A title is 1..=200 characters, the
    /// description at most 4000, options distinct and 1..=200 characters,
    /// 2..=16 of them; `minChoices..=maxChoices` within them, and
    /// `2·options + maxChoices − minChoices + 1` at most 38 (what one call can
    /// verify). 1..=8 trustees
    /// and a voter roll of at most 1024, each an account in the app's org;
    /// `threshold` 1..=trustees. Anything else is `Invalid`. Emits
    /// `PollCreated`.
    // Each argument is a named field of the ABI; a params struct would change it.
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
        let creator = me()?;
        if !is_member(&creator) {
            return Err(forbidden("guests cannot create polls"));
        }
        let title = title.trim().to_owned();
        if title.is_empty() || title.chars().count() > 200 {
            return Err(invalid("a title is 1..=200 characters"));
        }
        if description.chars().count() > 4000 {
            return Err(invalid("description is at most 4000 characters"));
        }
        let options: Vec<String> = options.into_iter().map(|o| o.trim().to_owned()).collect();
        if options
            .iter()
            .any(|o| o.is_empty() || o.chars().count() > 200)
        {
            return Err(invalid("every option is 1..=200 characters"));
        }
        if options.iter().collect::<BTreeSet<_>>().len() != options.len() {
            return Err(invalid("options must be distinct"));
        }
        crypto::Rules {
            options: options.len(),
            min: min_choices,
            max: max_choices,
        }
        .check()
        .map_err(crypto_err)?;
        let branches = 2 * options.len() + (max_choices - min_choices) as usize + 1;
        if branches > MAX_BALLOT_BRANCHES {
            return Err(invalid(&format!(
                "a ballot would carry {branches} proofs, more than the {MAX_BALLOT_BRANCHES} a \
                 node can verify in one call: allow fewer options or a narrower choice range"
            )));
        }

        let trustees = accounts(trustees, "trustees", MAX_TRUSTEES)?;
        if trustees.is_empty() {
            return Err(invalid("a poll needs at least one trustee"));
        }
        if threshold == 0 || threshold as usize > trustees.len() {
            return Err(invalid(&format!(
                "the threshold must be 1..={} (the number of trustees)",
                trustees.len()
            )));
        }
        let voters = accounts(voters, "voters", MAX_VOTERS)?;

        let def = PollDefinition {
            title,
            description,
            options,
            min_choices,
            max_choices,
            trustees,
            threshold,
            voters,
            creator,
            created_at: env::time_now(),
            closes_at,
        };
        let (poll_id, new) = self.definitions.insert(&def)?;
        if !new {
            return Err(invalid("an identical poll already exists"));
        }
        self.polls.insert(
            &poll_id,
            &PollControl {
                closing_at: None,
                anchor: None,
            },
        )?;
        env::emit(
            Event::PollCreated {
                poll_id: poll_id.clone(),
            },
            Audience::All,
        )?;
        Ok(poll_id)
    }

    /// Every poll, newest first.
    #[app::view]
    pub fn list_polls(&self) -> app::Result<Vec<PollSummary>> {
        let mut out = Vec::new();
        for (poll_id, _) in read_all(&self.polls, &[])? {
            let Some((def, state, sealed)) = self.load_with(&poll_id, false)? else {
                continue;
            };
            let ballots = match sealed {
                Some(n) => n,
                None => read_all(&self.ballots, &[KeyPart::Str(poll_id.clone())])?.len() as u32,
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

    /// One poll: definition, lifecycle, trustees' progress, turnout and the
    /// caller's own receipt. `NotFound` for an unknown id.
    #[app::view]
    pub fn get_poll(&self, poll_id: String) -> app::Result<PollView> {
        let caller = me()?;
        let (def, state) = self.poll(&poll_id)?;
        let ceremony = self.ceremony_of(&poll_id, &def)?;
        let mut trustees = Vec::new();
        for (i, t) in def.trustees.iter().enumerate() {
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
                partial_published: self.partials.contains(&(poll_id.clone(), t.clone()))?,
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
        let my_digest = self
            .ballots
            .get(&(poll_id.clone(), caller.clone()))?
            .map(|p| p.digest);
        let can_vote = state.phase == Phase::Voting && may_vote(&def, &caller);
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
    #[app::view]
    pub fn ceremony(&self, poll_id: String) -> app::Result<Ceremony> {
        let (def, _) = self.poll(&poll_id)?;
        self.ceremony_of(&poll_id, &def)
    }

    /// Round 1: a trustee publishes the key dealers will encrypt its shares
    /// to. Only a named trustee (`Forbidden`), only during the ceremony and
    /// only once (`Phase`), and only with a proof of knowledge bound to the
    /// caller (`Crypto`). Emits `TransportKeyPublished`.
    pub fn publish_transport_key(
        &mut self,
        poll_id: String,
        key: String,
        proof: WireBranch,
    ) -> app::Result<()> {
        let (def, state) = self.poll(&poll_id)?;
        let caller = me()?;
        require_trustee_in_ceremony(&def, &state, &caller)?;
        let slot = (poll_id.clone(), caller.clone());
        if self.transport_keys.contains(&slot)? {
            return Err(phase("your transport key is already published"));
        }
        let k = crypto::decode_point(&key, "transport key").map_err(crypto_err)?;
        let p = branch(&proof, "transport proof").map_err(crypto_err)?;
        if !crypto::verify_transport_key(&poll_id, &caller, &k, &p) {
            return Err(crypto_msg(
                "transport key proof of knowledge does not verify",
            ));
        }
        self.transport_keys
            .insert(&slot, &TransportKey { key, proof })?;
        env::emit(
            Event::TransportKeyPublished {
                poll_id,
                trustee: caller,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Round 2: a trustee deals shares of its polynomial to every trustee,
    /// once every transport key is in. The contract checks the shape and the
    /// proof of knowledge; whether each encrypted share matches the
    /// commitments only its recipient can tell, which is what complaints are
    /// for. Written once. Emits `DealingPublished`.
    pub fn publish_dealing(&mut self, poll_id: String, dealing: WireDealing) -> app::Result<()> {
        let (def, state) = self.poll(&poll_id)?;
        let caller = me()?;
        require_trustee_in_ceremony(&def, &state, &caller)?;
        let slot = (poll_id.clone(), caller.clone());
        if self.dealings.contains(&slot)? {
            return Err(phase("your dealing is already published"));
        }
        for t in &def.trustees {
            if !self
                .transport_keys
                .contains(&(poll_id.clone(), t.clone()))?
            {
                return Err(phase(&format!(
                    "trustee {t} has not published a transport key yet"
                )));
            }
        }
        let d = decode_dealing(&dealing).map_err(crypto_err)?;
        crypto::verify_dealing(&poll_id, &caller, def.threshold, def.trustees.len(), &d)
            .map_err(crypto_err)?;
        self.dealings.insert(&slot, &dealing)?;
        env::emit(
            Event::DealingPublished {
                poll_id,
                trustee: caller,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// A trustee proves `dealer` sent it a share that does not match the
    /// dealer's commitments. Refused unless the proof holds AND the share is
    /// really bad — so a complaint can never frame an honest dealer. One per
    /// (recipient, dealer). Emits `ComplaintFiled`.
    pub fn file_complaint(
        &mut self,
        poll_id: String,
        dealer: String,
        secret: String,
        proof: WireBranch,
    ) -> app::Result<()> {
        let (def, state) = self.poll(&poll_id)?;
        let caller = me()?;
        require_trustee_in_ceremony(&def, &state, &caller)?;
        let Some(wire) = self.dealings.get(&(poll_id.clone(), dealer.clone()))? else {
            return Err(invalid(&format!("{dealer} has not dealt")));
        };
        let Some(transport) = self
            .transport_keys
            .get(&(poll_id.clone(), caller.clone()))?
        else {
            return Err(phase("publish your transport key first"));
        };
        let slot = (poll_id.clone(), caller.clone(), dealer.clone());
        if self.complaints.contains(&slot)? {
            return Err(phase("you already filed a complaint against this dealer"));
        }
        let d = decode_dealing(&wire).map_err(crypto_err)?;
        let complaint = Complaint {
            poll_id: poll_id.clone(),
            dealer: dealer.clone(),
            secret,
            proof,
        };
        if !complaint_holds(&poll_id, &def, &caller, &complaint, &d, &transport.key) {
            return Err(crypto_msg("the complaint does not prove a bad share"));
        }
        self.complaints.insert(&slot, &complaint)?;
        env::emit(
            Event::ComplaintFiled {
                poll_id,
                recipient: caller,
                dealer,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Freeze the election key and open voting; returns the key. Only the
    /// creator (`Forbidden`), only once (`Phase`). The qualified set is every
    /// verified dealing with no valid complaint against it, and it must hold
    /// at least `t` dealers — otherwise fewer than `t` colluders could know
    /// the whole key. Emits `VotingOpened`.
    pub fn open_voting(&mut self, poll_id: String) -> app::Result<String> {
        let (def, state) = self.poll(&poll_id)?;
        require_creator(&def)?;
        if state.phase != Phase::KeyCeremony {
            return Err(phase("voting is already open"));
        }
        let ceremony = self.ceremony_of(&poll_id, &def)?;
        let mut transport = Vec::new();
        for t in &ceremony.trustees {
            let Some(k) = &t.transport else {
                return Err(phase(&format!(
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
            let valid = decode_dealing(dealing).is_ok_and(|d| {
                crypto::verify_dealing(&poll_id, &t.account, def.threshold, def.trustees.len(), &d)
                    .is_ok()
            });
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
            return Err(phase(&format!(
                "{} honest dealings; the threshold needs at least {}",
                qualified.len(),
                def.threshold
            )));
        }
        let decoded: Vec<crypto::Dealing> = qualified
            .iter()
            .map(|q| decode_dealing(&q.dealing))
            .collect::<Result<_, _>>()
            .map_err(crypto_err)?;
        let key = crypto::encode_point(&crypto::joint_key(&decoded.iter().collect::<Vec<_>>()));
        self.elections.insert(
            &poll_id,
            &Election {
                key: key.clone(),
                threshold: def.threshold,
                transport,
                qualified,
                disqualified,
                opened_at: env::time_now(),
            },
        )?;
        env::emit(Event::VotingOpened { poll_id }, Audience::All)?;
        Ok(key)
    }

    // ── voting ─────────────────────────────────────────────────────────────

    /// Submit a ballot the browser encrypted; returns its digest, the voter's
    /// receipt. Only while voting (`Phase`), only an eligible voter
    /// (`Forbidden`: on the roll, or any member when there is none), and only
    /// a ballot proven for the caller (`Crypto`). Voting again replaces the
    /// ballot. Emits `BallotCast`.
    pub fn cast_ballot(&mut self, poll_id: String, ballot: WireBallot) -> app::Result<String> {
        let (def, state) = self.poll(&poll_id)?;
        if state.phase != Phase::Voting {
            return Err(phase("this poll is not accepting ballots"));
        }
        let voter = me()?;
        if !may_vote(&def, &voter) {
            return Err(forbidden(if def.voters.is_empty() {
                "only members of the app's org can vote in this poll"
            } else {
                "you are not on this poll's voter roll"
            }));
        }
        let Some(election) = &state.election else {
            return Err(phase("voting has no election key"));
        };
        let pk = crypto::decode_point(&election.key, "election key").map_err(crypto_err)?;
        let decoded = decode_ballot(&ballot).map_err(crypto_err)?;
        crypto::verify_ballot(&pk, &poll_id, &voter, &rules(&def), &decoded).map_err(crypto_err)?;
        let digest = hex::encode(crypto::ballot_digest(&poll_id, &voter, &decoded));

        // The running sum: add this ballot, take out the one it replaces.
        let mut agg = match self.aggregates.get(&poll_id)? {
            Some(stored) => decode_cts(&stored)?,
            None => vec![crypto::Ciphertext::zero(); def.options.len()],
        };
        if let Some(old) = self.ballots.get(&(poll_id.clone(), voter.clone()))? {
            let Some(body) = self.ballot_bodies.get(&old.frozen)? else {
                return Err(invalid("your previous ballot is missing"));
            };
            let old = decode_ballot(&body.ballot).map_err(crypto_err)?;
            for (slot, choice) in agg.iter_mut().zip(&old.choices) {
                *slot = crypto::Ciphertext {
                    a: slot.a - choice.ct.a,
                    b: slot.b - choice.ct.b,
                };
            }
        }
        for (slot, choice) in agg.iter_mut().zip(&decoded.choices) {
            *slot = slot.add(&choice.ct);
        }
        self.aggregates.insert(&poll_id, &encode_cts(&agg))?;

        let (frozen, _) = self.ballot_bodies.insert(&StoredBallot {
            poll_id: poll_id.clone(),
            voter: voter.clone(),
            ballot,
        })?;
        self.ballots.insert(
            &(poll_id.clone(), voter.clone()),
            &BallotPointer {
                digest: digest.clone(),
                frozen,
                cast_at: env::time_now(),
            },
        )?;
        env::emit(Event::BallotCast { poll_id, voter }, Audience::All)?;
        Ok(digest)
    }

    /// Step one of closing: stop accepting ballots. Only the creator
    /// (`Forbidden`), only an open poll (`Phase`). Emits `PollClosing`.
    pub fn close_poll(&mut self, poll_id: String) -> app::Result<()> {
        let (def, state) = self.poll(&poll_id)?;
        require_creator(&def)?;
        if state.phase != Phase::Voting {
            return Err(phase("only an open poll can be closed"));
        }
        self.polls.insert(
            &poll_id,
            &PollControl {
                closing_at: Some(env::time_now()),
                anchor: state.anchor,
            },
        )?;
        env::emit(Event::PollClosing { poll_id }, Audience::All)?;
        Ok(())
    }

    /// Step two: freeze the ballots to count — every eligible voter's
    /// current ballot — and return how many. Only the creator (`Forbidden`),
    /// only a closing poll (`Phase`). Emits `PollSealed`.
    ///
    /// The proofs are not verified again here: `castBallot` verified each
    /// before storing it, nothing else stores one, and re-verifying every
    /// ballot in one call would not fit a call's fuel (see the README).
    pub fn seal_poll(&mut self, poll_id: String) -> app::Result<u32> {
        let (def, state) = self.poll(&poll_id)?;
        require_creator(&def)?;
        if state.phase != Phase::Closing {
            return Err(phase("close the poll before sealing the count"));
        }
        if state.election.is_none() {
            return Err(phase("closing has no election key"));
        }

        let mut counted = Vec::new();
        for (voter, pointer) in self.current_ballots(&poll_id)? {
            if !eligible(&def, &voter) {
                continue;
            }
            match self.authored_body(&pointer.frozen, &voter)? {
                Some(body) if body.poll_id == poll_id => {}
                _ => continue,
            }
            counted.push(CountedBallot {
                voter,
                digest: pointer.digest,
                frozen: pointer.frozen,
            });
        }
        let n = counted.len() as u32;
        for c in &counted {
            self.sealed.insert(&(poll_id.clone(), c.voter.clone()), c)?;
        }
        let aggregate = match self.aggregates.get(&poll_id)? {
            Some(stored) => stored,
            None => encode_cts(&vec![crypto::Ciphertext::zero(); def.options.len()]),
        };
        self.closures.insert(
            &poll_id,
            &StoredClosure {
                counted: n,
                aggregate,
                closed_at: env::time_now(),
            },
        )?;
        env::emit(
            Event::PollSealed {
                poll_id,
                counted: n,
            },
            Audience::All,
        )?;
        Ok(n)
    }

    // ── tally ──────────────────────────────────────────────────────────────

    /// The per-option aggregates a trustee decrypts. Recomputed from the
    /// sealed ballots every call. `Phase` before the seal.
    #[app::view]
    pub fn tally_inputs(&self, poll_id: String) -> app::Result<TallyInputs> {
        let (def, state) = self.poll(&poll_id)?;
        let Some(closure) = &state.closure else {
            return Err(phase("the count is not sealed yet"));
        };
        if closure.aggregate.len() != def.options.len() {
            return Err(invalid("the sealed aggregate is malformed"));
        }
        Ok(TallyInputs {
            aggregate: closure.aggregate.clone(),
            counted: closure.counted.len() as u32,
        })
    }

    /// A trustee publishes `Dⱼ = xⱼ·Aⱼ` for every option's aggregate, each
    /// with a DLEQ proof against its verification key `hⱼ`, which anyone can
    /// derive from the qualified commitments. Only after the seal (`Phase`),
    /// only a trustee (`Forbidden`), one proven partial per option
    /// (`Invalid` / `Crypto`). Publishing again replaces it. Emits
    /// `PartialPublished`.
    pub fn publish_partial(
        &mut self,
        poll_id: String,
        partials: Vec<WirePartial>,
    ) -> app::Result<()> {
        let (def, state) = self.poll(&poll_id)?;
        let caller = me()?;
        let Some(closure) = &state.closure else {
            return Err(phase("the count is not sealed yet"));
        };
        let Some(election) = &state.election else {
            return Err(phase("a sealed poll has no election key"));
        };
        let Some(index) = trustee_index(&def, &caller) else {
            return Err(forbidden("only a trustee can publish a partial decryption"));
        };
        if partials.len() != def.options.len() {
            return Err(invalid("one partial decryption per option"));
        }
        let vkey = verification_key(election, index)?;
        let aggregate = decode_cts(&closure.aggregate)?;
        for (j, (p, ct)) in partials.iter().zip(&aggregate).enumerate() {
            let d = crypto::decode_point(&p.d, "partial").map_err(crypto_err)?;
            let proof = branch(&p.proof, "partial proof").map_err(crypto_err)?;
            if !crypto::verify_partial(&poll_id, &caller, j as u32, &vkey, &ct.a, &d, &proof) {
                return Err(crypto_msg(&format!(
                    "partial decryption for option {j} does not verify"
                )));
            }
        }
        self.partials.insert(
            &(poll_id.clone(), caller.clone()),
            &StoredPartials { options: partials },
        )?;
        env::emit(
            Event::PartialPublished {
                poll_id,
                trustee: caller,
            },
            Audience::All,
        )?;
        Ok(())
    }

    /// Re-verify everything and, once `t` trustees have published, the counts.
    #[app::view]
    pub fn get_result(&self, poll_id: String) -> app::Result<AuditReport> {
        Ok(self.audit(&poll_id)?.0)
    }

    /// Every input of the tally plus this node's audit of it.
    #[app::view]
    pub fn get_transcript(&self, poll_id: String) -> app::Result<Transcript> {
        let (report, ballots, partials) = self.audit(&poll_id)?;
        let (def, state) = self.poll(&poll_id)?;
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

    /// Record where the transcript digest was published; returns the digest.
    /// Only the creator (`Forbidden`), only for a complete, verified result
    /// (`Phase`), with `network` 1..=64 and `reference` 1..=512 characters
    /// (`Invalid`). Emits `Anchored`.
    pub fn anchor_result(
        &mut self,
        poll_id: String,
        network: String,
        reference: String,
    ) -> app::Result<String> {
        let (def, state) = self.poll(&poll_id)?;
        require_creator(&def)?;
        let network = network.trim().to_owned();
        let reference = reference.trim().to_owned();
        if network.is_empty() || network.len() > 64 || reference.is_empty() || reference.len() > 512
        {
            return Err(invalid(
                "network is 1..=64 and reference 1..=512 characters",
            ));
        }
        let report = self.audit(&poll_id)?.0;
        let (true, Some(digest)) = (
            report.verified && report.counts.is_some(),
            report.transcript_digest,
        ) else {
            return Err(phase("only a complete, verified result can be anchored"));
        };
        self.polls.insert(
            &poll_id,
            &PollControl {
                closing_at: state.closing_at,
                anchor: Some(Anchor {
                    digest: digest.clone(),
                    network,
                    reference,
                    anchored_at: env::time_now(),
                }),
            },
        )?;
        env::emit(Event::Anchored { poll_id }, Audience::All)?;
        Ok(digest)
    }
}

/// A typed failure: `422 APP_ERROR` with `{ code, fields }` on the wire. v1's
/// `{ kind, data }` kinds, the data string as a named field.
#[app::error]
pub enum Error {
    /// No poll with this id.
    NotFound { poll_id: String },
    /// An argument broke a rule; `message` says which.
    Invalid { message: String },
    /// The caller may not do this (not the creator, not a trustee, not on
    /// the roll, a guest).
    Forbidden { message: String },
    /// Not in this phase (or already done).
    Phase { message: String },
    /// A proof or an encoding does not verify.
    Crypto { message: String },
}

/// A change to a poll, sent to everyone the app reaches. v1's events and
/// fields.
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

// ── helpers ─────────────────────────────────────────────────────────────────

fn invalid(message: &str) -> AppError {
    Error::Invalid {
        message: message.to_owned(),
    }
    .into()
}

fn forbidden(message: &str) -> AppError {
    Error::Forbidden {
        message: message.to_owned(),
    }
    .into()
}

fn phase(message: &str) -> AppError {
    Error::Phase {
        message: message.to_owned(),
    }
    .into()
}

fn crypto_msg(message: &str) -> AppError {
    Error::Crypto {
        message: message.to_owned(),
    }
    .into()
}

fn crypto_err(e: crypto::CryptoError) -> AppError {
    crypto_msg(&e.to_string())
}

/// The account the caller acts for (a signed-in account, or an API key acting
/// for one): what trustee lists, rolls and proofs name.
fn me() -> app::Result<String> {
    match env::caller() {
        Caller::Account(account) | Caller::ApiKey { account, .. } => Ok(account),
        Caller::Public | Caller::System | Caller::App(_) => Err(AppError::login_required()),
    }
}

/// A member (or more) of the app's org; with no org, any account.
fn is_member(account: &str) -> bool {
    match env::org() {
        Some(_) => env::org_role(account).is_some_and(|r| r >= OrgRole::Member),
        None => true,
    }
}

/// An account the app's org holds in any role (guests included); with no
/// org, any account.
fn in_org(account: &str) -> bool {
    env::org().is_none() || env::org_role(account).is_some()
}

/// Trimmed, de-duplicated account ids, each in the app's org. A 64-hex id
/// (a node's account id) is lowercased, as v1 did.
fn accounts(list: Vec<String>, what: &str, max: usize) -> app::Result<Vec<String>> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for a in list {
        let mut a = a.trim().to_owned();
        if a.len() == 64 && a.bytes().all(|b| b.is_ascii_hexdigit()) {
            a.make_ascii_lowercase();
        }
        if a.is_empty() || a.len() > MAX_ACCOUNT_LEN || !a.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(invalid(&format!("{what} must be account ids")));
        }
        if !in_org(&a) {
            return Err(invalid(&format!("{a} is not in this app's org")));
        }
        if seen.insert(a.clone()) {
            out.push(a);
        }
    }
    if out.len() > max {
        return Err(invalid(&format!("at most {max} {what}")));
    }
    Ok(out)
}

/// Every entry of `map` under `prefix`, following the cursor to the end.
fn read_all<K, V>(map: &UnorderedMap<K, V>, prefix: &[KeyPart]) -> app::Result<Vec<(K, V)>>
where
    K: ToKey + FromKey,
    V: Serialize + DeserializeOwned,
{
    let mut out = Vec::new();
    let mut opts = FindOpts::default().limit(PAGE);
    loop {
        let page = map.prefix(prefix, opts)?;
        out.extend(page.items);
        match page.next {
            Some(next) => opts = FindOpts::default().limit(PAGE).cursor(next),
            None => return Ok(out),
        }
    }
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
fn decode_ballot(w: &WireBallot) -> Result<crypto::Ballot, crypto::CryptoError> {
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

fn decode_dealing(w: &WireDealing) -> Result<crypto::Dealing, crypto::CryptoError> {
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

fn decode_cts(wire: &[WireCiphertext]) -> app::Result<Vec<crypto::Ciphertext>> {
    wire.iter()
        .map(|c| {
            Ok(crypto::Ciphertext {
                a: crypto::decode_point(&c.a, "aggregate")?,
                b: crypto::decode_point(&c.b, "aggregate")?,
            })
        })
        .collect::<Result<_, crypto::CryptoError>>()
        .map_err(crypto_err)
}

fn encode_cts(cts: &[crypto::Ciphertext]) -> Vec<WireCiphertext> {
    cts.iter()
        .map(|c| WireCiphertext {
            a: crypto::encode_point(&c.a),
            b: crypto::encode_point(&c.b),
        })
        .collect()
}

/// [`crypto::ballot_digest`] over the wire encoding, without decoding a point:
/// a stored ballot passed `castBallot`, so its encodings are canonical and
/// equal what re-encoding the decoded ballot would give. `None` for hex that
/// is not 32 bytes.
fn wire_digest(poll_id: &str, voter: &str, w: &WireBallot) -> Option<String> {
    let bytes = |h: &str| -> Option<[u8; 32]> { hex::decode(h).ok()?.try_into().ok() };
    let mut owned: Vec<[u8; 32]> = Vec::new();
    for choice in &w.choices {
        owned.push(bytes(&choice.a)?);
        owned.push(bytes(&choice.b)?);
        for br in &choice.proof {
            owned.push(bytes(&br.c)?);
            owned.push(bytes(&br.z)?);
        }
    }
    for br in &w.sum_proof {
        owned.push(bytes(&br.c)?);
        owned.push(bytes(&br.z)?);
    }
    let counts = [
        (w.choices.len() as u32).to_le_bytes(),
        (w.sum_proof.len() as u32).to_le_bytes(),
    ];
    let mut parts: Vec<&[u8]> = vec![poll_id.as_bytes(), voter.as_bytes(), &counts[0], &counts[1]];
    parts.extend(owned.iter().map(|b| b.as_slice()));
    Some(hex::encode(crypto::hash_to_digest("ballot", &parts)))
}

fn rules(def: &PollDefinition) -> crypto::Rules {
    crypto::Rules {
        options: def.options.len(),
        min: def.min_choices,
        max: def.max_choices,
    }
}

/// Whether a stored ballot by `account` counts under the poll's roll. With
/// no roll, `castBallot` already checked membership when the ballot was cast,
/// so a later change of role does not void it.
fn eligible(def: &PollDefinition, account: &str) -> bool {
    def.voters.is_empty() || def.voters.iter().any(|v| v == account)
}

/// Whether `account` may cast a ballot now: on the roll, or, with no roll,
/// a member (not a guest) of the app's org.
fn may_vote(def: &PollDefinition, account: &str) -> bool {
    if def.voters.is_empty() {
        is_member(account)
    } else {
        def.voters.iter().any(|v| v == account)
    }
}

fn trustee_index(def: &PollDefinition, account: &str) -> Option<u32> {
    def.trustees
        .iter()
        .position(|t| t == account)
        .map(|i| i as u32 + 1)
}

fn require_creator(def: &PollDefinition) -> app::Result<()> {
    if def.creator != me()? {
        return Err(forbidden("only the poll's creator can do this"));
    }
    Ok(())
}

fn require_trustee_in_ceremony(
    def: &PollDefinition,
    state: &PollState,
    caller: &str,
) -> app::Result<()> {
    if trustee_index(def, caller).is_none() {
        return Err(forbidden(
            "only a named trustee takes part in the key ceremony",
        ));
    }
    if state.phase != Phase::KeyCeremony {
        return Err(phase(
            "the key ceremony is over — the election key is frozen",
        ));
    }
    Ok(())
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

fn verification_key(election: &Election, index: u32) -> app::Result<crypto::Point> {
    let decoded: Vec<crypto::Dealing> = election
        .qualified
        .iter()
        .map(|q| decode_dealing(&q.dealing))
        .collect::<Result<_, _>>()
        .map_err(crypto_err)?;
    Ok(crypto::verification_key(
        &decoded.iter().collect::<Vec<_>>(),
        index,
    ))
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
fn transcript_text(
    poll_id: &str,
    def: &PollDefinition,
    election: &Election,
    counted: &[CountedBallot],
    counts: &[u32],
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

fn transcript_digest(text: &str) -> String {
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

/// What `audit` verified, besides the report: the transcript's ballots and
/// partials.
type Audited = (AuditReport, Vec<TranscriptBallot>, Vec<TranscriptPartial>);

// ── private ─────────────────────────────────────────────────────────────────

impl MeroVote {
    /// A poll as read: its definition, and its lifecycle derived from what its
    /// creator wrote. `None` for an unknown poll.
    ///
    /// The phase only moves forward: an election makes it Voting, the closing
    /// notice Closing, a seal Closed, and the election and seal are written
    /// once, so nothing can take a sealed poll back.
    fn try_load(&self, poll_id: &str) -> app::Result<Option<(PollDefinition, PollState)>> {
        Ok(self
            .load_with(poll_id, true)?
            .map(|(def, state, _)| (def, state)))
    }

    /// [`Self::try_load`], plus the number of sealed ballots; with
    /// `counted: false` the closure's `counted` list is left empty (not read).
    #[allow(clippy::type_complexity)]
    fn load_with(
        &self,
        poll_id: &str,
        counted: bool,
    ) -> app::Result<Option<(PollDefinition, PollState, Option<u32>)>> {
        let Some(control) = self.polls.get(&poll_id.to_owned())? else {
            return Ok(None);
        };
        let Some(def) = self.definitions.get(poll_id)? else {
            return Ok(None);
        };
        let election = self.elections.get(&poll_id.to_owned())?;
        let stored = match election {
            Some(_) => self.closures.get(&poll_id.to_owned())?,
            None => None,
        };
        let sealed = stored.as_ref().map(|c| c.counted);
        let closure = match stored {
            Some(c) => Some(Closure {
                counted: if counted {
                    read_all(&self.sealed, &[KeyPart::Str(poll_id.to_owned())])?
                        .into_iter()
                        .map(|(_, b)| b)
                        .collect()
                } else {
                    Vec::new()
                },
                aggregate: c.aggregate,
                closed_at: c.closed_at,
            }),
            None => None,
        };
        let phase = match (&election, &closure, control.closing_at) {
            (None, _, _) => Phase::KeyCeremony,
            (Some(_), Some(_), _) => Phase::Closed,
            (Some(_), None, Some(_)) => Phase::Closing,
            (Some(_), None, None) => Phase::Voting,
        };
        let state = PollState {
            phase,
            election,
            closing_at: control.closing_at,
            closure,
            anchor: control.anchor,
        };
        Ok(Some((def, state, sealed)))
    }

    fn poll(&self, poll_id: &str) -> app::Result<(PollDefinition, PollState)> {
        match self.try_load(poll_id)? {
            Some(loaded) => Ok(loaded),
            None => Err(Error::NotFound {
                poll_id: poll_id.to_owned(),
            }
            .into()),
        }
    }

    /// The ceremony from live entries, with every complaint adjudicated.
    fn ceremony_of(&self, poll_id: &str, def: &PollDefinition) -> app::Result<Ceremony> {
        let mut trustees = Vec::new();
        for (i, t) in def.trustees.iter().enumerate() {
            let slot = (poll_id.to_owned(), t.clone());
            trustees.push(CeremonyTrustee {
                account: t.clone(),
                index: i as u32 + 1,
                transport: self.transport_keys.get(&slot)?.map(|k| k.key),
                dealing: self.dealings.get(&slot)?,
            });
        }
        let mut complaints = Vec::new();
        for recipient in &trustees {
            for dealer in &trustees {
                let Some(filed) = self.complaints.get(&(
                    poll_id.to_owned(),
                    recipient.account.clone(),
                    dealer.account.clone(),
                ))?
                else {
                    continue;
                };
                let valid = match (&dealer.dealing, &recipient.transport) {
                    (Some(w), Some(key)) => decode_dealing(w).is_ok_and(|d| {
                        complaint_holds(poll_id, def, &recipient.account, &filed, &d, key)
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

    /// Every account's current ballot pointer for a poll, by account.
    fn current_ballots(&self, poll_id: &str) -> app::Result<BTreeMap<String, BallotPointer>> {
        Ok(
            read_all(&self.ballots, &[KeyPart::Str(poll_id.to_owned())])?
                .into_iter()
                .map(|((_, voter), p)| (voter, p))
                .collect(),
        )
    }

    /// `voter`'s body at `frozen`, if it is theirs.
    fn authored_body(&self, frozen: &str, voter: &str) -> app::Result<Option<StoredBallot>> {
        Ok(self.ballot_bodies.get(frozen)?.filter(|b| b.voter == voter))
    }

    /// The whole audit. Returns the report plus the transcript material it
    /// verified, so `getTranscript` hands out exactly what was checked.
    fn audit(&self, poll_id: &str) -> app::Result<Audited> {
        let (def, state) = self.poll(poll_id)?;
        let mut c = Checks { checks: Vec::new() };
        let mut ballots_out = Vec::new();
        let mut partials_out = Vec::new();

        let finish = |c: Checks,
                      counts: Option<Vec<u32>>,
                      digest: Option<String>,
                      decrypted_by: Vec<String>,
                      counted: u32,
                      uncounted: Vec<String>,
                      ballots,
                      partials|
         -> app::Result<Audited> {
            let verified = c.all_ok();
            Ok((
                AuditReport {
                    poll_id: poll_id.to_owned(),
                    phase: state.phase,
                    verified,
                    checks: c.checks,
                    counts: if verified { counts } else { None },
                    counted_ballots: counted,
                    decrypted_by: if verified { decrypted_by } else { Vec::new() },
                    transcript_digest: if verified { digest } else { None },
                    anchor: state.anchor.clone(),
                    uncounted,
                },
                ballots,
                partials,
            ))
        };

        let n_trustees = def.trustees.len();
        c.push(
            "written once",
            true,
            "the election and the seal are each one entry, written once by the creator",
        );
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
            return finish(
                c,
                None,
                None,
                Vec::new(),
                0,
                Vec::new(),
                ballots_out,
                partials_out,
            );
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
            // The dealer's own published dealing must be the frozen one.
            if self
                .dealings
                .get(&(poll_id.to_owned(), q.dealer.clone()))?
                .as_ref()
                != Some(&q.dealing)
            {
                dealings_ok = false;
            }
        }
        c.push(
            "dealings",
            dealings_ok,
            format!(
                "{} qualified dealings (threshold {}), each proven and published by its dealer",
                election.qualified.len(),
                def.threshold
            ),
        );

        // The frozen transport keys are the ones the trustees published:
        // complaints are adjudicated against them.
        let mut transport_ok = election.transport.len() == n_trustees;
        for (t, key) in def.trustees.iter().zip(&election.transport) {
            transport_ok &= self
                .transport_keys
                .get(&(poll_id.to_owned(), t.clone()))?
                .is_some_and(|k| &k.key == key);
        }
        c.push(
            "transport keys",
            transport_ok,
            "each frozen transport key was published by its trustee",
        );

        // Complaints, against the frozen dealings and transport keys: every
        // disqualified dealer must stand accused by a valid complaint, and no
        // qualified dealer may be.
        let mut complaints_ok = true;
        let mut valid_against: BTreeSet<String> = BTreeSet::new();
        for (ri, recipient) in def.trustees.iter().enumerate() {
            for dealer in &def.trustees {
                let Some(filed) = self.complaints.get(&(
                    poll_id.to_owned(),
                    recipient.clone(),
                    dealer.clone(),
                ))?
                else {
                    continue;
                };
                let frozen = match election.qualified.iter().find(|q| &q.dealer == dealer) {
                    Some(q) => Some(q.dealing.clone()),
                    None => self.dealings.get(&(poll_id.to_owned(), dealer.clone()))?,
                };
                let holds = match (frozen, election.transport.get(ri)) {
                    (Some(w), Some(key)) => decode_dealing(&w)
                        .is_ok_and(|d| complaint_holds(poll_id, &def, recipient, &filed, &d, key)),
                    _ => false,
                };
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
        if crypto::decode_point(&election.key, "election key").is_err() {
            return finish(
                c,
                None,
                None,
                Vec::new(),
                0,
                Vec::new(),
                ballots_out,
                partials_out,
            );
        }

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
            return finish(
                c,
                None,
                None,
                Vec::new(),
                0,
                Vec::new(),
                ballots_out,
                partials_out,
            );
        };
        let agg = match decode_cts(&closure.aggregate) {
            Ok(agg) if agg.len() == def.options.len() => agg,
            _ => {
                c.push("aggregate", false, "the sealed aggregate does not decode");
                return finish(
                    c,
                    None,
                    None,
                    Vec::new(),
                    0,
                    Vec::new(),
                    ballots_out,
                    partials_out,
                );
            }
        };
        let mut valid = 0usize;
        let mut unauthored = Vec::new();
        let mut voters_seen = BTreeSet::new();
        let current = self.current_ballots(poll_id)?;
        for cb in &closure.counted {
            let body = self.ballot_bodies.get(&cb.frozen)?;
            let ok = body.as_ref().is_some_and(|b| {
                b.voter == cb.voter
                    && b.poll_id == poll_id
                    && eligible(&def, &cb.voter)
                    && voters_seen.insert(cb.voter.clone())
                    && b.ballot.choices.len() == agg.len()
                    && wire_digest(poll_id, &cb.voter, &b.ballot).as_deref() == Some(&*cb.digest)
            });
            if ok {
                valid += 1;
            }
            if self.authored_body(&cb.frozen, &cb.voter)?.is_none() {
                unauthored.push(cb.voter.clone());
            }
            let endorsed = current
                .get(&cb.voter)
                .is_some_and(|p| p.digest == cb.digest);
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
                "{valid} of {n} counted ballots intact: each was proven (0-or-1 per option, count \
                 within bounds) when cast, and its receipt is re-checked here; 'Re-verify in \
                 this browser' re-checks every proof and the aggregate"
            ),
        );
        c.push(
            "ballot authorship",
            unauthored.is_empty(),
            if unauthored.is_empty() {
                format!("all {n} counted ballots were cast by their voters")
            } else {
                format!(
                    "{} counted ballots were not cast by the voter they name: {}",
                    unauthored.len(),
                    unauthored.join(", ")
                )
            },
        );
        let uncounted: Vec<String> = current
            .keys()
            .filter(|v| eligible(&def, v) && !closure.counted.iter().any(|b| &b.voter == *v))
            .cloned()
            .collect();

        // 3. Partial decryptions. `publishPartial` verified each against the
        //    trustee's verification key and the sealed aggregate before
        //    storing it, so here they are only decoded, and the `t`
        //    lowest-indexed are combined; re-verifying every proof on every
        //    read would not fit a view's fuel. 'Re-verify in this browser'
        //    re-checks every partial. One that does not decode is set aside.
        let need = def.threshold as usize;
        let mut good: Vec<(u32, String, Vec<crypto::Point>)> = Vec::new();
        let mut rejected = Vec::new();
        for (i, t) in def.trustees.iter().enumerate() {
            let index = i as u32 + 1;
            let Some(ps) = self.partials.get(&(poll_id.to_owned(), t.clone()))? else {
                continue;
            };
            partials_out.push(TranscriptPartial {
                trustee: t.clone(),
                index,
                options: ps.options.clone(),
            });
            if good.len() >= need {
                continue;
            }
            let ds: Option<Vec<crypto::Point>> = (ps.options.len() == agg.len())
                .then(|| {
                    ps.options
                        .iter()
                        .map(|p| crypto::decode_point(&p.d, "partial").ok())
                        .collect()
                })
                .flatten();
            match ds {
                Some(ds) => good.push((index, t.clone(), ds)),
                None => rejected.push(t.clone()),
            }
        }
        let t = need;
        c.push(
            "partial decryptions",
            true,
            format!(
                "{} of {} needed, each proven when published{}",
                partials_out.len(),
                t,
                if rejected.is_empty() {
                    String::new()
                } else {
                    format!("; set aside as malformed: {}", rejected.join(", "))
                }
            ),
        );

        let mut counts = None;
        let mut digest = None;
        let mut decrypted_by = Vec::new();
        if good.len() >= t && c.all_ok() {
            // The `t` lowest indices, so every verifier combines the same set.
            let used = &good[..t];
            let ps: Vec<(u32, Vec<crypto::Point>)> =
                used.iter().map(|(i, _, ds)| (*i, ds.clone())).collect();
            let opened: Option<Vec<u32>> = crypto::open_counts(&agg, &ps, n as u64)
                .and_then(|cs| cs.into_iter().map(|v| u32::try_from(v).ok()).collect());
            let sum_ok = opened.as_ref().is_some_and(|cs| {
                let total: u64 = cs.iter().map(|&v| u64::from(v)).sum();
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
            uncounted,
            ballots_out,
            partials_out,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
