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
workflows/  CI (merobox scenarios; the merod image pin here MUST equal the
            calimero-sdk tag in logic/Cargo.toml — CI fails the pair)
```

Pinned to core **0.11.0-rc.42**.

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
  - sessions survive the hour: access tokens are refreshed reactively and
    single-flight, since `POST /auth/refresh` is single-use and a replay makes
    the node revoke the whole token family
  - a refusal the refresh cannot fix (`token_revoked` — a **403**, not a 401 —
    `token_reuse`, `permission_denied`) ends the session and returns the app to
    login with the reason, instead of reconnecting forever
- ✅ App skeleton: login, trackers list, live map, tracker detail, CoreLocation publishing
- ⬜ Geofence authoring, history playback, groups UI (next tickets — see `../merotag.md`)
