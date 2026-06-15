# Mero AR

Collaborative spatial editing on the [Calimero](https://calimero.network) p2p
node network — multiple people scan the same room and edit a shared 3D scene,
with every change synchronized through Mero nodes (Figma-meets-ARKit).

```
logic/      Rust WASM contract (scene graph: objects, transforms, presence, comments, locks)
app/
  MeroKit/  native Swift Calimero client (RPC + SSE + admin + auth + blobs)
  MeroAR/   SwiftUI + ARKit + RealityKit app
scripts/    dev-node / dev-node2 / dev-invite / setup
workflows/  CI
Makefile    every command has a `make` shortcut
```

## Quick start

```bash
make setup        # check prereqs + build the WASM contract
make node         # start a Calimero node + create a Room (prints a Context ID)
make kit-verify   # smoke-test the Swift client (no Xcode required)
make app-gen      # generate MeroAR.xcodeproj (needs xcodegen + full Xcode)
```

> **Mero AR needs a physical ARKit device** (iPhone/iPad with an A12 chip or
> newer; LiDAR models also get scene-mesh reconstruction). The iOS Simulator
> cannot run an AR camera session. See **[requirements.md](requirements.md)**.

Implementation plan & task tracker: **[../merointerier.md](../merointerier.md)**.
Run `make help` for all targets.

## Status

- ✅ WASM scene-graph contract (objects + transforms, presence, comments, locking, versioned LWW, world-map blob) — builds + unit-tested
- ✅ MeroKit incl. `BlobApi` for ARWorldMap/mesh — builds + tested
- ✅ App skeleton: login, ARKit/RealityKit room view, place/sync objects, camera-pose presence, world-map relocalization wiring
- 🔵 Cross-device coordinate alignment uses persisted `ARWorldMap` (the chosen approach) — needs on-device validation
- ⬜ Spatial comments UI, shared-cursor avatars, lock UX, undo/redo (next tickets — see `../merointerier.md`)
