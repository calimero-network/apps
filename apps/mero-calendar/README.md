# Mero Calendar

A collaborative, peer-to-peer calendar built on the [Calimero](https://calimero.network)
network. Shared team calendars and truly private events — your schedule lives on
your own nodes, shared only with the people you invite.

- **Teams = namespaces.** A team is a Calimero namespace; everyone in the team
  shares **one** calendar context. Invite teammates with a code, and events sync
  P2P between your nodes.
- **Shared events** are owner-gated for writes: only an event's owner can edit
  or delete it, and every node enforces that. The calendar view lists only the
  events you own or were invited to (as a peer), but that is a filter, not
  privacy: every shared event replicates to every member of the team context,
  and any member can read it from their own node. Anything confidential belongs
  in a private event.
- **Private events** use the SDK's `#[app::private]` node-local storage — they
  live only on your node and are **never** replicated to anyone else.
- **Display names**, light/dark themes, and a refreshed, accessible color palette
  for events.
- **Light by default.** The sun/moon toggle in every signed-in top bar (and on
  the landing page) switches to dark; the choice is kept in `localStorage`
  under `mc-theme` (`app/src/providers/ThemeProvider`), and an inline script in
  `app/index.html` applies it before the first paint. **Log out** ends each
  top bar (`app/src/components/common/logout-button/LogoutButton.tsx`): it
  calls mero-react's `logout()` and returns to the landing page.

## Booking links

Calendly-style booking for people with no account. From a calendar, **Booking
links** makes a link with a length, weekly hours, how far ahead and how soon
someone may book. Whoever opens it (`/book#…`) sees the open times in their own
time zone, books **one** meeting, and can later reschedule or cancel it with the
same link. A cancelled link is spent.

- **The key is a core access grant.** Making a link issues one
  (`POST /admin-api/contexts/:id/grants`) naming only the five guest methods
  (`get_booking_page`, `get_available_slots`, `book_slot`,
  `reschedule_booking`, `cancel_booking`). The guest calls the node's public
  `POST /admin-api/contexts/:id/grant-calls` with the token and reaches nothing
  else in the calendar. Deleting the link revokes the grant.
- **Everything lives on the owner's node, privately.** Links, guests' names and
  emails, and the booked meetings are `#[app::private]` state and never
  replicate; a booking shows up as a private event in the owner's calendar.
  The contract keys a link by the SHA-256 of its token and keeps no secret.
- **Your node must be reachable from the guest's browser**, at the URL you are
  connected to, and its CORS must allow this app's origin. An account session
  (no node of its own) cannot make booking links.
- **Weekly hours use the UTC offset your browser has when you make the link.**
  A daylight-saving change shifts them by an hour until the link is re-made.

## Architecture

| Layer | Path | Stack |
|-------|------|-------|
| Contract ("logic") | `logic/` | Rust → WASM, `calimero-sdk` / `calimero-storage` `0.11.0-rc.25` |
| Frontend ("app") | `app/` | React 19 + Vite 6, `@calimero-network/mero-react` + `mero-js` + `mero-ui` |

The contract keeps shared events in synced CRDT state (an owner-stamped
`Authored<IndexedMap>`, indexed by owner and peers), members + usernames in
per-account `UserStorage` slots, and private events in node-local
`#[app::private]` storage. The frontend talks to a node over JSON-RPC (`execute`) and subscribes to
state changes over SSE.

## Prerequisites

- Rust + `wasm32-unknown-unknown` target (pinned by `logic/rust-toolchain.toml`)
- [`cargo-mero`](https://github.com/calimero-network/core/tree/master/tools/cargo-mero),
  pinned to the same core tag as the SDK — the ABI emitter is versioned with core:
  ```bash
  cargo install --git https://github.com/calimero-network/core --tag 0.11.0-rc.25 cargo-mero
  ```
- Node 20+ and `pnpm`
- A local [`merod`](https://github.com/calimero-network/core) node for development
- `merobox` + Docker for the workflow/integration tests (optional)

## Quick start

```bash
# Build the contract and install frontend deps
make setup

# Start a local node (builds the WASM, installs the app, creates a team calendar)
make dev-node

# Run the frontend (http://localhost:5174)
make frontend
```

Or the full two-node P2P stack in one shot:

```bash
make dev          # node1 + node2 + invite + frontend
```

Open the app, connect your node, create or join a team, and start scheduling.

## Build

```bash
make logic-build     # logic/src → logic/res/{mero_calendar.wasm,abi.json,state-schema.json}
make app-build       # frontend → app/dist
make build           # both
make bundle          # dev-signed .mpk → logic/dist/ (fine locally, refused by the registry)
make bundle-release  # publishable .mpk, signed with $MERO_SIGN_KEY_FILE
make publish         # push a built .mpk to the App Registry (needs $CALIMERO_API_KEY)
```

`cargo mero` reads the bundle manifest — package, slug, icon, tags, links,
`minRuntimeVersion` — straight out of `[package.metadata.calimero]` in
`logic/Cargo.toml`; there is no hand-written `manifest.json` to keep in sync.
The release version is not taken from that file either: `--bump patch` asks the
registry for the highest published `appVersion` and increments it.

## Test

```bash
make logic-test-rust   # Rust unit tests (cargo test)
make unit              # frontend unit tests (vitest), incl. ThemeProvider and LogoutButton
make e2e               # Playwright mocked e2e (no node needed), incl. theme.spec.ts
make logic-test        # merobox single-node contract workflow (needs Docker)
make workflows         # merobox two-node sync workflow (needs Docker)
make integration       # Playwright integration tests against a running node
```

The contract is covered by Rust `TestHost` unit tests and a merobox
`logic-test.yml` workflow; the frontend has mocked Playwright specs (CI) and
integration specs that run against a real merobox-bootstrapped node.

## Project layout

```
logic/                Rust smart contract (the calendar state machine)
  src/lib.rs          contract: events, members, private events + #[cfg(test)] tests
  Cargo.toml          SDK pins + [package.metadata.calimero] bundle manifest
  build.sh            shim over `cargo mero build`, kept for scripts/dev-node.sh
app/                  React frontend
  src/api/            contract (mero.rpc), admin (useMero().admin), session, privateStore, dataSource, appId
  src/pages/          landing, login, teams, calendar
  src/components/      calendar views + shared UI
workflows/            merobox workflow tests (e2e, integration-setup, logic-test)
scripts/              dev-node / dev-node2 / dev-invite / workflows runner
.github/workflows/    CI (unit + e2e + rust), integration, merobox, release
```

## Owned keys are per owner (core 0.11.0-rc.57)

Since core 0.11.0-rc.57 every owned collection (`Authored…`, `WriteOnce`, `Moderated`,
`ModeratedOnce`) is one namespace per account: two accounts writing one key hold two
independent entries, and a key-only `get`, `contains`, `owner_of`, `owned_by_me` or `remove`
acts on the CALLER's own entry only. This app was migrated:

`get_events` reads each event as its claimed owner's **own** entry (`get_by(owner, id)`)
and keeps rows apart by `(id, owner)`, so an event two accounts hold at one id is two
events, each with its owner. `update_event` / `delete_event` act on the caller's own
event and answer `Forbidden` when only someone else holds the id. Test:
`one_event_id_two_owners_are_two_events`.

## License

MIT © Calimero Network
