# Mero Vote

**Private polls with verifiable tallies.** A context is a voting group. Ballots are encrypted in
the voter's browser, proven well-formed in zero knowledge, and tallied by every member from the
same frozen ballot box. No node sees a vote, including the voter's own, and nobody has to trust
the count.

> A vote nobody can audit is a survey. A vote the host can see is not secret.

Comparable products: Slido (live polls, where the host sees everything) and Snapshot (auditable,
but every vote is public). Mero Vote aims for both properties at once: secret like a ballot box and
auditable like Snapshot, with no server.

## Is Calimero enough, or do we need ZK?

**We need cryptography in the app for secrecy. We do not need SNARKs.**

| Property | Where it comes from |
| --- | --- |
| **Authenticity: one account, one ballot** | Calimero. Ballots, key shares and decryption shares live in the author's `UserStorage` slot, and polls in an `AuthoredMap`. Both are signed by the author and checked **at merge**, so a modified node cannot write into someone else's slot. The contract has no signature code of its own. |
| **Immutability: no editing after the close** | Calimero. Ballot bodies and poll definitions are content-addressed in `FrozenStorage`. The poll id *is* the hash of its definition. |
| **Reproducible tally** | Calimero. Every member holds the whole ballot box and runs the same contract over it. `get_result` recomputes everything on the reader's own node every time. |
| **Secrecy from other members** | **Not Calimero.** Replicated state goes to every member's node. A plaintext ballot in a context can be read by every member and every node operator. |
| **Secrecy from your own node / a host** | **Not Calimero.** The contract runs on a node, and the node may be someone else's machine. So encryption has to happen in the browser. |
| **Ballots are well-formed without being readable** | **Zero-knowledge proofs.** Without them, one voter could encrypt "1000 votes for A" and no one could tell. |

The cryptography is the Helios design, on ristretto255:

- **Exponential ElGamal.** A ballot is one ciphertext per option, each encrypting 0 or 1.
  Ciphertexts add up, so only the per-option *totals* are ever decrypted. Individual ballots never are.
- **Threshold key (t-of-n).** The trustees run a Pedersen distributed key generation with
  Feldman commitments. Each trustee deals shares of a random polynomial to the others, encrypted
  to their transport keys, and proves knowledge of its constant term (which blocks the rogue-key
  attack). A trustee sent a bad share files a public complaint that anyone can check, and the
  cheater is left out. Any `t` trustees can decrypt the totals, fewer than `t` learn nothing, and
  no one ever holds the whole key.
- **Disjunctive Chaum–Pedersen proofs (CDS94).** Each option is proven to be 0 or 1, and the number
  chosen is proven to be within `[min, max]`.
- **Chaum–Pedersen DLEQ proofs.** Each trustee's partial decryption is proven against a
  verification key that anyone can derive from the commitments. Complaints are proven the same way.
- **Fiat–Shamir.** Every challenge binds the poll id, the author's account and the election key.
  This means a ballot cannot be replayed into another poll or re-cast under another voter's name.

These are sigma protocols. They need no trusted setup and no circuit, and verifying a ballot costs
a few scalar multiplications per option, which the contract's WASM does comfortably.

**When SNARKs would be warranted.** We would need them to hide *who* voted (Semaphore-style
anonymous membership), to get receipt-freeness against coercion (MACI, which needs a coordinator),
or to replace thousands of per-ballot proofs with one succinct proof for very large electorates.
None of those is needed for "secret ballot, public turnout, auditable count" in a group of people.

### What is and isn't hidden

| | sees |
| --- | --- |
| every member | who voted, encrypted ballots, all proofs, the final counts |
| a node operator | the same, and nothing more |
| fewer than `t` trustees | nothing more |
| `t` or more trustees colluding off-protocol | individual ballots |

Out of scope: anonymity of *who* voted (turnout is public), and coercion resistance. A voter can
prove how they voted by revealing their encryption randomness. Voting again replaces a ballot,
which helps a little against coercion.

## Lifecycle

1. **Key ceremony.** The creator names `n` trustees and a threshold `t` (the default is a
   majority), plus an optional voter roll. Each trustee's browser then:
   1. publishes a **transport key**;
   2. once all transport keys are in, **deals**: a fresh random polynomial of degree `t−1`, its
      public commitments, and one share encrypted to each trustee;
   3. **checks the shares it received** against the commitments, and files a **complaint** if one
      is bad.

   The creator **opens voting** once at least `t` honest dealings are in. The election key is the
   sum of those dealers' constant terms, and it is frozen together with the dealings. The only
   secret a trustee's browser keeps is its transport key (with a downloadable backup). Its combined
   decryption key is re-derived from the frozen dealings when it's needed.
