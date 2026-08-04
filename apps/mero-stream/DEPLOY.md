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

Repo root carries `vercel.json` with `installCommand` / `buildCommand` /
`outputDirectory` pointing into `app/`, so **Root Directory can stay at the repo
root** — no dashboard configuration needed. (`app/vercel.json` is retained for the
alternative layout where Root Directory is set to `app`; only one is ever read.)

- Framework preset: **Vite** (declared in the file)
- Build: `cd app && pnpm build` → `app/dist`
- SPA rewrite: all paths → `/index.html`, which is required — `/live` and
  `/stream` are client-side routes and would 404 on a hard refresh without it.
- Immutable caching on `/assets/*` (content-hashed), `no-cache` on everything
  else so `index.html` is never served stale.

No environment variables are required. `VITE_APPLICATION_PACKAGE` is optional and
defaults to `com.calimero.merostream`.

### How a user reaches a working page

The deployed origin needs a session handed in via the URL hash — the same shape
tauri-app's `openAppFrontend` builds and `scripts/dev-invite.sh` prints:

```
https://<deployment>/live#node_url=…&access_token=…&refresh_token=…
  &app-id=…&context_id=…&executor_public_key=…&dev_mode=1
```

Launching from the desktop app or the apps registry produces this automatically.

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
development key. Fine for `meroctl app install` locally; **the registry refuses
it**. Also note a node derives the ApplicationId from **(package, signer)**, so a
dev-signed and a prod-signed build of byte-identical wasm install as *different*
applications.

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
