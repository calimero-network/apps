// The contract, typed: one function per ABI method, by its camelCase name,
// over mero-js's `CalimeroClient` (no client is generated from a component ABI
// yet). `tests/blocks-api.test.ts` asserts CALLS and VIEWS and every argument
// name are exactly the committed `logic/res/abi.json`'s, so a method the
// contract drops or renames fails a test rather than a request.
//
// Wire conversions live here and nowhere else: a `u64` (`now`, `seed`,
// `createdAt`, the counts in `worldStats`) travels as a decimal string; the
// game keeps numbers.

import type { Edit } from "../engine/world";
import type { BlockEntry, RemotePlayer, Transform, WorldApi } from "./sync";
import { type ClientRoutes } from "@calimero-apps/connect";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-blocks";

/** Writes: through the app's log (`POST /apps/{app}/intents`). */
export const CALLS = ["setBlocks", "join", "heartbeat", "leave"] as const;
/** Reads: answered by a node without writing. */
export const VIEWS = ["worldMeta", "getOverrides", "overrideCount", "worldStats", "getPlayers", "myAccount"] as const;

/** The arguments each method takes, by name, as the ABI lists them. */
export const PARAMS: Record<(typeof CALLS)[number] | (typeof VIEWS)[number], readonly string[]> = {
  setBlocks: ["edits", "now", "device"],
  join: ["name", "now", "device"],
  heartbeat: ["t", "now", "device"],
  leave: ["now", "device"],
  worldMeta: [],
  getOverrides: ["cursor", "limit"],
  overrideCount: [],
  worldStats: [],
  getPlayers: ["now", "cursor", "limit"],
  myAccount: [],
};

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

/** What the contract answers for a player (`PlayerView`). */
interface PlayerView extends Transform {
  id: string;
  account: string;
  device: string;
  online: boolean;
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

type Transport = ClientRoutes<{ apps: "call" | "view" }>;

/** One page of a paged view (`getOverrides`, `getPlayers`). */
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
 * The world at instance `app` through `client`, as `device` (a label for this
 * browser, so two devices of one account are two avatars). `after` runs after
 * every request (the session store syncs a refreshed session there).
 */
export function blocks(client: Transport, app: string, device: string, after: () => void = () => {}): Blocks {
  const call = async <T>(method: (typeof CALLS)[number], args: Record<string, unknown>): Promise<T> => {
    try {
      return (await client.apps.call({ app, method, args })).result as T;
    } finally {
      after();
    }
  };
  const view = async <T>(method: (typeof VIEWS)[number], args: Record<string, unknown> = {}): Promise<{ result: T; index: number }> => {
    try {
      const answer = await client.apps.view({ app, method, args });
      return { result: answer.result as T, index: answer.index };
    } finally {
      after();
    }
  };
  /**
   * Every row of a paged view: the contract answers at most 1,000 per call
   * (its collections only grow), so follow `next` until it is `null`.
   */
  const allPages = async <T>(method: "getOverrides" | "getPlayers", args: Record<string, unknown>): Promise<T[]> => {
    const rows: T[] = [];
    let cursor: string | null = null;
    for (let n = 0; n < MAX_PAGES; n++) {
      const answer: { result: Page<T> } = await view<Page<T>>(method, cursor === null ? args : { ...args, cursor });
      const result = answer.result;
      rows.push(...(result?.items ?? []));
      cursor = result?.next ?? null;
      if (cursor === null) return rows;
    }
    throw new Error(`${method}: more than ${MAX_PAGES} pages`);
  };
  return {
    setBlocks: (edits: Edit[], now: number) => call<number>("setBlocks", { edits, now: u64(now), device }),
    join: (name: string, now: number) => call("join", { name, now: u64(now), device }),
    heartbeat: (t: Transform, now: number) => call("heartbeat", { t, now: u64(now), device }),
    leave: (now: number) => call("leave", { now: u64(now), device }),
    getOverrides: () => allPages<BlockEntry>("getOverrides", {}),
    getPlayers: async (now: number): Promise<RemotePlayer[]> => {
      const rows = await allPages<PlayerView>("getPlayers", { now: u64(now) });
      return rows.map(({ id, name, x, y, z, yaw, pitch, sel, online }) => ({ id, name, x, y, z, yaw, pitch, sel, online }));
    },
    worldMeta: async () => {
      const { result, index } = await view<{ name: string; seed: string; createdAt: string }>("worldMeta");
      return { meta: { name: result.name, seed: Number(result.seed), createdAt: Number(result.createdAt) }, index };
    },
    overrideCount: async () => (await view<number>("overrideCount")).result,
    worldStats: async () => {
      const { result } = await view<{ overrides: string; players: string }>("worldStats");
      return { overrides: Number(result.overrides), players: Number(result.players) };
    },
    myAccount: async () => (await view<string>("myAccount")).result,
  };
}

/** The avatar id the contract gives this device's player (`PlayerView.id`, the events' `id`). */
export function playerId(account: string, device: string): string {
  return device ? `${account}/${device}` : account;
}
