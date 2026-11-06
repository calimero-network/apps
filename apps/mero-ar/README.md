# Mero AR

Collaborative spatial editing on [Calimero](https://calimero.network): several
people scan the same room and edit a shared 3D scene, with every change kept by
their organization's attested Calimero cluster (Figma-meets-ARKit).

**Landing page:** [`landing/`](landing/), a static site explaining how Mero AR
works, with real recordings from the app and a promo film. `cd landing && npm
install && npm run dev`; deploys to Vercel as-is (`landing/vercel.json`).

```
logic/      Rust contract, a calimero:app component (scene graph: objects, transforms, presence, comments, locks, roles)
app/
  MeroAR/   SwiftUI + ARKit + RealityKit app (SceneKit 3D preview where ARKit isn't available)
landing/    the landing page (Vite + React + Framer Motion), media in landing/public/media
promo/      the promo film (Remotion), rendered into landing/public/media
scripts/    setup.sh
Makefile    every command has a `make` shortcut
```

Built for **Calimero core 1.0** (`1.0.0-rc.9`): the contract is a
`calimero:app` WebAssembly component on core's **component SDK**
(`calimero-sdk`, pinned to that tag in `logic/Cargo.toml`, `min-runtime-version`
too) that runs on the node's wasmtime runtime, and the app uses the Swift SDK's
1.0 client (`CalimeroClient`: sealed channel, passkeys).

## The iOS app

A dark, spatial design of its own: glass panels over the camera, an aurora
(violet → cyan) accent, SF Symbols, spring animations and haptics.

- **Sign in** with your cluster's address (from the Calimero Cloud console) and
  a passkey, or create an account with a new one. **Development cluster** takes
  a `merod local` node URL instead (mock attestation, a soft passkey kept for
  that node).
- **Nickname**: asked once after sign-in; it's the name on the roster, on
  notes and on what you place. Change it in Settings or from your row in People.
- **Your homes**: a *home* is a Calimero organization holding Mero AR, and its
  rooms are the organization's app instances of `com.calimero.mero-ar`. **New
  home** creates the organization and its first room (`POST /orgs`,
  `POST /apps` with access `org`, installed from the registry by the cluster).
  Each home lists its rooms, with **+** for another room and **Invite** for a
  link to the whole home. **Join** takes a home or room invite link (an org
  invite token, redeemed as your account), or a room ID.
- **The room**: a tool dock (Add, Notes, Share scan, People); an object library
  with **furniture** at real size (sofa, armchair, chair, dining and coffee
  tables, bed, bookcase, floor lamp, plant, rug, TV on a media unit, wall TV,
  picture frame), **your photos** framed on the wall (uploaded as a blob into
  the room, so every peer sees the picture), and shapes (cube, sphere, arrow,
  marker, 3D labels, six colours); an inspector for the
  selected object (move, turn, resize, paint, lock, delete); notes pinned in
  space; other people's viewpoints; Apple's coaching overlay while scanning.
- **People**: roles (admin / editor / viewer), editor toggles for admins,
  invites as a link (Share or Copy link) to the room's home, and **Update
  available** when a newer Mero AR release is out: an admin reviews and approves
  it on the node's consent page in Safari.
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
  the parametric USDZ RoomPlan exports. Both are uploaded as blobs of the
  room's app instance, and the contract's `setRoomScan` records them (blob
  ids, sizes, dimensions, `scannedBy`, `scannedAt`, `version`; one current
  scan per room, a new one bumps the version). Peers download the model from
  the room's blobs, like the `ARWorldMap`.
- **View and edit:** the 3D room (SceneKit, non-AR, so it renders in the
  Simulator and on every device) rebuilds walls, floor, door and window
  frames and the detected furniture (labelled by category). Orbit and zoom, or
  flip to a top-down **floor plan**. Scene objects live in room coordinates:
  add them from the library, **drag them across the floor** (snapped to the
  floor, kept inside the walls), and turn, resize, paint, lock or delete them
  with the inspector. Everyone's edits sync as before.
- **Make scanned furniture movable** (Room menu): the sofa, chairs, tables,
  bed, storage and TV the scan detected become catalogue furniture placed,
  turned and sized as scanned, and the room is shared again without the static
  boxes, so anyone can rearrange the real room's furniture. Fixtures (sinks,
  stairs, a fireplace) stay part of the room.
- **Live AR:** with a 3D room shared, the dock offers *3D room*; *Align to my
  room* shares the AR world map so devices in the same physical room line up.
- **Try a sample room:** a built-in 5.2 × 4.2 m living room (walls, a door,
  two windows, sofa, table, chairs, TV, storage), always labelled *Sample
  room*. It's what the Simulator, the tests and the recordings use, since
  RoomPlan can't run there. It is not a real scan.

Contract: `setRoomScan`, `getRoomScan`, `clearRoomScan` (admin), event
`RoomScanUpdated`.

