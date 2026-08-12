# Mero AR

Collaborative spatial editing on the [Calimero](https://calimero.network) p2p
node network — multiple people scan the same room and edit a shared 3D scene,
with every change synchronized through Mero nodes (Figma-meets-ARKit).

```
logic/      Rust WASM contract (scene graph: objects, transforms, presence, comments, locks, roles)
app/
  MeroAR/   SwiftUI + ARKit + RealityKit app
scripts/    dev-node / dev-node2 / dev-invite / setup
workflows/  merobox suites (logic-test.yml = 1 node, identity-and-roles.yml = 2 nodes)
Makefile    every command has a `make` shortcut
```

The Swift client is **not** vendored here: the app depends on
[calimero-network/swift-sdk](https://github.com/calimero-network/swift-sdk)
(`MeroKit`), pinned by commit in `app/MeroAR/project.yml`. That SDK brings the
actor-based single-flight token refresh, reactive 401→refresh retry, SSO, the
full admin API, and Keychain-backed tokens. To move to a newer SDK, bump the
`revision:` there and run `make app-test`.

## Quick start

```bash
make setup        # check prereqs + build the WASM contract
make node         # start a Calimero node + create a Room (prints a Context ID)
make app-gen      # generate MeroAR.xcodeproj (needs xcodegen + full Xcode)
make test         # contract unit tests + app tests
make workflows    # merobox suites against a real merod in Docker
```

> **Mero AR needs a physical ARKit device** (iPhone/iPad with an A12 chip or
> newer; LiDAR models also get scene-mesh reconstruction). The iOS Simulator
> cannot run an AR camera session, so simulator runs cover the login, room, and
> roles UI only. See **[requirements.md](requirements.md)**.

Implementation plan & task tracker: **[../merointerier.md](../merointerier.md)**.
Run `make help` for all targets.

## Identity & roles (core 0.11.0-rc.20)

Nothing in the contract trusts a client-supplied id. Every write is attributed to
`env::device_id()` (the real signer), and authorization gates on
`env::account_id()`, because `AccessControl`/`Ownable` are account-keyed since
rc.20 — one person, many devices. A `accounts` map records each device→account
pairing, self-registered on join and on every presence update, so an admin can
name a member in a grant.

| Who | Can |
| --- | --- |
| **admin** (room creator; owner) | everything, plus grant/revoke editor, clear the scene, break any lock, rename the room, transfer ownership |
| **editor** | place / move / recolor / delete objects, pin comments, publish the room scan |
| **viewer** (anyone who joins) | look around, appear in the room via presence |

So a second device that joins by invitation starts read-only: open the members
sheet from the room and toggle it to **editor**. The app hides the tools for a
viewer, and the contract rejects the write regardless.

Because the app must sign as its own device, every RPC carries
`executorPublicKey` — the identity from `/contexts/{id}/identities-owned`.

## Status

- ✅ WASM scene-graph contract (objects + transforms, presence, comments, locking, versioned LWW, world-map blob) — core rc.20, builds + unit-tested
- ✅ rc.20 identity model: device-attributed writes, account-keyed roles, owner-gated room name, admin lock-breaking — covered by both merobox suites
- ✅ App on the shared swift-sdk: login (incl. first-login setup code), Keychain session resume, live SSE, roles UI
- ✅ ARKit/RealityKit room view: place/sync objects, camera-pose presence, publish + relocalize into a shared `ARWorldMap`
- 🔵 Cross-device coordinate alignment via persisted `ARWorldMap` — needs on-device validation with two phones
- ⬜ Spatial comments UI, shared-cursor avatars, lock UX, undo/redo (next tickets — see `../merointerier.md`)
- ⬜ No Android client. [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) exists, but an Android AR app (ARCore) is greenfield work, not a port of this one.
