# Mero AR

Collaborative spatial editing on the [Calimero](https://calimero.network) p2p
node network — multiple people scan the same room and edit a shared 3D scene,
with every change synchronized through Mero nodes (Figma-meets-ARKit).

**Landing page:** [`landing/`](landing/), a static site explaining how Mero AR
works, with real recordings from the app and a promo film. `cd landing && npm
install && npm run dev`; deploys to Vercel as-is (`landing/vercel.json`).

```
logic/      Rust WASM contract (scene graph: objects, transforms, presence, comments, locks, roles)
app/
  MeroAR/   SwiftUI + ARKit + RealityKit app (SceneKit 3D preview where ARKit isn't available)
landing/    the landing page (Vite + React + Framer Motion), media in landing/public/media
promo/      the promo film (Remotion), rendered into landing/public/media
scripts/    dev-node / dev-node2 / dev-invite / setup, record-demo.sh, demo-peer.py
workflows/  merobox suites (logic-test.yml = 1 node, identity-and-roles.yml = 2 nodes)
Makefile    every command has a `make` shortcut
```

Built for **Calimero core 0.11.0-rc.90**: the contract pins `calimero-sdk`,
`calimero-storage` and `calimero-storage-macros` to tag `0.11.0-rc.90`
(`logic/Cargo.toml`, `min-runtime-version` too), and the merobox suites run
`ghcr.io/calimero-network/merod:0.11.0-rc.90`.

## The iOS app

A dark, spatial design of its own: glass panels over the camera, an aurora
(violet → cyan) accent, SF Symbols, spring animations and haptics.

- **Sign in** with Calimero Cloud, or **Manually enter node URL** for a node you
  run (URL + admin username and password).
- **Your rooms**: on a node session, the node's Mero AR rooms; otherwise the ones
  you opened before. **New room** (node sessions) installs `com.calimero.mero-ar`
  from the app registry if needed and creates the room; **Join** takes an invite
  link or a room ID.
- **The room**: a tool dock (Add, Notes, Share scan, People); an object library
  (cube, sphere, arrow, marker, 3D labels, six colours); an inspector for the
  selected object (move, turn, resize, paint, lock, delete); notes pinned in
  space; other people's viewpoints; Apple's coaching overlay while scanning.
- **People**: roles (admin / editor / viewer), editor toggles for admins, and
  invites as a signed link (Share or Copy link).
- **No ARKit?** In the Simulator, on a Mac or an older device, the room opens as
  a **3D preview** (SceneKit, orbit with a finger) with the same tools. The UI
  says so; live AR needs an ARKit iPhone or iPad. `MEROAR_PREVIEW=1` forces the
  preview on a device.

### Your room, in 3D

Scan your real room into a 3D model, share it with the people in the Mero AR
room, and decorate it together.

- **Scan** (Room menu → *Scan this room*): Apple RoomPlan (`RoomCaptureView`),
  with coaching text, Done, then a review screen with the room in 3D, its size,
  *Retake* and *Share with the room*. **Needs LiDAR** (iPhone 12 Pro and later
  Pro models, LiDAR iPads); elsewhere the option is replaced by an explanation.
- **Share:** the scan becomes a small portable room model (`RoomModel`,
  `meroar.room/1`: walls, doors, windows, openings and detected objects with
  category, dimensions and transform, mirroring RoomPlan's `CapturedRoom`) plus
  the parametric USDZ RoomPlan exports. Both are uploaded as blobs into the
  room's context, and the contract's `set_room_scan` records them (blob ids,
  sizes, dimensions, `scanned_by`, `scanned_at`, `version`; one current scan
  per room, a new one bumps the version). Peers download the model through the
  room's context, like the `ARWorldMap`.
- **View and edit:** the 3D room (SceneKit, non-AR, so it renders in the
  Simulator and on every device) rebuilds walls, floor, door and window
  frames and the detected furniture (labelled by category). Orbit and zoom, or
  flip to a top-down **floor plan**. Scene objects live in room coordinates:
  add them from the library, **drag them across the floor** (snapped to the
  floor, kept inside the walls), and turn, resize, paint, lock or delete them
  with the inspector. Everyone's edits sync as before.
- **Live AR:** with a 3D room shared, the dock offers *3D room*; *Align to my
  room* shares the AR world map so devices in the same physical room line up.
- **Try a sample room:** a built-in 5.2 × 4.2 m living room (walls, a door,
  two windows, sofa, table, chairs, TV, storage), always labelled *Sample
  room*. It's what the Simulator, the tests and the recordings use, since
  RoomPlan can't run there. It is not a real scan.

Contract: `set_room_scan`, `get_room_scan`, `clear_room_scan` (admin), event
`RoomScanUpdated`. The registry's published Mero AR may predate them: for a
local node, build this repo's contract (`make logic-bundle`) and launch the app
with `MEROAR_APP_BUNDLE=$PWD/logic/res/mero-ar.mpk` so **New room** installs it.

**End to end on two nodes:** `MERO_BIN=… scripts/e2e-room-scan.sh` runs the
app (sample room → two items → drag one on the floor plan) on node A, then
checks node B received the scan record, can download the room model, and has
both items at A's positions.

**Limits:** scanning needs LiDAR; the Simulator only has the sample room;
aligning live AR to a shared scan uses ARKit relocalization and has not been
tested on devices yet; the parametric USDZ is shared but the app renders the
room from the model, not the USDZ.

### Run it against a local node

```bash
make node                 # or any merod 0.11.0-rc.90 you run yourself
make app-run              # Simulator
```

Then **Manually enter node URL** → `http://localhost:2450` (`make node`'s port),
username `admin`, password `calimero1234`, and **New room**. In the Simulator
`localhost` is your Mac; on a phone use the Mac's LAN address. For a second
person, `make node2` and
`scripts/demo-peer.py --a <node1> --b <node2> --context <room id>` brings
"Leo" in from node 2: he joins, gets editor, and builds, over real
peer-to-peer sync.

### Cloud sign-in, relay session

The Swift client is **not** vendored here: the app depends on
[calimero-network/swift-sdk](https://github.com/calimero-network/swift-sdk)
(`MeroKit` + `MeroKitUI`) as a SwiftPM package declared in
`app/MeroAR/project.yml`, pinned to the
[0.2.0 release](https://github.com/calimero-network/swift-sdk/releases/tag/v0.2.0) (`from: 0.2.0`).

**Continue with Calimero Cloud** opens the Calimero wallet in the system sign-in
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

On a Cloud session the app does not create rooms: a room is a context inside a
space (namespace), created on a node (the app's node sign-in, `make node`, or
the web build); the phone joins it by invitation. On a node session, **New
room** creates one there: a namespace, an open group in it, and the room's
context.

### Building against an unmerged SDK

To try an SDK change that isn't released yet, build against a local checkout:
in `app/MeroAR/project.yml` replace the package's `url:`/`from:` with
`path: /path/to/swift-sdk-checkout`, run `make app-gen`, and **don't commit
that change**.

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

- ✅ WASM scene-graph contract (objects + transforms, presence, comments, locking, versioned LWW, world-map blob) — core rc.89, builds + unit-tested
- ✅ Account identity model: account-attributed writes, account-keyed roles, owner-gated room name, admin lock-breaking — covered by both merobox suites
- ✅ App on the shared swift-sdk: Cloud sign-in (wallet passkey → device certificate → relay), relay writes/reads, Keychain session resume, live SSE, roles UI
- ✅ Its own dark spatial design (glass panels, aurora accent, SF Symbols, ids behind "Technical details")
- ✅ Node sign-in (URL + admin login), room list and room creation on a node, recent rooms
- ✅ Object library, inspector (move / turn / resize / paint / lock / delete), notes, invite links, presence of others
- ✅ SceneKit 3D preview of the shared room where ARKit isn't available (Simulator, Mac)
- ✅ ARKit/RealityKit room view: place/sync objects, camera-pose presence, publish + relocalize into a shared `ARWorldMap`
- 🔵 Cross-device coordinate alignment via persisted `ARWorldMap` — needs on-device validation with two phones
- ✅ Your room in 3D: RoomPlan scan (LiDAR) or the labelled sample room, shared as blobs + `room_scan` record, 3D room and floor plan, drag on the floor, two-node e2e
- 🔵 Live AR alignment to a shared room scan — needs on-device validation
- ⬜ Undo/redo, image objects, dragging objects by touch in AR (next tickets — see `../merointerier.md`)
- ⬜ No Android client. [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) exists, but an Android AR app (ARCore) is greenfield work, not a port of this one.

## Landing page, recordings and promo

- **Landing page:** `landing/` (Vite + React + TypeScript + Framer Motion). `npm
  run dev` to work on it, `npm run build` for `dist/`. Respects reduced motion and
  the system light/dark setting.
- **Recordings:** `MERO_BIN=/path/to/merod-rc89/bin scripts/record-demo.sh` boots
  two local nodes, drives the app in the "iPhone 18 Pro Max" simulator through
  the recording UI tests (`testRecord*`), brings a second person in over
  `scripts/demo-peer.py`, and writes `clip-signin`, `clip-room` and
  `clip-invite` (`.mp4` + poster `.jpg`) into `landing/public/media/`. They are
  Simulator recordings, so the room shows as its 3D preview.
- **Promo film:** `cd promo && npm install && npm run render` renders `promo`
  (1920×1080) and `promo-vertical` (1080×1920) with Remotion into `promo/out/`,
  using the recordings above, plus the poster. Compress for the web with
  `ffmpeg -i out/promo.mp4 -c:v libx264 -crf 28 -preset slow -an -movflags
  +faststart ../landing/public/media/promo.mp4`. The phone-in-a-room scan shot is
  motion graphics and is labelled as an illustration.
