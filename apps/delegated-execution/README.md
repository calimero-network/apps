# Delegated execution — a clickable demo

Epic [`calimero-network/core#3928`](https://github.com/calimero-network/core/issues/3928)
states the goal in one sentence:

> A client holding only an account root and a device key can: obtain a session against a
> node it is not the owner of, read a context it is a member of, and submit a delegated
> write — with no password anywhere in the flow.

`apps/scaffolding-e2e/workflows/delegated-session.yml` in `calimero-network/core` asserts
exactly that, headless, in CI. **This is the same flow with a person driving it**, for the
parts a green scenario cannot show you: what each failure looks like, how far you get
before the missing piece bites, and that the account in the panel is one you minted
yourself half a minute ago.

## There is no `logic/` directory, deliberately

Every other app here is a contract plus a frontend. This one is a **frontend only**: it
drives the contract that `apps/scaffolding-e2e/logic` already ships (`set` and `get`), so
there is nothing to compile, nothing to publish to the registry, and no second copy of a
key-value store to keep in step with the first. What is being demonstrated is the
*protocol path*, not the application.

Two consequences worth knowing:

- `scripts/check-app-metadata.sh` requires a `[package.metadata.calimero]` table for every
  crate under `apps/*/logic/`. There is no such crate here, so this app is outside that
  check rather than exempted from it.
- `scripts/landing/generate.mjs` builds landing pages from an explicit list in
  `apps.config.mjs`. This app is not in it and gets no landing page — it is a tool, not
  something to install.
- It **does** carry a `vercel.json`, because `scripts/check-vercel-output.sh` requires one
  for every `apps/*/app` and fails the `frontend` job without it. Deploying it also needs
  a Vercel project pointing at `apps/delegated-execution/app`, which is created in the
  Vercel dashboard and not from this repository.

## Pointing it at a hosted HA node

The demo does not care whether the node is yours or a fleet relay, but a relay has to
expose what the flow uses. On a mero-tee node that is decided by
`mero-traefik/templates/traefik-routing.yml.j2`:

| what the demo calls | router | gated? |
| --- | --- | --- |
| `GET /auth/challenge`, `POST /auth/token` | `auth-public` | no — `cors` only |
| `POST /admin-api/contexts/<id>/intents` | `node-api-intents` | no — `cors` only, **relay builds only** (`fleet_delegated_execution`) |
| `POST /admin-api/contexts/<id>/query` | `node-api` (generic) | yes — `cors` + `auth-node`, so the session token has to satisfy it |
| `POST /admin-api/namespaces/<id>/admit` | `node-api-admit` | no — `cors` only |

Two things still have to be true beyond routing: the node's auth service must have the
`account_proof` provider **enabled** (routing exposes `/auth/`, it does not turn the
provider on), and the node's account must hold `CAN_AUTHOR_ON_BEHALF` on the group that
owns the context — which the "Check first" button answers without signing anything.

## It pins mero-js instead of using `catalog:`

```json
"@calimero-network/mero-js": "^19.7.1"
```

The workspace catalog is on `^18.3.0`, which predates `login()`, `RelayClient` and
`generateAccountRoot` — the three things this demo is built out of. Moving the catalog pin
would re-resolve and re-test all sixteen apps for the benefit of this one, so the pin is
local and this paragraph is the reason. **Fold it back into the catalog** the next time the
catalog moves past 19.7.1.

## What you need running

A node on **`merod 0.11.0-rc.38` or newer**. rc.38 is the first release carrying the
`account_proof` provider; rc.37, which the workspace pins for merobox workflows, has no
device-key login at all and will answer `/auth/challenge` with a 404.

### 1. Enable device-key login on the node

The provider is **off by default** and that is deliberate — it is a second way in. On a
release new enough to have the flag (core#3962), it is set at `init`:

```bash
merod --node demo init --server-port 2428 --swarm-port 2528 \
  --device-key-login --device-key-login-audience http://localhost:5173
```

On rc.38, which has the provider but not the flag, put the same thing in
`~/.calimero/demo/config.toml` before starting the node:

```toml
[auth.account_proof]
# The node's own device signing key — the value the browser must pin. It is the
# `publicKey` from `GET /admin-api/identity` on this node:
#   curl -s localhost:2428/admin-api/identity
node_key = "<64 hex>"
# EXACT origins, compared byte for byte. An empty list accepts ANY surface, which is
# not what you want even in a demo.
allowed_audiences = ["http://localhost:5173"]
```

> **`init`, not a later `merod config`.** Restarting a node re-reads the file, but some
> tooling rewrites `config.toml` on start — that is how the first run of the e2e scenario
> failed, with a 404 from `/auth/challenge` because the provider was off at runtime.

### 2. Create something to read and write

Any namespace and context will do; the demo calls `set`/`get`, so install the
scaffolding-e2e bundle:

```bash
meroctl --node demo app install --path dist/com.calimero.scaffolding-e2e-0.0.0.mpk
meroctl --node demo namespace create --application-id <app-id>           # → namespace id
meroctl --node demo context create --application-id <app-id> --group-id <namespace-id>
```

### 3. Let the node author on your behalf

This is the step that is missed most often, and the symptom is a write refused *after* you
have already spent a warrant nonce on it. The node's own account needs
`CAN_AUTHOR_ON_BEHALF` — bit 9, decimal 512 — on the group owning the context:

The group id and the account are **positional**; only the capability is a flag:

```bash
meroctl --node demo group members set-capabilities \
  <namespace-id> <node-account> --can-author-on-behalf
```

Note that this command **replaces** the member's whole mask rather than adding to it, so
pass every capability that member should keep in the same invocation.

Since [core#3969](https://github.com/calimero-network/core/pull/3969) a **namespace is
created carrying that bit in its default mask**, so a node admitted to a namespace created
after that change already has it. Two limits apply and both bite here: the mask is copied
at admission so it is *not retroactive*, and it is seeded for non-admin members only — so
the node that *created* the namespace still needs the explicit grant above.

The demo's **“Check first”** button answers this without signing anything. Use it.

### 4. Become a member

The account you mint in the browser has to be a member of the group, or the read returns
403 and the write is refused. Invite it the way you would invite anyone, using the account
id the first panel shows:

```bash
meroctl --node demo namespace invite <namespace-id>              # → invitation blob
```

The joining side of that is not in this demo — the browser signs member-join ops through
mero-js's `signMemberJoinOp`, but wiring an admitter into the page is a larger piece of
work than the flow being shown here. Admit the account from a node you control.

## Running it

```bash
pnpm install
pnpm --filter delegated-execution dev      # http://localhost:5173
```

If you serve it on another port or host, that origin must be in `allowed_audiences` —
the node compares it byte for byte, so `http://localhost:5173` and `http://127.0.0.1:5173`
are two different audiences.

## What each step proves

| Step | What happens | What it demonstrates |
| --- | --- | --- |
| 1. Mint | An account root and a device key are generated in the tab; the root certifies the device | Two keys, one certificate. Neither secret is ever sent; what travels carries no secret |
| 2. Point | Node URL, node signing key, context id | The node key is **pinned out of band**, never read from the node — otherwise whoever answers picks what you sign about |
| 3. Session | Challenge → statement signed by the device key → token | A session with no password in the path. The token authorises reads only |
| 4. Read | `POST /admin-api/contexts/<id>/query` with the token | Membership is re-checked per call, not per session; only `&self` methods are reachable |
| 5. Write | A warrant signed by the device, spent by the relay | The session plays **no part**. The delta is attributed to *your* account, not the node's |

## Things it deliberately does not do

- **It does not show that the delta is attributed to you rather than to the relay.** That
  is `Principal`'s job and it is real, but it is not observable from the HTTP responses —
  the author rides on the delta, not on the reply. Read it back from a *second* node, or
  see `delegated-authorship.yml`'s DAG assertions in core.
- **It does not keep your account root.** It is held in memory long enough to certify a
  device and then dropped; the 24-word phrase shown once is the only way back. The device
  secret *is* persisted, because that is what a device holding a key means — and
  "Forget this device" clears it together with its warrant nonce counter, which must go
  with it or the next device replays numbers the network has already seen.
- **It does not refresh the session.** Tokens expire; open a new one.
