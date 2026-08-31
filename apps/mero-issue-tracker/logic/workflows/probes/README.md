# Manual scenarios — not gated by CI

`smoke.yml` installs a **signed `.mpk` bundle**, not a bare wasm:

```yaml
- type: install_application
  path: ./logic/dist/com.calimero.mero-issue-tracker.mpk
```

It has to. This app declares a `services` table, so `create_context` passes
`service_name: issue-tracker` — and a `serviceName` that does not match the
bundle's `services` list fails with a bare 500 from
`POST /admin-api/contexts`. A bare wasm install produces a single-service
application with no service names at all, so the scenario cannot be rewritten to
use one without changing what it tests.

`ci.yml`'s `e2e` job hands over the **wasm** artifact (`wasm-<app>-<sha>`,
unpacked to `apps/<app>/logic/res/`), not the bundle. The `.mpk` is built by the
`wasm` job and uploaded separately as `mpk-<app>-<sha>`, which only the `browser`
job downloads. So this scenario has no bundle to install under the e2e job and
would fail on step 1.

That is not a regression from the migration — **the standalone repo never ran it
in CI either.** Its own `ci.yml` ran fmt/clippy/test, the bundle build, codegen
and the app's typecheck/unit tests. This file's header always said so:

> Usage (run from the chat project root, after a dev bundle has been built)

So it lives here, one directory deeper than `ci.yml`'s non-recursive
`workflows/*.yml` glob. Run it deliberately:

```sh
cd apps/mero-issue-tracker
pnpm logic:build                       # produces logic/dist/<package>.mpk
cd logic && merobox bootstrap run workflows/probes/smoke.yml
```

⚠️ `scripts/check-app-metadata.sh`'s merod-image check also globs
`apps/*/logic/workflows/*.yml`, so this file's `image:` pin is **maintained by
hand**. Keep it equal to `[workspace.metadata.mero-apps].merod-image` in the root
`Cargo.toml`, or the smoke test runs a different release than the contract is
built for.

**Worth fixing properly:** if `ci.yml`'s `e2e` job also downloaded the
`mpk-<app>-<sha>` artifact, bundle-installing scenarios like this one could be
gated. That helps every multi-service app (mero-drive has the same shape), but it
changes shared scaffolding and does not belong in a migration PR.
