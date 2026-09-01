# Foundation recipes

Self-contained, **logic-only** reference modules that extend the one base
scaffold (`app/` + `logic/`). The base ships a proven design system, auth,
namespaces=workspaces, flat auto-join rooms, blobs, presence and moderation.
These recipes show *additional* Calimero patterns the base doesn't use, so the
Studio build agent can **pull in just the logic it needs** without a second,
design-duplicated foundation app.

> Recipes are reference code, not wired into the built app. Copy the pieces you
> need into `app/src/...` / `logic/crates/...`, keep the base's design system
> (`app/src/theme.ts` + the styled components), and re-run codegen/build.

## Index

| Recipe | Shows | Files |
| --- | --- | --- |
| **private-rooms/** | Public (`open`) vs private (`restricted`) rooms as **subgroups** with visibility — real per-room membership (the base's flat rooms auto-join everyone) | `useSubgroupRooms.ts` |
| **authored-feed/** | `AuthoredVector<T>` — an **ordered, author-owned** log (vs the base's hash-ordered `AuthoredMap`) | `feed.rs` |
| **counters/** | `GCounter` / `PNCounter` CRDT — likes / votes / tallies | `counter.rs` |
| **dms/** | 1:1 **direct messages** as a 2-member restricted subgroup (builds on private-rooms) | `useDms.ts` |
| **context-metadata/** | `setContextMetadata` — propagated room topic/description every member sees | `useRoomMetadata.ts` |

## How the build agent should use these

1. Pick the recipe(s) that match the spec (e.g. "private channels" → `private-rooms` + maybe `dms`; "leaderboard"/"voting" → `counters`; "activity feed" → `authored-feed`).
2. Copy the logic into the generated app, adapting names to `studio.config.json`.
3. Keep the base design — recipes never restyle; they reuse `theme.ts`, the modals, the sidebar, etc.
4. For Rust recipes, add the field to the service's `#[app::state]` and the methods to its `#[app::logic]` impl, then rebuild WASM + regenerate the client.

Every API used here is verified against mero-js v2 / mero-react 2.5 / calimero-storage 0.11. See also the `calimero-client-js` skill's `subgroups-and-visibility.md`.
