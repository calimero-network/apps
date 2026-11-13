# Mero Docs - Development Guide

Mero Docs is a component app on Calimero 1.0: a contract on core's component
SDK (`logic/`), developed against `merod local`, and a Vite + React frontend
(`app/`) that talks to the cluster through mero-js's `CalimeroClient`
(`@calimero-apps/connect`). The repo-wide guide is
[`docs/COMPONENT-APPS.md`](../../../docs/COMPONENT-APPS.md).

## Quick start

From the repository root, with `merod` at the pinned core tag on `PATH` (or in
`MEROD_BIN`; Linux only):

```bash
pnpm install
pnpm dev:local mero-docs
meroctl local dev apps/mero-docs   # the same with core's meroctl (1.0.0-rc.24 or later)
```

That starts `merod local` (three nodes on `127.0.0.1:2501-2503`), builds the
component, uploads it as a raw bundle, writes `app/.env.development.local`
and runs the dev server on exactly `http://localhost:5173/`. Sign up there
with a passkey; creating a workspace creates an organization and its
registry instance from that bundle.

The pieces separately:

```bash
pnpm merod-local up                 # the cluster
pnpm merod-local deploy mero-docs   # build + upload + .env.development.local
pnpm -F mero-docs dev               # the frontend on :5173
pnpm merod-local e2e mero-docs      # logic/scenarios/*.json on the cluster
```

## How the frontend maps onto Calimero 1.0

| what the screens call it | what it is on 1.0 | where |
|---|---|---|
| workspace | an organization | `src/calimero/orgs.ts` |
| workspace member, role, display name | org member (owner/admin = Admin, member, guest = Guest), org member metadata `{ name }` | `orgs.ts` |
| folder, Open / Restricted | a team of the org, `join: everyone` / `join: invite`; name = team name, colour = team metadata | `src/lib/coreFolders.ts` |
| folder role Viewer / Editor / Manager | a team row: `readOnly` / `member` / `member` + manager caps (`lead` shows as Owner) | `orgs.ts`, `src/lib/roles.ts` |
| a folder's documents | one app instance with `access: team`, id in the team's metadata (`docsApp`) | `orgs.ts` `createContext` |
| tags, saved views, managers | one org-access app instance, id in the org's metadata (`registryApp`) | `src/hooks/useDriveWorkspace.ts` |
| invitation link | an org invite token in `?invite=`, naming the folder's team for a folder invite | `src/hooks/useNamespaceInvitation.ts` |
| live updates, presence | `client.events(app)`, `publishPresence` / `presenceStream` | `src/calimero/live.ts` |
| contract calls | `client.call` / `client.view`, camelCase | `src/lib/docsApi.ts` |

Every membership change (role, capabilities, adding or removing someone,
an invite, deleting or leaving a workspace) is a passkey step-up on 1.0, so
it asks for the caller's passkey.

## Commands

```bash
# Frontend (from the repository root)
pnpm -F mero-docs lint
pnpm -F mero-docs typecheck
pnpm -F mero-docs test        # vitest, including the ABI check against logic/res/abi.json
pnpm -F mero-docs build

# Logic
cargo test --manifest-path apps/mero-docs/logic/Cargo.toml
cargo run --release --manifest-path tools/component-bundle/Cargo.toml -- build apps/mero-docs/logic
```

## Environment

`app/.env.example` lists the `VITE_CALIMERO_*` variables. Development needs
none (`pnpm dev:local` writes them); the production build, which is packed
into the `.mpk` and served by the cluster, needs `VITE_CALIMERO_CLUSTER` and
`VITE_CALIMERO_MIN_RELEASE`.
