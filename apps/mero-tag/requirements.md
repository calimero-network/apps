# Mero Tag: requirements and how to run it

Mero Tag is a real-time location-sharing iOS app built on Calimero. This is the end-to-end guide to building it and
running it in the Simulator and on an iPhone.

```
mero-tag/
  logic/      Rust contract, a calimero:app component (runs on your cluster's nodes)
  app/
    MeroTag/  the SwiftUI iOS app (depends on calimero-network/swift-sdk)
  scripts/    setup, publish-bundle
  Makefile    every command below has a `make` shortcut
```

> **What talks to what:** the iOS app → **MeroKit / MeroKitUI** (the Calimero Swift SDK) → the **Calimero Cloud
> relay** that serves your account → your **WASM contract**, running in that relay's node.
>
> - Writes are warrant intents the device signs.
> - Reads are queries.
> - Live events arrive over SSE.

---

## 1. Prerequisites

| Tool | Needed for | Install |
|------|-----------|---------|
| **Rust** + `wasm32-wasip2` | building the component contract | <https://rustup.rs>; `logic/rust-toolchain.toml` pins core's toolchain and target |
| **mero-component** | component build + signed bundle | `make tools` (calimero-network/apps' component bundler) |
| **Full Xcode 16+** | building / running the app, XCTest, deploying to a device | Mac App Store, then `sudo xcode-select -s /Applications/Xcode.app` |
| **XcodeGen** | generating the `.xcodeproj` | `brew install xcodegen` |
| **A Calimero account** | signing in | created with a passkey in the Calimero wallet on first sign-in |
| `merod` (Linux, or Docker on macOS) | *optional:* a `merod local` development cluster | build from calimero-network/core |

Check everything at once with `make setup`.

---

## 2. Quick start (Simulator)

```bash
make app-run      # xcodegen + xcodebuild + boot the Simulator + launch
```

1. Tap **Continue with Calimero**. The Calimero wallet opens in a system sheet. Approve this device with your passkey,
   and you're back in the app.
2. On **Choose a space**, enter the name others see, then either **Create a space** (you own it) or paste the invite
   link someone sent you and tap **Join space**. Opening an invite link (`merotag://join?invitation=…`) does the same.
   In a space, **Invite people** on the Space tab creates a link to share.
3. On **Trackers**, tap **+** to create a tracker for this phone. Keep *Report this phone's location* on.
4. Open **Map**. In the Simulator, simulate movement with **Features ▸ Location**. Anyone you share the tracker with
   sees it move live.

Passkeys in the Simulator need an Apple ID signed in with iCloud Keychain. For the smoothest run, use a real device.

---

## 3. Running on a physical iPhone

1. `make app-gen`, then `open app/MeroTag/MeroTag.xcodeproj`.
2. Select the **MeroTag** target ▸ *Signing & Capabilities* ▸ your team.
3. Plug in the iPhone, select it, and press **⌘R**.
4. The first time only: on the phone, trust your developer certificate in *Settings ▸ General ▸ VPN & Device
   Management*.
5. Sign in with Calimero and open your space, as above. When asked about location, choose *Allow While Using*, or
   *Always* for background sharing.

The phone talks to the hosted relay over the internet, so you don't need a local network or a Mac-hosted node.

---

## 4. Multi-device demo

Sign in on two devices, with two accounts. Open the **same space** on both, then share a tracker from one with the
other's member (tracker ▸ **Share**). Move one device and watch the other's map update live.

---

## 5. Testing

| Command | What it runs | Needs Xcode? |
|---------|-------------|--------------|
| `make logic-test` | Rust unit tests for the pure helpers, then the contract on core's wasmtime engine (`tests/harness.rs`, `scenarios/*.json`) | no |
| `make logic-build` | the `calimero:app` component and its ABI (`logic/res/`) | no |
| `make app-test` | App unit tests (events, service args, store, session) + sign-in UI smoke test | yes |
| `make test` | `logic-test` (the no-Xcode subset) | no |

CI (`.github/workflows/ci.yml`) runs the contract's tests and clippy (host and `wasm32-wasip2`) on Linux, and the
app's unit tests on a macOS runner.

---

## 6. A development cluster (contract work)

```bash
# in calimero-network/core (merod is Linux-only; on macOS run it in Docker)
cargo run -p merod -- local                     # 3 nodes on :2501-2503, mock attestation
meroctl node add local http://127.0.0.1:2501/ --allow-mock
meroctl login --dev-passkey ./dev-passkey.json --name ada
make logic-bundle                               # here: logic/dist/mero-tag-dev.mpk
meroctl app install --path logic/dist/mero-tag-dev.mpk
```

In the app, **Development cluster** takes the node's URL. `logic/scenarios/*.json` are written to run on such a
cluster too (accounts named `@alice`, `@bob`); the same files run in `cargo test`.

---

## 7. Troubleshooting

- **`xcodebuild` says "tool not found".** Full Xcode isn't selected. Run
  `sudo xcode-select -s /Applications/Xcode.app`.
- **The package fails to resolve, or MeroKit / MeroKitUI APIs are missing.** The app needs swift-sdk `0.2.0` or
  later. Reset the package cache (*File ▸ Packages ▸ Reset Package Caches*), or to try an unreleased SDK change:
  1. Temporarily set the `path:` in `project.yml`.
  2. Run `make app-gen`.
- **"Couldn't open that space".** Either the ID is wrong, or your account isn't a member of that context on its relay.
  Ask the owner for an invitation.
- **"No relay yet".** A new account gets a relay when it accepts its first invitation.
- **"Refreshing" instead of "Live".** The relay session for events couldn't be established. Writes still work, and the
  app refreshes every 20 seconds. *Space ▸ Show technical details* shows why.
- **The map shows nothing.** Grant location permission. In the Simulator, set a location with
  *Features ▸ Location*.
