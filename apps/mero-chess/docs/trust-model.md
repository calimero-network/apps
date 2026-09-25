# Writing a contract for a network that will not run it

Every defect in this document was real, in this app, and is fixed in it. They are
written up because they are not chess problems — they are the problems you get
when you write a Calimero contract the way you would write a server, and they
will look different enough in your app that you may not recognise them.

If you read one paragraph, read the next one.

---

## The thing that surprises everyone

**A peer's node does not execute your contract when it receives a delta.**

It verifies the author's signature, authorizes them at their causal cut,
decrypts, and folds the actions into storage. That is all. Nothing re-runs
`play()`. Nothing re-checks the `if` you wrote above the write.

So this:

```rust
pub fn play(&mut self, uci: String, now: u64) -> app::Result<()> {
    if !self.legal_moves().contains(&uci) {
        app::bail!("illegal move");         // ← binds ONE node: the one running this
    }
    self.moves.insert(key, record)?;        // ← these bytes are what ships
    Ok(())
}
```

is not a rule. It is a rule *for the node that ran it*. A patched node skips the
function entirely and emits the same storage action with different bytes in it.
The delta is signed by a real member and is perfectly well-formed; there is no
layer that will notice it never came from your code.

Two consequences, and everything else in this document follows from them:

1. **You cannot prevent a write.** Membership is the default write boundary. If
   a peer may write to the context at all, they may write anything into any
   entity that is not specifically guarded.
2. **You can decide what a write MEANS.** Every honest node reads the same
   storage through the same contract. If reading is derivation rather than
   lookup, a forged row is inert: it sits in storage, it is in the root hash,
   and no honest reader folds it into anything.

That is the model. **Quarantine at interpretation, not prevention at write.**

---

## The storage tiers, and what each actually enforces

The guarded tiers are enforced *at apply*, by core, on every node — which is
exactly why they are the only writes a byzantine peer cannot forge. Pick from
this table before you write a state struct, not after.

| Tier | Type | Enforced at apply by | Use it for |
|---|---|---|---|
| **Public** (default) | `UnorderedMap`, `Vector`, `LwwRegister`, `UnorderedSet`, … | *nothing* — `StorageType::Public` falls straight through to the upsert | data where every member is equally entitled to the value, and where a wrong value is a nuisance rather than a lie |
| **Authored** | `AuthoredMap<K, V>`, `AuthoredVector<T>` | a per-action Ed25519 signature checked against the entry's `StorageType::User { owner }` stamp, plus a monotonic nonce for replay | "this is a claim by one person about themselves" — a move, a vote, a bid, a signature, a message |
| **Shared** | `SharedStorage<T>` | the entry's writer set, carried by its anchor; rotation is signed by a current writer | a domain a fixed group may write — a shared document, a team's records |
| **Permissioned** | `PermissionedStorage<T>` + `AccessControl` | per-member `OpMask` (`WRITE`, `DELETE`, …) projected onto the capability map and checked at merge | role-based apps: editors, moderators, admins |
| **Frozen** | `FrozenStorage<T>` | content addressing — the entry's id must be the hash of its bytes; `Update` and `Delete` are refused outright | append-only immutable records: attachments, receipts, anything hash-identified |

Three things about this table that cost time to learn:

**`Public` is not "readable by everyone".** Everything in a context is readable
by its members. `Public` means *writable* by every member, unchecked. It is the
default, which is the trap: a state struct written without thinking about this
is a state struct where every field is forgeable.

**The `AuthoredMap` API guards are local; the merge guard is not.**
`AuthoredMap::insert` refusing an occupied key, and `update`/`remove` refusing a
non-owner, run inside your contract on the writing node — a patched node simply
does not call them. What a patched node cannot do is produce a valid signature
for an account it does not hold a key for. So the owner stamp is the real
boundary, and your reader has to actually check it (`owner_of`) rather than
assume the collection did.

**The owner is an *account*, not a device key.** Someone on their laptop can
update what they wrote from their phone. Device identity lives on
`env::device_id` and is what CRDT mechanics use for tiebreaks; do not conflate
the two.

### Why chess is `AuthoredMap` everywhere

