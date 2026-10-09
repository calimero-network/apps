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

Built for **Calimero core 0.11.0-rc.83**: the contract pins `calimero-sdk`,
`calimero-storage` and `calimero-storage-macros` to tag `0.11.0-rc.83`
(`logic/Cargo.toml`, `min-runtime-version` too), and the merobox suites run
`ghcr.io/calimero-network/merod:0.11.0-rc.83`.

## The iOS app: Cloud sign-in, relay session

The Swift client is **not** vendored here: the app depends on
[calimero-network/swift-sdk](https://github.com/calimero-network/swift-sdk)
(`MeroKit` + `MeroKitUI`) as a SwiftPM package declared in
`app/MeroAR/project.yml`. It needs two SDK changes that are open as PRs, so the
package tracks `branch: master` until they land and a release is cut:

- [swift-sdk#43](https://github.com/calimero-network/swift-sdk/pull/43) — the core rc.83 wire.
- [swift-sdk#44](https://github.com/calimero-network/swift-sdk/pull/44) — Cloud sign-in, the account layer and `RelayClient`.

**Sign-in is Cloud only.** There is no node URL, username or password in the
app. **Continue with Calimero** opens the Calimero wallet in the system sign-in
sheet (`ASWebAuthenticationSession`); the person approves this device with their
passkey, and the wallet returns to `meroar://enrol` with a device certificate.
The SDK verifies it, asks the Cloud manager which relay serves the account, and
logs in there. Device keys, the session and relay tokens live in the Keychain
(service `network.calimero.meroar`), so a relaunch reconnects without the wallet.

Every contract call then goes through that relay:

| What | How |
| --- | --- |
| Writes (`join`, `add_object`, `update_presence`, roles…) | warrant intents — `RelayClient.execute`, signed by the device, executed as the account |
| Reads (`get_room`, `get_objects`, `my_role`…) | `RelayClient.query` with the relay's Bearer session |
| World map blob | the relay's Bearer `Mero` — upload with `context_id`, download via `admin.getBlob(_:contextId:)` |
| Live updates | SSE on the relay's Bearer session; the room polls if that session isn't up |
| Invitations | signed by the account on the device (`CloudSignIn.createNamespaceInvitation`, naming the space's relays as admitters), redeemed with `CloudSignIn.join` |

Rooms are entered from the lobby by pasting an invite link (the fleet format,
`links.calimero.network/com.calimero.mero-ar/join?invitation=…`) or a room ID
the account is already in. A new account with no relay gets one by redeeming
its first invitation.

The app does not create rooms. A room is a context inside a space (namespace),
created where the contract is deployed (`make node`, or the web build); the
phone joins it. Founding a space from the phone (`CloudSignIn.foundNamespace`)
would also need a context created in it, which is out of scope here.

### Building against an unmerged SDK

Until #43/#44 are on swift-sdk master, build against a local checkout that
merges both branches: in `app/MeroAR/project.yml` replace the package's
`url:`/`branch:` with `path: /path/to/swift-sdk-checkout`, run `make app-gen`,
and **don't commit that change**.

## Identity & roles

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

**No call names its own author.** A write is a warrant signed by this device's
key under the account's certificate; the relay executes it and the contract
sees `env::account_id()` = that account. Who a write is attributed to is decided
by who signed it, not by an argument.

## The world map is a blob, and a blob needs a context (core 0.11.0-rc.39)

Relocalization is the one thing here that does not travel on the DAG: the room's
`ARWorldMap` is uploaded as a blob and the contract stores only its id.

core#3823 (0.11.0-rc.39) removed the blob DHT. `?context_id=` is now the **only**
index a node has — an upload without one is announced to nobody, and a download
without one has nowhere to look. Neither fails loudly: the request is well
formed, the node answers, and the bytes simply never arrive. It is also
invisible from the device that published the map, which holds the bytes locally
and relocalizes perfectly; it only breaks for everyone else in the room, which
is the whole point of a *shared* world map. So both calls in `MeroARService`
carry the room's context id, and `BlobRequestTests` asserts the requests still do.

Two more things the same code depends on:

- **A blob id is hex** (core#3691, rc.27 removed base58). It is stored on the
  contract exactly as the node minted it and is never re-encoded.
- **The transfer timeout is not the SDK default.** `MeroConfig.timeout` is 10s,
  which is right for an admin call. Downloads use the SDK's context-blob timeout
  (60s, covering the node's 30s peer probe); the upload carries 120s, since a
  scanned room's `ARWorldMap` is megabytes on a phone uplink.

## Status

- ✅ WASM scene-graph contract (objects + transforms, presence, comments, locking, versioned LWW, world-map blob) — core rc.83, builds + unit-tested
- ✅ Account identity model: account-attributed writes, account-keyed roles, owner-gated room name, admin lock-breaking — covered by both merobox suites
- ✅ App on the shared swift-sdk: Cloud sign-in (wallet passkey → device certificate → relay), relay writes/reads, Keychain session resume, live SSE, roles UI
- ✅ Light Calimero design (the apps' light tokens, SF Symbols, ids behind "Show technical details")
- ✅ ARKit/RealityKit room view: place/sync objects, camera-pose presence, publish + relocalize into a shared `ARWorldMap`
- 🔵 Cross-device coordinate alignment via persisted `ARWorldMap` — needs on-device validation with two phones
- ⬜ Spatial comments UI, shared-cursor avatars, lock UX, undo/redo (next tickets — see `../merointerier.md`)
- ⬜ No Android client. [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) exists, but an Android AR app (ARCore) is greenfield work, not a port of this one.
