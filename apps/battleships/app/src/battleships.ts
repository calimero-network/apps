import { AppError } from '@calimero-network/mero-js';
import { describeError, type ClientRoutes } from '@calimero-apps/connect';

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = 'com.calimero.battleships';

/**
 * The contract's methods by their ABI names (camelCase), split the way the
 * node runs them: a call goes through the app's log, a view is answered by a
 * node without writing. `battleships.test.ts` asserts these lists, and every
 * method's parameter names, are exactly the committed `logic/res/abi.json`'s,
 * so a method the contract drops or renames fails a test rather than a request.
 */
export const CALLS = [
  'registerPlayer',
  'createMatch',
  'commitBoard',
  'proposeShot',
  'acknowledgeShot',
  'revealBoard',
] as const;
export const VIEWS = [
  'getPlayers',
  'getMatches',
  'getPlayerStats',
  'getHistory',
  'getShots',
  'getIncomingShots',
  'getMatchState',
  'getActiveMatchId',
  'getCurrentTurn',
  'getWinner',
  'getCurrentUser',
] as const;

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

export interface PlayerEntry {
  account: string;
  player: string;
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

type U64 = string;

export interface WireMatchSummary extends Omit<MatchSummary, 'created_ms'> {
  created_ms: U64;
}
export interface WireMatchRecord extends Omit<MatchRecord, 'finished_ms'> {
  finished_ms: U64;
}
export interface WirePlayerStats {
  wins: U64;
  losses: U64;
  games_played: U64;
}

const num = (v: U64 | number): number => (typeof v === 'number' ? v : Number(v));

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

// ── The typed contract ───────────────────────────────────────────────────────

/**
 * A lobby, typed from the contract (no client is generated from a component
 * ABI yet). The argument objects keep v1's snake_case names; each method sends
 * the camelCase ones the contract takes.
 */
export interface Battleships {
  registerPlayer(): Promise<string>;
  getPlayers(): Promise<PlayerEntry[]>;
  createMatch(args: { player2: string }): Promise<string>;
  getMatches(): Promise<MatchSummary[]>;
  getPlayerStats(args: { player: string }): Promise<PlayerStatsView | null>;
  getHistory(): Promise<MatchRecord[]>;
  commitBoard(args: { match_id: string; commitment: string }): Promise<null>;
  proposeShot(args: { match_id: string; x: number; y: number }): Promise<null>;
  /** `"hit"` or `"miss"`. */
  acknowledgeShot(args: { match_id: string; shot_id: number; hit: boolean }): Promise<string>;
  revealBoard(args: { match_id: string; board_bytes: Uint8Array; salt: Uint8Array }): Promise<null>;
  getShots(args: { match_id: string }): Promise<ShotsView>;
  getIncomingShots(args: { match_id: string }): Promise<ShotsView>;
  getMatchState(args: { match_id: string }): Promise<MatchStateView>;
  getActiveMatchId(): Promise<string | null>;
  getCurrentTurn(args: { match_id: string }): Promise<string | null>;
  getWinner(args: { match_id: string }): Promise<string | null>;
  getCurrentUser(): Promise<string>;
  /** The highest log index any answer through this wrapper has reflected (0 before the first). */
  index(): number;
}

type Transport = ClientRoutes<{ apps: 'call' | 'view' }>;

/**
 * The lobby at instance `app` through `client`. `after` runs after every
 * request (the session store syncs a refreshed session there).
 */
export function battleships(client: Transport, app: string, after: () => void = () => {}): Battleships {
  let seen = 0;
  const saw = <R extends { index: number }>(r: R): R => {
    if (typeof r.index === 'number' && r.index > seen) seen = r.index;
    return r;
  };
  const call = async <T>(method: (typeof CALLS)[number], args: Record<string, unknown> = {}): Promise<T> => {
    try {
      return saw(await client.apps.call({ app, method, args })).result as T;
    } finally {
      after();
    }
  };
  const view = async <T>(method: (typeof VIEWS)[number], args: Record<string, unknown> = {}): Promise<T> => {
    try {
      return saw(await client.apps.view({ app, method, args })).result as T;
    } finally {
      after();
    }
  };
  return {
    registerPlayer: () => call('registerPlayer'),
    getPlayers: () => view('getPlayers'),
    createMatch: ({ player2 }) => call('createMatch', { player2 }),
    getMatches: async () => (await view<WireMatchSummary[]>('getMatches')).map(toMatchSummary),
    getPlayerStats: async ({ player }) => {
      const w = await view<WirePlayerStats | null>('getPlayerStats', { player });
      return w ? toPlayerStats(w) : null;
    },
    getHistory: async () => (await view<WireMatchRecord[]>('getHistory')).map(toMatchRecord),
    commitBoard: ({ match_id, commitment }) => call('commitBoard', { matchId: match_id, commitment }),
    proposeShot: ({ match_id, x, y }) => call('proposeShot', { matchId: match_id, x, y }),
    acknowledgeShot: ({ match_id, shot_id, hit }) =>
      call('acknowledgeShot', { matchId: match_id, shotId: shot_id, hit }),
    revealBoard: ({ match_id, board_bytes, salt }) =>
      call('revealBoard', { matchId: match_id, boardBytes: base64url(board_bytes), salt: base64url(salt) }),
    getShots: ({ match_id }) => view('getShots', { matchId: match_id }),
    getIncomingShots: ({ match_id }) => view('getIncomingShots', { matchId: match_id }),
    getMatchState: ({ match_id }) => view('getMatchState', { matchId: match_id }),
    getActiveMatchId: () => view('getActiveMatchId'),
    getCurrentTurn: ({ match_id }) => view('getCurrentTurn', { matchId: match_id }),
    getWinner: ({ match_id }) => view('getWinner', { matchId: match_id }),
    getCurrentUser: () => view('getCurrentUser'),
    index: () => seen,
  };
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
