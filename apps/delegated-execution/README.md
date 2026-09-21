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
"@calimero-network/mero-js": "^19.9.0"
```

The workspace catalog is on `^18.3.0`, which predates `login()`, `RelayClient` and
`generateAccountRoot` — the three things this demo is built out of. Moving the catalog pin
would re-resolve and re-test all sixteen apps for the benefit of this one, so the pin is
local and this paragraph is the reason. **Fold it back into the catalog** the next time the
catalog moves past this version.

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

The joining side **is** in the demo now: step 3's second button signs the membership op
with the device key and posts it to the admitter the cloud resolved. You do not admit the
account from a node you control — that is the whole point, and it is what makes the
account a member of a namespace it has no node in.

The admitter only carries the op. Every peer checks the signer against the certificate
inside it, so the relaying node cannot admit a different account, change the group or
grant a role; it can refuse, and that is the whole of its power. Its own consent —
an `AdmitterEndorsement` — is attached as it relays, outside the joiner's signature and
outside the op's id, which is exactly what lets a keyholder be admissible at all: an
endorsement can only be signed by an account the invitation named, and a keyholder is
not one.

`published: true` means the op reached the namespace topic, not that you are a member.
Membership lands when peers fold it, which the admitter neither performs nor waits for —
so step 5 is the confirmation, and a 403 immediately after sending is usually that race
rather than a refusal.

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
| 2. Connect to your cloud | The **account root** signs a cloud challenge, once; the cloud records the ownership and opens a session over it | The only proof on the page a device credential cannot make. Certificates are public, so device proofs say *a device of X is asking*; only the root says *X is mine* |
| 3. Prove & accept | The device key signs a cloud challenge so the routing read names your account; the signed `admitters` list is intersected with the cloud's live routing; the device signs the membership op the admitter carries | Two sources, two questions: who is *allowed* to admit you, and who is *reachable*. The node signing key is still **pinned out of band** — otherwise whoever answers picks what you sign about |
| 4. Session | Challenge → statement signed by the device key → token | A session with no password in the path. The token authorises reads only |
| 5. Read | `POST /admin-api/contexts/<id>/query` with the token | Membership is re-checked per call, not per session; only `&self` methods are reachable |
| 6. Write | A warrant signed by the device, spent by the **cloud-resolved relay** | The session plays **no part**. The delta is attributed to *your* account, not the node's — and the relay need not be the node that admitted you |

## Connecting: consent from the cloud, the key from here

Step 2 is two actions, and they answer different questions.

**Connect** opens the cloud portal in a tab. You sign in there, read what is being asked
(the app's origin and the account id), and agree — and you come back holding a **grant**.

This round trip exists because of a real bind: only Google issues a *first* cloud session,
and linking an account lives behind one. A tab that holds an account root can therefore
prove it owns that account forever and never get a session, because
[the proof says who you are and the link says what you are entitled to](#connecting-the-account-to-your-cloud-is-the-roots-one-job).
So the consent is collected where you are signed in, and carried back across the redirect.

**What crosses is a grant, deliberately not a session token and not a Google ID token.** It
authorises exactly one link, on one named account, expires in five minutes, and is spendable
only by whoever can sign it with that account's root — so a grant someone intercepts links
nothing. It arrives in the URL *fragment*, which browsers never send to servers. Handing the
tab a session instead would give it everything that cloud login owns.

Three checks make it safe, and all three are on the server:

- the grant names one account, sealed at consent time, and the cloud re-derives the account
  from the key that signs. The app chooses which account to ask about, so without this it
  could ask about the account you expect and spend the consent on one it controls;
- the grant carries a purpose, so an ordinary link challenge cannot be spent as one;
- the callback origin is allow-listed (`account_link_callback_origins`, empty by default).
  The portal checks too, but a check in the page decides nothing — the redirect target is
  exactly what an attacker controls.

Cancelling at the cloud sends you back with `error=denied` and links nothing.

The demo needs both URLs because production has two hosts: the **portal** serves the sign-in
page and does not proxy `/api/*`, and the **API** host has no sign-in page.

## Connecting the account to your cloud is the root's one job

Everything else this page signs is signed by the **device** key: the routing proof, the
login statement, the warrant. All three rest on a certificate the root issued — and a
certificate is *public*. It travels in the clear inside every device-link op, so the
strongest statement any device proof can make is *"a device of account X is asking"*.

It can never say *"X is mine"*. Only the root can, and step 2 is where it does: the cloud
mints a challenge, the account root signs
`calimero.mdma.account-login.v1\0 ‖ nonce`, and `POST /api/auth/account` verifies it and
**writes the ownership down**. Once. From then on the cloud knows the account behind those
later device proofs was claimed by whoever holds its root. A separate signing domain from
the account-*link* proof, deliberately: both are a root signature over a cloud-issued
nonce, so without the separation a signature gathered while linking — an operation you
perform while signed in and trusting the page — would be replayable as a login.

What comes back is the ordinary MDMA session token, the same one `signInWithGoogle`
returns, which every cloud route already accepts. That is the "talk to the cloud just by
holding the key" half, and the panel's second button spends it on
`/api/cloud/me/namespaces` so you can see it is a real session rather than a claim about
one.

**Proven and entitled are two different things.** The cloud issues a session only where a
`CloudAccountLink` exists — the proof establishes *who you are*, the link establishes *what
you are entitled to*. Anyone can mint an account root offline, so a session on the proof
alone would authenticate perfectly and authorize nothing: no cloud user, no plan, no
namespaces to scope it to. An unlinked account therefore gets a 403 for the session **and
its claim is recorded anyway**, so a keyholder who links later does not have to come back
and prove again. The panel reports that state as *proven, unlinked* rather than as a
failure, because it is one.

Nothing else on the page needs the session. Routing reads prove themselves, the node
session comes from the device key, and the write is authorised by a warrant — which is why
step 2 is optional and the four steps after it work without it.

## The routing read proves an account, and only that

Step 3 asks the cloud where to send a signed join. That read used to be anonymous, which
meant anyone who learned a 32-byte namespace id could map which nodes serve it, their URLs
and their liveness.

It cannot be gated on a cloud login. A joiner is by construction **not** the namespace
owner, and holding no cloud account is the entire point of this path — the whole demo is a
keyholder that mints a root, certifies a device and signs its own membership op offline.
So the browser proves possession of the credential it already holds instead: it fetches a
sealed, namespace-bound challenge, signs it with the certified **device** key, and resends
with `X-Calimero-Credential`, `X-Calimero-Nonce` and `X-Calimero-Signature`. mero-js's
`routingCredential` does all of that; nothing new is minted, stored or typed.

The device signs, not the root — the opposite of the account-link proof, and on purpose.
This runs on every routing read from a tab that deliberately discards the root after
certifying its device, and requiring the root would mean re-entering 24 words to look up a
URL.

**What it establishes:** the caller holds a device key certified by some account root, and
which account that is. **What it does not:** that the account was invited, or that it is a
member. The cloud cannot check either — membership is governance state on the nodes — and
anyone can mint a root offline, so this is not a wall. It buys attribution and it ends
anonymous bulk discovery. Authorization stays where it always was: at the node, on the
signed op, which is why step 3 still refuses a node outside the invitation's signed list.

The cloud does not yet *require* the proof. This demo sends it anyway, so a client that
gets it wrong finds out now rather than on the day the flag flips.

**"Prove my account to the cloud" makes it visible.** The proof rides every routing read
whether or not you press it, so the button adds no capability — it exists because a demo
that performs its central claim invisibly has not demonstrated anything. Pressing it shows
the sealed challenge, the device signature, and the account the cloud then served the read
as. There is deliberately nothing to stay connected to afterwards: no session is issued and
nothing is stored, because a challenge is namespace-bound and expires in about two minutes,
and every read proves itself again.

## The admitter and the relay are two different nodes

Step 3 resolves both from one cloud read, and they are separate answers because
they are separate permissions:

- **Admission** is authorised by the invitation's signed `admitters` list. A node
  outside that list refuses a join claim whatever else is true of it.
- **Authorship** is authorised by `CAN_AUTHOR_ON_BEHALF` on the owning group — a
  governance op an admin signed. The cloud reports it as `canExecute` and has no
  say in granting it.

One node often holds both, and step 3 prefers such a node so the demo lands on
one. But it only *prefers*: admission is the leg that cannot proceed without a
node, so when no invited node can execute, step 3 still picks an admit-only one.
Before the two were split, the write leg then reused that node — the panel said
"it can admit but not execute" and the button posted there anyway.

So the relay is chosen separately, across **every** node the cloud lists rather
than only the invited ones. Intersecting against `admitters` would be wrong here
in exactly the case that matters: a node assigned after the invitation was minted
is absent from the signed list, is a perfectly good relay, and would be discarded
for a reason that applies only to joins.

Nothing forces the two legs onto one node. The intent carries a **warrant**, not
the session token, so the relay never needs the session the admitter issued.

When no node holds the grant, step 3 says so and leaves the relay unset rather
than falling back — a healthy fleet with no authorship grant is a real state, and
the remedy is a governance op, not a retry. The write panel shows which node it
will use, and says when that differs from the admitter.

## Things it deliberately does not do

- **It does not show that the delta is attributed to you rather than to the relay.** That
  is `Principal`'s job and it is real, but it is not observable from the HTTP responses —
  the author rides on the delta, not on the reply. Read it back from a *second* node, or
  see `delegated-authorship.yml`'s DAG assertions in core.
- **It keeps your account root in `localStorage`, and a product must not.** Step 2's
  claim is a *root* signature, so a tab that dropped the root could make it exactly once
  and never again without re-entering 24 words — so this demo stores it. The trade is
  real: a stolen device key is revocable, which is what device certificates are for, and a
  stolen root is the account, permanently. A product keeps the root in a desktop app, a
  hardware key or an OS keychain and signs the challenge there, which is why mero-js
  splits `signAccountLogin` out from `signInWithAccount`. The device secret is persisted
  for its own reason — that is what a device holding a key means — and "Forget this
  device" clears both, plus the warrant nonce counter, which must go with them or the next
  device replays numbers the network has already seen.
- **It does not refresh the session.** Tokens expire; open a new one.

## Steps 7–10: the same flow with both secrets removed

Steps 1–6 keep an account root and a device secret in `localStorage`, and the bullet
above concedes that a product must not. Steps 7–10 are the other half of that sentence —
the same legs, with the compromise actually removed rather than only admitted:

| | steps 1–6 | steps 7–10 |
| --- | --- | --- |
| account root | generated in the tab, kept in `localStorage` | never in the browser; a CLI holding it signs the certificate |
| device key | a hex secret in `localStorage` | a non-extractable `CryptoKey` in IndexedDB |
| warrant, login statement | mero-js, from that hex secret | reproduced against the key, pinned to core's fixtures |

Both paths stay on the page because the **contrast is the subject**. Deleting the original
would leave a demo asserting that a compromise used to exist.

### Why the signing is reimplemented rather than delegated

mero-js 19.10 takes every secret as 32 hex bytes — `WarrantInput.deviceSecret`,
`signLoginStatement`'s `deviceSecret`, `signDeviceCert`'s `rootSecret`. There is no signer
hook to pass a `CryptoKey` through, so a key that *cannot* be exported cannot be used with
it at all. `lib/warrant.ts` and `lib/login.ts` therefore reproduce the two byte contracts
around a key instead of a secret.

That is a real risk and it is covered the way core asks for it to be: both are pinned to
core's own vectors — `crates/account/src/tests/warrant_wire_fixture.rs` and
`login_wire_fixture.rs` — because the domain constants are `pub(crate)` there and nothing
on that side forces anyone to notice this code depends on them. A drift arrives as a 403
at a relay or a 401 at login, nowhere near its cause. If `pnpm test` is green, these bytes
match the node's.

The audience is the field a reimplementation gets wrong, and all three variants are pinned
for that reason: in the **preimage** it is `tag ‖ body` with no length (`domain_hash`
prefixes each part it is handed, so a length here is counted twice), and on the **wire** it
is a borsh enum — tag, then a borsh `String`. `Cli` is a bare tag with neither, which is
what makes a "length-prefix everything" implementation look correct right up until someone
logs in from a browser.

### Certifying a device

The certificate is signed where the root is. Build the CLI from `poc/webcert`:

```bash
cargo run -p certifier -- new --out account.key
```

That prints the account id and writes the root to a file the browser never sees. Invite
that account to the namespace the way you would invite any other (`meroctl --node demo
namespace invite <namespace-id>`), then press **Generate a device key** in step 7 and run
the command it shows:

```bash
cargo run -p certifier -- certify --key account.key --device-key <64 hex> --kem-key <64 hex>
```

Paste the account id, device id and credential back into step 7. The credential is an
`AccountProof<DeviceCert>`: it carries no secret, is public by construction, and travels in
the clear inside every device-link op anyway.

In the shape this stands in for, the root is in a Secure Enclave or on a YubiKey and the
signing happens there. The ceremony is identical; only custody differs — which is why the
certifier is a separate binary from `publisher` rather than another subcommand on it. A
publisher root certifies *apps*, an account root certifies *devices*, and one key file
holding both would be one compromise losing both.

### What this still does not fix

Script injected into this origin can **use** the key for as long as the page is open: it
can open sessions and spend warrants. That residual cannot be removed, because a key usable
by the page is usable by anything running as the page. What is removed is **exfiltration** —
the attacker cannot walk away with the identity, and revoking the device ends it. A stolen
hex secret, by contrast, is the account until the root revokes it, and a stolen root is the
account permanently.

### Running steps 7–10 against a local node

The setup above (written for rc.38) does not work on master, in four ways that each fail
silently or confusingly. What follows was run end to end against `merod` built from master.

```bash
merod --home ~/.calimero --node demo init --server-port 2428 --swarm-port 2528 --auth-mode embedded --no-admin --device-key-login --device-key-login-audience http://localhost:5173 --public-intents
```

- **`--auth-mode embedded` is required.** `--device-key-login` warns and does nothing
  without it: the provider lives in an auth service the node is otherwise not running.
- **`--public-intents` is required for step 10.** Without it the relay route
  (`POST /admin-api/contexts/{id}/intents`) is not served to a caller holding no node
  credential, which is every caller this demo is about.
- **`node_key` needs no value.** Master fills it from the node's own signing key at
  startup; the older instruction to read it from `GET /admin-api/identity` risks pinning
  the libp2p key, which is a different key and fails at login. A node that has never taken
  part in a namespace has no signing key yet, and the provider stays disabled until it does.
- **`--device-key-login` sets the `providers` toggle for you.** Hand-editing
  `[auth.account_proof]` alone leaves the provider off, and `/auth/challenge` answers 404 —
  the symptom the older instructions blamed on the release.

`--no-admin` keeps the node free of a password account, which is fine for the provider but
means `meroctl` cannot authenticate: it only signs in through a loopback browser flow.
Either drop `--no-admin` and pass admin credentials at init, or provision one afterwards
with the node **stopped** (`merod auth set-admin` takes an exclusive lock on the auth
database):

```bash
merod --home ~/.calimero --node demo auth set-admin --admin-user demo --admin-password-file ./admin.pw
```

Then install the bundle, create the namespace and context, grant the node authorship, and
add your offline account as a member. A namespace **is** its root group, so membership and
capabilities are group routes:

```bash
meroctl --node demo app install --path dist/com.calimero.scaffolding-e2e-0.0.0.mpk
meroctl --node demo namespace create --application-id <app-id>
meroctl --node demo context create --application-id <app-id> --group-id <namespace-id>
meroctl --node demo group members set-capabilities <namespace-id> <node-account> --can-author-on-behalf
meroctl --node demo group members add <namespace-id> <your-account-id> Member
```

**The account never signs to become a member**, which is what makes steps 7–10 possible at
all: `MemberAdded` is admin-signed, so an operator adds the account and the account holder
proves possession later, at login. The joiner-signed membership op that step 3 uses would
need the device key, and that key cannot leave the browser.

Two things worth knowing about the node's own account: it is created as the namespace's
`Admin` with a capability mask of **0**, so the `CAN_AUTHOR_ON_BEHALF` grant above is not
optional — the default-capability seeding covers members admitted later, not the creator.
And the capabilities call **replaces** the whole mask, so read it first on a node that
holds others.

### The delegated read needs an app built after core#3936

The read (steps 5 and 9) is gated on the method's **declared** `MethodIntent`, and the gate
**fails closed** on `Unspecified` — core refuses rather than guesses, because a wrong guess
would run an unreviewed method under the caller's identity with no warrant behind it.

`feat(sdk): derive MethodIntent from the receiver` (#3936, 2026-09-15) is what makes `&self`
mean `ReadOnly`. Before it, intent came from `#[app::view]` alone — and as that commit's own
note records, two methods across the entire `apps/` tree carried the annotation against 573
`pub fn`s, so "every read gate downstream refused nearly everything".

`scaffolding-e2e` annotates nothing, so a bundle built before that date declares no intent
for any method and the read answers:

```
HTTP 409  method 'get' is not declared read-only; a session authorizes reads only,
          so this call needs a warrant
```

That is the gate working, not a client bug — and it applies to step 5 exactly as it does to
step 9. If your `dist/*.mpk` predates 2026-09-15, rebuild it (`cargo mero build
--manifest-path apps/scaffolding-e2e/Cargo.toml`, then `cargo mero bundle --dev --no-icon`
from the app's directory) or the read cannot succeed however correct the session is.

**Reinstalling is not enough, and this is the part that will waste your afternoon.** The
application id is derived from package + version, so a rebuilt bundle installs over the same
id — but a **namespace pins a bytecode blob at creation** (`appKey`, the `bytecodeId` that
`namespace create` defaults to "latest installed"). Every context in that namespace keeps
executing the pinned blob, so a namespace created before the rebuild still runs the old wasm
and still answers 409, even for a context created after it. The admin ABI endpoint will
cheerfully report `intent: read_only` the whole time, because it reads the *application's*
current blob rather than the one your context executes.

Compare them before debugging anything else:

```bash
curl -s localhost:2428/admin-api/namespaces/<namespace-id> -H "Authorization: Bearer $TOKEN"   # appKey
curl -s localhost:2428/admin-api/applications -H "Authorization: Bearer $TOKEN"                # blob.bytecode
```

Different values mean the namespace is pinned to an older build. Create a **new namespace**
after installing the rebuilt bundle (and re-add members and the `CAN_AUTHOR_ON_BEHALF` grant
there — both are per-namespace).
