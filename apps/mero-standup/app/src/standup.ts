import { type ClientRoutes } from "@calimero-apps/connect";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-standup";

/**
 * The contract's methods by their ABI names (camelCase), split the way the node
 * runs them: a call goes through the app's log, a view is answered by a node
 * without writing. `standup.test.ts` asserts these lists are exactly the
 * committed `logic/res/abi.json`'s, so a method the contract drops or renames
 * fails a test rather than a request.
 */
export const CALLS = [
  "postUpdate",
  "clearUpdate",
  "logDecision",
  "offerHelp",
  "withdrawHelp",
  "setTeamName",
  "setName",
] as const;
export const VIEWS = [
  "whoami",
  "getDay",
  "listDays",
  "currentBlockers",
  "members",
  "getDecision",
  "listDecisions",
  "tags",
  "getWeek",
  "teamName",
  "getName",
] as const;

// ── What the screens use ────────────────────────────────────────────────────
//
// The shapes the screens were written against (v1's generated client):
// snake_case fields and timestamps as numbers (ms). The contract answers
// camelCase with 64-bit integers as decimal strings; `decode*` below is the one
// place that converts.

export interface HelpView {
  account: string;
  name: string;
  note: string;
  at: number;
}

export interface UpdateView {
  day: string;
  author: string;
  author_name: string;
  done: string;
  next: string;
  blockers: string;
  created_at: number;
  edited_at: number;
  helpers: HelpView[];
}

export interface DayView {
  day: string;
  updates: UpdateView[];
}

export interface DaySummary {
  day: string;
  updates: number;
  blocked: number;
}

export interface DayPage {
  days: DaySummary[];
  next_cursor: string | null;
}

export interface MemberView {
  account: string;
  name: string;
  last_day: string;
}

export interface PersonView {
  account: string;
  name: string;
}

export interface DecisionView {
  id: string;
  author: string;
  author_name: string;
  title: string;
  decision: string;
  rationale: string;
  supersedes: string;
  superseded_by: string;
  created_at: number;
  tags: string[];
  with: PersonView[];
  from_day: string;
}