Every row in this contract is one player's claim about themselves: *I took this
seat*, *I played this move*, *I resigned*, *I offered a draw*. There is no
shared object two people co-edit, and there are no roles. That is the shape
`AuthoredMap` is for, and the shape it is not for is just as clear: a collaborative
document is `SharedStorage`, a forum with moderators is `PermissionedStorage`.

```rust
#[app::state(emits = Event)]
pub struct MeroChess {
    // Captions. The only two unauthored writes here — see "What is
    // deliberately NOT fixed".
    title: LwwRegister<String>,
    created_at: LwwRegister<u64>,
    players: AuthoredMap<MemberId, Player>,
    seat_claims: AuthoredMap<String, Seat>,
    games: AuthoredMap<String, GameRecord>,
    moves: AuthoredMap<String, MoveRecord>,
    endings: AuthoredMap<String, Ending>,
    draw_offers: AuthoredMap<String, DrawOffer>,
}
```

---

## The findings

Each one is: what the code looked like, what it buys an attacker, why it got
written that way, what replaced it, and where it is pinned so it cannot come
back.

### 1. Every collection was a plain one

**Was:** `UnorderedMap` throughout. The contract checked `caller_id()` before
every write and considered the matter closed.

**Exploit:** anything. A spectator writes White's next move. A losing player
writes the winner's resignation. A member overwrites the seat list. None of it
needs a forged signature, because `Public` entries carry no authorship to forge
— the delta is signed by a genuine member and every field inside it is free.

**Why it happened:** `caller_id()` is right there, and it is genuinely the
caller. It is easy to read the check as "only Alice can write Alice's row" when
what it says is "only Alice can write Alice's row *through this function*".

**Now:** every map is an `AuthoredMap`, and the reader re-checks the stamp:

```rust
fn valid_rows<V>(map: &AuthoredMap<String, V>, prefix: &str) -> app::Result<Vec<(String, V)>> {
    let mut rows = Vec::new();
    for (key, value) in map.entries()? {
        if !key.starts_with(prefix) { continue; }
        // The key NAMES an author; core's owner stamp has to AGREE with it.
        let Some(author) = key_author(&key).map(ToOwned::to_owned) else { continue };
        if !Self::owned_by(Self::owner_of(map, &key)?, &author) { continue; }
        rows.push((key, value));
    }
    Ok(rows)
}
```

The key names an author and the stamp confirms it. Either half alone is useless:
a key is a string anyone can choose, and a stamp without a key to check it
against tells you who wrote a row but not whose row it was meant to be.

**Pinned by:** `a_move_row_written_by_anyone_but_the_player_to_move_is_inert`,
`a_seat_claim_filed_on_someone_elses_behalf_moves_no_chair`.

### 2. Ordering was read from a stored field

**Was:** `MoveRecord` carried `ply: u32`. `moves_of()` collected the rows and
sorted them by that field.

**Exploit:** write a row at any key naming itself ply 6 and it is applied sixth.
Gaps compacted silently, so a move list of plies 0, 1, 9 replayed as three
consecutive moves. Sorting by a stored field hands the ordering of the game to
whoever wrote the rows.

**Now:** the sequence is the reader's arithmetic. Ply 0, then ply 1, then ply 2,
each looked up under its own key prefix, stopping at the first ply nobody
validly wrote — and a row counts at ply *p* only if its key names the player
whose turn *p* is (White on the even plies, Black on the odd).

**The general rule:** *order is not data.* If your app has a sequence, derive the
sequence and look up each position, rather than collecting rows and sorting them
by something they carry.

**Pinned by:** `a_row_at_a_ply_the_game_has_not_reached_is_inert`.

### 3. A derived value was stored, and echoed

**Was:** `MoveRecord` carried `san: String`, and the view passed it through.

**Exploit:** the row says `e2e4`, the scoresheet reads `Qxf7# (and White
resigns)`. Nobody is fooled about the *position* — that is replayed — but every
human looking at the move list is reading a string the opponent wrote.

**Now:** the replay recomputes SAN as it goes, from the position each move is
played in. There is no stored notation to disagree with the board.

**The general rule:** *if you can compute it, do not store it.* A stored copy of
a derivable value is a field an attacker can set, and a field your reader will
eventually be tempted to trust. Storing it and then ignoring it is not safe
either — see finding 11.

### 4. The view was not truncated to what validation accepted

