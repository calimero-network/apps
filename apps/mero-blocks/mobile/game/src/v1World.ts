// The game's `WorldApi` over the native bridge, on the wire the native shells
// speak today: the v1 contract's snake_case methods with `now` as a number,
// through the swift-sdk / kotlin-sdk v1 clients and the account relay.
//
// The web build now talks to the component runtime (`app/src/net/blocks.ts`);
// the native shells cannot yet (no component-runtime client in swift-sdk or
// kotlin-sdk), so this keeps the page they bundle working unchanged until they
// move. See `apps/mero-blocks/mobile/README.md`.

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
