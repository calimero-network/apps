# Setup Guide

Everything you need to do before opening the frontend for the first time.

---

## Prerequisites

Install `merod` and `meroctl` (v0.11.0-rc.20):

```bash
./install-calimero.sh
```

Verify:

```bash
merod --version
meroctl --version
```

---

## 1. Initialize the node

```bash
merod --home ~/.calimero/node1 init \
  --server-host 127.0.0.1 \
  --server-port 2528 \
  --auth-mode embedded
```

`--auth-mode embedded` means the node handles auth itself — no separate auth server, no JWT setup. Simplest mode for local dev.

This creates the node's config and keypair under `~/.calimero/node1`. Run it once.

---

## 2. Start the node

```bash
merod --home ~/.calimero/node1 run
```

Leave this running in a terminal. The node listens at `http://localhost:2528`.

---

## 3. Register the node with meroctl

In a new terminal:

```bash
meroctl node add node1 ~/.calimero/node1
meroctl node use node1
```

Verify it's alive:

```bash
meroctl --node node1 node identity
```

---

## 4. Build the app bundle

Install the app toolchain once, pinned to the same core release as the SDK in
`logic/Cargo.toml`:

```bash
cargo install --git https://github.com/calimero-network/core \
  --tag 0.11.0-rc.20 cargo-mero --locked
```

```bash
cd logic
./build-bundle.sh
cd ..
```

This produces `logic/dist/com.calimero.scaffolding-e2e-0.0.1.mpk`, and on the
first run also generates a gitignored signing key at `logic/res/my-key.json`.
Never commit that key: whoever signs a package's first published version owns
it on the registry.

> First run takes a few minutes (Rust + WASM compilation). Subsequent builds are fast.

---

## 5. Install the app

```bash
APP_ID=$(meroctl --node node1 --output-format json app install \
  --path logic/dist/com.calimero.scaffolding-e2e-0.0.1.mpk \
  | jq -r '.applicationId')

echo "APP_ID=$APP_ID"
```

Copy the `APP_ID` — you need it in the next two steps.

> No `jq`? Run without `--output-format json` and copy the ID from the output manually.

---

## 6. Create a namespace

A namespace ties the app to a group and is required before creating any context.

```bash
NS_ID=$(meroctl --node node1 --output-format json namespace create \
  --application-id $APP_ID \
  | jq -r '.namespaceId')

echo "NS_ID=$NS_ID"
```

---

## 7. Create a context

A context is the running instance of the app. This is what the frontend connects to.

```bash
CTX_ID=$(meroctl --node node1 --output-format json context create \
  --group-id $NS_ID \
  --application-id $APP_ID \
  | jq -r '.contextId')

echo "CTX_ID=$CTX_ID"
```

---

## 8. Configure the frontend

```bash
cd frontend
cp .env.example .env
```

Pick **one** of the two modes and set it in `.env`:

**Mode 1 — App ID (you already have it from step 5):**
```env
VITE_NODE_URL=http://localhost:2528
VITE_APP_ID=4qCTneKZfg2Hp1DmtzTGqtou7DdtS2zEgZZ1tDzAU2TS
```
Then copy the WASM into the frontend's public folder so merod can fetch it:
```bash
npm run sync-wasm
```

**Mode 2 — Package name (installed via `.mpk` with a known package name):**
```env
VITE_NODE_URL=http://localhost:2528
VITE_APPLICATION_PACKAGE=com.calimero.scaffolding-e2e
```
No extra step needed.

If both are set, `VITE_APP_ID` wins.

---

## 9. Install dependencies and start

```bash
npm install
npm run dev
```

The frontend runs at `http://localhost:5173`.

---

## 10. Open in the browser

```
http://localhost:5173
```

The `CalimeroProvider` handles auth automatically:

1. It pre-fills the node URL from `VITE_NODE_URL` — just click **Connect**.
2. With `--auth-mode embedded`, the node authenticates locally (no cloud, no separate auth server). Follow any on-screen prompts.
3. After connecting, the provider shows your available contexts. Select the one with ID from step 7.
4. You're in. The context ID is stored in `localStorage` so it persists across refreshes.

> **Tip:** If you opened the app from merobox/tauri-app, the node URL and tokens are injected via the URL hash automatically — you skip the login screen entirely.

---

## All steps as a single script

```bash
# Terminal 1 — run the node
merod --home ~/.calimero/node1 init --server-host 127.0.0.1 --server-port 2528 --auth-mode embedded
merod --home ~/.calimero/node1 run
```

```bash
# Terminal 2 — wire everything up
meroctl node add node1 ~/.calimero/node1
meroctl node use node1

cd logic && ./build-bundle.sh && cd ..

APP_ID=$(meroctl --node node1 --output-format json app install \
  --path logic/dist/com.calimero.scaffolding-e2e-0.0.1.mpk | jq -r '.applicationId')

NS_ID=$(meroctl --node node1 --output-format json namespace create \
  --application-id $APP_ID | jq -r '.namespaceId')

CTX_ID=$(meroctl --node node1 --output-format json context create \
  --group-id $NS_ID --application-id $APP_ID | jq -r '.contextId')

echo ""
echo "Context created: $CTX_ID"
echo "Open http://localhost:5173 — connect to node, then select this context ID"
```

```bash
# Terminal 3 — frontend
cd frontend
cp .env.example .env
# Option A — paste your app ID (fastest):
#   Edit .env: set VITE_APP_ID=<APP_ID from above>
#   Then: npm run sync-wasm
# Option B — use package name:
#   Edit .env: set VITE_APPLICATION_PACKAGE=com.calimero.scaffolding-e2e
npm install && npm run dev
```

---

## Adding a second node (optional, for testing sync)

```bash
# Init and start node2
merod --home ~/.calimero/node2 init --server-host 127.0.0.1 --server-port 2529 --auth-mode embedded
# (separate terminal) merod --home ~/.calimero/node2 run

meroctl node add node2 ~/.calimero/node2

# Install same app on node2
meroctl --node node2 app install --path logic/dist/com.calimero.scaffolding-e2e-0.0.1.mpk

# node1 generates an invitation for the namespace
INVITE=$(meroctl --node node1 --output-format json namespace invite $NS_ID)

# node2 joins the namespace and then the context
meroctl --node node2 namespace join $NS_ID "$INVITE"
meroctl --node node2 group join-context $CTX_ID

# Open the frontend pointing at node2
echo "Open http://localhost:5173 — connect to http://localhost:2529 and select context $CTX_ID"
```

Open two browser tabs. In each, connect to a different node URL (`2528` vs `2529`) and select the same context ID. Any write in one tab syncs to the other.

---

## Troubleshooting

**`meroctl: command not found`** — run `./install-calimero.sh` first, then restart your terminal.

**`app install` fails with "file not found"** — run `./logic/build-bundle.sh` first.

**Frontend shows "node: not set"** — make sure you passed `node_url` in the URL hash (step 10), or set `VITE_NODE_URL` in `.env`.

**`namespace create` returns an error about the app not found** — the `APP_ID` variable wasn't captured correctly. Run `meroctl --node node1 app ls` to find the ID and set it manually.

**Context state isn't syncing between nodes** — nodes need to be able to reach each other on P2P. On the same machine this works automatically. Across machines, ensure the P2P port (shown in the merod startup logs) is reachable.