**Was:** the replay stopped at the first invalid move (correct), but the move
list rendered every row it had found (not correct).

**Exploit:** the board shows the position after ply 4 while the scoresheet lists
seven moves. The two disagree, and the extra three are whatever the forger
wanted them to be.

**Now:** `move_views` takes `replayed.applied` entries and no more. The FEN and
the move list are two renderings of one replay.

**The general rule:** *one derivation, many views.* Two code paths over the same
rows will drift, and the drift is the vulnerability.

### 5. Endings were believed because they were written

**Was:** an `Ending` row set `result` and `reason`, and the reader reported them.

**Exploit:** write `{result: "0-1", reason: "resignation"}` and win. You do not
even need to be a player.

**Now:** a stored ending is a *claim*, and each reason is checkable, so each one
is checked:

- **resignation** — the result must be a **loss** for whoever wrote it. Nobody
  resigns into a win.
- **agreement** — the opponent must have had an offer **standing at that ply**.
  An agreement is two acts and only one of them is in this row.
- **threefold / fiftyMove** — the draw must actually be available in the
  position at that ply, which the reader replays and checks.

This is why `Ending.ply` is load-bearing rather than bookkeeping: it is the
handle that lets the reader re-check a claim against the position it was made
in. An ending nobody can re-derive is an ending anyone can invent.

**Pinned by:** `a_resignation_nobody_could_have_made_is_not_believed`,
`an_agreed_draw_needs_an_offer_that_actually_stood`,
`a_claimed_draw_has_to_be_available_in_the_position`.

### 6. The current index was read from a row

**Was:** `init` wrote a `GameRecord` for game 0, and the reader took the current
game from the highest-indexed record.

**Exploit:** write a record for game 9999. Every reader now shows an empty board
and the real game — with its real result — is behind it.

**Now:** game 0 is **implicit**: there is no record for it. `current_game()`
counts valid rematches up from zero, and a rematch counts only if it was claimed
by a seat holder after a finished game. A row cannot move the table; it can only
be *counted*, and only if it earns it.

**The general rule:** *do not let one row relocate every reader.* If a value
selects which data everybody looks at, derive it by counting or folding — never
by reading a maximum or a "current" pointer out of a writable entity.

**Pinned by:** `a_rematch_nobody_at_the_table_claimed_starts_no_game`.

### 7. A key any member could take first

**Was:** the move key was `"<game>/<ply>"`. One key per ply, shared.

**Exploit:** this one is worse than it looks, and it is a **denial of service
against every table in the context**. `AuthoredMap::insert` refuses an occupied
key and only the owner may `update` it. So any member — a spectator, not even a
player — writes a junk row at the key White's next move needs, and the table is
wedged **permanently**. White can never move again. Not "White's move is
ignored": White's move has nowhere to go.

**Now:** every key carries its author and a per-write nonce:

```
moves:  "<game>/<ply:04>/<author>/<nonce>"
claims: "<game>/<member>/<nonce>"
seats:  "<seat>/<member>/<nonce>"
```

(The ply is zero-padded so that one ply's rows share a prefix no other ply's
rows start with — `12/` would otherwise be a prefix of `120/`.)

The author segment means a squatter's row lands under their own name and is
dropped by `valid_rows`. The nonce means that even a collision with *yourself*
costs a retry rather than a turn — `free_key` walks to the next free nonce. The
reader then elects among an author's rows (earliest for things you do once,
latest for a state that moves like a draw offer), with ties broken on the
canonical encoding so every replica lands on the same row without talking to
any other.

**The general rule:** *a key shared between writers is a lock.* In a system where
you cannot prevent writes, any key two people might write is a key one of them
can hold hostage. Put the author in the key. Put a nonce after it.

**Pinned by:** `a_squatted_key_costs_a_nonce_and_not_a_turn`.

### 8. Attribution was read from a field the writer chose

**Was:** `MoveRecord.by: MemberId`, and `MoveView.by` passed it through.

**Exploit:** play your own perfectly legal move and credit your opponent with
it. Every move is valid, the position is right, the result is right — and the
game record says someone else played it. In a chess app that is an annoyance; in
an app where "who did this" drives money, access or blame, it is the whole bug.

