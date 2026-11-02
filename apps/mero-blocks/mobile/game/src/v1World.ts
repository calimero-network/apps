// The game's `WorldApi` over the native bridge, on the page's own bridge wire:
// the snake_case method names with `now` as a number and whole lists, as the
// page has always sent them. The native side (`Bridge.swift` / `Bridge.kt`)
// maps each call onto the contract's component ABI: camelCase names, `u64`s as
// decimal strings, paged reads followed to the end.
//
// The web build calls the component ABI directly (`app/src/net/blocks.ts`).

import type { BlockEntry, RemotePlayer, WorldApi } from "../../../app/src/net/sync";

export type Exec = <T = unknown>(method: string, args: Record<string, unknown>) => Promise<T>;

export function v1World(exec: Exec): WorldApi {
  return {
    setBlocks: (edits, now) => exec("set_blocks", { edits, now }),
    getOverrides: async () => (await exec<BlockEntry[]>("get_overrides", {})) ?? [],
    getPlayers: async (now) => (await exec<RemotePlayer[]>("get_players", { now })) ?? [],
    join: (name, now) => exec("join", { name, now }),
    heartbeat: (t, now) => exec("heartbeat", { t, now }),
    leave: (now) => exec("leave", { now }),
  };
}
