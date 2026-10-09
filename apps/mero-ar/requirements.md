# Mero AR — Requirements & How to Run

Mero AR is a collaborative spatial-editing iOS app on the Calimero p2p network:
several devices scan the same room and edit one shared 3D scene, synced through
Mero nodes. This is the end-to-end guide to building and running it.

```
mero-ar/
  logic/      Rust WASM contract (the scene-graph backend, runs inside a Calimero node)
  app/
    MeroAR/   the SwiftUI + ARKit + RealityKit app (depends on the shared swift-sdk)
  scripts/    dev-node / dev-node2 / dev-invite / setup
  workflows/  merobox suites — logic-test.yml (1 node) + identity-and-roles.yml (2 nodes)
  Makefile    every command below has a `make` shortcut
```

> **What talks to what:** the iOS app → **MeroKit**, the shared Calimero Swift
> SDK ([calimero-network/swift-sdk](https://github.com/calimero-network/swift-sdk),
> pinned by commit in `app/MeroAR/project.yml`) → a **Calimero node** over HTTP
> (`/jsonrpc` calls, `/sse` events, `/admin-api/blobs` for the ARWorldMap) → your
> **WASM contract** inside that node. Devices relocalize into a shared coordinate
> frame by downloading the room's `ARWorldMap` blob.
>
> The SDK is fetched by SwiftPM at project-generation time, so `make app-gen`
> (and CI) needs network access on a cold build.

---

## 1. ⚠️ Device requirement (read first)

**Mero AR requires a physical ARKit device** — an iPhone or iPad with an A12
Bionic chip or newer (2018+). LiDAR models (iPhone 12 Pro+/iPad Pro) additionally
get scene-mesh reconstruction. **The iOS Simulator cannot run an AR camera
session**, so unlike Mero Tag there is no simulator path for the actual AR view.
You will deploy to a real device.

---

## 2. Prerequisites

| Tool | Needed for | Install |
|------|-----------|---------|
| **Rust** + `wasm32-unknown-unknown` | building the WASM contract | <https://rustup.rs> then `rustup target add wasm32-unknown-unknown` |
| **`merod`** (Calimero node) | running the backend | already at `/usr/local/bin/merod` |
| **`jq`** | dev scripts | `brew install jq` |
| **Full Xcode** (15+) | building/running/testing the app, device deploy | Mac App Store |
| **XcodeGen** | generating the `.xcodeproj` | `brew install xcodegen` |
| **An ARKit iPhone/iPad** | running the app | — |

> The contract builds and tests with Rust alone (`make logic-test`). Everything
> Swift — including the unit tests — now needs full Xcode, since the client lives
> in an SwiftPM package the app target links: `sudo xcode-select -s
> /Applications/Xcode.app`.

Verify everything:

```bash
make setup
```

---

## 3. Start the backend

```bash
make node      # builds WASM, launches a node on :2450, creates a Room context
```

Copy the printed **Context ID** and the **phone/LAN URL** (e.g.
`http://192.168.1.5:2450`). Sanity-check the contract against a real node —
no Xcode needed:

```bash
make workflows
```

Stop later with `make stop`.

---

## 4. Build & run on your iPhone/iPad

1. **Open the project:**
   ```bash
   make app-gen          # generates app/MeroAR/MeroAR.xcodeproj
   open app/MeroAR/MeroAR.xcodeproj
   ```
2. **Signing:** select the **MeroAR** target ▸ *Signing & Capabilities* ▸ choose
   your Apple ID team (or set `DEVELOPMENT_TEAM` in `app/MeroAR/project.yml` and
   re-run `make app-gen`).
3. **Plug in the device**, select it as the run destination, press **⌘R**.
   - First run: on the device, *Settings ▸ General ▸ VPN & Device Management* →
     trust your developer certificate.
4. **In the app**, tap **Continue with Calimero**. The Calimero wallet opens in
   the system sign-in sheet; approve this device with your passkey and you land
   back in the app, signed in to your account's hosted relay. There is no node
   URL, username or password on mobile — the phone never talks to a node you
   run; every call goes through your relay (writes as signed warrant intents,
   reads as relay queries).

   Then paste an **invite link** someone sent you (or a room ID you're already
   in) and tap **Join and enter**.

   The device key and the session live in the Keychain, so the next launch
   reconnects to the relay and walks straight back into the last room.
5. Grant **camera permission**, then **slowly pan the device** to scan the room.
6. Point the centre reticle at a surface and tap **Cube / Sphere / Marker** to
   place objects. Tap an object to select it (then delete).

> **Wallet callback:** the wallet returns to `meroar://enrol`. It needs a wallet
> build that accepts app-scheme callbacks (mero-wallet#7).

---

## 5. Multi-device collaboration

1. Build & run on **two devices** (repeat §4 for each). The second person signs
   in with their own account and pastes the invite link from the first device
   (members sheet ▸ **Create invite link**).
2. On the **first** device (the one that created the room, so it is admin), scan,
   then tap **Share scan** in the toolbar to publish the shared map — `set_world_map`
   with the serialized `ARWorldMap`.
   If it says *"keep scanning"*, ARKit hasn't mapped enough of the room yet.
3. The **second** device downloads that map on entry and **relocalizes** into the
   same coordinate frame, so objects appear in the same physical spot. Place or
   move an object on one device and it updates live on the other via SSE.

**Roles:** whoever created the room is its admin; a device that joins is a
**viewer** and cannot place anything until promoted. On the admin's device, open
the members sheet (the people button, top-right) and toggle the other member to
**editor**. This is contract-enforced, not just UI.

**Local two-node P2P** (`make node` → `make node2` → `make invite`) exercises the
contract and sync on your Mac — merobox and the curl e2e use it. The phone app
does not log into those nodes; it reaches rooms through its Cloud relay.

> **Why relocalization matters:** two devices don't share an origin. We use
> persisted `ARWorldMap` relocalization (the approach chosen in
> `../merointerier.md` P4.1) — scan once, others load the same room. This is the
> one part that *must* be validated on real hardware.

---

## 6. Testing

| Command | What it runs | Needs Xcode? |
|---------|-------------|--------------|
| `make logic-test` | Rust unit tests (version LWW, lock/comment rules, geometry) | no |
| `make workflows` | merobox suites against a real merod in Docker — identity attribution, roles, cross-identity locks | no (needs Docker) |
| `make app-test` | App unit tests + UI smoke test (XCUITest) | yes |
| `make test` | `logic-test` + `app-test` | yes |

---

## 7. Common tasks

```bash
make logic-build   # rebuild WASM after editing logic/src/lib.rs
make node          # restart node with fresh WASM (resets room state)
make app-gen       # regenerate the Xcode project after adding Swift files
make stop          # tear down nodes, free ports 2450/2451/2550/2551
make clean         # remove build artifacts
```

---

## 8. Troubleshooting

- **App builds but the camera view is black / AR fails** → you're on the
  Simulator. Deploy to a physical ARKit device.
- **`xcodebuild` does nothing** → full Xcode not selected:
  `sudo xcode-select -s /Applications/Xcode.app`.
- **"Couldn't sign in"** → the wallet page must be able to return to
  `meroar://enrol`; check the wallet build accepts app-scheme callbacks.
- **"No relay yet"** → a new account gets its relay by redeeming its first
  invitation. Paste one in the lobby.
- **Objects appear in different places on each device** → relocalization hasn't
  completed; the joining device needs the published `ARWorldMap` and must see
  enough of the same scene to relocalize. Pan slowly over shared features.
- **"Couldn't open the room"** → the relay doesn't serve that room. Use an
  invite link rather than a bare room ID for a room you haven't joined.
- **"View-only — ask an admin for editor access"** → this device joined the room
  rather than creating it, so it's a viewer. Promote it from the admin device's
  members sheet.
- **SwiftPM can't resolve MeroKit** → cold builds fetch the SDK from GitHub;
  check network access, or `File ▸ Packages ▸ Reset Package Caches` in Xcode.

---

## 9. Where to go next

The phased plan, task tracker, and AR-specific gotchas are in
[`../merointerier.md`](../merointerier.md). Built so far: the scene-graph
contract on core rc.32 (account-attributed writes, account-keyed roles), the app
on the shared swift-sdk (Cloud sign-in, relay session, live SSE, roles UI), and the AR
room (scan, place, sync, presence, publish + relocalize the world map). Next
tickets: spatial comments UI, shared-cursor avatars, lock UX, and on-device
validation of relocalization with two phones.