**Limits:** scanning needs LiDAR; the Simulator only has the sample room;
aligning live AR to a shared scan uses ARKit relocalization and has not been
tested on devices yet; the parametric USDZ is shared but the app renders the
room from the model, not the USDZ.

### Run it against a development cluster

```bash
make tools        # once: mero-component, the component bundler
make dev          # merod local on :2501-2503 (Docker on a Mac), then bundle + install the contract
make app-gen      # then run from Xcode
```

`make dev` runs [`scripts/dev-cluster.sh`](scripts/dev-cluster.sh): core's
`merod local` (three nodes, mock attestation) from
`ghcr.io/calimero-network/merod` in Docker, because merod 1.0 is Linux-only.
Set `MEROD_BIN` to a merod 1.0 binary to run that instead. State is kept across
runs; `scripts/dev-cluster.sh up --fresh` starts over, `make dev-down` stops it.

In the app, **Development cluster (merod local)** → `http://localhost:2501` in
the Simulator, or `http://<your Mac's LAN address>:2501` on an iPhone on the
same Wi-Fi (allow Local Network when asked; `scripts/dev-cluster.sh urls`
prints it). The app trusts that node's mock attestation and signs in with a
soft passkey it keeps for the node, creating the account the first time.

### How the app talks to the cluster

The Swift client is **not** vendored here: the app depends on
[calimero-network/swift-sdk](https://github.com/calimero-network/swift-sdk)
(`MeroKit` + `MeroKitUI`), declared in `app/MeroAR/project.yml` and pinned to
the SDK's Calimero 1.0 release, v0.5.0 (`exactVersion`).

The app first verifies the node's TDX quote (`GET /attestation`, against signed
mero-tee releases) and opens the sealed channel; everything else goes through
it. Sign-in is a passkey (`PlatformPasskey`); the session and its refresh token
live in the Keychain (service `network.calimero.meroar`), so a relaunch
reconnects without a prompt.

| What | How |
| --- | --- |
| Writes (`join`, `addObject`, `updatePresence`, roles…) | `POST /apps/{room}/intents`, run once on the room's leader as the signed-in account |
| Reads (`getRoom`, `getObjects`, `myRole`…) | `POST /apps/{room}/views` |
| World map, room scan, photos | the room's blobs, `/apps/{room}/blobs` |
| Live updates | the room's sealed SSE, `/apps/{room}/events`; while it is down the room re-reads every few seconds |
| Homes | organizations: `POST /orgs` (+ metadata `{name, package}`), rooms `POST /apps` with access `org` |
| Invitations | `POST /orgs/{org}/invites` (role member), redeemed with `POST /invites/{token}/redeem` |
| Upgrades | `POST /consent/requests` → the node's consent page in Safari → `GET /consent/{id}/result` |

### Tests without a node

Debug builds carry `FixtureCluster` (`Sources/Debug/`): an in-memory Calimero
cluster with Mero AR's contract, behind the app's own `RoomCluster` protocol.
The app's real code runs against it with no network.

- **`AppFlowTests`** (unit): two people on one fixture. They cover homes and
  rooms, home and room invitations (including a forged one), roles and edit
  grants, locks, objects, notes, the shared 3D room and world map, nicknames
  and sign-out.
- **`FixtureUITests`** (UI): the app launched with `MEROAR_FIXTURE=1`. One
  person goes through every screen: nickname, new home, objects, label, sample
  3D room, floor plan, inspector, notes, People and a second room. A second
  person, played by relaunching as someone else, joins by link, sees the room
  view-only, is made an editor, and adds an object.

`FurnitureFlowTests` use a `RecordingCluster` that records what the store sends.
`make app-test` runs the unit tests.

### Contract tests

`make logic-test` (`cargo test` in `logic/`) builds the contract into a
component and runs it on core's real wasmtime engine with an in-memory host
(`calimero_sdk::testing::TestApp`): `tests/harness.rs` covers roles, locks,
objects, notes, presence, the room scan, access and the wire, and
`tests/scenarios.rs` runs every `scenarios/*.json` (in the org its `.org.json`
names), the same files a `merod local` cluster can run.

### Contract API (component ABI)

Methods and argument names are camelCase: `whoami`, `getRoom`, `renameRoom`,
`setWorldMap`, `setRoomScan`, `getRoomScan`, `clearRoomScan`, `join`,
`getMembers`, `updateMemberUsername`, `addObject`, `updateTransform`,
`updateColor`, `lockObject`, `unlockObject`, `deleteObject`, `clearObjects`,
`getObjects`, `getObject`, `addComment`, `deleteComment`, `getComments`,
`updatePresence`, `getPresence`, `grantEditor`, `revokeEditor`, `getRole`,
`myRole`, `canEdit`, `listRoles`, `transferOwnership`. Reads are views. A
top-level `u64` argument or result (`setRoomScan`'s `jsonSize`, `usdzSize` and
returned version) is a decimal string; records (`SceneObject`, `RoomScan`, …)
keep their numbers. A refused call is `422 APP_ERROR` with code `Forbidden` or
`Invalid` and the sentence in `fields.message`.

