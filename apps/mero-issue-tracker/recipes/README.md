# Foundation recipes

Self-contained, **reference** modules that extend the base scaffold (`app/` +
`logic/`) with Calimero patterns the base does not use, so a build agent can
pull in just the piece it needs. They are not compiled or wired into the app:
copy what you need into `app/src/...` / `logic/src/lib.rs` and keep the base's
design system (`app/src/theme.ts`, the modals, the sidebar).

All of them target **Calimero 1.0**: contracts on the component SDK
(`calimero-sdk`, see `docs/COMPONENT-APPS.md`) and frontends on mero-js's
`CalimeroClient` (through `@calimero-apps/connect`; in this app,
`useSignedIn()` from `app/src/sessionContext.tsx` hands you the client).

| v1 | Calimero 1.0 |
|---|---|
| namespace (workspace) | organization |
| context (room, repo) | app instance (`createApp(name, source, { org, access })`) |
| subgroup with visibility | team (`join: 'everyone'` open, `'invite'` restricted) and app access `{ kind: 'team', team }` |
| context metadata | app metadata (`setAppMetadata`, `getApp(app).metadata`) |
| `AuthoredVector`, `Authored<IndexedMap>` | a `Table` with an `author` field, checked against `env::caller()` |
| `GCounter` / `PNCounter` | `Counter` (one log orders every write: nothing to merge) |

## Index

| Recipe | Shows | Files |
| --- | --- | --- |
| **private-rooms/** | Public vs private rooms as **teams** of the org, each room an app instance reachable by its team | `useTeamRooms.ts` |
| **dms/** | 1:1 **direct messages**: an app instance whose access is exactly two accounts | `useDms.ts` |
| **context-metadata/** | A room's topic/description as **app metadata** every member reads | `useRoomMetadata.ts` |
| **authored-feed/** | An **append-ordered, author-owned** feed: a `Table` keyed by position with an `author` field | `feed.rs` |
| **counters/** | A `Counter` tally, and one-vote-per-person votes as rows keyed `(item, account)` | `counter.rs` |

## How the build agent should use these

1. Pick the recipe(s) that match the spec ("private channels" → `private-rooms`
   + maybe `dms`; "leaderboard"/"voting" → `counters`; "activity feed" →
   `authored-feed`).
2. For Rust recipes, add the fields to the app's `#[app::state]` and the
   methods (and the `#[app::error]`/`#[app::event]` variants) to its
   `#[app::logic]` module, then `mero-component build` to refresh `res/abi.json`.
3. For TypeScript recipes, pass the signed-in `CalimeroClient` and the app's
   `AppSource` (`appSource(import.meta.env, PACKAGE)`).
