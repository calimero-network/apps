# Mero AR — Requirements & How to Run

Mero AR is a collaborative spatial-editing iOS app on Calimero: several devices
scan the same room and edit one shared 3D scene, kept by the organization's
Calimero 1.0 cluster. This is the end-to-end guide to building and running it.

```
mero-ar/
  logic/      Rust WASM contract (the scene-graph backend, runs as an app instance on the cluster)
  app/
    MeroAR/   the SwiftUI + ARKit + RealityKit app (depends on the shared swift-sdk)
  scripts/    setup.sh
  Makefile    every command below has a `make` shortcut
```

> **What talks to what:** the iOS app → **MeroKit**, the shared Calimero Swift
> SDK ([calimero-network/swift-sdk](https://github.com/calimero-network/swift-sdk),
> pinned by revision in `app/MeroAR/project.yml`) → a **node of your cluster**,
> after verifying its TDX quote, over the sealed channel (`/apps/{room}/intents`
> for writes, `/views` for reads, `/events` for live changes, `/blobs` for the
> world map and scans) → the **WASM contract** running as the room's app
> instance. Devices relocalize into a shared coordinate frame by downloading the
> room's `ARWorldMap` blob.

---

## 1. Device requirement (read first)

**Live AR needs a physical ARKit device**, an iPhone or iPad with an A12 Bionic
chip or newer. LiDAR models also get room scanning. Elsewhere the room opens as
a 3D preview with the same tools.

---

## 2. Prerequisites

| Tool | Needed for | Install |
|------|-----------|---------|
| **Rust** + `wasm32-unknown-unknown` | building the WASM contract | <https://rustup.rs> then `rustup target add wasm32-unknown-unknown` |
| **`cargo mero`** (core 1.0.0-rc.3) | building and bundling the contract | the core release of the tag in `logic/Cargo.toml` |
| **Full Xcode** (16+) | building the app, device deploy | Mac App Store |
| **XcodeGen** | generating the `.xcodeproj` | `brew install xcodegen` |
| **A Calimero cluster** | running rooms | Calimero Cloud, or `merod local` for development |

Verify everything with `make setup`.

---

## 3. A cluster

- **Calimero Cloud:** your organization's cluster, from the console at
  cloud.calimero.network. Note a node's address; the app asks for it once.
  Mero AR is installed from the app registry (`com.calimero.mero-ar`) when the
  first room is created.
- **Development:** `merod local` in a core checkout (3 nodes on
  `127.0.0.1:2501-2503`, mock attestation; Linux only, so in Docker on a Mac),
  then install this repo's contract: `make logic-bundle` and
  `meroctl app install --path logic/res/mero-ar.mpk`.

---

## 4. Build & run on your iPhone/iPad

1. `make app-gen` and open `app/MeroAR/MeroAR.xcodeproj`.
2. **Signing:** choose your team on the **MeroAR** target. For passkeys on a
   real cluster, add the Associated Domains entitlement
   `webcredentials:<the cluster's passkey domain>`.
3. Run on the device.
4. **In the app:** enter the cluster address and **Continue with passkey** (or
   **Create an account with a new passkey**). For a development cluster, use
   **Development cluster (merod local)** with the node URL (the Mac's LAN
   address from a phone).
5. **New home** creates an organization and its first room. Invite people from
   the home (or from People inside a room); they paste the link in **Join**.

---

## 5. Multi-device collaboration

1. The second person signs in with their own account and pastes the invite link.
2. On the first device (the room's admin), scan, then **Share scan** to publish
   the `ARWorldMap` (`set_world_map`).
3. The second device downloads that map on entry and relocalizes into the same
   coordinate frame. Edits arrive live over the room's event stream.

**Roles:** whoever created the room is its admin; people who join are viewers
until promoted to editor in People. Admins of the home's organization can also
moderate. This is contract-enforced, not just UI.

**Updates:** when a newer Mero AR release is out, People shows **Update
available**. An admin approves it on the node's consent page, which opens in
Safari; core accepts approvals only there.

---

## 6. Testing

| Command | What it runs | Needs Xcode? |
|---------|-------------|--------------|
| `make logic-test` | Rust unit tests + TestHost tests of the 1.0 semantics | no |
| `make app-build` | the app for a generic iOS device, unsigned | yes |
| `make app-test` | app unit tests against the in-memory `FixtureCluster` | yes |

---

## 7. Troubleshooting

- **"The node could not be verified"** → the node's attestation didn't check
  out. For `merod local`, use **Development cluster**, which trusts its mock
  attestation.
- **"This node may not serve your account"** → try another node of the cluster.
- **"Your session ended"** → sign in again; a refresh token is single-use.
- **"View-only — ask an admin for editor access"** → promote the member from
  the admin's People sheet.
- **Objects appear in different places on each device** → relocalization hasn't
  completed; pan slowly over shared features.
- **SwiftPM can't resolve MeroKit** → cold builds fetch the SDK from GitHub;
  check network access, or `File ▸ Packages ▸ Reset Package Caches`.
