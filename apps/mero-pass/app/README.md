# Mero Pass: web app

The React 19 + TypeScript frontend of Mero Pass, built with Vite. It talks to
Calimero through mero-js's `CalimeroClient` (`@calimero-apps/connect`): the
`merod local` nodes under `vite`, the Calimero Cloud cluster named by
`VITE_CALIMERO_CLUSTER` in a production build. Every secret is encrypted and
decrypted in the browser. What the app does, and how vaults, teams and
encryption map onto Calimero, is in [Mero Pass's README](../README.md); this
page covers working on the frontend.

## Scripts

Run these from this directory (`apps/mero-pass/app`):

| Script                        | What it does                                        |
| ----------------------------- | --------------------------------------------------- |
| `pnpm dev`                    | Vite dev server on http://localhost:5173            |
| `pnpm build`                  | Typecheck, then a production build into `dist/`     |
| `pnpm preview`                | Serve the production build                          |
| `pnpm typecheck`              | `tsc -b`                                            |
| `pnpm lint` / `pnpm prettier` | ESLint, and a Prettier check of `src/`              |
| `pnpm test`                   | Vitest unit and screen tests (mocked client)        |

`pnpm dev:local mero-pass` from the repo root starts `merod local`, uploads the
contract, writes `.env.development.local` and runs `pnpm dev` (see
[docs/COMPONENT-APPS.md](../../../docs/COMPONENT-APPS.md)). The variables are
listed in `.env.example`.

## Where things are

- `src/calimero.tsx`: the session provider (`useCalimero()`): target, client,
  passkey sign-in and sign-up, the stored session.
- `src/lib/meroPass.ts`: the contract, typed; `meroPass.test.ts` checks its
  method list and parameter names against `../logic/res/abi.json`.
- `src/lib/vaultApi.ts`: the one adapter from the contract's camelCase,
  decimal-string answers to the records `@calimero-network/mero-pass` and the
  screens use.
- `src/lib/vaults.ts`: teams (orgs), vaults (app instances), invites, members.
- `src/lib/inviteLink.ts`: `?invite=` links, captured before React mounts.
- `src/screens.test.tsx`, `src/App.routes.test.tsx`: the screens and the
  router against a mocked client.

**Log out** (`src/auth/signOut.ts`) locks the device key, clears a copied
secret from the clipboard, forgets the last team and vault, and ends the
session. The theme, the auto-lock delay and the sealed device key stay.
