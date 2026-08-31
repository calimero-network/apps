# merobox scenarios — manual, not gated by CI

All eleven scenarios here install a **signed `.mpk` bundle**:

```yaml
- type: install_application
  path: dist/com.calimero.mero-drive-docs.mpk
```

They have to. Mero Drive is a genuine **two-service** app — `docs` and
`registry` — so every `create_context` passes `service_name: docs` or
`service_name: registry`, and a `serviceName` that does not match the bundle's
`services` list fails with a bare 500 from `POST /admin-api/contexts`. Installing
a bare wasm produces a single-service application with no service names at all,
so these cannot be rewritten to use one without changing what they test.

`ci.yml`'s `e2e` job hands over the **wasm** artifact (`wasm-<app>-<sha>`,
unpacked to `apps/<app>/logic/res/`). The `.mpk` is built by the `wasm` job and
uploaded separately as `mpk-<app>-<sha>`, which only the `browser` job downloads.
So under the e2e job these would fail on step 1 with no bundle to install.

They therefore live one directory below `ci.yml`'s non-recursive
`workflows/*.yml` glob. Run them deliberately:

```sh
cd apps/mero-drive
pnpm logic:build                       # produces logic/dist/<package>.mpk
cd logic && merobox bootstrap run workflows/probes/workflow-mero-drive-e2e.yml
```

**⚠️ This is a real coverage loss versus the standalone repo, and the single most
valuable follow-up from this migration.** Adding the `mpk-<app>-<sha>` download to
`ci.yml`'s `e2e` job would let every one of these be gated again — and would do
the same for mero-issue-tracker's smoke scenario, which has the identical shape.
That change touches shared scaffolding, so it does not belong in a migration PR.

## Two scenarios need bundles that are not in the tree

`workflow-mero-drive-comments-migration.yml` and the `-v2-` step install
**version-pinned** bundles:

```
dist/com.calimero.mero-drive-docs-9.3.0.mpk
dist/com.calimero.mero-drive-docs-v2-9.4.0.mpk
```

They exercise a schema migration by installing an OLD build and then a newer one,
so they need two bundles built from two different commits. Neither is in the
repository (the tree only ever carried the current `com.calimero.mero-drive-docs.mpk`,
which is now gitignored as build output). Build them from the matching tags before
running these two.

## What changed here during the migration

* **`image: ghcr.io/calimero-network/merod:edge` → `0.11.0-rc.28`.** `edge` is a
  MOVING tag and `force_pull_image: true` re-pulls it every run, so the release
  under test changed silently between runs. It also would have failed
  `scripts/check-app-metadata.sh`, whose regex matches any
  `ghcr.io/calimero-network/merod:<tag>` and compares it to the workspace pin —
  had these stayed in the gated glob.
* **`mdns: true` stated explicitly.** core rc.26 made mDNS opt-in (core#3620):
  `merod init` now writes `discovery.mdns = false` where every earlier release
  left it on, and merobox does not pass the flag. Peer discovery changed at the
  image bump without a line of these files changing.
* **`path:` lost its `../logic/` prefix.** merobox resolves it against its CWD,
  which is now `apps/mero-drive/logic`.

⚠️ `check-app-metadata.sh`'s merod-image check globs `apps/*/logic/workflows/*.yml`
— non-recursive — so these pins are **maintained by hand**. Keep them equal to
`[workspace.metadata.mero-apps].merod-image` in the root `Cargo.toml`.
