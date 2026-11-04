# Mero Vote

**Private polls with verifiable tallies.** A voting group is one app instance in an organization.
Ballots are encrypted in the voter's browser, proven well-formed in zero knowledge, and tallied
from the same sealed ballot box. No node sees a vote, including the voter's own, and nobody has to
trust the count: any member's browser re-verifies it.

> A vote nobody can audit is a survey. A vote the host can see is not secret.

Comparable products: Slido (live polls, where the host sees everything) and Snapshot (auditable,
but every vote is public). Mero Vote aims for both properties at once: secret like a ballot box and
auditable like Snapshot, with no trusted server.

Runs on Calimero 1.0: the contract is a `calimero:app` component on core's component SDK
(`calimero-sdk`, wasmtime), developed against `merod local`, and the frontend talks to
Calimero Cloud in production through mero-js's `CalimeroClient` (see
[docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md)). The native iOS and Android apps in
`mobile/` move to the same contract in their own PR (#697), which follows this port; see
[mobile/README.md](mobile/README.md).

## Is Calimero enough, or do we need ZK?

**We need cryptography in the app for secrecy. We do not need SNARKs.**

| Property | Where it comes from |
| --- | --- |
| **Authenticity: one account, one ballot** | Calimero. Every write is a method call by a signed-in account (`env::caller()`), applied by the cluster's leader in one log. Ballots, transport keys, dealings, complaints and partial decryptions are stored under the caller's own account by the method that checks them; the election and the seal only by the poll's creator. Nothing else writes the state, so nobody can write as someone else. Every proof also binds the account it was made for. |
| **Immutability: no editing after the close** | Calimero, by method checks. Poll definitions are content-addressed (`Frozen`: the poll id *is* the hash of its definition), and the election, the seal, each transport key, dealing and complaint are written once (a second write is refused with `Phase`). The phase only moves forward, so a sealed poll can never go back to voting. |
| **Reproducible tally** | The contract recomputes the audit on every `getResult`, and any member's browser re-verifies every proof from `getTranscript` with an independent TypeScript implementation and compares the counts and digest. |
| **Secrecy from other members** | **Not Calimero.** Every member can read the app's state. A plaintext ballot could be read by every member and every node operator. |
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
2. **Voting.** The browser encrypts, proves and submits. The contract verifies the proofs before
   storing the ballot and returns its digest, which is the voter's **receipt**. Voting again
   replaces the ballot. The contract keeps a running per-option sum of the current ballots.
3. **Close.** The creator closes the poll; new ballots are refused from then on.
4. **Seal.** The creator freezes the set of ballots to count, with the per-option sums. A voter
   checks that their receipt is in the set.
5. **Tally.** Any `t` trustees publish partial decryptions of the per-option sums; the contract
   verifies each against the trustee's verification key before storing it. The counts come from
   Lagrange-combining the `t` lowest-indexed partials, so every verifier combines the same set.
   Late or extra partials don't change the result.
6. **Audit.** `getResult` re-checks the election (each qualified dealing proven and the one its
   dealer published, every disqualification backed by a proven complaint, the key), every counted
   ballot (its voter, eligibility, and its receipt recomputed from its bytes), and the decryption.
   It does **not** re-run every ballot and partial proof: each was verified when it was submitted,
   and re-running them all in one view would not fit its fuel (see [Limits](#limits)).
   **Re-verify in this browser** runs a second, independent TypeScript implementation over
   `getTranscript` — every proof, the per-option sums recomputed from the ballots, every partial —
   and compares its counts and digest with the contract's.
7. **Public anchor (optional).** The canonical transcript has a SHA-256 digest. Publish it
   somewhere outside the group (a transaction memo, a signed git tag, a post), then record where
   with `anchorResult`. The contract only accepts the digest it computes itself, and every later
   audit re-checks it. The digest covers the key, dealings, ballots and counts, but not the
   partials. That way a trustee who decrypts after the anchor was recorded can't move it.

## Who may do what

The organization decides who reaches the app: its owner, admins, members and guests. Anonymous
callers get `401`, accounts outside the org `404`, before the contract runs.

| | who | refused with |
| --- | --- | --- |
| read anything, audit, `setName` | anyone the app reaches, guests included | — |
| `createPoll` | members, admins, the owner (not guests) | `Forbidden` |
| trustees and voter-roll entries | accounts the app's org holds (any role, guests included) | `Invalid` |
| `castBallot` | on the roll; with no roll, members and up (a guest only when named on a roll) | `Forbidden` |
| `publishTransportKey`, `publishDealing`, `fileComplaint` | a named trustee, during the key ceremony, once each | `Forbidden`, `Phase` |
| `publishPartial` | a named trustee, after the seal | `Forbidden`, `Phase` |
| `openVoting`, `closePoll`, `sealPoll`, `anchorResult` | the poll's creator, in phase | `Forbidden`, `Phase` |

Events go to everyone the app reaches (guests too); they carry ids only, never a vote.

## Layout

```
logic/                  a standalone component crate (its own [workspace] and Cargo.lock)
  crates/crypto/        the protocol: Rust, no randomness inside, deterministic provers
    vectors.json        cross-implementation test vectors (written by tests/vectors.rs)
  src/lib.rs            the contract: polls, ceremony, ballots, seal, verify-on-read audit
  tests/harness.rs      whole polls on core's wasmtime engine (TestApp), proofs built by the crypto crate
  tests/scenarios.rs    every scenarios/*.json in the harness
  scenarios/            neutral steps, also run on merod local by CI's e2e job
  res/abi.json          the component's ABI (committed, diffed in CI)
app/
  src/meroVote.ts          the typed client: v1's method surface and answer shapes over CalimeroClient
  src/session.ts           target (merod local / Cloud) → client → passkey session
  src/groups.ts            voting groups (app instances in their own org), invite links
  src/crypto/protocol.ts   the same protocol in TypeScript (@noble/curves ristretto255)
  src/crypto/verify.ts     independent transcript re-audit
  src/crypto/*.test.ts     byte-for-byte agreement with vectors.json; tamper cases
  src/theme.ts             light/dark, kept under mero-vote:theme (index.html applies it pre-paint)
  src/signOut.ts           Log out: forget the open group, then end the session
mobile/                 native iOS and Android apps (ported to this contract in #697)
```

Light is the default; the sun/moon button in the top bar switches to dark. **Log out** is always
in the top bar, and again in the session menu. It keeps the theme choice and a trustee's transport
key (`utils/trusteeKeys.ts`), which a poll's count may still need.

**Two implementations, pinned together.** The browser proves and the contract verifies, so they
must agree byte for byte. `vectors.json` is generated from fixed seeds by the Rust test. The
TypeScript test replays the same seeds and must produce identical ciphertexts, proofs, digests,
partials and counts. The transcript digest is pinned the same way (`transcript_digest_is_pinned`
in Rust, and the matching test in `verify.test.ts`).

## Run it

```bash
pnpm install
pnpm dev:local mero-vote     # merod local + build + deploy + the Vite dev server on :5173
```

Sign up in the browser with a passkey, **Create voting group**, join the roster with a name, and
create a poll. A second browser profile (another passkey account) joins through the group's invite
link. Every step of a poll needs a browser per account (trustees, voters), since the browser builds
every proof.

## Test it

```bash
M=tools/component-bundle/Cargo.toml
cargo test --manifest-path apps/mero-vote/logic/Cargo.toml          # crypto + vectors, harness, scenarios
UPDATE_VECTORS=1 cargo test --manifest-path apps/mero-vote/logic/Cargo.toml -p mero-vote-crypto --test vectors
cargo run --release --manifest-path $M -- build apps/mero-vote/logic # res/mero_vote.wasm + res/abi.json
pnpm -F mero-vote lint && pnpm -F mero-vote typecheck && pnpm -F mero-vote test && pnpm -F mero-vote build
pnpm merod-local e2e mero-vote                                       # the scenarios on merod local
```

`tests/harness.rs` runs whole polls on core's real engine as named accounts: a 2-of-3 poll with a
trustee missing and an anchor, a cheating dealer disqualified by a proven complaint, every ceremony
refusal, definition rules, the roster, the guest rules, everything v1 kept in storage write rules
as the same call by someone the method refuses, and the largest poll `createPoll` allows run step
by step within a call's fuel. The JSON scenarios stop short of a valid proof: every proof binds the
caller's account id, which on a cluster is only known at run time, so a scenario cannot carry one
(v1's two-node Docker workflow had the same limit). They cover the lifecycle's refusals, the roster and the
access rules, on the harness and on `merod local`.

## What changed in the port, and why

The same methods, arguments, answers and events, with these differences a client sees:

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method names | `set_name`, `create_poll`, `list_polls`, `get_poll`, `publish_transport_key`, `publish_dealing`, `file_complaint`, `open_voting`, `cast_ballot`, `close_poll`, `seal_poll`, `tally_inputs`, `publish_partial`, `get_result`, `get_transcript`, `anchor_result` | `setName`, `createPoll`, `listPolls`, `getPoll`, `publishTransportKey`, `publishDealing`, `fileComplaint`, `openVoting`, `castBallot`, `closePoll`, `sealPoll`, `tallyInputs`, `publishPartial`, `getResult`, `getTranscript`, `anchorResult` (`whoami`, `roster`, `ceremony` unchanged) | the ABI names methods and arguments in camelCase |
| argument names | `poll_id`, `min_choices`, `max_choices`, `closes_at` | `pollId`, `minChoices`, `maxChoices`, `closesAt`; v1 names are `BadArgs` | the same |
| answers | snake_case fields | still snake_case fields (`poll_id`, `my_digest`, `sum_proof` in a ballot, …) | kept, so the screens and the TS verifier read them unchanged |
| 64-bit integers | numbers (`created_at`, `closes_at`, `opened_at`, `closed_at`, `closing_at`, `anchored_at`, `cast_at`) | decimal strings, in answers and in `closesAt` | `u64` travels as a decimal string (D20); `src/meroVote.ts` converts them back |
| `counts` | `u64` numbers | `u32` numbers (each is at most the ballots counted) | a JSON number that is exact |
| event fields | `poll_id` | `pollId` (others unchanged) | event fields are camelCase |
| errors | `{"kind":"Phase","data":"…"}` | `422 APP_ERROR` `{ code: "Phase", fields: { message: "…" } }`; `NotFound { pollId }` | `#[app::error]`'s wire shape |
| poll ids | SHA-256 of the borsh definition | SHA-256 of the CBOR definition (still 64 hex) | `Frozen` addresses the stored bytes |
| account ids | 64-hex ids, lowercased; any string was accepted as a trustee | any account id (64-hex lowercased), and it must be in the app's org | catches a typo before a ceremony can never finish |
| who may create a poll or vote | any member of the context | see [Who may do what](#who-may-do-what): guests read, are named, and vote only on a roll | the org's roles |
| a second complaint by the same trustee against the same dealer | stored | `Phase` | one valid complaint already disqualifies |
| an identical poll created twice in the same millisecond | overwrote the first's control entry | `Invalid` | same definition, same id |
| ballot size | up to 16 options, any bounds | `2·options + maxChoices − minChoices + 1` at most 38 | a ballot is verified in one call, ~4.75M fuel per proof branch, 200M per call |
| closing | nodes refused new ballots once they saw the close; ballots in flight could still sync in, so `uncounted` could list voters | the close refuses every later ballot, and the seal counts every ballot cast before it; `uncounted` is empty | one leader orders every write |
| the seal | re-verified every ballot | takes every eligible current ballot (each verified when cast), and freezes the per-option sums (`closure.aggregate`, new); the counted ballots are stored one row per voter and `closure.counted` is read from them | re-verifying every ballot in one call would not fit its fuel; a list that grows with the electorate is never one stored value |
| `getResult` | re-verified every ballot and partial proof | re-checks the ceremony, every receipt, authorship and the decryption, not each proof again; the browser's re-verification still checks every proof | a view's fuel |
| `written once`, `ballot authorship` checks | could fail (two elections, a ballot body another account filed) | always hold | only the methods write, once |
| v1's per-owner storage keys | `get_by` reads, forged entries ignored | gone | no node writes outside a method |
| transport | JSON-RPC `execute` on your own node, a context id | `POST /apps/{app}/intents` and `/views` on any node of the cluster, an app id | one app per replicated log |

v1's convergence tests (`tests/converge.rs`) and its two-node Docker workflow
(`logic/workflows/poll-lifecycle.yml`) are gone: under one log there is nothing to converge, and
the workflow is `scenarios/poll-lifecycle.json` (plus `scenarios/access.json`).

The frontend changed with it: mero-react's provider and node login, the context and namespace
picker, namespace invitations, the desktop SSO hand-off, the namespace-wide member names, the
generated `MeroVoteClient` and the Playwright suites against merod 0.x are gone. It now resolves its
target from the build (`@calimero-apps/connect`: `merod local` under `vite`, a Cloud cluster under
`vite build`), signs in with a **passkey**, lists and creates **voting groups** (app instances in
an organization of their own: v1's context in a namespace), invites with an **org invite link**
(making it is approved with your passkey; opening it, then signing in, redeems it), and calls the
contract through `src/meroVote.ts`, which keeps v1's generated client's method surface and answer
shapes so the screens did not change; a test checks its methods and parameter names against
`logic/res/abi.json`.

## Limits

- **Fuel.** A call or view runs within 200M fuel. Verifying a ballot costs ~4.75M per proof
  branch, hence the ballot-size rule above. The largest poll `createPoll` allows (8 trustees, all
  8 needed, 16 options) runs every step within that (pinned by a test); `getResult` costs ~0.4M
  per counted ballot beyond that, so such a poll audits a few hundred ballots, a small one more.
  `getTranscript` returns every ballot.
- **Setup needs every trustee's transport key.** Dealing can't start until all `n` are in. After
  that, only `t` dealings are needed to open voting, and only `t` trustees to count.
- **A creator can open voting without an honest trustee's dealing**; the key still needs `t`
  proven dealings.
- **Deadlines are informational.** Closing is an explicit act of the creator.
- **Coercion resistance is out of scope.** A voter can prove how they voted by revealing their
  encryption randomness.

## Production

`vite build` connects to a Calimero Cloud cluster by name, and refuses to start without
`VITE_CALIMERO_CLUSTER` and `VITE_CALIMERO_MIN_RELEASE` set where the bundle's frontend is built
(`app/.env.example`). The production frontend is the one packed into the `.mpk` (`frontend-dir`),
served by the cluster from the package's own origin, and instances are created from the package
(`com.calimero.mero-vote`). The `frontend` link in `logic/Cargo.toml` and the Vercel project
(`app/vercel.json`) stay as the listing's link.

```bash
pnpm -F mero-vote build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/mero-vote/logic --key <production key> --app-version <x.y.z>
```
