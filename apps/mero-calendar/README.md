# Mero Calendar

Shared team calendars, private events and booking links on
[Calimero](https://calimero.network) 1.0. The contract is on core's
**component SDK** (`calimero-sdk`, a `calimero:app` WebAssembly component on
the node's wasmtime runtime), developed on **`merod local`**, with a frontend on
mero-js's **`CalimeroClient`** that talks to a **Calimero Cloud** cluster in
production and to the local nodes in development.

- **Teams are organizations.** A team is a Calimero org; the people in it are
  exactly the people you invited. A team holds any number of calendars, each an
  instance of this app in the org, which every member reaches.
- **Shared events** have invitees. Only an event's owner can edit or delete it,
  and only its owner and its invitees can read it: the contract answers nobody
  else.
- **Private events** have nobody else in them. They are the owner's own rows:
  every method that reads them reads only the caller's. An event created with no
  invitees is private; naming its first invitee later makes it shared (same id).
  Sharing is one-way: removing every invitee does not make it private again.
- **Booking links**: a link someone with no account opens to book one meeting
  with you, then reschedule or cancel it. Its token is an API key of your
  account limited to this calendar and the five booking methods; the meeting
  lands in your calendar as a private event.
- **Display names** per calendar, light/dark themes, and an accessible palette.

```
apps/mero-calendar/
├── logic/                   a standalone crate (own [workspace] + Cargo.lock)
│   ├── src/lib.rs           state, methods, events, errors
│   ├── src/booking.rs       booking links: types, validation, slots, time parsing
│   ├── tests/harness.rs     TestApp: the built component on core's real engine
│   ├── tests/scenarios.rs   every scenarios/*.json in the harness
│   ├── scenarios/           logic, members, private-events, private-routing, booking, access
│   └── res/abi.json         the component's ABI (committed, diffed in CI)
├── app/                     Vite + React; @calimero-apps/connect + mero-js CalimeroClient
└── mobile/                  native iOS / Android apps; their move to Calimero 1.0 is #682, which follows this port
```

See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md) for how component
apps are built, run and tested in this repo.

## Run it

```bash
pnpm install                     # once, at the repo root
rustup target add wasm32-wasip2  # once
pnpm dev:local mero-calendar     # merod local + build + deploy + http://localhost:5173/
```

`merod` at the pinned core release must be on the `PATH` (or in `MEROD_BIN`);
`pnpm dev:local` prints how to get it when it is missing. In the browser,
**create an account** (a passkey), **create a team**, a **calendar** in it, and
events. **Invite** from a team's menu: a second browser profile with its own
passkey and the invitation link is a second member. **Booking links** are in the
calendar's sidebar; open one in a private window to book as a guest.

## Test it

| | what it covers | needs a node |
|---|---|---|
| `cargo test --manifest-path apps/mero-calendar/logic/Cargo.toml` | v1's `TestHost` tests method for method; v1's storage write rules as method checks (forged owners, another account's private rows, a peer editing an owner's event); booking through an API key acting for its owner; access and wire checks; the booking slot rules (unit tests in `src/booking.rs`); every `scenarios/*.json`, on core's wasmtime engine | no |
| `pnpm -F mero-calendar test` | the methods the UI calls are exactly the committed ABI's, with its parameter names; the adapter's conversions and messages; booking links (API key + record); the booking page; teams, calendars and invitations (mocked client); member names | no |
| `pnpm merod-local e2e mero-calendar` | every `scenarios/*.json` on `merod local`: real accounts with passkeys, an org per scenario, each account on a different node, event streams | yes |

The scenarios are the six merobox workflows, ported: `logic.json`
(`logic-test.yml`), `members.json` (`e2e.yml` and `integration-setup.yml`),
`private-events.json`, `private-routing.json` and `booking.json`. Joins, syncs
and waits are gone (one log, nothing to replicate); what they asserted about
leaks is now asserted about access: another account's private event is
`NotFound` to it, a peer's edit is `Forbidden`. A bookable slot depends on the
cluster's clock, which a scenario cannot set, so booking, rescheduling and
cancelling a slot are in the harness; `booking.json` covers the rest of the
link's life. `access.json` adds what merobox could not express: anonymous
callers and accounts outside the org refused, a guest's own calendar, a removed
member, typed errors, malformed arguments.

## What changed in the port, and why

Every change a client sees:

| | v1 (`calimero-sdk`, merobox, mero-react) | now |
|---|---|---|
| methods | `get_events`, `create_event`, … | the same methods, camelCase on the wire (`getEvents`, `createEvent`, …), arguments too (`eventData`, `eventId`, `linkId`, `fromMs`, …) |
| `timestamp` arguments | `set_username`, `create_event`, `create_private_event`, `update_event`, `update_private_event` took the client's clock | gone: the app's log is the clock (`env::time_now()`); v1 needed the client clock only for its last-writer-wins merges |
| ids | event ids base64 of 16 random bytes; members a 64-hex `UserId` | event ids from the log (`env::unique_id()`, e.g. `1.4.0`); accounts are the node's account ids, as strings |
| shared events | an `Authored<IndexedMap>` every member's node held; `get_events` was only a view filter | a `Table` (index `byOwner`) with peers beside it and an invitations set; `getEvents` answers only the caller's own and invited events, and nobody else can read them at all |
| private events | `#[app::private]` storage on the owner's node, never replicated; on an account (relay) kept in the browser instead | per-owner rows in the app's state on the cluster (sealed, on attested nodes), read only by the owner's own calls, for every session. They are no longer node-local, and whoever may upgrade the app (the org's owner, or a holder of `MANAGE_APPLICATION`) could install code that reads them |
| members | `UserStorage<Member>` with an LWW clock | a map keyed by account; `setUsername` writes only the caller's row |
| events (notifications) | `CalendarEventCreated(id)` … as tuple payloads, to every node | the same names with named fields (`{ id }`, `{ account }`); a shared event's go to its owner and its peers (before and after the change), member events to everyone the app reaches (guests included); private events emit none, as before |
| errors | `{ kind, data }` with `NotFound(key)`, `Forbidden`, and strings | typed: `NotFound { id }`, `Forbidden`, `Invalid { message }` (v1's message), `LinkExists`, `AlreadyBooked`, `LinkCancelled`, `LinkExpired`, `NotBooked`, `SlotUnavailable`; the frontend shows v1's messages |
| 64-bit numbers | JSON numbers | decimal strings (`"1783296000000"`): `joinedAt`, `usernameUpdatedAt`, every `…Ms` field, `getAvailableSlots`' answer, and `fromMs` / `toMs` / `startMs` / `expiresAtMs` arguments. The frontend converts them back |
| lists | every entry | a page: `getEvents` (1,000 owned + 1,000 invited), `getPrivateEvents`, `getMembers`, `listBookingLinks` (1,000 each) |
| booking links | the token is a node access grant; the guest calls the owner's node's `/grant-calls`; the link names the node | the token is a core API key of the owner's account (`createApiKey`, a passkey step-up) limited to this calendar and the five guest methods; the guest's browser calls the cluster with it; the link is `/book#a=<calendar>&t=<key>`. A link without an expiry ends with its key, after a year at most |
| booking slots | computed at the node's current time | `bookSlot` / `rescheduleBooking` check at the time they are logged, as before; `getAvailableSlots` and `getBookingPage` are views, whose clock is the time of the app's last logged run, so near "now" they can offer a slot `bookSlot` then refuses (`SlotUnavailable`) |
| peers | any `UserId` | 1 to 100 account ids of at most 256 bytes, de-duplicated, order kept |
| guests (org role) | no such role | an org guest reaches the app and keeps a calendar of its own, as any v1 context member could |
| teams | a namespace of this app, one subgroup + context per calendar, names in group/context metadata | an org (`createOrg`, members may create calendars and invite), calendars are app instances (`createApp(name, …, { org })`) carrying their names; orgs are the platform's teams, so one made in another 1.0 app is listed and can hold calendars |
| team roles | core `Admin` / `Member` + a capability mask | org roles: the owner deletes the team, owner and admins manage members and delete calendars, a calendar's creator deletes it too; anyone else leaves the team |
| invitations | a signed namespace invitation in a deflate+base58 link, a confirm dialog, desktop deep links | an org invite token in `?invite=` (a passkey step-up to make), redeemed after sign-in |
| sign-in | a node login or a Calimero account (wallet), `MeroProvider` | passkeys through `@calimero-apps/connect`: local nodes in dev, the Cloud cluster in production |
| live updates | SSE on the context, join-sync banners | the app's event stream (`client.events`); nothing to join or sync |
| migrations | none in this app | none (the component SDK has no migrations yet) |

Removed: the merobox workflows (`logic/workflows/`), v1's `TestHost` tests and
`res/state-schema.json`, `src/types/id.rs`, the Makefile and `scripts/`
(merod-in-Docker dev nodes, invites, workflow runner), the Playwright suites
(mocked, integration, journey, screenshots) that drove merobox or merod 0.x,
mero-react / mero-platform, the access-grant client, the desktop SSO hand-off,
the v1 invitation codec and prompt, the device-local private store, the
application-id resolver and the namespace/context admin helpers.
`app/e2e/marketing-landing.spec.ts` stays: `scripts/landing` generates it for
every app.

## Production

`vite build` connects to a Calimero Cloud cluster by name, and refuses to start
without two variables set where the bundle's frontend is built:

```
VITE_CALIMERO_CLUSTER=<cluster name in the cloud's node directory>
VITE_CALIMERO_MIN_RELEASE=<lowest mero-tee release a node may run>
```

The production frontend is the one **packed into the `.mpk`** (`frontend-dir`),
which the cluster serves from the package's own origin: a Cloud node trusts
passkey ceremonies only from its own origins and from frontends it serves from a
bundle, so a copy on another origin cannot sign in. Instances are created from
the package (`com.calimero.mero-calendar`). The `frontend` link in
`logic/Cargo.toml` and the Vercel project (`app/vercel.json`) stay as the
listing's link; they are not where people sign in.

```bash
pnpm -F mero-calendar build
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- \
  bundle apps/mero-calendar/logic --key <production key> --app-version <x.y.z>
```

⚠️ Known gap: mero-js checks a Cloud node's release against
`cloud.calimero.network` mirrors, which the served page's CSP does not list
(docs/COMPONENT-APPS.md, "What the component SDK does not have yet").

## Theme and Log out

- **Light by default.** The sun/moon toggle in every signed-in top bar (and on
  the landing page) switches to dark; the choice is kept in `localStorage`
  under `mc-theme` (`app/src/providers/ThemeProvider`), and an inline script in
  `app/index.html` applies it before the first paint.
- **Log out** ends each top bar
  (`app/src/components/common/logout-button/LogoutButton.tsx`): it signs out on
  the cluster, forgets the stored session and returns to the landing page.

## License

MIT © Calimero Network