### Building against an unmerged SDK

To try an SDK change that isn't released yet, build against a local checkout:
in `app/MeroAR/project.yml` replace the package's `url:`/`revision:` with
`path: /path/to/swift-sdk-checkout`, run `make app-gen`, and **don't commit
that change**.

## Identity & roles

Nothing in the contract trusts a client-supplied id. A member **is** an account:
every write is attributed to the caller's account (`env::caller()`), and so is
every ownership record — the roster, an object's author, a lock holder, a
comment's author, the room's admins and its owner. Someone in the room on a
phone and an iPad is one member holding one role, not two.

Core 1.0 has no devices at all, so presence is keyed by account too: one camera
per member. A role can be granted to any account of the room's organization
(`Invalid` otherwise), before they have ever opened the room.

Admins of the room's organization (`env::org_role` admin or owner) pass the
room's admin and editor gates as well: they can moderate any room in their
home. Granting roles and transferring ownership stay with the room's own
admins.

| Who | Can |
| --- | --- |
| **admin** (room creator; owner) | everything, plus grant/revoke editor, clear the scene, break any lock, rename the room, transfer ownership |
| **editor** | place / move / recolor / delete objects, pin comments, publish the room scan |
| **viewer** (anyone who joins) | look around, appear in the room via presence |

So a second device that joins by invitation starts read-only: open the members
sheet from the room and toggle it to **editor**. The app hides the tools for a
viewer, and the contract rejects the write regardless.

**No call names its own author or its time.** A write runs as the passkey
session's account, so the contract sees `env::caller()` = that person; and
it runs once, on the room's Raft leader, which stamps every record with its own
clock. Who wrote something, and when, is never an argument.

## The world map is a blob

Relocalization is the one thing here that isn't contract state: the room's
`ARWorldMap` is uploaded as a blob of the room's app instance and the contract
stores only its id. Core 1.0 keeps an app's blobs on every node of its cluster,
so there is nothing to announce; anyone who can reach the room can download it.

## Status

- ✅ Scene-graph contract (objects + transforms, presence, comments, locking, version counter, world-map blob, room scan) — a component on core 1.0.0-rc.9's SDK, tested on core's wasmtime engine (TestApp harness + scenarios)
- ✅ Account identity model: account-attributed writes, account-keyed roles and presence, owner-only room rename, admin lock-breaking, org admins moderate
- ✅ App on the swift-sdk 1.0 client: passkey sign-in on an attested cluster, sealed intents/views/events, Keychain session resume, orgs as homes, invites, consent-page upgrades
- ✅ Its own dark spatial design (glass panels, aurora accent, SF Symbols, ids behind "Technical details")
- ✅ Development clusters (`merod local`, mock attestation), room list and room creation, recent rooms
- 🔵 Not yet exercised end to end against a live 1.0 cluster from the app
- ✅ Object library, inspector (move / turn / resize / paint / lock / delete), notes, invite links, presence of others
- ✅ SceneKit 3D preview of the shared room where ARKit isn't available (Simulator, Mac)
- ✅ ARKit/RealityKit room view: place/sync objects, camera-pose presence, publish + relocalize into a shared `ARWorldMap`
- 🔵 Cross-device coordinate alignment via persisted `ARWorldMap` — needs on-device validation with two phones
- ✅ Your room in 3D: RoomPlan scan (LiDAR) or the labelled sample room, shared as blobs + `room_scan` record, 3D room and floor plan, drag on the floor
- 🔵 Live AR alignment to a shared room scan — needs on-device validation
- ⬜ Undo/redo, image objects, dragging objects by touch in AR (next tickets — see `../merointerier.md`)
- ⬜ No Android client. [kotlin-sdk](https://github.com/calimero-network/kotlin-sdk) exists, but an Android AR app (ARCore) is greenfield work, not a port of this one.

## Landing page, recordings and promo

- **Landing page:** `landing/` (Vite + React + TypeScript + Framer Motion). `npm
  run dev` to work on it, `npm run build` for `dist/`. Respects reduced motion and
  the system light/dark setting.
- **Recordings:** the clips in `landing/public/media/` were filmed from the 0.x
  app; the recording script went with the 0.x dev nodes and has not been
  rebuilt for 1.0 yet.
- **Promo film:** `cd promo && npm install && npm run render` renders `promo`
  (1920×1080) and `promo-vertical` (1080×1920) with Remotion into `promo/out/`,
  using the recordings above, plus the poster. Compress for the web with
  `ffmpeg -i out/promo.mp4 -c:v libx264 -crf 28 -preset slow -an -movflags
  +faststart ../landing/public/media/promo.mp4`. The phone-in-a-room scan shot is
  motion graphics and is labelled as an illustration.
