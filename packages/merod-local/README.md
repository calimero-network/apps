# @calimero-apps/merod-local

Local development and e2e for component apps on core's `merod local` (three
nodes on `127.0.0.1:2501-2503` in one process, mock attestation). Replaces
merobox for component apps. Node >= 22.18 runs it as TypeScript, no build step.

```bash
pnpm dev:local <app>              # merod local + build + deploy + the app's Vite dev server on :5173
pnpm merod-local up [--fresh]     # the cluster alone, in this terminal
pnpm merod-local deploy <app>     # build, upload, write apps/<app>/app/.env.development.local
pnpm merod-local e2e <app>        # the app's scenarios/*.json on the cluster
```

`MEROD_BIN` names the merod binary (default `merod` on the PATH); `--wasm FILE`
skips the build. State and the cluster log live in `.merod-local/`.

`e2e` runs the same neutral scenario files `cargo test` runs in core's harness
(`crates/app-sdk/src/testing/scenario.rs`), on the cluster: per file a fresh
org (`owner`, and the admins, members and guests its `.org.json` lists, each
invited and redeemed; `outsiders` sign up without joining), a fresh app from
the uploaded bundle in that org, every account on a different node, an event
stream per account. `ok`, `error` (+ `fields`), `trap`, `confirmRequired` and
`refused` expectations, `$saved` and `@account` substitution, `confirmed: true`
(the step's passkey answers the 412) and `removeMember` are supported; a file
that ticks a timer, advances the clock, calls as `@system` or needs teams is
skipped with the reason (the harness covers it).

See [docs/COMPONENT-APPS.md](../../docs/COMPONENT-APPS.md).