This one survived the first hardening pass, which is the point of including it:
the row was already authored, the stamp was already checked, and the *view* was
still reading a string the writer picked. Authorship enforced at the storage
layer does nothing if the reader then reports a different field.

**Now:** attribution follows the ply, which follows the key the row was found
under — which `valid_rows` has already matched against core's owner stamp:

```rust
by: if ply % 2 == 0 { white } else { black }.to_owned(),
```

**Pinned by:** `the_scoresheet_is_derived_and_not_transcribed`.

### 9. Electing before validating

**Was:** for each player, elect their earliest ending row, then check whether it
is valid.

**Exploit:** write one junk ending row with an early timestamp. It wins the
election, fails validation, and the reader concludes there is no ending — so
your *real* resignation, written a moment later, is masked by your own garbage.
A player could quietly un-resign.

**Now:** validity first, then election, over the surviving rows:

```rust
let mut valid = Vec::new();
for (key, ending) in Self::valid_rows(&self.endings, &claim_prefix(index, &holder))? {
    if self.ending_is_valid(index, color, &ending, replayed)? {
        valid.push((key, ending));
    }
}
let Some(ending) = Self::elect(valid, |e| e.at, true) else { continue };
```

**The general rule:** *filter, then choose.* Choosing from a set that includes
invalid rows lets an invalid row suppress a valid one — a class of bug that
looks like nothing at all in the happy path, because in the happy path there is
only ever one row.

### 10. A count taken from `len()`

**Was:** `games_played: self.games.len()`.

This was correct right up until finding 6 made game 0 implicit, and then it was
off by one forever: a table on its first game reported `0`, and after a rematch
it reported `1` where two games had been played.

Not a security bug — a **correctness bug introduced by a security fix**, which
is why it is here. It is also the one bug in this list that no single-node test
caught: every in-process assertion sat at "game 1 of 1" and read as plausible.
The two-node merobox scenario caught it, because it was the only test that
looked at the field after a rematch.

**Now:** `games_played` is `index.saturating_add(1)`, derived from the index the
reader counted, and the rematch test pins the count as well as the index.

**The general rule:** *when you change what is stored, re-read everything that
counted it.* And: a value that is only ever `1` in your tests is not tested.

### 11. A lookup at a key that had stopped existing

**Was:** `history()` fetched each game's start time with
`self.games.get(&game_key(index))`.

Finding 7 had given claim keys an author and a nonce, so `game_key(index)` was a
key nothing had written since. `get` returned `None`, the `map_or` fell back to
`0`, and every game in the history silently reported the epoch as its start
time.

Nothing failed. No compiler warning, no clippy lint, no test — because a lookup
that misses is a perfectly normal thing for a lookup to do.

**Now:** derived. Game 0 began when the table did; a later game began at the
earliest valid rematch claim that opened it — the same row `rematch_is_valid`
already counts.

**The general rule:** *a key-format change is a schema migration.* Grep every
construction of the old key shape. And prefer deriving a value over looking it
up, because a derivation that breaks tends to break loudly.

### 12. Fields left in the struct after the reader stopped needing them

`MoveRecord` ended up as:

```rust
pub struct MoveRecord {
    pub uci: String,   // the only thing here a reader cannot work out for itself
    pub at: u64,       // orders this ONE author's rows for one ply, and nothing else
}
```

It used to carry `game`, `ply`, `san` and `by`. As each was replaced by a
derivation, the field stayed — unread, harmless. `Ending.by` and
`GameRecord.started_by` were the same.

They are gone now, and the reason is worth stating: **a stored value that
nothing reads is not harmless. It is an invitation for the next reader to trust
it.** The next person to add a feature sees a `by` field sitting in the struct
and uses it, and finding 8 comes back. Deleting the field makes that impossible
rather than merely discouraged.

Note what is left in `MoveRecord.at`, and why it is safe: it orders that one
author's own rows for one ply, and they are the only person who can write them.
A wrong clock there costs its author a retry and costs nobody else anything.
That is the test for whether a stored scalar is acceptable — not "is it
correct", but "who is harmed if it is a lie".

### 13. A test deleted for a good reason, and left deleted after the reason expired

Finding 1 turned every collection into an `AuthoredMap`, and that broke
`tests/converge.rs`: the harness could not carry authored state at the time, so
the convergence suite was deleted with a note saying merobox now carried that
weight.

