# Mero AR — Requirements & How to Run

Mero AR is a collaborative spatial-editing iOS app on the Calimero p2p network:
several devices scan the same room and edit one shared 3D scene, synced through
Mero nodes. This is the end-to-end guide to building and running it.

```
mero-ar/
  logic/      Rust WASM contract (the scene-graph backend, runs inside a Calimero node)
  app/
    MeroKit/  Swift package — the Calimero client (JSON-RPC + SSE + auth + admin + blobs)
    MeroAR/   the SwiftUI + ARKit + RealityKit app
  scripts/    dev-node / dev-node2 / dev-invite / setup
  workflows/  CI
  Makefile    every command below has a `make` shortcut
```

> **What talks to what:** the iOS app → **MeroKit** (Swift) → a **Calimero node**
> over HTTP (`/jsonrpc` calls, `/sse` events, `/admin-api/blobs` for the
> ARWorldMap) → your **WASM contract** inside that node. Devices relocalize into
> a shared coordinate frame by downloading the room's `ARWorldMap` blob.

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
| **Swift / Command Line Tools** | MeroKit logic + smoke test | `xcode-select --install` |
| **Full Xcode** (15+) | building/running the app, device deploy | Mac App Store |
| **XcodeGen** | generating the `.xcodeproj` | `brew install xcodegen` |
| **An ARKit iPhone/iPad** | running the app | — |

> This Mac currently has Command Line Tools only. The contract and MeroKit build
> and test without Xcode; **building/deploying the app needs full Xcode** — then
> `sudo xcode-select -s /Applications/Xcode.app`.

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
`http://192.168.1.5:2450`). Sanity-check the client without Xcode:

```bash
make kit-verify
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
4. **In the app**, enter:
   - Node URL: `http://<your-mac-ip>:2450` (must be on the same Wi-Fi as the Mac)
   - Username `admin`, Password `calimero1234`
   - Context ID: the value from `make node`
5. Grant **camera permission**, then **slowly pan the device** to scan the room.
6. Point the centre reticle at a surface and tap **Cube / Sphere / Marker** to
   place objects. Tap an object to select it (then delete).

> **Firewall:** if the device can't reach the node, allow incoming connections
> for `merod` (System Settings ▸ Network ▸ Firewall).

---

## 5. Multi-device collaboration

1. Build & run on **two devices** (repeat §4 for each, same Context ID).
2. On the **first** device, after scanning, publish the shared map — this calls
   `set_world_map` with the serialized `ARWorldMap` (wired in
   `MeroARService.publishWorldMap`; surface it behind a "Share room" button as
   the next ticket).
3. The **second** device downloads that map on entry and **relocalizes** into the
   same coordinate frame, so objects appear in the same physical spot. Place or
   move an object on one device and it updates live on the other via SSE.

**Full P2P (two nodes):** `make node` → `make node2` → `make invite`, then point
each device at `:2450` and `:2451` with the same Context ID.

> **Why relocalization matters:** two devices don't share an origin. We use
> persisted `ARWorldMap` relocalization (the approach chosen in
> `../merointerier.md` P4.1) — scan once, others load the same room. This is the
> one part that *must* be validated on real hardware.

---

## 6. Testing

| Command | What it runs | Needs Xcode? |
|---------|-------------|--------------|
| `make logic-test` | Rust unit tests (version LWW, geometry) | no |
| `make kit-verify` | MeroKit pure-logic smoke test | **no** |
| `make kit-test` | Full MeroKit XCTest suite | yes |
| `make app-test` | App UI smoke test (XCUITest) | yes |
| `make test` | `logic-test` + `kit-verify` | no |

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
- **Device can't connect** → wrong IP / not same Wi-Fi / Mac firewall blocking
  `merod`. Use the LAN URL from `make node`.
- **Objects appear in different places on each device** → relocalization hasn't
  completed; the joining device needs the published `ARWorldMap` and must see
  enough of the same scene to relocalize. Pan slowly over shared features.
- **Login works but no objects** → wrong/empty Context ID (see
  `app/.env.integration` → `E2E_CONTEXT_ID`).

---

## 9. Where to go next

The phased plan, task tracker, and AR-specific gotchas are in
[`../merointerier.md`](../merointerier.md). Built so far: the scene-graph
contract, MeroKit (with blobs), and the AR app skeleton (scan, place, sync,
presence, relocalization wiring). Next tickets: spatial comments UI,
shared-cursor avatars, lock UX, and a "Share room" button for the world map.
