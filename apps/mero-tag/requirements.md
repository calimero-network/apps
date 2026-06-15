# Mero Tag — Requirements & How to Run

Mero Tag is a distributed, real-time location-sharing iOS app built on the
Calimero p2p node network. This document is the **end-to-end guide** to building
and running it on your Mac (simulator) and on a physical iPhone.

The repo is a single monorepo, structured the same way as `curb` and
`MeroDesign`:

```
mero-tag/
  logic/      Rust WASM contract  (the backend that runs inside a Calimero node)
  app/
    MeroKit/  Swift package — the Calimero client (JSON-RPC + SSE + auth + admin)
    MeroTag/  the SwiftUI iOS app
  scripts/    dev-node / dev-node2 / dev-invite / setup
  workflows/  CI definitions
  Makefile    every command below has a `make` shortcut
```

> **What talks to what:** the iOS app → **MeroKit** (Swift) → a **Calimero node**
> over HTTP (`/jsonrpc` for calls, `/sse` for live events) → your **WASM
> contract** running inside that node. There is no central server; nodes sync
> peer-to-peer.

---

## 1. Prerequisites

| Tool | Needed for | Install |
|------|-----------|---------|
| **Rust** + `wasm32-unknown-unknown` | building the WASM contract | <https://rustup.rs> then `rustup target add wasm32-unknown-unknown` |
| **`merod`** (Calimero node) | running the backend | Calimero install (you already have it at `/usr/local/bin/merod`) |
| **`jq`** | dev scripts | `brew install jq` |
| **Swift / Command Line Tools** | MeroKit logic + smoke test | `xcode-select --install` |
| **Full Xcode** (15+) | building/running the iOS app, XCTest, device deploy | Mac App Store |
| **XcodeGen** | generating the `.xcodeproj` | `brew install xcodegen` |

> ⚠️ **You currently have Command Line Tools only** (no full Xcode). MeroKit and
> the contract build/test without Xcode, but **building or running the iOS app
> (simulator or device) requires full Xcode.** Install it, then run
> `sudo xcode-select -s /Applications/Xcode.app` before the app steps.

Verify everything at once:

```bash
make setup
```

---

## 2. Quick start (Mac simulator)

```bash
# 1. Start the backend: build WASM, launch a node, create a tracking space.
make node
#    → prints Node URL, username/password, and a Context ID. Copy the Context ID.

# 2. Sanity-check the Swift client (works without Xcode).
make kit-verify

# 3. Generate + build + launch the app in the iOS Simulator (needs full Xcode).
make app-run
```

In the app's login screen:

| Field | Value |
|-------|-------|
| Node URL | `http://localhost:2440` |
| Username | `admin` |
| Password | `calimero1234` |
| Context ID | *(paste the value printed by `make node`)* |

Tap **Connect**. Create a tracker on the **Trackers** tab, then open the **Map**
tab — the simulator can simulate movement via **Features ▸ Location** in the
Simulator menu, and you'll see the marker update.

Stop everything with:

```bash
make stop
```

---

## 3. Running on a physical iPhone

The phone talks to the node running on your Mac over your **local network**, so
both must be on the same Wi-Fi.

1. **Find your Mac's LAN IP** — `make node` prints it (the "phone/LAN" URL), or:
   ```bash
   ipconfig getifaddr en0
   ```
2. **Open the project in Xcode:**
   ```bash
   make app-gen           # generates app/MeroTag/MeroTag.xcodeproj
   open app/MeroTag/MeroTag.xcodeproj
   ```
3. **Set your signing team:** select the **MeroTag** target ▸ *Signing &
   Capabilities* ▸ choose your Apple ID team. (Or edit `DEVELOPMENT_TEAM` in
   `app/MeroTag/project.yml` and re-run `make app-gen`.)
4. **Plug in your iPhone**, select it as the run destination, press **⌘R**.
   - First run: on the phone, *Settings ▸ General ▸ VPN & Device Management* →
     trust your developer certificate.
5. **In the app**, log in with:
   - Node URL: `http://<your-mac-ip>:2440`
   - Username `admin`, Password `calimero1234`
   - Context ID: the value from `make node`
6. Grant **location permission** when prompted (choose *Allow While Using* or
   *Always* for background sharing).

> **Mac firewall:** if the phone can't reach the node, allow incoming
> connections for `merod` (System Settings ▸ Network ▸ Firewall), or temporarily
> disable the firewall on your dev machine.

---

## 4. Multi-device demo (the Success Criteria)

**Easiest:** run the **simulator and your phone at the same time**, both pointed
at the *same* node (`make node`) with the *same* Context ID. Move one device and
watch the other update live — that already demonstrates real-time sync.

**Full P2P (two nodes syncing peer-to-peer):**

```bash
make node      # node1 on :2440, creates the space
make node2     # node2 on :2441, peers with node1
make invite    # node2 joins node1's space + context
```

Point one client at `:2440` and another at `:2441` (same Context ID). Updates
made on one node propagate to the other through Calimero's p2p sync.

---

## 5. Testing

| Command | What it runs | Needs Xcode? |
|---------|-------------|--------------|
| `make logic-test` | Rust unit tests for the contract's pure helpers | no |
| `make kit-verify` | MeroKit pure-logic smoke test (`swift run`) | **no** |
| `make kit-test` | Full MeroKit XCTest suite (output parser, SSE decode, RPC round-trip via a mock URLProtocol) | yes |
| `make app-test` | App UI smoke test (XCUITest) | yes |
| `make test` | `logic-test` + `kit-verify` (the no-Xcode subset) | no |

CI (`workflows/ci.yml`) runs the contract build/tests on Linux and the Swift +
app builds on macOS runners.

---

## 6. Common tasks

```bash
make logic-build     # rebuild just the WASM after editing logic/src/lib.rs
make node            # restart the node with the fresh WASM (wipes node state)
make app-gen         # regenerate the Xcode project after adding Swift files
make stop            # tear down nodes, free ports 2440/2441/2540/2541
make clean           # remove all build artifacts
```

After editing `logic/src/lib.rs`, you must `make node` again so the node picks
up the rebuilt contract (it reinstalls the app and recreates the space, which
resets state — expected in dev).

---

## 7. Troubleshooting

- **`xcodebuild` does nothing / "tool not found"** → full Xcode isn't selected.
  Install Xcode, then `sudo xcode-select -s /Applications/Xcode.app`.
- **App can't connect from the phone** → wrong IP, not on the same Wi-Fi, or Mac
  firewall blocking `merod`. Use the LAN URL printed by `make node`.
- **Login works but no data** → the Context ID is wrong or empty. Re-copy it
  from the `make node` output (or `app/.env.integration` → `E2E_CONTEXT_ID`).
- **`make node2`/`invite` fails with "no mesh peers"** → the two nodes haven't
  peered yet; the invite script retries, but give it a few seconds and re-run
  `make invite`.
- **Map shows nothing** → grant location permission; in the Simulator set a
  location via *Features ▸ Location*.

---

## 8. Where to go next

The phased implementation plan, task tracker, and known gotchas live in
[`../merotag.md`](../merotag.md). Phases P0–P2 (repo, MeroKit, contract) and the
core of P3–P4 (screens, live sync) are scaffolded here; geofences, history
playback, and groups UI are the next tickets.