export interface DecisionPage {
  items: DecisionView[];
  next_cursor: string | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

// ── The wire ────────────────────────────────────────────────────────────────

type Wire = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "string" || typeof v === "number" ? Number(v) : 0);
const list = (v: unknown): Wire[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
/** An object answer as a record; anything else (a malformed answer) as `{}`. */
const obj = (v: unknown): Wire => (v && typeof v === "object" && !Array.isArray(v) ? (v as Wire) : {});

export function decodeUpdate(w: Wire): UpdateView {
  return {
    day: str(w.day),
    author: str(w.author),
    author_name: str(w.authorName),
    done: str(w.done),
    next: str(w.next),
    blockers: str(w.blockers),
    created_at: num(w.createdAt),
    edited_at: num(w.editedAt),
    helpers: list(w.helpers).map((h) => ({
      account: str(h.account),
      name: str(h.name),
      note: str(h.note),
      at: num(h.at),
    })),
  };
}

export function decodeDay(w: Wire): DayView {
  return { day: str(w.day), updates: list(w.updates).map(decodeUpdate) };
}

export function decodeDecision(w: Wire): DecisionView {
  return {
    id: str(w.id),
    author: str(w.author),
    author_name: str(w.authorName),
    title: str(w.title),
    decision: str(w.decision),
    rationale: str(w.rationale),
    supersedes: str(w.supersedes),
    superseded_by: str(w.supersededBy),
    created_at: num(w.createdAt),
    tags: Array.isArray(w.tags) ? (w.tags as string[]) : [],
    with: list(w.with).map((p) => ({ account: str(p.account), name: str(p.name) })),
    from_day: str(w.fromDay),
  };
}

/** The team, typed from the contract (no client is generated from a component ABI yet). */
export interface StandupClient {
  whoami(): Promise<string>;
  postUpdate(p: { day: string; done: string; next: string; blockers: string }): Promise<void>;
  clearUpdate(p: { day: string }): Promise<void>;
  getDay(p: { day: string }): Promise<DayView>;
  listDays(p: { before: string | null; limit: number }): Promise<DayPage>;
  currentBlockers(): Promise<UpdateView[]>;
  members(): Promise<MemberView[]>;
  logDecision(p: {
    title: string;
    decision: string;
    rationale: string;
    supersedes: string | null;
    tags: string[];
    with: string[];
    from_day: string | null;
  }): Promise<string>;
  getDecision(p: { id: string }): Promise<DecisionView>;
  listDecisions(p: {
    search: string | null;
    tag: string | null;
    from_day: string | null;
    standing_only: boolean;
    cursor: string | null;
    limit: number;
  }): Promise<DecisionPage>;
  tags(): Promise<TagCount[]>;
  offerHelp(p: { day: string; author: string; note: string }): Promise<void>;
  withdrawHelp(p: { day: string; author: string }): Promise<void>;
  getWeek(p: { start: string }): Promise<DayView[]>;
  setTeamName(p: { name: string }): Promise<void>;
  teamName(): Promise<string>;
  setName(p: { name: string }): Promise<void>;
  getName(p: { account: string }): Promise<string>;
}

type Transport = ClientRoutes<{ apps: "call" | "view" }>;

/**
 * The team at app instance `app` through `client`. `after` runs after every
 * request (the session store syncs a refreshed session there).
 */
export function standup(client: Transport, app: string, after: () => void = () => {}): StandupClient {
  const call = async (method: (typeof CALLS)[number], args: Wire = {}): Promise<unknown> => {
    try {
      return (await client.apps.call({ app, method, args })).result;
    } finally {
      after();
    }
  };
  const view = async (method: (typeof VIEWS)[number], args: Wire = {}): Promise<unknown> => {
    try {
      return (await client.apps.view({ app, method, args })).result;
    } finally {
      after();
    }
  };
  const done = async (p: Promise<unknown>) => {
    await p;
  };
  return {
    whoami: async () => str(await view("whoami")),
    postUpdate: (p) => done(call("postUpdate", { ...p })),
    clearUpdate: (p) => done(call("clearUpdate", { ...p })),
    getDay: async (p) => decodeDay(obj(await view("getDay", { ...p }))),
    listDays: async (p) => {
      const w = obj(await view("listDays", { ...p }));
      return {
        days: list(w.days).map((d) => ({ day: str(d.day), updates: num(d.updates), blocked: num(d.blocked) })),
        next_cursor: typeof w.nextCursor === "string" ? w.nextCursor : null,
      };
    },
    currentBlockers: async () => list(await view("currentBlockers")).map(decodeUpdate),
    members: async () =>
      list(await view("members")).map((m) => ({
        account: str(m.account),
        name: str(m.name),
        last_day: str(m.lastDay),
      })),
    logDecision: async ({ from_day, ...p }) => str(await call("logDecision", { ...p, fromDay: from_day })),
    getDecision: async (p) => decodeDecision(obj(await view("getDecision", { ...p }))),
    listDecisions: async ({ from_day, standing_only, ...p }) => {
      const w = obj(await view("listDecisions", { ...p, fromDay: from_day, standingOnly: standing_only }));
      return {
        items: list(w.items).map(decodeDecision),
        next_cursor: typeof w.nextCursor === "string" ? w.nextCursor : null,
      };
    },
    tags: async () => list(await view("tags")).map((t) => ({ tag: str(t.tag), count: num(t.count) })),
    offerHelp: (p) => done(call("offerHelp", { ...p })),
    withdrawHelp: (p) => done(call("withdrawHelp", { ...p })),
    getWeek: async (p) => list(await view("getWeek", { ...p })).map(decodeDay),
    setTeamName: (p) => done(call("setTeamName", { ...p })),
    teamName: async () => str(await view("teamName")),
    setName: (p) => done(call("setName", { ...p })),
    getName: async (p) => str(await view("getName", { ...p })),
  };
}
