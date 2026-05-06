# Calimero Scaffolding E2E Application

A full-stack Calimero app for testing and exploring the SDK. The backend is a Rust/WASM app (`logic/`) and the frontend is a React app (`frontend/`) that lets you call every method interactively and run an automated test suite against a live node.

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

```bash
cd logic
./build-bundle.sh
cd ..
```

Output: `logic/res/scaffolding-e2e-1.0.0.mpk`

First build takes a few minutes (Rust + WASM). Subsequent builds are fast.

---

## 4. Install the app on the node

```bash
meroctl --node node1 app install --path logic/res/scaffolding-e2e-1.0.0.mpk
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
meroctl --node node2 app install --path logic/res/scaffolding-e2e-1.0.0.mpk
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

A **single-value** store with an explicit writer set. Only nodes whose Ed25519 public key is in the writer set can call `shared_set`. The writer set is managed via `rotate_writers` (exposed as `shared_add_writer` in this app). Any context member can read.

The writer set is a `BTreeSet<PublicKey>`. The context creator (node1) is the initial writer. Use `shared_add_writer` with a base58 public key to authorize additional nodes before they attempt to write.

Frontend: **Storage → Shared Storage**

Methods exposed:
- `shared_set(value)` — set the shared value (writers only)
- `shared_get()` — read the current value
- `shared_get_writers()` — list authorized writer keys (base58)
- `shared_add_writer(writer_bs58)` — add a writer by base58 public key
- `shared_is_writer(key_bs58)` — check if a key is authorized
- `shared_is_frozen()` — whether the storage was locked at construction

---

## Troubleshooting

**`merod` / `meroctl` not found** — run `./install-calimero.sh` and restart your terminal.

**`app install` fails** — run `./logic/build-bundle.sh` first.

**Frontend shows "node: not set"** — set `VITE_NODE_URL` in `.env` or open the app from Merobox.

**Context state not syncing** — both nodes need to be able to reach each other on the P2P port shown in the merod startup logs.
