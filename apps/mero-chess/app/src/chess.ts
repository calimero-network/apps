import { AppError } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import type {
  AppTransport,
  GameSummary as WireGameSummary,
  TableView as WireTableView,
} from "./generated/client";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-chess";

// ── The shapes the screens use ───────────────────────────────────────────────
//
// v1's generated client (snake_case fields, numbers for every integer). The
// screens were written against these, so the answers of the component
// contract (camelCase, u64s as decimal strings) are converted back to them in
// one place, `toTableView` / `toGameSummary`, rather than every screen
// learning the new wire.

export interface SeatView {
  /** `white` or `black`: which chair this is, i.e. its colour in game 0. */
  seat: string;
  /** The account holding it, or `""` when the chair is free. */
  member: string;
  name: string;
  online: boolean;
}

export interface MoveView {
  ply: number;
  uci: string;
  san: string;
  by: string;
  at: number;
}

export interface PlayerView {
  id: string;
  name: string;
  online: boolean;
  color: string;
}

export interface GameSummary {
  index: number;
  started_at: number;
  result: string;
  reason: string;
  plies: number;
  white: string;
  black: string;
}

export interface TableView {
  title: string;
  created_at: number;
  game: number;
  fen: string;
  side_to_move: string;
  moves: MoveView[];
  legal_moves: string[];
  status: string;
  result: string;
  reason: string;
  check: boolean;
  claimable_draw: string;
  white: SeatView;
  black: SeatView;
  me: string;
  my_color: string;
  my_turn: boolean;
  draw_offer_from: string;
  players: PlayerView[];
  games_played: number;
}

// ── The wire (the contract's own answers) ────────────────────────────────────
//
// As the generated client types them from the ABI: camelCase, u64s as decimal
// strings.

export type {
  GameSummary as WireGameSummary,
  MoveView as WireMove,
  TableView as WireTableView,
} from "./generated/client";

/** A u64 off the wire. Timestamps here are milliseconds, well inside 2^53. */
const num = (s: string | number): number => (typeof s === "number" ? s : Number(s));

export function toTableView(w: WireTableView): TableView {
  return {
    title: w.title,
    created_at: num(w.createdAt),
    game: w.game,
    fen: w.fen,
    side_to_move: w.sideToMove,
    moves: w.moves.map((m) => ({ ...m, at: num(m.at) })),
    legal_moves: w.legalMoves,
    status: w.status,
    result: w.result,
    reason: w.reason,
    check: w.check,
    claimable_draw: w.claimableDraw,
    white: w.white,
    black: w.black,
    me: w.me,
    my_color: w.myColor,
    my_turn: w.myTurn,
    draw_offer_from: w.drawOfferFrom,
    players: w.players,
    games_played: w.gamesPlayed,
  };
}

export function toGameSummary(w: WireGameSummary): GameSummary {
  return {
    index: w.index,
    started_at: num(w.startedAt),
    result: w.result,
    reason: w.reason,
    plies: w.plies,
    white: w.white,
    black: w.black,
  };
}

// ── Calling the contract ─────────────────────────────────────────────────────
//
// The contract is called through `MeroChessClient`, which `mero-app-build
// codegen` writes from logic/res/abi.json (`src/generated/client.ts`), which
// types its records from the ABI; the answers are converted to the shapes the
// screens use here, by `toTableView` / `toGameSummary`.

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
 * just past what the table already reflects.
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
  UnknownSeat: "a seat is either `white` or `black`",
  SeatTaken: "that seat is taken",
  NotSeated: "only a seated player can do that",
  AlreadyPlayed: "you have played at this table — resign instead",
  GameOver: "this game is over",
  MoveLimit: "this game has reached the move limit",
  WaitingForOpponent: "both seats must be taken before a move can be played",
  NotYourMove: "it is not your move",
  BadMove: "that is not a move in UCI notation",
  IllegalMove: "that move is not legal in this position",
  NoDrawOffer: "there is no draw offer to answer",
  NoDrawToClaim: "there is no draw to claim in this position",
  GameNotFinished: "finish this game first",
  GameLimit: "this table has played all the games it counts",
};

/** One line for the UI: the contract's refusals in words, anything else as `describeError` puts it. */
export function messageOf(e: unknown): string {
  if (e instanceof AppError && MESSAGES[e.appCode]) return MESSAGES[e.appCode] as string;
  return describeError(e);
}
