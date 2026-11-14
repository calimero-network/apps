/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-standup";

// ── What the screens use ────────────────────────────────────────────────────
//
// The shapes the screens were written against (v1's generated client):
// snake_case fields and timestamps as numbers (ms). The contract answers
// camelCase with 64-bit integers as decimal strings; `decode*` below is the one
// place that converts.
//
// The contract is called through `MeroStandupClient`, which `meroctl app
// codegen` writes from logic/res/abi.json (`src/generated/client.ts`) and
// types its records from the ABI; each read passes its answer through the
// `decode*` for its shape, which also fills in a field an older contract left out.

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

/** `getDay`'s answer. */
export const decodeDayAnswer = (v: unknown): DayView => decodeDay(obj(v));

/** `getWeek`'s answer. */
export const decodeDays = (v: unknown): DayView[] => list(v).map(decodeDay);

/** `currentBlockers`'s answer. */
export const decodeUpdates = (v: unknown): UpdateView[] => list(v).map(decodeUpdate);

/** `listDays`'s answer. */
export function decodeDayPage(v: unknown): DayPage {
  const w = obj(v);
  return {
    days: list(w.days).map((d) => ({ day: str(d.day), updates: num(d.updates), blocked: num(d.blocked) })),
    next_cursor: typeof w.nextCursor === "string" ? w.nextCursor : null,
  };
}

/** `members`'s answer. */
export const decodeMembers = (v: unknown): MemberView[] =>
  list(v).map((m) => ({ account: str(m.account), name: str(m.name), last_day: str(m.lastDay) }));

/** `getDecision`'s answer. */
export const decodeDecisionAnswer = (v: unknown): DecisionView => decodeDecision(obj(v));

/** `listDecisions`'s answer. */
export function decodeDecisionPage(v: unknown): DecisionPage {
  const w = obj(v);
  return {
    items: list(w.items).map(decodeDecision),
    next_cursor: typeof w.nextCursor === "string" ? w.nextCursor : null,
  };
}

/** `tags`'s answer. */
export const decodeTags = (v: unknown): TagCount[] => list(v).map((t) => ({ tag: str(t.tag), count: num(t.count) }));

/** A string answer (`whoami`, `teamName`, `getName`, `logDecision`): anything else as `""`. */
export const decodeText = (v: unknown): string => str(v);
