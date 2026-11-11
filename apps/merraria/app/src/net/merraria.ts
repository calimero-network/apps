// The contract's methods, typed (no client is generated from a component ABI
// yet). tests/merraria.test.ts asserts CALLS and VIEWS are exactly the
// committed logic/res/abi.json's, and that each method sends the parameter
// names the ABI declares, so a method the contract drops or renames fails a
// test rather than a request.

import { type ClientRoutes } from "@calimero-apps/connect";

/** The package a production world is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.merraria";

/**
 * The ABI names (camelCase), split the way the node runs them: a call goes
 * through the app's log (`/intents`), a view is answered by a node without
 * writing (`/views`).
 */
export const CALLS = ["createWorld", "setTiles", "join", "heartbeat", "leave"] as const;
export const VIEWS = ["worldMeta", "getOverrides", "getPlayers"] as const;

export type CallName = (typeof CALLS)[number];
export type ViewName = (typeof VIEWS)[number];
export type MethodName = CallName | ViewName;

const VIEW_SET: ReadonlySet<string> = new Set(VIEWS);
export const isView = (method: string): method is ViewName => VIEW_SET.has(method);

export interface WorldMeta {
  name: string;
  /** read by the terrain generator as a u32 */
  seed: number;
  /** seconds since the epoch: the day clock's anchor */
  createdAt: number;
}

export interface Edit {
  x: number;
  y: number;
  t: number;
}

export interface TileEntry {
  /** `"x,y"` */
  k: string;
  t: number;
}

/** One page of `getOverrides`: `next` is null on the last page. */
export interface OverridesPage {
  items: TileEntry[];
  next: string | null;
}

/** The most overrides one `getOverrides` answers (its default and largest `limit`). */
export const OVERRIDES_PAGE = 1000;

/**
 * Every override, page after page until `next` is null. The contract answers
 * one page per call (at most 1,000), so a full world is many small reads, not
 * one answer of over a megabyte.
 */
export async function readAllOverrides(exec: Exec): Promise<TileEntry[]> {
  const all: TileEntry[] = [];
  let cursor: string | null = null;
  do {
    const args: Record<string, unknown> = cursor === null ? {} : { cursor };
    const page: OverridesPage = await exec<OverridesPage>("getOverrides", args);
    all.push(...(page?.items ?? []));
    cursor = page?.next ?? null;
  } while (cursor !== null);
  return all;
}

export interface PlayerView {
  /** the player's account */
  id: string;
  name: string;
  x: number;
  y: number;
  dir: number;
  sel: number;
  action: string;
  online: boolean;
}

/** Seconds since the epoch, as every `now` argument takes it (a u32). */
export const nowSecs = (): number => Math.floor(Date.now() / 1000);

/** `exec(method, args)`: the shape SyncEngine is written against. */
export type Exec = <T = unknown>(method: MethodName, args: Record<string, unknown>) => Promise<T>;

type Transport = ClientRoutes<{ apps: "call" | "view" }>;

/**
 * `exec` for the world at instance `app`: views through `client.view`, calls
 * through `client.call`. `after` runs after every request (the session store
 * syncs a refreshed session there); `onIndex` sees each answer's log index.
 */
export function bindExec(
  client: Transport,
  app: string,
  after: () => void = () => {},
  onIndex: (index: number) => void = () => {},
): Exec {
  return async <T>(method: MethodName, args: Record<string, unknown>): Promise<T> => {
    try {
      const answer = isView(method)
        ? await client.apps.view({ app, method, args })
        : await client.apps.call({ app, method, args });
      onIndex(answer.index);
      return answer.result as T;
    } finally {
      after();
    }
  };
}

/** The world's methods by name, for the places that are not the sync engine. */
export interface Merraria {
  createWorld(name: string, seed: number, now?: number): Promise<null>;
  worldMeta(): Promise<WorldMeta>;
  setTiles(edits: Edit[], now?: number): Promise<number>;
  /** One page: from `cursor` (absent for the first), at most `limit` (default and largest 1,000). */
  getOverrides(cursor?: string, limit?: number): Promise<OverridesPage>;
  join(name: string, now?: number): Promise<PlayerView>;
  heartbeat(t: Omit<PlayerView, "id" | "online">, now?: number): Promise<null>;
  leave(now?: number): Promise<null>;
  getPlayers(now?: number): Promise<PlayerView[]>;
}

export function merraria(exec: Exec): Merraria {
  return {
    createWorld: (name, seed, now = nowSecs()) => exec("createWorld", { name, seed, now }),
    worldMeta: () => exec("worldMeta", {}),
    setTiles: (edits, now = nowSecs()) => exec("setTiles", { edits, now }),
    getOverrides: (cursor, limit) =>
      exec("getOverrides", {
        ...(cursor === undefined ? {} : { cursor }),
        ...(limit === undefined ? {} : { limit }),
      }),
    join: (name, now = nowSecs()) => exec("join", { name, now }),
    heartbeat: (t, now = nowSecs()) => exec("heartbeat", { t, now }),
    leave: (now = nowSecs()) => exec("leave", { now }),
    getPlayers: (now = nowSecs()) => exec("getPlayers", { now }),
  };
}

/** A seed the contract takes: a non-negative integer below 2^32. */
export function toSeed(raw: unknown, fallback: number): number {
  const n = Math.floor(Math.abs(Number(raw)));
  if (!Number.isFinite(n) || n === 0) return fallback;
  return n % 2 ** 32;
}
