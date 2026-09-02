# Mero Forum — rewrite plan

`only-peers` was Calimero's original demo app. Renamed to **mero-forum** on
migration into the monorepo (nothing was ever published under any only-peers id,
so the rename costs nothing). Its 113-line contract is not a forum that needs
updating — it is a single-node prototype that cannot work peer-to-peer, and the
SDK now says so out loud.

## Why this is a rewrite, not a port

### 1. It has no CRDT storage at all

`logic/Cargo.toml` depends on `calimero-sdk` **only** — there is no
`calimero-storage`. State is a plain `Vec`:

```rust
#[app::state(emits = for<'a> Event<'a>)]
pub struct OnlyPeers {
    posts: Vec<Post>,
}
```

rc.26's SDK rejects that by name:

```
error: (calimero)> bare `Vec` is not allowed as a mergeable field — it has no
merge semantics and would silently diverge across replicas. Wrap it: `Vector<T>`.
```

That diagnostic is the whole problem in one line. Two peers posting concurrently
have no defined merge, so replicas diverge — in a system whose entire premise is
replication. Note it is a *compile* error now; when this app was written it was
not, which is how it shipped as a demo.

`Post.id` is `self.posts.len()`, a positional index — the same defect core called
out when `AuthoredVector::push` was changed to return an `Id`: *"a remote insert
ahead of it silently renumbers it."* Post 3 on Alice's node is a different post
from post 3 on Bob's, and every comment references its post by that index.

### 2. Anyone can comment as anyone

```rust
pub fn create_comment(
    &mut self,
    post_id: usize,
    user: String, // todo! expose executor identity to app context
    text: String,
) -> Option<&Comment>
```

The author is a **caller-supplied string**. The `todo!` is in the original
source. Impersonation is not a bug here, it is the interface. Identity must come
from the executor.

⚠️ And that choice is not a rename. rc.20 replaced `executor_id()` with
`device_id()` **and** `account_id()`, and picking the wrong one type-checks and
authorizes the wrong principal. For a forum, author attribution is
**per-account**: keyed on `device_id`, the same person posting from a laptop and a
phone becomes two authors, and "delete my own comment" stops working on the other
device.

### 3. No access control, no moderation

No `AccessControl`, no `Ownable`, no author gate. `create_post` and
`create_comment` are open to any context member, and nothing can be edited or
removed by anyone — there is no `delete_post`, no `edit_comment`, no author check.

⚠️ When adding `AccessControl`, note the trap: **a grant confers nothing until it
is projected, and a new admin cannot project.** `init` can only seed one admin,
and `capabilities()` read back in the same execution as `set_capabilities` returns
the stale value.

### 4. The frontend is seven majors behind, and half of it is NEAR

* `@calimero-network/calimero-client` **1.6.4** — the pre-mero-js client. The
  fleet is on mero-js 13 / mero-react 6.
* Four `@near-wallet-selector/*` packages. Calimero no longer authenticates
  through a NEAR wallet; this is dead weight and dead code paths.
* React 18 (fleet is 19), Tailwind 4, `gh-pages` deploy rather than Vercel.
* No tests of any kind — no vitest, no Playwright.

## Plan

### Phase 1 — contract
1. Add `calimero-storage` (done in this PR's manifest) and move state to CRDT
   collections: `UnorderedMap<String, Post>` keyed by a generated id, comments as
   an `UnorderedMap` per post or a single map keyed `(post_id, comment_id)`.
   **Never a positional index**, and never `UnorderedSet` insert-after-remove
   (that pattern never converges and stays banned even though rc.10 fixed the
   tombstone bug).
2. Text fields that can be edited become `LwwRegister<String>`; last-writer-wins
   is the right semantics for a post body.
3. Author identity from `env::account_id()`, not a parameter. Drop the `user`
   argument from `create_comment` — this is an ABI break, which is free because
   nothing is published.
4. Add `AbiType` + `RekeyTarget` to every stored struct (rc.20 derives the ABI
   from the type system; rc.21 rekeyed storage to `AccountId`).
5. Author-gated `edit_post` / `delete_post` / `edit_comment` / `delete_comment`,
   plus an admin role via `AccessControl` for moderation.
6. TestHost unit tests **and** a `tests/converge.rs` that asserts two replicas
   converge after concurrent posts — the property the current design cannot hold.

### Phase 2 — bundle + scenarios
7. `cargo mero build` → commit `res/abi.json` + `res/state-schema.json`.
8. A merobox two-node scenario in `logic/workflows/`: both peers post
   concurrently, both see both posts, a non-author edit is **rejected**.
   ⚠️ Assert the rejection properly — `expected_failure: true` on a `call` step
   can never fail the run, so capture the error into an output and
   `is_set(...)` it. Validate with the pinned merobox (`bootstrap validate`) before
   pushing.

### Phase 3 — frontend
9. `calimero-client` 1.6.4 → mero-js 13 / mero-react 6; generate the typed client
   from the fresh ABI into `app/src/generated/` so a stale call is a build error
   rather than a runtime 500. ⚠️ Do NOT hand-roll SSO token seeding —
   mero-react >= 4.3.4 already does it, and seeding plus stripping the hash
   disables `resolveTokenAdoption`.
10. Delete all four `@near-wallet-selector/*` packages and their code paths.
11. React 18 → 19, deps to `catalog:`, add `typecheck: tsc -b`.
12. A Playwright config + smoke spec — `ci.yml`'s `browser` job runs
    `npx playwright test` and this app has neither.
13. Replace the `gh-pages` deploy with a Vercel project whose Root Directory is
    `apps/mero-forum/app`, and set `[package.metadata.calimero].frontend` to that
    exact origin. It doubles as the login callback's registered redirect URI and
    is compared by **exact origin**, so a wrong value breaks hosted login after
    credentials are accepted while local login keeps working.

## Not blocking, but decide early

`slug`/`package` (`com.calimero.mero-forum`) is settled in this PR and should not
move again — it is the deep-link slug the desktop resolves and it goes into every
invite link. The display `name` ("Mero Forum") is free to change whenever.