2. **Voting.** The browser encrypts, proves and submits. The contract verifies before storing and
   returns the ballot digest, which is the voter's **receipt**. Voting again replaces the ballot.
3. **Close.** The creator closes the poll. Each node refuses new ballots once it sees the close,
   but ballots cast before that keep syncing in.
4. **Seal.** The creator freezes the set of ballots to count, each one re-verified. A voter checks
   that their receipt is in the set.
5. **Tally.** Any `t` trustees publish partial decryptions of the per-option aggregates. The
   counts come from Lagrange-combining the `t` lowest-indexed proven partials, so every verifier
   combines the same set. Late or extra partials don't change the result.
6. **Audit.** `get_result` re-checks everything on your node: dealings (proven, and endorsed by
   each dealer's signed slot), complaints (every disqualification backed by a proven one), the key, every
   ballot proof and digest, voter endorsement (the voter's signed slot still points at the counted
   ballot), every partial, and the decryption. **Re-verify in this browser** runs a second,
   independent TypeScript implementation over `get_transcript` and compares its counts and digest
   with the node's.
7. **Public anchor (optional).** The canonical transcript has a SHA-256 digest. Publish it
   somewhere outside the context (a transaction memo, a signed git tag, a post), then record where
   with `anchor_result`. The contract only accepts the digest it computes itself, and every later
   audit re-checks it. The digest covers the key, dealings, ballots and counts, but not the
   partials. That way a trustee who decrypts after the anchor was recorded can't move it.

## Layout

```
logic/
  crates/crypto/        the protocol: Rust, no randomness inside, deterministic provers
    vectors.json        cross-implementation test vectors (written by tests/vectors.rs)
  src/lib.rs            the contract: polls, slots, frozen ballots, verify-on-read audit
  src/tests.rs          three-account lifecycle through TestHost (full crypto happy path)
  tests/converge.rs     concurrent slot / poll writes converge
  workflows/            merobox: two-node replication + every refusal on a real node
app/
  src/crypto/protocol.ts   the same protocol in TypeScript (@noble/curves ristretto255)
  src/crypto/verify.ts     independent transcript re-audit
  src/crypto/*.test.ts     byte-for-byte agreement with vectors.json; tamper cases
  e2e/mero-vote.spec.ts    the whole flow against a real merod
```

**Two implementations, pinned together.** The browser proves and the contract verifies, so they
must agree byte for byte. `vectors.json` is generated from fixed seeds by the Rust test. The
TypeScript test replays the same seeds and must produce identical ciphertexts, proofs, digests,
partials and counts. The transcript digest is pinned the same way (`transcript_digest_is_pinned`
in Rust, and the matching test in `verify.test.ts`).

## Working on it

```bash
cargo test -p mero-vote-crypto -p mero-vote
UPDATE_VECTORS=1 cargo test -p mero-vote-crypto --test vectors   # after an intentional protocol change

cargo mero bundle --manifest-path apps/mero-vote/logic/Cargo.toml --dev --app-version 0.0.0 \
  --output apps/mero-vote/logic/dist/com.calimero.mero-vote.mpk
pnpm -F mero-vote codegen
pnpm -F mero-vote test
MEROD_BINARY=… pnpm -F mero-vote test:e2e
```

## Known limits

- **Setup needs every trustee's transport key.** Dealing can't start until all `n` are in. After
  that, only `t` dealings are needed to open voting, and only `t` trustees to count.
- **Closing is still the creator's view.** Close → seal narrows the window: ballots that were
  already cast arrive before the seal. But a ballot still in flight when the creator seals isn't
  counted. The voter can see this, because their receipt is missing from the counted set.
- **Ballot stuffing by the creator is detectable, not preventable.** A creator can put a
  self-made ballot for another account into the seal. The audit flags it, because that account's
  signed slot doesn't endorse it, and the victim sees a receipt they never cast. Preventing it
  outright would need voters to sign ballots with a key the creator can't reach. Calimero's
  signed slots already play that role for everything except the seal itself.
- **Deadlines are informational.** Node clocks are not a consensus source.
- **Coercion resistance is out of scope.** A voter can prove how they voted by revealing their
  encryption randomness.