The note was true when it was written. Core fixed the harness in 2026-09, this
app moved to a release that includes the fix — and the test stayed deleted,
because nothing re-reads a deletion. For that whole window the app had **no
coverage at all** of the one thing CRDT state exists for: two replicas writing
concurrently and agreeing afterwards. Neither the single-store tests nor the
merobox sequence touches it.

`tests/converge.rs` is back, with three cases that each found nothing wrong —
which is the correct outcome and not an argument against having written them.

**The general rule:** *a test you delete because a tool cannot run it is a
dependency on that tool's limitations.* Write the reason down where the
dependency lives (the commit message is not where anyone looks), and re-check it
when you bump the dependency. "We deleted the test because X" ages into "we have
no test", silently.

---

## What is deliberately NOT fixed

Being honest about the residue is part of the model. Three things remain, and
each is a decision rather than an oversight.

**`title` and `created_at` are plain `LwwRegister`s.** Any member can
last-write them. They are captions: nothing about a game's legality, result,
turn order or history reads either one, so the worst case is that somebody
relabels the table. Guarding them would mean a writer-set anchor for two strings
nobody makes decisions from. *The general rule: know which of your fields are
load-bearing, write it down, and let the rest be cheap.*

**A player can stall.** Nothing forces a move. That is also what walking away
from a board looks like, and a chess clock is a feature, not a security
boundary.

**The forgery path itself has no automated coverage in this repository.** The
byzantine tests below prove the *reader* is not fooled, and `tests/converge.rs`
proves honest authored writes replicate and converge. The check that stops a
forged authored row from existing *at all* lives in core's
`Interface::apply_action` — `converge_app` can model a refusal with
`.allow_dropped_actions()`, but the enforcement itself is core's to test.

---

## Testing this class

Four tiers. Most apps write the first and the last and skip the two in the
middle, which is where this class of bug lives.

**`cargo test` — the rules and the reader.** Fast, in-process, no node. This is
where the byzantine tests live, and they are the only tests in this repo that
model an attacker:

```rust
// Carol is a spectator. She writes a perfectly legal opening move into the
// slot White is expected to fill — under her own account, because that is the
// only thing she can sign for.
app.call_as_account(CAROL, CAROL, |s| {
    let record = forged_move("e2e4");
    let _written = s.moves.insert(move_key(0, 0, &white, at(3)), record);
});

// The board never saw it.
let view = table_as(&mut app, ALICE, at(4));
assert!(view.moves.is_empty());
```

The technique is the whole trick: **write straight into the state struct's maps,
bypassing your own `#[app::logic]` methods, as a different account.** That is
precisely what a patched node does, and it is reachable from an in-crate test
because `src/tests.rs` can see private fields. Any of those writes that changes
what an honest reader concludes is a finding.

Two mechanical notes that cost an afternoon each:

- `call_as_account(account, device, …)` moves the account **and** the device.
  `call_as` alone moves only the device — same person, second machine — which
  is a different test.
- These tests must live **in-crate** (`src/tests.rs`), not in `tests/`. The
  `TestHost` bridge is `#[cfg(test)]`-gated, so an integration test cannot
  satisfy the trait bounds.

**`converge_app` — two replicas writing at the same instant.** The in-process
tests above drive one store, so they can show a forged row is ignored but never
that two stores agree. merobox below shows two real nodes agreeing, but a
scenario is a *sequence* — node-1 moves, node-2 waits, node-2 answers — so no
two writes in it are ever genuinely concurrent. `converge_app` is the missing
case: every replica applies every op locally without seeing the others, gossips
the deltas, and the harness asserts root-hash equality.

```rust
converge_app(|| MeroChess::init("Converging table".to_owned(), NOW))
    .replicas(2)
    .ops(|s| { let _ = s.sit("white".to_owned(), "Player".to_owned(), NOW); })
    .ops(|s| { let _ = s.sit("black".to_owned(), "Player".to_owned(), NOW); })
    .invariant("both chairs resolve to exactly one holder", |s| { … })
    .assert_all_replicas_equal();
```

Two things to know before you reach for it.

*Assert invariants, not just the hash.* Deterministic last-writer-wins converges
every replica to the same **wrong** value, so a data-loss bug sails through a
hash check. `.invariant(…)` is where you say what a correct merge would have
produced. (And check your invariants actually bite: flip one to something false
once and watch the test fail. An invariant over an empty collection is
vacuously true.)

