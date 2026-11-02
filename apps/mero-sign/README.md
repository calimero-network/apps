# MeroSign

Document signing on [Calimero](https://calimero.network) 1.0: upload a PDF,
collect signatures from the people in your workspace, and check that the copy
you hold is the one everybody signed.

- **Contract** (`logic/`): core's **component SDK** (`calimero-app-sdk`, a
  `calimero:app` WebAssembly component, `wasm32-wasip2`), pinned at core
  `1.0.0-rc.8`.
- **Frontend** (`app/`): Vite + React on mero-js's `CalimeroClient` through
  `@calimero-apps/connect`: `merod local` in development, Calimero Cloud in
  production.
- **Mobile** (`mobile/`): native iOS and Android apps, still on the v1 SDKs
  (see [mobile/README.md](mobile/README.md): they cannot reach the ported
  contract yet).

## The model

| | what it is |
|---|---|
| **Workspace** | an organization (`createOrg`), marked `{ kind: "mero-sign:workspace" }`. The people you sign with; invitations are to a workspace. |
| **Agreement** | an app instance in the workspace's org, set up with `setup(isPrivate: false, name)`. Its creator is its first Admin. |
| **Participant** | an account in the agreement at `Admin`, `Sign` or `Read`. Opening an agreement registers you as `Sign` (`registerSelfAsParticipant`) unless an admin removed you. |
| **Document** | a PDF uploaded as a **blob** of the agreement, recorded with its SHA-256 (which *is* the blob id, and the contract checks it). Everybody holding `Sign` or `Admin` at upload must sign it. |
| **Signature** | a new PDF with the signer's mark, uploaded as a blob, recorded as one row `(document, signer)` made from the version it was signed on. A **passkey confirmation** approves each one. |
| **Personal library** | an app instance with no org (only its owner reaches it), set up with `setup(isPrivate: true, "default")`: your saved signature images (blobs) and bookmarked agreements. |
| **Invitation** | an org invite (`client.invite`, approved with your passkey, 24 h), as a link `?invite=<token>&agreement=<app id>`; redeemed after sign-in, landing in the agreement it names. |

## Run it

```bash
# merod at core 1.0.0-rc.8, once:
curl -fsSL https://github.com/calimero-network/core/releases/download/1.0.0-rc.8/merod_x86_64-unknown-linux-gnu.tar.gz | tar xz

pnpm dev:local mero-sign      # merod local + build + deploy + the dev server on http://localhost:5173/
```

Sign up with a passkey, create a workspace, an agreement, upload a PDF and
sign it. For a second signer, open the workspace's invitation link in another
browser profile.

## Test it

```bash
M=tools/component-bundle/Cargo.toml
cargo test --manifest-path apps/mero-sign/logic/Cargo.toml        # TestApp harness + scenarios
cargo run --release --manifest-path $M -- build apps/mero-sign/logic   # res/mero_sign.wasm + res/abi.json
pnpm merod-local e2e mero-sign                                     # the scenarios on merod local
pnpm -F mero-sign lint typecheck test build
```

- `logic/tests/harness.rs`: every method on core's real wasmtime engine
  (`TestApp`): setup, the library, participants and levels, upload, consent,
  signing (confirmation, stale versions, repeats, completion), deletion and
  blob retention, download grants, search, bounds, and the node's own checks.
- `logic/scenarios/*.json`: `agreement` (the old merobox two-node workflow:
  a second signer joins, signs; a stale copy is refused; fully signed; delete),
  `library` (the personal context), `access` (every write rule v1 kept in
  storage, as a refused call). The blobs a scenario needs are listed in its
  `.org.json` under `"blobs"` and uploaded before the first step, in the
  harness and on the cluster.
- `app/src/lib/meroSign.test.ts`: the wrapper's method list, confirmations and
  parameter names are exactly the committed `logic/res/abi.json`'s;
  `screens.test.tsx` and the `lib`/`api` tests run the screens and the adapter
  against a mocked client.

## What changed in the port, and why

The methods, their arguments and the events are v1's where the new runtime
allows. What a client sees differently:

