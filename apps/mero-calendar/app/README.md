# Mero Calendar: web app

The React frontend of Mero Calendar, built with Vite. It talks to your own Calimero node through
`@calimero-network/mero-react`. What the app does, and how the frontend and the contract fit together, is in
[Mero Calendar's README](../README.md); this page covers working on the frontend.

## Scripts

Run these from this directory (`apps/mero-calendar/app`):

| Script                          | What it does                                          |
| ------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                      | Vite dev server                                       |
| `pnpm build`                    | Typecheck, then a production build into `dist/`       |
| `pnpm preview`                  | Serve the production build                            |
| `pnpm typecheck`                | `tsc -b`                                              |
| `pnpm test` / `pnpm test:watch` | Vitest unit tests, once or watching                   |
| `pnpm e2e` / `pnpm e2e:ui`      | Playwright browser tests against a mocked node        |
| `pnpm e2e:integration`          | Playwright browser tests against a real node          |
| `pnpm test:journey`             | Two-node journey: log in, create a team, invite, sync |

## Theme and Log out

- **Light by default.** The sun/moon switch in every signed-in top bar, and in the landing page's footer, flips to
  dark. The choice is saved in `localStorage` under `mc-theme` (`src/providers/ThemeProvider`). An inline script
  in `index.html` applies it to `<html data-theme>` before the first paint, so a dark reload never flashes light.
  Keep that script's key and colours in step with the provider.
- **Log out** ends every signed-in top bar (`src/components/common/logout-button/LogoutButton.tsx`). It calls
  mero-react's `logout()` and returns to the landing page. On a phone the label collapses to its icon; the
  accessible name stays "Log out".
- Tests: `e2e/theme.spec.ts` (default light, the switch, persistence across reloads) and
  `LogoutButton.test.tsx`.

## Layout

| Path                    | Contents                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `src/pages/landing`     | The public landing page, docs and preview (its config is generated, see `scripts/landing`) |
| `src/pages/teams`       | Team list and a team's calendars                                                           |
| `src/pages/calendar`    | The calendar itself                                                                        |
| `src/providers`         | Theme provider                                                                             |
| `src/components/common` | Shared header, dialogs, theme switch, Log out                                              |
| `src/styles/theme.css`  | The light and dark colour tokens every surface reads                                       |
| `e2e/`                  | Playwright specs: `integration/` runs against a node, `journey/` against two               |
