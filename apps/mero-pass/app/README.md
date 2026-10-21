# Mero Pass: web app

The React 19 + TypeScript frontend of Mero Pass, built with Vite. It talks to your own Calimero node through
`@calimero-network/mero-react`, and encrypts and decrypts every secret in the browser. What the app does, and how
vaults, teams and encryption map onto Calimero, is in [Mero Pass's README](../README.md); this page covers working
on the frontend.

## Scripts

Run these from this directory (`apps/mero-pass/app`):

| Script                        | What it does                                                  |
| ----------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                    | Vite dev server                                               |
| `pnpm build`                  | Typecheck, then a production build into `dist/`               |
| `pnpm preview`                | Serve the production build                                    |
| `pnpm typecheck`              | `tsc -b`                                                      |
| `pnpm lint` / `pnpm prettier` | ESLint, and a Prettier check of `src/`                        |
| `pnpm test`                   | Vitest unit tests                                             |
| `pnpm test:e2e`               | Playwright browser tests (`tests/`) against a mocked node     |
| `pnpm test:live`              | Contract tests against a real node (`e2e/live/`)              |
| `pnpm test:journey`           | Two-node journey: log in, create a team, invite, sync secrets |
| `pnpm codegen`                | Regenerate the typed contract client in `src/generated/`      |

## Theme and Log out

- **Light by default.** The sun/moon switch at the end of the top bar flips to dark (`src/components/ThemeToggle.tsx`,
  logic in `src/lib/theme.ts`). The choice is saved in `localStorage` under `mero-pass:theme`, only when the switch
  is pressed. An inline script in `index.html` applies it to `<html data-theme>` before the first paint, so a dark
  reload never flashes light.
- **Log out** sits under "Signed in" at the foot of the side rail, and on the Security page. `src/auth/signOut.ts`
  locks the device key (every open vault drops its decrypted items), clears a copied secret from the clipboard,
  forgets the app selection, then calls mero-react's `logout()` and returns to the landing page. The theme choice and
  the auto-lock delay stay, because they belong to the browser rather than the account.
- **Signed-in routes are guarded.** `/teams`, `/teams/:teamId`, `/vault/:vaultId` and `/security` send a signed-out
  visitor to the landing page, so Back after Log out never shows an empty app. `/share`, `/docs` and `/preview` stay
  public.
- Tests: `tests/theme.spec.ts`, `tests/logout.spec.ts`, `src/lib/theme.test.ts`, `src/auth/signOut.test.ts` and
  `src/App.routes.test.tsx`.

## Layout

| Path                          | Contents                                                  |
| ----------------------------- | --------------------------------------------------------- |
| `src/pages/landing`           | The public landing page, docs and preview                 |
| `src/pages/teams`, `team`     | Your teams, and one team's vaults and people              |
| `src/pages/vault`             | A vault: its items and the item detail                    |
| `src/pages/security`          | Device key, auto-lock, approvals and Log out              |
| `src/pages/share`             | Opening a share link (needs no node and no login)         |
| `src/components/AppShell.tsx` | The signed-in frame: side rail, top bar, phone nav drawer |
| `src/lib`                     | Device key, recovery key, invites, clipboard, theme       |
| `src/auth`                    | Sign-out and desktop bootstrap                            |
| `src/generated`               | The typed contract client (`pnpm codegen`)                |
