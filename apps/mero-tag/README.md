# Mero Tag

Distributed, real-time location sharing on the [Calimero](https://calimero.network)
p2p node network — an AirTag/Find My-style app where location updates propagate
through Mero nodes instead of a central server.

```
logic/      Rust WASM contract (calimero-sdk)
app/
  MeroKit/  native Swift Calimero client (JSON-RPC + SSE + auth + admin)
  MeroTag/  SwiftUI iOS app (MapKit + CoreLocation)
scripts/    dev-node / dev-node2 / dev-invite / setup
workflows/  CI
```

## Quick start

```bash
make setup        # check prereqs + build the WASM contract
make node         # start a Calimero node + create a tracking space (prints a Context ID)
make kit-verify   # smoke-test the Swift client (no Xcode required)
make app-run      # build + run the app in the iOS Simulator (requires full Xcode)
```

Full Mac + iPhone walkthrough: **[requirements.md](requirements.md)**.
Implementation plan & task tracker: **[../merotag.md](../merotag.md)**.

Run `make help` for all targets.

## Status

- ✅ WASM contract (trackers, locations, sharing, groups, geofences, presence, history) — builds + unit-tested
- ✅ MeroKit (RPC execute, SSE, admin, auth, Keychain) — builds + tested
- ✅ App skeleton: login, trackers list, live map, tracker detail, CoreLocation publishing
- ⬜ Geofence authoring, history playback, groups UI (next tickets — see `../merotag.md`)
