# `packages/`

Frontend code shared across apps. Empty on purpose, and wired into the workspace
anyway — `pnpm-workspace.yaml` already globs `packages/*`, so the first shared
package is a directory with a `package.json` and nothing else.

A seam that already builds is a seam people use. A seam that has to be invented
later is a seam nobody uses.

## What belongs here, eventually

`transition-apps.md` identifies the code every app currently keeps its own copy
of. Across the nine app repos today: `utils/invitation.ts` ×4,
`utils/authTokens.ts` ×4, `contexts/ToastContext.tsx` ×4,
`pages/LandingPage.tsx` ×4, `hooks/useSse.ts` ×3, `api/rpc.ts` ×3.

Those become `workspace:*` dependencies here — no publishing, no version dance,
and a change lands with all its consumers in one commit.

`utils/authTokens.ts` is the one worth naming: those four copies should be
**deleted**, not shared. mero-react has guarded token adoption since 4.3.4 and
does it better. Four copies of a downgrade is four places to get `token_reuse`
wrong.

## What does not belong here

Anything with one consumer. Extract from a second real use, never from a first
guess — a shared package with one caller is a worse version of a local module,
and it makes every future change to it a fleet-wide event for no reason.

## Shared configuration

Shared *config* is not here — it is at the repo root, where the tools look for
it without indirection: `tsconfig.base.json`, `pnpm-workspace.yaml`'s `catalog:`,
`requirements-e2e.txt`. Re-exporting those through npm packages would add a
layer and no capability.
