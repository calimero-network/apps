import { AppError } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import type { AppTransport } from "./generated/client";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-kombat";

/** One corner (the contract's `FighterView`). */
export interface FighterView {
  seat: string;
  /** The account in this corner, or `""` when it is empty. */
  member: string;
  name: string;
  fighter: string;
  hp: number;
  roundsWon: number;
  matchesWon: number;
  online: boolean;
}

/** One blow of the current round (`HitView`). */
export interface HitView {
  by: string;
  id: number;
  kind: string;
  damage: number;
  blocked: boolean;
  /** A u64: a decimal string on the wire. */
  at: string;
}

/** Everything the arena draws (`ArenaView`). */
export interface ArenaView {
  title: string;
  createdAt: string;
  matchIndex: number;
  round: number;
  status: "waiting" | "fighting" | "finished" | string;
  roundResults: string[];
  winner: string;
  flawless: boolean;
  p1: FighterView;
  p2: FighterView;
  me: string;
  mySeat: string;
  hits: HitView[];
  matchActions: number;
  /** A u64: a decimal string on the wire. */
  totalActions: string;
  maxHp: number;
  roundsToWin: number;
}

/** One match of the arena's record (`MatchSummary`). */
export interface MatchSummary {
  index: number;
  startedAt: string;
  winner: string;
  flawless: boolean;
  rounds: string[];
  actions: number;
}

// ── Calling the contract ─────────────────────────────────────────────────────
//
// The contract is called through `MeroKombatClient`, which `mero-app-build
// codegen` writes from logic/res/abi.json (`src/generated/client.ts`). The ABI
// names `ArenaView` and `MatchSummary` without their shapes, so the generated
// types are `unknown`: the shapes above type them where they are read.

/** `now` as the contract takes it: the caller's clock, a u64 as a decimal string. */
export const now = (clock: () => number = Date.now): string => String(Math.floor(clock()));

/** A transport that keeps the highest log index its answers reflected (0 before the first). */
export interface Indexed<T> {
  transport: T;
  index(): number;
}

/**
 * `client`, watched for the log index each answer carries: the generated
 * client returns a method's result alone, and the event stream is resumed
 * just past what the arena already reflects.
 */
export function indexed<T extends AppTransport>(client: T): Indexed<AppTransport> {
  let seen = 0;
  const saw = <R extends { result: unknown }>(r: R): R => {
    const index = (r as { index?: unknown }).index;
    if (typeof index === "number" && index > seen) seen = index;
    return r;
  };
  return {
    transport: {
      apps: {
        call: async (args, options) => saw(await client.apps.call(args, options)),
        view: async (args, options) => saw(await client.apps.view(args, options)),
      },
      events: (app, from, signal) => client.events(app, from, signal),
    },
    index: () => seen,
  };
}

/** v1's refusal messages, by the error code that replaced each. */
const MESSAGES: Record<string, string> = {
  UnknownSeat: "a corner is either `p1` or `p2`",
  UnknownFighter: "unknown fighter",
  UnknownMove: "unknown move",
  CornerTaken: "that corner is taken",
  InOtherCorner: "you are already in the other corner",
  NotInCorner: "only a fighter in a corner can do that",
  AlreadyFought: "you have already fought here",
  WaitingForOpponent: "waiting for an opponent",
  MatchOver: "this match is over",
  WrongMatch: "that match is not being fought",
  RoundOver: "that round is over",
  ActionLimit: "this round has reached its action limit",
  MatchNotFinished: "finish this match first",
  MatchLimit: "this arena has fought all the matches it counts",
};

/** One line for the UI: the contract's refusals in words, anything else as `describeError` puts it. */
export function messageOf(e: unknown): string {
  if (e instanceof AppError && MESSAGES[e.appCode]) return MESSAGES[e.appCode] as string;
  return describeError(e);
}
