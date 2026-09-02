# Deploying the frontend (Vercel) and publishing the bundle

Two independent artifacts. The **frontend** is a static SPA on Vercel. The
**bundle** (`.mpk`) is the WASM app published to the apps registry. The registry
record links to the frontend, so deploy the frontend first and make sure the URL
in `logic/Cargo.toml` matches.

---

## 1. Frontend → Vercel

### What had to change before this could work at all

The production build previously rendered the app **only inside the Tauri desktop
shell**: `APP_ENABLED` was `IS_TAURI || hasDevSession()`, and `hasDevSession()`
hard-returned `false` whenever `import.meta.env.DEV` was false. So a Vercel deploy
of the old code was a dead landing page for every visitor — including someone
arriving from the desktop app with a perfectly valid session in the hash.

That gate predated PR #5, which established that web-only is sound here: node
traffic is direct HTTP + SSE from the browser, no Tauri Rust proxy sits on any
path, and auth is an ordinary bearer token. The session is now accepted from the
URL hash in production too (`hasHashSession`).

It is still gated. No hash ⇒ no node URL and no token ⇒ the landing page. And
`main.tsx` passes only the hash-supplied `node_url` as mero-react's
`allowedNodeUrls`, so a page on any origin cannot point the app at a node of its
own choosing.

### Project setup

**Root Directory must be `app`.** That is the only setting required, and it is not
optional: `pnpm-lock.yaml` lives in `app/` and there is no lockfile at the repo
root, so a build rooted at the repo root has no dependency graph to install from.

Config is `app/vercel.json`, and it needs no commands — `framework: "vite"` lets
Vercel derive install (`pnpm install`), build (`pnpm build`) and output (`dist`)
on its own.

- SPA rewrite: all paths → `/index.html`. **Required**: `/live` and `/stream` are
  client-side routes and would 404 on a hard refresh or a direct link without it.
- Immutable caching on `/assets/*` (content-hashed filenames), `no-cache` on
  everything else so `index.html` is never served stale.

> A repo-root `vercel.json` with `cd app && …` commands **does not work here** and
> was tried and removed. With Root Directory set to `app`, Vercel reads that root
> config but executes the commands with the working directory already inside
> `app/`, so `cd app` fails with `sh: line 1: cd: app: No such file or directory`.
> Keep the config in `app/vercel.json`.

**pnpm version.** `app/package.json` pins `packageManager: "pnpm@9.6.0"`, the
version that generated the lockfile (`lockfileVersion: 9.0`). Without a pin,
Vercel's build log reports it is choosing a pnpm major *from the project creation
date* — drift that eventually breaks `--frozen-lockfile` for reasons unrelated to
any change you made. If Vercel ignores the field, opt in explicitly with
`ENABLE_EXPERIMENTAL_COREPACK=1`.

### Environment variables

**None are required.** Leave the Vercel env config empty.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_APPLICATION_PACKAGE` | No | `com.calimero.merostream` | Registry package id passed to `MeroProvider` |

Set it only when publishing under a different package id (e.g. a staging bundle).

Two things are deliberately *not* configurable. `registryUrl` is hardcoded to
`https://apps.calimero.network` in `main.tsx`. And the node URL arrives per-user in
the URL hash and becomes mero-react's `allowedNodeUrls` trust anchor — making it an
env var would break that trust model, since every user runs their own node.

Nothing sensitive can reach the bundle: Vite only exposes `VITE_`-prefixed vars to
the client, and every key in `app/.env.dev-call` is `DEV_*`. That file is also not
one of the names Vite auto-loads (`.env`, `.env.local`, `.env.<mode>`,
`.env.<mode>.local`), and it is gitignored and untracked. Verified — the built
bundle contains zero JWTs.

### How a user reaches a working page

**Two ways in. Neither requires the desktop app.**

**1. Log in from the page itself.** The landing page carries mero-react's
`ConnectButton` — same pattern as mero-chat's Login page. The full flow, verified
end to end against a real merod rc.19 (`app/e2e/web-login.mjs --node …`):

1. **Connect a node** — the modal probes the well-known local Calimero ports and
   also accepts a URL typed by hand.
2. **Choose an authentication method** on the node's embedded auth frontend —
   `user_password` for a standard node.
3. **Username / password.**
4. **Install & Continue** — mero-react resolves the app from the registry
   (`com.calimero.merostream`) and installs it on the node. Expected on a fresh
   node, and skipped once installed.
5. **Review Permissions** → **Generate Token** — the node shows the resolved
   Application ID and the granted scopes (`context:list/create/execute`,
   `application:list`, `namespace`, `group`, `blob`, `context:alias`), then mints
   the token pair and hands the session back.

You land on the stream picker, where **Create stream** makes the namespace +
context. Watching a frame cross still needs a *second* node — one context member
cannot observe replication.

