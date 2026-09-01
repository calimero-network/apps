# merobox scenarios — manual, not gated by CI

`spec-smoke.yml` installs a **signed `.mpk` bundle**, because this app declares a
`services` table (`spreadsheet`) and so every `create_context` passes
`service_name`. A `serviceName` that does not match the bundle's services list
fails with a bare 500 from `POST /admin-api/contexts`, and a bare wasm install
produces a single-service application with no service names at all.

`ci.yml`'s `e2e` job hands over the **wasm** artifact; the `.mpk` is uploaded
separately as `mpk-<app>-<sha>` and only the `browser` job downloads it. So this
would fail on step 1 under the e2e job, and it lives one level below the
non-recursive `workflows/*.yml` glob.

**Follow-up that fixes it:** download `mpk-<app>-<sha>` in `ci.yml`'s e2e job. That
re-gates this, mero-drive's eleven, battleships' two and mero-issue-tracker's
smoke — every multi-service app has the same shape.

## Changed during the migration

* **`image: merod:0.11.0-rc.8` → `0.11.0-rc.26`.** rc.8 is eighteen releases back;
  it would also have failed `check-app-metadata.sh`'s image assertion.
* **`path: ./logic/res/p2p-sheets-1.0.0.mpk` → `dist/com.calimero.mero-sheets.mpk`.**
  Three things at once: merobox resolves `path:` against its CWD (now
  `apps/p2p-sheets/logic`); `cargo mero bundle` writes to `dist/`, not `res/`; and
  it names the bundle after the **package id**, not `<name>-<version>.mpk` as the
  deleted `build-bundle.sh` did.

⚠️ NOT run, and NOT validated. The contract does not compile against rc.26 yet, so
there is no wasm to bundle. It has also not been through `merobox bootstrap
validate` on the pinned 0.6.66 — a scenario written against an rc.8-era merobox
will almost certainly carry stale fields (`path`/`capability` on `create_mesh`
were dropped; `expect_error` is not a field), which is what bit every app in this
batch that was checked.
