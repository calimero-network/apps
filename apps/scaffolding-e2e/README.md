# Calimero Scaffolding E2E Application

A full-stack Calimero app for testing and exploring the SDK. The backend is a Rust/WASM app (`logic/`) and the frontend is a React app (`frontend/`) — built on `@calimero-network/mero-react`, the same SDK the other mero apps use — that lets you call every method interactively and run an automated test suite against a live node.

---

## Prerequisites

Install `merod` and `meroctl`:

```bash
./install-calimero.sh
```

You also need Node.js and `pnpm` for the frontend.

---

## 1. Start a node

Initialize (first time only):

```bash
merod --home ~/.calimero/node1 init --server-host 127.0.0.1 --server-port 2528 --auth-mode embedded
```

Run it:

```bash
merod --home ~/.calimero/node1 run
```

Leave this running. The node listens at `http://localhost:2528`.

---

## 2. Register the node with meroctl

```bash
meroctl node add node1 ~/.calimero/node1
meroctl node use node1
```

Check it's alive:

```bash
meroctl --node node1 node identity
```

---

## 3. Build the app bundle

Install the Calimero app toolchain once (pinned to the same core release as the
SDK in `logic/Cargo.toml` — the ABI emitter is versioned with core):

```bash
cargo install --git https://github.com/calimero-network/core \
  --tag 0.11.0-rc.20 cargo-mero --locked
```

Then build:

```bash
cd logic
./build-bundle.sh
cd ..
```

Output: `logic/dist/com.calimero.scaffolding-e2e-0.0.1.mpk`

The first run also generates a signing key at `logic/res/my-key.json` and tells
you so. It is gitignored — do not commit it. Whoever signs a package's first
published version owns it, because the node derives the ApplicationId from
(package, signer), so a different key is a different app rather than an upgrade.

First build takes a few minutes (Rust + WASM). Subsequent builds are fast.

---

## 4. Install the app on the node

```bash
meroctl --node node1 app install --path logic/dist/com.calimero.scaffolding-e2e-0.0.1.mpk
```

The output includes an `applicationId`. Copy it — you need it in the next steps.

---

## 5. Create a namespace

```bash
meroctl --node node1 namespace create --application-id <APP_ID>
```

The output includes a `namespaceId`. Copy it.

---

## 6. Create a context

```bash
meroctl --node node1 context create --application-id <APP_ID> --group-id <NS_ID>
```

The output includes a `contextId`. Copy it.

---

## 7. Configure the frontend

```bash
cd frontend
cp .env.example .env
```

Open `.env` and fill in your app ID:

```env
VITE_NODE_URL=http://localhost:2528
VITE_APP_ID=<APP_ID from step 4>
```

Then copy the WASM into the public folder so the node can fetch it:

```bash
npm run sync-wasm
```

---

## 8. Start the frontend

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Click **Connect**, then select the context you created in step 6.

---

## Hosted frontend

The same frontend is deployed at **https://scaffolding-e2e.vercel.app/** — that URL is the
`frontend` key in the bundle manifest, so it is what the desktop app and
`links.calimero.network` open for `com.calimero.scaffolding-e2e`.

It is a convenience, not a replacement for the local run: it is a static build with no node
of its own, so you still need the node from step 1 and the context from step 6. The connect
screen takes any node URL (default `http://localhost:2528`), and the app ID is resolved from
the registry by package name, so the hosted build needs **no environment variables** — Vercel
project settings are just root directory `frontend`, and `vercel.json` supplies the rest.

Reaching a `localhost` node from the hosted page works out of the box: merod's default CORS
config is permissive (`allowed_origins` unset ⇒ any origin, private-network requests allowed),
and browsers exempt `http://localhost` from mixed-content blocking. A node that has set an
explicit `allowed_origins` list must include `https://scaffolding-e2e.vercel.app`.

Mode 1 (`VITE_APP_ID` + `npm run sync-wasm`) does **not** work on the hosted build: it serves
the WASM from `public/app.wasm`, which only exists in a local checkout. The hosted build always
runs in mode 2, resolving the app ID from the registry by package name.

---

## Opening from Merobox

If you open the app from the Merobox desktop app, authentication and node URL are injected automatically via the URL hash — you skip the connect screen entirely.

---

## Adding a second node (optional)

Initialize and run node2 in a separate terminal:

```bash
merod --home ~/.calimero/node2 init --server-host 127.0.0.1 --server-port 2529 --auth-mode embedded
merod --home ~/.calimero/node2 run
```

Register it:

```bash
meroctl node add node2 ~/.calimero/node2
```

Install the same app on node2:

```bash
meroctl --node node2 app install --path logic/dist/com.calimero.scaffolding-e2e-0.0.1.mpk
```

Invite node2 to the namespace from node1:

```bash
meroctl --node node1 namespace invite <NS_ID>
```

Copy the invitation payload from the output, then on node2:

```bash
meroctl --node node2 namespace join <NS_ID> '<invitation payload>'
meroctl --node node2 group join-context <CTX_ID>
```

Open two browser tabs. In each, connect to a different node (`localhost:2528` vs `localhost:2529`) and select the same context ID. Writes in one tab sync to the other.

---

## Storage types

The app demonstrates every storage primitive in the Calimero SDK. Two of them are worth explaining because their access rules are enforced at the CRDT merge layer, not just in application logic:

### AuthoredMap

A shared key→value map where **ownership is per-entry**. Any context member can insert a new key — the inserting node becomes the entry's owner. Only the owning node can update or remove that entry. Reads (`get`, `entries`) are open to all.

This is implemented with `AuthoredMap<String, LwwRegister<String>>` from `calimero_storage::collections`. Ownership is stored in `StorageType::User { owner }` metadata and enforced at merge time.

Frontend: **Storage → Authored Map**

Methods exposed:
- `authored_insert(key, value)` — insert a new entry (caller becomes owner)
- `authored_update(key, value)` — update an entry (owner only)
- `authored_remove(key)` — remove an entry (owner only)
- `authored_get(key)` — read a single entry
- `authored_entries()` — read all entries as a map
- `authored_get_owner(key)` — returns the base58 public key of the owner
- `authored_len()` — entry count

### SharedStorage

A **single-value** store with an explicit writer set. Only callers whose **account** is in the writer set can call `shared_set`. The writer set is managed via `rotate_writers` (exposed as `shared_add_writer` in this app). Any context member can read.

The writer set is a `BTreeSet<AccountId>` — an account id, not the base58 device key the rest of this app reports. Core 0.11 split one identity into a device (the installation, the CRDT replica id, what `authored_get_owner` returns) and an account (the person, the only authorization subject), and only the account authorizes. `AccountId` is `From<[u8; 32]>`, so passing a device key where an account belongs still compiles and still "succeeds" — it just grants an account nobody holds, and the grantee stays unable to write. Nothing on the wire maps a device key to an account, so a peer has to tell you theirs: `whoami`.

The context creator (node1) is the initial writer. Use `shared_add_writer` with a 64-hex account id to authorize additional accounts before they attempt to write.

Frontend: **Storage → Shared Storage**

Methods exposed:
- `whoami()` — the caller's own `{ device_id, account_id }`
- `shared_set(value)` — set the shared value (writers only)
- `shared_get()` — read the current value
- `shared_get_writers()` — list authorized writer accounts (64-hex)
- `shared_add_writer(account_hex)` — add a writer by account id
- `shared_is_writer(account_hex)` — check if an account is authorized
- `shared_is_frozen()` — whether the storage was locked at construction

---

## Publishing to the App Registry

`.github/workflows/deploy-bundle.yml` builds, signs and publishes
`com.calimero.scaffolding-e2e` to [apps.calimero.network](https://apps.calimero.network)
on every merge to `master` that touches `logic/**`, and on manual dispatch.

**The registry owns the version.** The workflow asks it for the highest
published `appVersion` and increments the patch (starting at `0.0.1` when
nothing is published). `logic/Cargo.toml`'s `version` field is not the release
version and bumping it changes nothing — read a shipped version from the
registry or the workflow's run summary, never from the tree. The trade-off is
that there is no idempotency: a re-run mints another version of the same
content.

Everything the registry and the node render — name, description, author,
license, tags, links, icon, `minRuntimeVersion` — comes from
`[package.metadata.calimero]` in `logic/Cargo.toml`. No manifest is written by
hand. `min-runtime-version` must stay equal to the `calimero-sdk` tag: this
build imports host functions that only exist from that release on, and a node
older than that installs the bundle happily and then fails at context creation
with `link error: unknown import`.

Two organization secrets are required:

| Secret | What it is |
| --- | --- |
| `MERO_SIGN_KEY` | Full JSON of the production signing key. Must be the key that signed the package's first published version — the node derives the ApplicationId from (package, signer), so a different key publishes a *different app*, not an upgrade. |
| `CALIMERO_REGISTRY_API_KEY` | API token from the registry's Organizations page (CLI Access). |

⚠️ Set these at **organization** level. A repo-level secret of the same name
shadows the org one, which is how a sibling app ended up published under an
individual's account instead of `calimero-network`. The workflow's last step
detects it — but only after the bundle is already on the registry.

To change the icon, edit `logic/res/icon.svg` and run `logic/gen-icon.sh`.

---

## Troubleshooting

**`merod` / `meroctl` not found** — run `./install-calimero.sh` and restart your terminal.

**`cargo mero` not found** — `cargo install --git https://github.com/calimero-network/core --tag 0.11.0-rc.20 cargo-mero --locked`.

**`app install` fails** — run `./logic/build-bundle.sh` first.

**Frontend shows "node: not set"** — set `VITE_NODE_URL` in `.env` or open the app from Merobox.

**Login fails with "Login callback destination is not allowed."** — the node's auth
frontend only hands tokens to an origin it trusts: loopback, its own origin, or the
frontend URL the app registry declares for this package. On a hosted deploy that
last one is the only route, so `frontend` in `logic/Cargo.toml`'s
`[package.metadata.calimero]` must match the deployed origin EXACTLY — and the
bundle must have been republished since it changed, because auth reads the
manifest in the registry, not this repo. Check what the registry currently
declares with:

```bash
curl -s "https://apps.calimero.network/api/v2/bundles?package=com.calimero.scaffolding-e2e" \
  | jq '.[].links'
```

Local development never hits this (loopback is always trusted), which is why it
can ship broken.

**Context state not syncing** — both nodes need to be able to reach each other on the P2P port shown in the merod startup logs.