This path depends on the app being published: step 4 resolves from the registry,
and before publication it failed with `No versions found for package
'com.calimero.merostream'`. It is published now, so it works.

**2. Arrive with a session in the URL hash** — what tauri-app's `openAppFrontend`
builds and `scripts/dev-invite.sh` prints:

```
https://<deployment>/live#node_url=…&access_token=…&refresh_token=…
  &app-id=…&context_id=…&executor_public_key=…&dev_mode=1
```

This skips all five steps, and skips registry resolution too because `app-id` is
supplied directly — which is why the two-node e2e worked while web login was still
broken.

### ⚠️ One thing to verify on the real deployment

An `https://` page reaching a plain-`http://` node is the open question. Browsers
treat `http://localhost` as a potentially-trustworthy origin, so it is *likely*
permitted, but Chrome's Private Network Access rules have tightened here and this
has **not** been verified against a live HTTPS deployment — only against the local
`http://127.0.0.1` dev server, where the scheme matches and the question does not
arise.

So: **the deployed site is expected to work against an HTTPS-reachable node** (and
inside the desktop shell, which supplies its own transport). If you point it at
`http://localhost:2660` and requests fail, that is the cause, not a bug in the
app — check the console for a mixed-content or PNA error. Local two-node work
should use the vite dev server (`make e2e-call` does exactly this), where
everything is same-scheme `http://127.0.0.1`.

---

## 2. Bundle → apps registry

```bash
cargo mero key generate --output mero-stream-key.json   # once; keep it OUT of git
cd logic && ./build-bundle.sh --key ../mero-stream-key.json
```

`build-bundle.sh` resolves the next `appVersion` from the registry (patch-bump of
the highest published version for this package), runs `cargo mero bundle`, then
**re-verifies the packaged `.mpk`**: signature present, and every artifact carries
a non-null hash. That check is not ceremony — the node rejects a bundle with a
null artifact hash as malformed *before* it ever looks at the signature, and the
previous hand-written manifest emitted exactly that.

Metadata lives in `logic/Cargo.toml` under `[package.metadata.calimero]`, not in
the script.

`--dev` (the default when no `--key` is given) signs with cargo-mero's well-known
development key. A node derives the ApplicationId from **(package, signer)**, so a
dev-signed and a prod-signed build of byte-identical wasm install as *different*
applications — republishing under a real key changes the app id.

⚠️ **cargo-mero's help says a dev-signed bundle is "REFUSED by the registry". That
is not what happens.** The bundle currently published at
`apps.calimero.network/apps/com.calimero.merostream` (appVersion 0.1.0) carries
`signerId: did:key:z6MknF3p5L5FDHJQ7FREUapuX4Wmp4MtF6WrHYaXS2B3eZQd` — the dev key
— and the registry reports `verified: true`. So the tool's documented guarantee
does not hold; don't rely on the registry to stop a dev-signed publish.

That matters because **the dev key is well-known by design**: anyone can sign a
bundle that produces the same `signerId`, and therefore the same ApplicationId for
this package. The currently-published 0.1.0 should be re-published under a real key
before anyone treats it as trustworthy:

```bash
cargo mero key generate --output mero-stream-key.json   # keep OUT of git
cd logic && ./build-bundle.sh --key ../mero-stream-key.json
```

### What the manifest contains

`package`, `appVersion`, `minRuntimeVersion`, `links.frontend`,
`metadata.{name,description,author}`, `migrations`, per-artifact
`{path,size,hash}` for `app.wasm` and `abi.json`, plus `signature` and `signerId`.

### ⚠️ Registry fields rc.19 cannot write yet

`cargo mero` at 0.11.0-rc.19 parses `[package.metadata.calimero]` with
`deny_unknown_fields` and accepts exactly:

```
package · name · description · author · min-runtime-version · frontend · services
```

Everything rc.19 supports is already set. But **`license`, `tags`, `icon`,
`links.github` and `links.docs` are not settable** — adding any of them fails the
build outright:

```
Error: invalid [..metadata.calimero] table: unknown field `icon`,
expected one of `package`, `name`, `description`, `author`,
`min-runtime-version`, `frontend`, `services`
```

The registry renders several of those, so bundles published now will show those
slots blank. Core **#3374** ("derive the manifest from the canonical type") is the
PR that adds them and is still open. When it lands in a release: bump the four
`calimero-*` git tags in `logic/Cargo.toml`, bump `CARGO_MERO_TAG` in
`scripts/ensure-cargo-mero.sh` to match, then add the fields.

Do not hand-write a manifest to work around this. That is what produced
`"hash": null` and the unwritable-metadata drift in the first place.

---

## Order of operations

1. Deploy the frontend; note the production URL.
2. If it differs from `frontend` in `logic/Cargo.toml`, update it — the registry
   record links there, and auth-frontend derives frontend-origin trust from it.
3. Build and publish the bundle with a real key.
