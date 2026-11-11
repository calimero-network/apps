import { AppError } from "@calimero-network/mero-js";
import { describeError, type ClientRoutes } from "@calimero-apps/connect";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-kombat";

/**
 * The contract's methods by their ABI names, split the way the node runs them:
 * a call goes through the app's log, a view is answered by a node without
 * writing. `kombat.test.ts` asserts these lists are exactly the committed
 * `logic/res/abi.json`'s, so a method the contract drops or renames fails a
 * test rather than a request.
 */
export const CALLS = ["join", "pick", "sit", "stand", "act", "rematch"] as const;
export const VIEWS = ["arena", "history"] as const;

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

export interface ActArgs {
  match: number;
  round: number;
  id: number;
  kind: string;
  hit: boolean;
  blocked: boolean;
}

/** The arena, typed from the contract (no client is generated from a component ABI yet). */
export interface Kombat {
  arena(): Promise<ArenaView>;
  history(): Promise<MatchSummary[]>;
  join(name: string, fighter: string): Promise<null>;
  pick(fighter: string): Promise<null>;
  sit(seat: "p1" | "p2", name: string, fighter: string): Promise<null>;
  stand(): Promise<null>;
  act(a: ActArgs): Promise<null>;
  /** The new match's index. */
  rematch(): Promise<number>;
  /** The highest log index any answer through this wrapper has reflected (0 before the first). */
  index(): number;
}

type Transport = ClientRoutes<{ apps: "call" | "view" }>;

/** `now` as the contract takes it: the caller's clock, a u64 as a decimal string. */
const now = (clock: () => number) => String(Math.floor(clock()));

/**
 * The arena at instance `app` through `client`. `after` runs after every
 * request (the session store syncs a refreshed session there).
 */
export function kombat(
  client: Transport,
  app: string,
  after: () => void = () => {},
  clock: () => number = Date.now,
): Kombat {
  let seen = 0;
  const saw = <R extends { index: number }>(r: R): R => {
    if (typeof r.index === "number" && r.index > seen) seen = r.index;
    return r;
  };
  const call = async <T>(method: (typeof CALLS)[number], args: Record<string, unknown>): Promise<T> => {
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
    arena: () => view("arena", { now: now(clock) }),
    history: () => view("history"),
    join: (name, fighter) => call("join", { name, fighter, now: now(clock) }),
    pick: (fighter) => call("pick", { fighter, now: now(clock) }),
    sit: (seat, name, fighter) => call("sit", { seat, name, fighter, now: now(clock) }),
    stand: () => call("stand", { now: now(clock) }),
    act: (a) =>
      call("act", {
        matchIndex: a.match,
        round: a.round,
        id: a.id,
        kind: a.kind,
        hit: a.hit,
        blocked: a.blocked,
        now: now(clock),
      }),
    rematch: () => call("rematch", { now: now(clock) }),
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
