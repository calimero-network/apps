// The world's contract is called through `MerrariaClient`, which `mero-app-build
// codegen` writes from logic/res/abi.json (`src/generated/client.ts`);
// tests/generatedClient.test.ts checks it covers exactly the committed ABI. The
// ABI names its records (`WorldMeta`, `OverridesPage`, `PlayerView`, ...) without
// their shapes, so the generated types are `unknown`: the interfaces below type
// them where they are read.

import type { AppTransport, MerrariaClient } from "../generated/client";

/** The package a production world is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.merraria";

/**
 * The world's methods the game engine uses: the generated client's, so the
 * native host (`NativeGameClient`, over the apps' v1 bridge) answers the same
 * surface as a `CalimeroClient`.
 */
export type WorldCalls = Pick<
  MerrariaClient,
  "worldMeta" | "setTiles" | "getOverrides" | "getPlayers" | "join" | "heartbeat" | "leave"
>;

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
export async function readAllOverrides(world: Pick<WorldCalls, "getOverrides">): Promise<TileEntry[]> {
  const all: TileEntry[] = [];
  let cursor: string | null = null;
  do {
    const page = (await world.getOverrides(cursor === null ? {} : { cursor })) as OverridesPage;
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

/**
 * `client`, with `onIndex` seeing each answer's log index: the generated
 * client returns a method's result alone, and the event stream resumes just
 * past the last index seen.
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

/** A seed the contract takes: a non-negative integer below 2^32. */
export function toSeed(raw: unknown, fallback: number): number {
  const n = Math.floor(Math.abs(Number(raw)));
  if (!Number.isFinite(n) || n === 0) return fallback;
  return n % 2 ** 32;
}
