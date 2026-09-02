# Solo testing — a real 2-peer call on one laptop

Mero Meet is desktop-only in production, and a video call needs **two context
members**. A single Calimero Desktop instance is one node = one identity, so you
can't call yourself. This harness runs **two local nodes** joined to one room and
points **two browser profiles** at them — each with a *fake* camera, so there's no
webcam contention and no second machine needed.

> The fake camera (`--use-fake-device-for-media-stream`) makes Chrome generate a
> synthetic moving video + beep instead of touching your real webcam. Both
> profiles get their own — that's why "2 frontends, 1 camera" is a non-issue here.

## TL;DR

```bash
make dev-nodes        # node1 + node2 + create room + invite node2  (~30s)
make dev              # in a SECOND terminal: Vite dev server on :5173
make dev-call         # opens two fake-camera Chrome profiles into the room
```

In **each** window: type a name → **Call**. You should see two video tiles
(each showing the fake stream). `make dev-stop` tears the nodes down.

## How it works

A "room" is a Calimero context inside a namespace.

1. **`scripts/dev-node.sh`** — builds the WASM, runs node1 (`:2660` RPC / `:2661`
   p2p), installs the app, creates the room (namespace + context), and writes
   ids/tokens to `app/.env.dev-call`.
2. **`scripts/dev-node2.sh`** — runs node2 (`:2670` / `:2671`), bootstraps it
   straight to node1 (mDNS is unreliable with two merods on one host), installs
   the app, appends its tokens.
3. **`scripts/dev-invite.sh`** — invites node2 into the namespace, joins it, then
   joins the room context, so node2 has its own identity in the room.
4. **`scripts/dev-call.sh`** — builds the desktop-style auth hash for each node
   and opens two isolated Chrome profiles.

The app needs no special web build: `MeroProvider` already reads `node_url` +
`access_token` from the URL hash (the real desktop SSO path), and the dev-only
`APP_ENABLED` gate (`src/lib/tauri.ts`) lets the full UI render in a browser when
that hash is present. `import.meta.env.DEV` guards it, so it can never ship in a
production build.

## Fully automated: `make dev-e2e`

Don't want to click through two windows at all? With the nodes and vite running:

```bash
make dev-nodes                  # once
make dev                        # separate terminal (or any port: DEV_VITE_PORT=…)
make dev-e2e                    # headless, asserted, ~3 min
```

It drives both peers with Playwright (fake cameras, isolated browser contexts)
and **asserts real video frames flow**, through the exact lifecycle that has
broken before: join → media both ways → leave (remote tile must disappear) →
rejoin in BOTH directions → everyone leaves → the call must die ("Start call"
again). On failure it dumps screenshots, per-peer browser consoles, and each
peer's in-call diagnostics (the ⚙ log) to `/tmp/meet-dev-e2e/`.

Run this before shipping anything that touches the contract, `useCall.ts`, or
`webrtc.ts` — in one afternoon it caught an SSO-trust regression, a
media/negotiation race, and a CRDT rejoin bug.

## Testing the in-app invite flow

`make dev-nodes` auto-joins node2 (fast path for call testing). To test the real
**"paste an invite code"** path that users actually take:

```bash
make dev-invite-test   # nukes both nodes, node2 left OUTSIDE the room
make dev               # in a second terminal, if not already running
```

It opens two windows in `--web-invite` mode:

- **Peer A (node1)** lands inside the room → click **Invite** → a code is minted
  (`createNamespaceInvitation`) and copied to the clipboard.
- **Peer B (node2)** lands on the **Rooms** page → paste the code into **Join**.
  It joins the namespace, waits for the room context to sync, then enters it.

If Peer B ends up in the same room, invitations work. `./scripts/dev-invite-test.sh --print`
prints the two URLs instead of launching Chrome.

## Notes

- **Not Chrome?** `./scripts/dev-call.sh --print` prints the two URLs — open each
  in a separate browser **profile** (separate token stores). On Chrome you must
  add the fake-media flags yourself; without them you'll share/contend the real
  webcam. Override the binary with `CHROME_BIN=...`.
- **Reload loses the room?** `MeroProvider` strips the auth hash after reading it.
  Just re-run `make dev-call` (or reopen the printed URL) to get a fresh session.
- **Ports** `2660/2661` (node1) and `2670/2671` (node2) avoid the curb dev nodes
  (`2428/2528`, `2429/2529`) and the merobox e2e (`2640/2740`). Override via
  `MEET_DEV_PORT` / `MEET_DEV_PORT2` etc.
- **Vite on another port?** `DEV_VITE_PORT=5174 make dev-call`.
- This is for **media/UI** iteration. The `make workflows` merobox e2e covers the
  signaling relay headlessly (no video).
