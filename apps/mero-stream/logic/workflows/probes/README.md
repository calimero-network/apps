# Capacity probes — not gated by CI

`ci.yml`'s `e2e` job globs `workflows/*.yml` (non-recursive) and runs every match
**sequentially in one job** with a 40-minute timeout. The standalone repo ran its
six scenarios as a **parallel matrix**, one job each, so sequencing them was free
there and is not here.

`e2e-capacity-ladder.yml` is the one that does not belong in that loop:

* it boots **4** nodes and runs 13 steps, the largest scenario in the repo;
* it is a **measurement**, not a regression test. It reports delivery ratios —
  ~96% of frames with one author, ~43–70% with two, regardless of publish rate —
  and the numbers are the output. There is no pass/fail line for a PR to gate on.

So it lives here, one directory deeper, where the glob does not reach. Run it
deliberately:

```sh
make ladder                 # from apps/mero-stream/
# or
cd apps/mero-stream/logic && merobox bootstrap run workflows/probes/e2e-capacity-ladder.yml
```

## Two consequences worth knowing

1. **`scripts/check-app-metadata.sh` does not check this file's merod image.**
   That check also globs `apps/*/logic/workflows/*.yml`. The pin here is
   maintained by hand — keep it equal to `[workspace.metadata.mero-apps]
   .merod-image` in the root `Cargo.toml`, or the probe measures a different
   release than the contract is built for.
2. **The `script:` path is one level deeper.** merobox rejects a `script:` path
   containing `..`, and resolves it against its CWD — which is
   `apps/mero-stream/logic`. Hence `workflows/probes/e2e-capacity-ladder.sh`, and
   hence the three `../` hops inside that wrapper.

The five scenarios still in `workflows/` are regression tests and do gate PRs:
bit-identity (C1), pruning + tombstones (C3), 3-node gossip fan-out, approach-2
opaque chunks, approach-1 ephemeral frames.
