import { AppError, type CalimeroClient } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-chess";

/**
 * The contract's methods by their ABI names, split the way the node runs them:
 * a call goes through the app's log, a view is answered by a node without
 * writing. `chess.test.ts` asserts these lists are exactly the committed
 * `logic/res/abi.json`'s, so a method the contract drops or renames fails a
 * test rather than a request.
 */
export const CALLS = [
  "join",
  "heartbeat",
  "sit",
  "stand",
  "play",
  "resign",
  "offerDraw",
  "acceptDraw",
  "declineDraw",
  "claimDraw",
  "rematch",
] as const;
export const VIEWS = ["table", "history"] as const;

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

export interface WireMove {
  ply: number;
  uci: string;
  san: string;
  by: string;
  /** A u64: a decimal string on the wire. */
  at: string;
}

export interface WireGameSummary {
  index: number;
  startedAt: string;
  result: string;
  reason: string;
  plies: number;
  white: string;
  black: string;
}

export interface WireTableView {
  title: string;
  createdAt: string;
  game: number;
  fen: string;
  sideToMove: string;
  moves: WireMove[];
  legalMoves: string[];
  status: string;
  result: string;
  reason: string;
  check: boolean;
  claimableDraw: string;
  white: SeatView;
  black: SeatView;
  me: string;
  myColor: string;
  myTurn: boolean;
  drawOfferFrom: string;
  players: PlayerView[];
  gamesPlayed: number;
}

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

// ── The typed contract ───────────────────────────────────────────────────────

/** The table, typed from the contract (no client is generated from a component ABI yet). */
export interface Chess {
  table(): Promise<TableView>;
  history(): Promise<GameSummary[]>;
  join(name: string): Promise<null>;
  heartbeat(): Promise<null>;
  sit(seat: "white" | "black", name: string): Promise<null>;
  stand(): Promise<null>;
  /** The move's SAN. */
  play(uci: string): Promise<string>;
  resign(): Promise<null>;
  offerDraw(): Promise<null>;
  acceptDraw(): Promise<null>;
  declineDraw(): Promise<null>;
  claimDraw(): Promise<null>;
  /** The new game's index. */
  rematch(): Promise<number>;
  /** The highest log index any answer through this wrapper has reflected (0 before the first). */
  index(): number;
}

type Transport = Pick<CalimeroClient, "call" | "view">;

/** `now` as the contract takes it: the caller's clock, a u64 as a decimal string. */
const now = (clock: () => number) => String(Math.floor(clock()));

/**
 * The table at instance `app` through `client`. `after` runs after every
 * request (the session store syncs a refreshed session there).
 */
export function chess(
  client: Transport,
  app: string,
  after: () => void = () => {},
  clock: () => number = Date.now,
): Chess {
  let seen = 0;
  const saw = <R extends { index: number }>(r: R): R => {
    if (typeof r.index === "number" && r.index > seen) seen = r.index;
    return r;
  };
  const call = async <T>(method: (typeof CALLS)[number], args: Record<string, unknown> = {}): Promise<T> => {
    try {
      return saw(await client.call(app, method, { ...args, now: now(clock) })).result as T;
    } finally {
      after();
    }
  };
  const view = async <T>(method: (typeof VIEWS)[number], args: Record<string, unknown> = {}): Promise<T> => {
    try {
      return saw(await client.view(app, method, args)).result as T;
    } finally {
      after();
    }
  };
  return {
    table: async () => toTableView(await view<WireTableView>("table", { now: now(clock) })),
    history: async () => (await view<WireGameSummary[]>("history")).map(toGameSummary),
    join: (name) => call("join", { name }),
    heartbeat: () => call("heartbeat"),
    sit: (seat, name) => call("sit", { seat, name }),
    stand: () => call("stand"),
    play: (uci) => call("play", { uci }),
    resign: () => call("resign"),
    offerDraw: () => call("offerDraw"),
    acceptDraw: () => call("acceptDraw"),
    declineDraw: () => call("declineDraw"),
    claimDraw: () => call("claimDraw"),
    rematch: () => call("rematch"),
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
