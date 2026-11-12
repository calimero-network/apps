import { AppError } from '@calimero-network/mero-js';
import { describeError } from '@calimero-apps/connect';

import {
  BattleshipsClient,
  type AppTransport,
  type MatchRecord as WireMatchRecord,
  type MatchSummary as WireMatchSummary,
  type PlayerStatsView as WirePlayerStats,
} from './generated/client';

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = 'com.calimero.battleships';

// ── What the screens use ─────────────────────────────────────────────────────
//
// The shapes the screens were written against (v1's generated clients):
// snake_case fields, numbers for every integer. The contract keeps the
// snake_case result fields but answers 64-bit integers as decimal strings
// (D20); the functions below are the one place that converts.

export type MatchStatus = 'Pending' | 'Active' | 'Finished';

export interface MatchSummary {
  match_id: string;
  player1: string;
  player2: string;
  player2_account: string;
  /** `Pending` until both fleets are committed, `Active` while played, `Finished` once won. */
  status: MatchStatus;
  winner: string | null;
  created_ms: number;
}

export interface MatchRecord {
  match_id: string;
  winner: string;
  loser: string;
  finished_ms: number;
}

export interface PlayerStatsView {
  wins: number;
  losses: number;
  games_played: number;
}

export interface ShotsView {
  size: number;
  shots: number[];
}

export interface PendingShotView {
  shot_id: number;
  x: number;
  y: number;
  target: string;
}

export interface MatchStateView {
  standing: 'playing' | 'awaiting_reveal' | 'won' | 'void';
  committed: string[];
  pending_shot: PendingShotView | null;
  ended_by: string | null;
  loser: string | null;
  revealed: string[];
  audit_failed: string[];
  winner: string | null;
}

// ── The wire ─────────────────────────────────────────────────────────────────
//
// The contract's own shapes, as the generated client types them from the ABI:
// every u64 a decimal string.

export type { WireMatchRecord, WireMatchSummary, WirePlayerStats };

const num = (v: string | number): number => (typeof v === 'number' ? v : Number(v));

export const toMatchSummary = (w: WireMatchSummary): MatchSummary => ({
  ...w,
  created_ms: num(w.created_ms),
});
export const toMatchRecord = (w: WireMatchRecord): MatchRecord => ({
  ...w,
  finished_ms: num(w.finished_ms),
});
export const toPlayerStats = (w: WirePlayerStats): PlayerStatsView => ({
  wins: num(w.wins),
  losses: num(w.losses),
  games_played: num(w.games_played),
});

/** Bytes as the contract takes them (D20): base64url, no padding. */
export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Calling the contract ─────────────────────────────────────────────────────
//
// The lobby's contract is called through `BattleshipsClient`, which
// `mero-app-build codegen` writes from logic/res/abi.json
// (`src/generated/client.ts`): camelCase arguments, bytes as base64url
// (`base64url` above). The ABI describes its records, so the generated client
// types what the contract answers; the `to*` functions convert them to the
// shapes the screens use, where they are read. `ShotsView` stays undescribed
// (its `shots` is a JSON array of bytes, which the ABI cannot spell), so it is
// typed where it is read.

/** A lobby's contract, and the highest log index its answers reflected (0 before the first). */
export interface Lobby {
  contract: BattleshipsClient;
  index(): number;
}

/**
 * The lobby at instance `app` through `client`. `after` runs after every
 * request (the session store syncs a refreshed session there). The generated
 * client returns a method's result alone, so the transport under it notes the
 * log index each answer carries: the event stream resumes just past it.
 */
export function lobby(client: AppTransport, app: string, after: () => void = () => {}): Lobby {
  let seen = 0;
  const saw = <R extends { result: unknown }>(r: R): R => {
    const index = (r as { index?: unknown }).index;
    if (typeof index === 'number' && index > seen) seen = index;
    return r;
  };
  const watched: AppTransport = {
    apps: {
      call: async (args, options) => saw(await client.apps.call(args, options)),
      view: async (args, options) => saw(await client.apps.view(args, options)),
    },
    events: (a, from, signal) => client.events(a, from, signal),
  };
  return { contract: new BattleshipsClient(watched, app, { after }), index: () => seen };
}

/** The contract's refusals in words, by error code (v1's messages where it had them). */
const MESSAGES: Record<string, string> = {
  NotFound: 'That match does not exist in this lobby',
  Invalid: 'That is not allowed here',
  Forbidden: 'You cannot do that in this match',
  Finished: 'Match already finished',
  MatchIdCollision: 'Match id already exists. Try again',
  AlreadyCommitted: 'Your fleet is already deployed',
  CommitmentMismatch: 'That board does not match the fleet you deployed',
};

/**
 * One line for the UI: the contract's refusals in words (`Invalid` and
 * `Forbidden` carry their own sentence), anything else as `describeError`
 * puts it.
 */
export function messageOf(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof AppError) {
    const message = typeof e.fields?.message === 'string' ? e.fields.message : null;
    if (message) return message.charAt(0).toUpperCase() + message.slice(1);
    if (MESSAGES[e.appCode]) return MESSAGES[e.appCode] as string;
  }
  return describeError(e) || fallback;
}

/** The refusal of a shot at a match that is over. */
export const isMatchFinishedError = (e: unknown): boolean =>
  e instanceof AppError && e.appCode === 'Finished';

/** The refusal of a shot before the opponent has deployed. */
export const isShipsNotPlacedError = (e: unknown): boolean =>
  e instanceof AppError &&
  e.appCode === 'Invalid' &&
  String(e.fields?.message ?? '').includes('place ships first');