*`.one_account()` is a different test.* By default each replica is a separate
person — the right model for "two people reach for the same chair", where the
writes land on different keys and the *reader's* election has to agree. With one
account, the replicas are one person's laptop and phone: the owner stamp covers
both, the writes land on the **same** key, and reconciliation falls to your
`Mergeable` impl instead. Chess needs both, and `tests/converge.rs` has both.

> **This harness could not do any of that until 2026-09**, and the way it failed
> is the lesson. Replica device ids were made-up bytes rather than real
> keypairs, so every signed action failed verification on receipt — and a
> refused action is *dropped*, not raised. Replicas silently exchanged nothing
> and each kept its own local write: values individually correct, roots
> different, indistinguishable from a CRDT bug, and reported as one
> (core#3965). It now holds real ed25519 keys and fails the run on a dropped
> action. If you read anywhere (this app's own history included) that
> `converge_app` cannot carry authored storage, that was true and is not any
> more — check the harness's own docs rather than the folklore.

**merobox — real nodes, real gossip, real network.** The only tier that proves
your signed writes cross a wire and land, and the only one that runs the
binaries your users will run.

`workflows/play-a-game.yml` runs two nodes through five games: a mate, a
declined offer then an agreed draw, a threefold claimed after a knight shuffle,
a resignation whose colour swap decides which way it goes, and a chair given up
and retaken. Every assertion is made on the node that did *not* perform the act,
because that is the only assertion a single node cannot fake.

`the_merobox_scenario_holds_as_a_sequence_of_rules` walks the same order of
calls in-process. It proves nothing about replication — but when a rule stops
holding it fails in a second rather than in Docker, and the two are kept in
step deliberately.

**Playwright — the UI against a real node.** Catches the wire-format drift
nothing else sees.

---

## The checklist

Before your contract ships, for each field in your `#[app::state]`:

- [ ] **Could a member forge this?** If it is `Public`, yes. Is that acceptable
      for this specific field, in one sentence you could defend?
- [ ] **Is it derivable from something else?** Then derive it on read and delete
      the field. Do not store it and ignore it.
- [ ] **Does any reader trust it?** Trace the field from storage to view. The
      storage tier is irrelevant if the view reports a different field (finding 8).
- [ ] **Does it order, select or count anything?** Ordering, "which one is
      current", and totals must be the reader's arithmetic (findings 2, 6, 10).
- [ ] **Do two writers share its key?** Put the author in the key and a nonce
      after it, or you have shipped a permanent lock (finding 7).
- [ ] **Is it a claim someone makes?** `AuthoredMap`, and re-check `owner_of`
      against the author named in the key — both halves.
- [ ] **Do you filter before you choose?** An invalid row must not be able to
      suppress a valid one (finding 9).
- [ ] **Can you re-derive every claim you accept?** A resignation must lose, an
      agreement needs its offer, a claimed draw must be available (finding 5).
- [ ] **Is there a byzantine test?** Write the row directly into the map under
      the wrong account and assert the reader is not moved.
- [ ] **Is there a `converge_app` test?** Two replicas writing it at the same
      instant, with an invariant that says what a correct merge produces — not
      just a hash.
- [ ] **Is there a merobox scenario?** Nothing else runs the binaries your
      users run.

---

## Further reading

- [`apps/mero-chess/README.md`](../README.md) — the app, and the three design
  decisions this document is the long version of.
- [`logic/src/lib.rs`](../logic/src/lib.rs) — every rule above is commented at
  the line that implements it.
- [`logic/src/tests.rs`](../logic/src/tests.rs) — the byzantine tests, at the
  bottom.
- [`logic/tests/converge.rs`](../logic/tests/converge.rs) — two replicas writing
  at the same instant.
- [`logic/workflows/play-a-game.yml`](../logic/workflows/play-a-game.yml) — five
  games across two real nodes.
- The Calimero [protocol reference](https://calimero-network.github.io/core/) —
  the write path, the receive & apply path, and the projection that turns a DAG
  into state. `crates/storage/src/interface.rs` in core is where
  `apply_action` actually enforces the tiers in the table above.
