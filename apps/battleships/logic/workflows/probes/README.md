# merobox scenarios — manual, not gated by CI

Both scenarios install a **signed `.mpk` bundle**, because Battleships is a
genuine **two-service** app: `lobby` for matchmaking and `game` per match. Every
`create_context` passes `service_name: lobby` or `service_name: game`, and a
`serviceName` that does not match the bundle's `services` list fails with a bare
500 from `POST /admin-api/contexts`. A bare wasm install produces a
single-service application with no service names at all.

`ci.yml`'s `e2e` job hands over the **wasm** artifact (`wasm-<app>-<sha>`); the
`.mpk` is uploaded separately as `mpk-<app>-<sha>` and only the `browser` job
downloads it. So these would fail on step 1 under the e2e job, and they live one
level below its non-recursive `workflows/*.yml` glob.

**Follow-up that fixes this properly:** teach `ci.yml`'s e2e job to download the
`mpk-<app>-<sha>` artifact. It re-gates these two, mero-drive's eleven, and
mero-issue-tracker's smoke scenario — every multi-service app has this shape.

## Changed during the migration

* **`image: ghcr.io/calimero-network/merod:edge` → `0.11.0-rc.26`.** `edge` is a
  MOVING tag and `force_pull_image: true` re-pulls it every run, so the release
  under test changed silently between runs.
* **`path: ../logic/res/battleships-0.3.2.mpk` → `dist/com.calimero.battleships.mpk`.**
  Two changes in one: merobox resolves `path:` against its CWD (now
  `apps/battleships/logic`), and `cargo mero bundle` names the bundle after the
  package id with the version in the manifest — not `<name>-<version>.mpk`, which
  is what the deleted `build-bundle.sh` produced.

⚠️ These have NOT been run. The contract does not compile against rc.26 yet, so
there is no wasm to bundle and nothing to run them against. They also have not
been through `merobox bootstrap validate` on the pinned 0.6.66 — expect stale
fields (`path` / `capability` on `create_mesh` were dropped, and `expect_error`
is not a field at all), which is what bit every other app in this batch.
