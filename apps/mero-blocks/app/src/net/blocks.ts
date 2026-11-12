// The world's contract, through `MeroBlocksClient`, which `mero-app-build
// codegen` writes from logic/res/abi.json (`src/generated/client.ts`;
// tests/generatedClient.test.ts checks it covers exactly the committed ABI).
// `blocks()` adapts it to what the game engine takes (`WorldApi`, sync.ts).
//
// Wire conversions live here and nowhere else: a `u64` (`now`, `seed`,
// `createdAt`, the counts in `worldStats`) travels as a decimal string; the
// game keeps numbers. The ABI describes its records (`WorldMeta`, `PlayersPage`,
// ...), so the generated client types what the contract answers, and the
// shapes below are what the game reads after the conversion.

import type { Edit } from "../engine/world";
import { MeroBlocksClient, type AppTransport, type PlayerView } from "../generated/client";
import type { BlockEntry, RemotePlayer, Transform, WorldApi } from "./sync";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-blocks";

/** `init`'s arguments (`createApp(..., { initArgs })`), all optional on the contract. */
export const INIT_PARAMS = ["name", "seed", "now"] as const;

export interface WorldMeta {
  name: string;
  seed: number;
  /** Unix seconds; the day/night cycle is counted from here. */
  createdAt: number;
}

export interface WorldStats {
  overrides: number;
  players: number;
}

/** The world at instance `app`, as one device of the signed-in account. */
export interface Blocks extends WorldApi {
  /** The world's meta, and the log index it was read at (where the event stream picks up). */
  worldMeta(): Promise<{ meta: WorldMeta; index: number }>;
  overrideCount(): Promise<number>;
  worldStats(): Promise<WorldStats>;
  /** The caller's account as the contract sees it: `PlayerView.account`. */
  myAccount(): Promise<string>;
}

/** One page of a paged view (`OverridesPage`, `PlayersPage`). */
interface Page<T> {
  items: T[];
  next: string | null;
}

/** Pages a read follows at most: 1,000 rows each, so ~1M rows (a world full of edits). */
const MAX_PAGES = 1100;

const u64 = (n: number): string => String(Math.max(0, Math.floor(n)));

/** `init` arguments for a new world: name, seed in [0, 2^32), the creator's clock. */
export function initArgs(name: string, seed: number, nowSecs: number): Record<(typeof INIT_PARAMS)[number], string> {
  return { name, seed: u64(seed % 4294967296), now: u64(nowSecs) };
}

/**
 * `client`, with `onIndex` seeing each answer's log index: the generated
 * client returns a method's result alone, and the event stream picks up at
 * the index the world was read at.
 */
export function indexed(client: AppTransport, onIndex: (index: number) => void): AppTransport {
  const saw = <R extends { result: unknown }>(r: R): R => {
    const index = (r as { index?: unknown }).index;
    if (typeof index === "number") onIndex(index);
    return r;
  };
  return {
    apps: {
      call: async (args, options) => saw(await client.apps.call(args, options)),
      view: async (args, options) => saw(await client.apps.view(args, options)),
    },
    events: (app, from, signal) => client.events(app, from, signal),
  };
}

/**
 * The world at instance `app` through `client`, as `device` (a label for this
 * browser, so two devices of one account are two avatars). `after` runs after
 * every request (the session store syncs a refreshed session there).
 */
export function blocks(client: AppTransport, app: string, device: string, after: () => void = () => {}): Blocks {
  const world = new MeroBlocksClient(client, app, { after });
  /**
   * Every row of a paged view: the contract answers at most 1,000 per call
   * (its collections only grow), so follow `next` until it is `null`.
   */
  const allPages = async <T>(read: (cursor: string | null) => Promise<Page<T> | null>, method: string): Promise<T[]> => {
    const rows: T[] = [];
    let cursor: string | null = null;
    for (let n = 0; n < MAX_PAGES; n++) {
      const result = await read(cursor);
      rows.push(...(result?.items ?? []));
      cursor = result?.next ?? null;
      if (cursor === null) return rows;
    }
    throw new Error(`${method}: more than ${MAX_PAGES} pages`);
  };
  return {
    setBlocks: (edits: Edit[], now: number) => world.setBlocks({ edits, now: u64(now), device }),
    join: (name: string, now: number) => world.join({ name, now: u64(now), device }),
    heartbeat: (t: Transform, now: number) => world.heartbeat({ t, now: u64(now), device }),
    leave: (now: number) => world.leave({ now: u64(now), device }),
    getOverrides: () =>
      allPages<BlockEntry>((cursor) => world.getOverrides(cursor === null ? {} : { cursor }), "getOverrides"),
    getPlayers: async (now: number): Promise<RemotePlayer[]> => {
      const rows = await allPages<PlayerView>(
        (cursor) => world.getPlayers(cursor === null ? { now: u64(now) } : { now: u64(now), cursor }),
        "getPlayers",
      );
      return rows.map(({ id, name, x, y, z, yaw, pitch, sel, online }) => ({ id, name, x, y, z, yaw, pitch, sel, online }));
    },
    worldMeta: async () => {
      // The index of this one answer, not of whatever else is in flight.
      let index = 0;
      const read = new MeroBlocksClient(indexed(client, (i) => (index = i)), app, { after });
      const result = await read.worldMeta();
      return { meta: { name: result.name, seed: Number(result.seed), createdAt: Number(result.createdAt) }, index };
    },
    overrideCount: () => world.overrideCount(),
    worldStats: async () => {
      const result = await world.worldStats();
      return { overrides: Number(result.overrides), players: Number(result.players) };
    },
    myAccount: () => world.myAccount(),
  };
}

/** The avatar id the contract gives this device's player (`PlayerView.id`, the events' `id`). */
export function playerId(account: string, device: string): string {
  return device ? `${account}/${device}` : account;
}
