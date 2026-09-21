# merobox scenarios not gated by CI

CI runs `logic/workflows/*.yml`, which is non-recursive, so nothing here runs on a pull request.
Every mero-drive scenario that passes against the pinned merod lives one level up.

## `workflow-mero-drive-comments-migration.yml`

It exercises a schema migration by installing an old build and then a newer one:

```
dist/com.calimero.mero-drive-docs-9.3.0.mpk
dist/com.calimero.mero-drive-docs-v2-9.4.0.mpk
```

CI builds only the current bundle, and neither of these is in the tree.
Build them from the matching tags before running it.

## Running one by hand

```sh
cd apps/mero-drive/logic
merobox bootstrap run workflows/probes/workflow-mero-drive-comments-migration.yml
```

`check-app-metadata.sh` only checks the merod image in `workflows/*.yml`, so keep the `image:` pins here equal to `[workspace.metadata.mero-apps].merod-image` in the root `Cargo.toml` by hand.