| | v1 (`calimero-sdk`, wasmer) | now (component SDK) | why |
|---|---|---|---|
| method names | `upload_document`, `sign_document`, … | `uploadDocument`, `signDocument`, … (arguments too: `pdfBlobIdStr`, `fileSize`, …) | the ABI is camelCase |
| `init(is_private, context_name)` | arguments to `init` | `init()`, then `setup(isPrivate, contextName)` once, by the app's owner (`AlreadySetUp`, `Forbidden`); before it, `NotSetUp` | the runtime runs `init` with no arguments |
| ids | 32-byte arrays (`UserId`, `BlobId`, `ContextId`) | strings: account ids, app ids, blob ids as 64 hex | accounts and apps are the node's |
| u64 values | JSON numbers (`size`, `created_at`, signature ids) | decimal strings (`"2048"`) | no precision loss in JSON |
| times | nanoseconds | milliseconds | the runtime's clock |
| signature ids | random 53-bit numbers | `"1"`, `"2"`, … from a counter | one log orders every write, so a counter cannot collide |
| `list_signatures`, `list_joined_contexts`, `list_documents` | every entry | one page: `{ items, next }` (`cursor`, `limit` ≤ 1,000, 100 by default); the frontend follows `next` | multi-row reads are pages |
| `join_shared_context(context_id, shared_identity, name)` | three arguments | `joinSharedContext(contextIdStr, contextName)`: the bookmark of an app id | one account is the same identity in every app |
| `get_identity_mapping`, `get_shared_identity`, `resolve_private_identity` | v1's per-context identities | **removed** | there is nothing to map: no per-context identity exists |
| `ContextMetadata` | `private_identity`, `shared_identity` | not stored (the frontend fills both with the account) | same |
| `get_context_details(context_id)` | `created_at` was the read's own clock | `contextIdStr` optional and ignored (the app answers for itself); `createdAt` is when `setup` ran | |
| `upload_document` | any `hash` | `hash` must be the PDF's SHA-256, i.e. the blob id (`HashMismatch`); the blob must exist (`BlobNotFound`) and hold `fileSize` bytes (`Invalid`); search content bounded (≤ 2,048 dims, 64 KiB text, 200 chunks) | documents are blobs; one value is rewritten whole, so bounds |
| `sign_document` | consent, then sign | consent, then sign **with a passkey confirmation** (`#[app::confirm]`, `412 CONFIRM_REQUIRED` without one); `newHash` must be the new blob's SHA-256 | a signature is the act a fresh confirmation is for |
| two signers on one version | a fork, settled by a rule on every node | the second is refused (`StaleVersion { current }`) | one log orders them |
| a signer later demoted | their signature dropped from the chain | it stays | a signature is a fact about the past |
| `mark_participant_signed` | a call that wrote nothing | a view | it writes nothing |
| participants | unlimited | at most 256 per agreement (`Conflict`) | bounds every per-call read and a document's signer list |
| `add_participant` | any key | an account the workspace holds (`NotFound` otherwise); permission `"Read"`/`"Sign"`/`"Admin"` (`Invalid` otherwise) | accounts are the org's |
| `set_consent` | anyone, any id | participants only, an existing document | consents are kept per document and deleted with it |
| reading documents, signatures, search | any context member | participants only (`Forbidden`); `getContextDetails`, `whoami`, `getUserPermission`, `listParticipants`, `hasConsented` stay open to anyone the app reaches | an org member who never joined, or was removed, does not read the documents |
| errors | a string | `422 APP_ERROR` `{ code, fields }`: `Forbidden`, `NotFound`, `Invalid`, `Conflict`, `WrongContext`, `ConsentRequired`, `StaleVersion`, `BlobNotFound`, `HashMismatch`, `NotSetUp`, `AlreadySetUp`; `fields.message` is v1's text | `#[app::error]` |
| events | `UserId` arrays, snake_case fields, `ParticipantInvited` declared | account strings, camelCase fields; the library's reach its owner, an agreement's everyone the app reaches (guests included); `ParticipantInvited` dropped (never emitted) | |
| new | | `getDocumentStatus` (status, current hash, signature count), `documentDownload` (current blob, hash, size, a one-hour download grant) | a status poll without timestamps; grants for signers |
| `DocumentInfo` | `embeddings`, `extracted_text`, `chunks` (always `None` in lists) | dropped from the answer; `originalHash` added | they were never filled in a list |

v1 kept its write rules in storage (`Frozen`, `AccessControl`, `UserStorage`,
`ModeratedOnce`, `WriteOnce`) because a member running a modified node could
write around the methods. Under one log every write goes through a method, so
each rule is a check against `env::caller()` before anything is written; the
table in `logic/src/lib.rs` lists them and `scenarios/access.json` refuses each
forged write.

**Removed:** the merobox workflows (`logic/workflows/`) and probes,
`src/tests.rs` (`TestHost`), `res/state-schema.json`, the generated
`MeroSignClient`, mero-react's provider and join-sync, the node login, the
desktop SSO hand-off, the v1 invitation codec and deep links, the admin-API
namespace/subgroup/context plumbing, the Playwright browser, journey and live
e2e suites that drove merobox, and their entry in
`scripts/merobox-coverage-baseline.json`.

**Not available yet (rc.8):** nothing this app uses is missing. The legal
assistant's retrieval (`searchDocumentByEmbedding`, a cosine search over
stored chunks) is ported; its answer generation never existed on v1 either,
so the assistant stays hidden (`LEGAL_ASSISTANT_ENABLED`). The contract makes
**no outbound HTTP** and declares no `outbound` hosts: an operator configures
no hosts and no secrets for it.

## Production

The production frontend is the one packed into the bundle (`frontend-dir`),
served by the cluster from the package's origin: a Cloud node trusts passkey
ceremonies only there. Build it with `VITE_CALIMERO_CLUSTER` and
`VITE_CALIMERO_MIN_RELEASE` set (`app/.env.example`). Agreements and libraries
are created from the package `com.calimero.mero-sign`.
