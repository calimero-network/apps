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
make setup        # check prereqs + build the signed .mpk bundle
make node         # start a Calimero node + create a Room (prints a Context ID)
make app-gen      # generate MeroAR.xcodeproj (needs xcodegen + full Xcode)
make test         # contract unit tests + app tests
make workflows    # merobox suites against a real merod in Docker
make logic-bundle # rebuild just the .mpk (raw .wasm is not installable since rc.31)
```

> **Mero AR needs a physical ARKit device** (iPhone/iPad with an A12 chip or
> newer; LiDAR models also get scene-mesh reconstruction). The iOS Simulator
> cannot run an AR camera session, so simulator runs cover the login, room, and
> roles UI only. See **[requirements.md](requirements.md)**.

Implementation plan & task tracker: **[../merointerier.md](../merointerier.md)**.
Run `make help` for all targets.

## Identity & roles (core 0.11.0-rc.32)

Nothing in the contract trusts a client-supplied id. A member **is** an account:
every write is attributed to `env::account_id()`, and so is every ownership
record — the roster, an object's author, a lock holder, a comment's author, the
`AccessControl` admin tier and the `Ownable` room name. Someone in the room on a
phone and an iPad is one member holding one role, not two.

`env::device_id()` survives in exactly one place: **presence**. A camera pose is
a property of the phone holding the camera, so two devices are genuinely two
viewpoints and must not overwrite each other.

There is no `accounts` map. rc.20 keyed the roster by device and carried a
device→account self-registration map to reach the account a grant had to name;
rc.23 retired that twice over — the legacy `executor_id()` shim resolves to the
account (core#3510) and group membership is stated in accounts (core#3522) — so
the bridge is gone and a member id is a 64-hex `AccountId` everywhere, including
in what an admin types to grant a role.

| Who | Can |
| --- | --- |
| **admin** (room creator; owner) | everything, plus grant/revoke editor, clear the scene, break any lock, rename the room, transfer ownership |
| **editor** | place / move / recolor / delete objects, pin comments, publish the room scan |
| **viewer** (anyone who joins) | look around, appear in the room via presence |

So a second device that joins by invitation starts read-only: open the members
sheet from the room and toggle it to **editor**. The app hides the tools for a
viewer, and the contract rejects the write regardless.

**No RPC carries `executorPublicKey`.** The node resolves the caller from the
auth token on the request and hands the contract `env::account_id()`; the
JSON-RPC `execute` payload has no such field to read, so passing one only looked
like it was steering something. Who a write is attributed to is decided by which
session signed it, not by an argument.

## Status

- ✅ WASM scene-graph contract (objects + transforms, presence, comments, locking, versioned LWW, world-map blob) — core rc.32, builds + unit-tested
- ✅ Account identity model: account-attributed writes, account-keyed roles, owner-gated room name, admin lock-breaking — covered by both merobox suites
- ✅ App on the shared swift-sdk: login, Keychain session resume, live SSE, roles UI
- ✅ ARKit/RealityKit room view: place/sync objects, camera-pose presence, publish + relocalize into a shared `ARWorldMap`
- 🔵 Cross-device coordinate alignment via persisted `ARWorldMap` — needs on-device validation with two phones
- ⬜ Spatial comments UI, shared-cursor avatars, lock UX, undo/redo (next tickets — see `../merointerier.md`)
- ⬜ No Android client. [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) exists, but an Android AR app (ARCore) is greenfield work, not a port of this one.
