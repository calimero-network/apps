# Mero Tag

Live location sharing on [Calimero](https://calimero.network): an AirTag / Find My-style app where positions live on
your own Calimero cluster, not with a tracking company.

**Landing page:** [`landing/`](landing/) — how it works, with real screen recordings and a promo film
(`cd landing && npm install && npm run dev`; deploys to Vercel as-is).

```
logic/      Rust WASM contract (calimero-sdk)
landing/    The landing page (Vite + React + Framer Motion) and its media
promo/      The promo film (Remotion), rendered from the app's recordings
app/
  MeroTag/  SwiftUI iOS app (MapKit + CoreLocation), built on the official
            Calimero Swift SDK (MeroKit + MeroKitUI)
scripts/    setup
```

Built for **Calimero core 1.0**:

- the contract builds against `calimero-sdk` / `calimero-storage` tag `1.0.0-rc.8`
  (`min-runtime-version = "1.0.0-rc.8"`)
- the app uses [`calimero-network/swift-sdk`](https://github.com/calimero-network/swift-sdk) pinned to
  its `v0.5.0` release (`exactVersion` in `app/MeroTag/project.yml`)

## How the app talks to Calimero

A Calimero 1.0 node runs in an attested cluster. The app verifies the node's attestation, then talks to it over a
sealed channel (`calimero/sealed-http/v2`), all through the SDK's `CalimeroClient`.

1. **Sign in with a passkey.** The person enters their cluster's address once (from the Calimero Cloud console) and
   signs in, or creates an account, with this phone's passkey. The session is kept in the Keychain and refreshed, so a
   relaunch needs no prompt.
2. **A space is an app instance.** Creating one founds an **organization** named after it and creates the Mero Tag
   app instance in it from the registry package (`com.calimero.mero-tag`), open to the organization's members.
3. **Calls, views and events.** Reads (`get_trackers`, `whoami`, …) are views (`POST /apps/{app}/views`); writes
   (`join`, `update_location`, …) are calls (`POST /apps/{app}/intents`), run once on the app instance's leader. Live
   updates are the app instance's server-sent events; if the stream drops, the app refreshes on a timer. Nothing is
   written offline.
4. **Invite people.** An organization invite (role member) travels as the SDK's `InviteLink`
   (`https://links.calimero.network/com.calimero.mero-tag/join?invitation=…`) with the app instance id and the space's
   name. The joiner pastes it, or opens it as `merotag://join?invitation=…`; the app redeems it
   (`/invites/{token}/redeem`) and opens the space.
5. **Approvals.** When the registry has a newer Mero Tag than the space runs, the Space tab offers it. Approving opens
   the cluster's consent page in the system browser; the app waits for the decision.

The contract takes every member, owner and author id from the caller's account (`env::account_id()`), stamps records
with the leader's clock, and lets admins of the space's organization (`env::caller_org()`) moderate.

## Run it against a development cluster

```bash
# in calimero-network/core (merod is Linux-only; on macOS run it in Docker)
cargo run -p merod -- local                     # 3 nodes on :2501-2503, mock attestation
meroctl node add local http://127.0.0.1:2501/ --allow-mock
make logic-bundle                               # here: logic/dist/mero-tag-dev.mpk
meroctl app install --path logic/dist/mero-tag-dev.mpk
```

In the app tap **Development cluster**, use `http://<your Mac's address>:2501` and a name. The SDK keeps a software
passkey for that node and makes an account on first use. Then create a space.

## Build the app

You need full Xcode 16+ (an iOS 17 SDK) and XcodeGen (`brew install xcodegen`).

```bash
make app-gen      # generate app/MeroTag/MeroTag.xcodeproj from project.yml
```

For a device: open `app/MeroTag/MeroTag.xcodeproj` and set your team under *Signing & Capabilities* (or set
`DEVELOPMENT_TEAM` in `project.yml`). A platform passkey on a real cluster also needs the
`webcredentials:<cluster rp id>` associated domain.

To build against a local swift-sdk checkout, temporarily replace the package's `url` / `exactVersion` in
`app/MeroTag/project.yml` with `path: /path/to/swift-sdk`, run `make app-gen`, and do not commit that change.

## Contract

```bash
make setup        # check prereqs, build the WASM + signed dev bundle
make logic-test   # cargo test (pure helpers, merge laws, TestHost 1.0 semantics)
make logic-build  # cargo mero build → logic/res/mero_tag.wasm (ABI embedded)
make logic-bundle # signed dev .mpk for a merod local cluster
```

Run `make help` for all targets. [requirements.md](requirements.md) has the full Mac and iPhone walkthrough.

## Status

- Done: the WASM contract on core 1.0 (trackers, locations, sharing, groups, geofences, presence, history).
- Done: passkey sign-in, spaces as app instances in organizations, invites, live events, update approvals on the
  consent page.
- Not yet: authoring geofences, playing back history, and a UI for groups.
- Not yet: an end-to-end lane against `merod local` (merobox, which the old lane used, is archived).
