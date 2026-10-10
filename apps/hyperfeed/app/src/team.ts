import type { FeedItem } from "./generated/HyperfeedClient";
import { fieldsOf, laneOf } from "./format";

/**
 * The team view: the feed told the way a workplace feed tells it. People
 * first, what needs you on top, what your team did around you grouped by what
 * it was about, and your agent's work as one digest instead of a row per step.
 *
 * Everything here is a reading of the rows the feed already returns; nothing
 * new is stored.
 */

/** One row, as a sentence about a person: "Xabi" "assigned you" "Create my feed fails". */
export interface Headline {
  who: string;
  /** Initials for the face beside it. */
  initials: string;
  verb: string;
  /** What it is about; may be empty. */
  object: string;
  /** Who is a teammate (not you, not your agent). */
  person: boolean;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** First line of a text, cut to a card's length. */
export function line(s: string, max = 120): string {
  const first = s.split("\n").find((l) => l.trim()) ?? "";
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first.trim();
}

function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/** A title as the rest of a sentence: "Assigned you an issue" → "assigned you an issue". */
function asVerb(title: string): string {
  return title ? title.charAt(0).toLowerCase() + title.slice(1) : "";
}

export function headlineOf(item: FeedItem, appName: (key: string) => string): Headline {
  if (item.kind === "notification") {
    const f = fieldsOf(item);
    const who = text(f.from) || item.from || appName(item.app);
    const subject = line(text(f.what) || text(f.question) || text(f.text) || text(f.game) || line(item.body));
    // "Assigned HF-31 to you" already says what: no second line repeating it.
    const object = subject && item.title.toLowerCase().includes(subject.toLowerCase()) ? "" : subject;
    return { who, initials: initialsOf(who), verb: asVerb(item.title), object, person: Boolean(text(f.from) || item.from) };
  }
  if (item.kind === "message") {
    if (item.from === "you") return { who: "You", initials: "You", verb: "asked your agent", object: line(item.body || item.title), person: false };
    return { who: "Your agent", initials: "AI", verb: "answered", object: line(item.body), person: false };
  }
  // An action's title is already its sentence ("Prepared the NDA for your
  // signature"); where it stands is the status pill beside it.
  return { who: "Your agent", initials: "AI", verb: "", object: line(item.title), person: false };
}

/**
 * Rows that say nothing to a person: a read your agent made (looking an
 * issue up is not news), once it is settled.
 */
export function isNoise(item: FeedItem): boolean {
  if (item.kind !== "action" || item.needs_you) return false;
  const settled = item.status === "done" || item.status === "declined";
  return settled && /(^|_)(get|list|read|view|search|lookup|describe|count|status|info)(_|$)/.test(item.method);
}

/** What your team did around you on one subject: one card, however many updates. */
export interface TeamGroup {
  key: string;
  subject: string;
  app: string;
  /** Newest first. */
  items: FeedItem[];
  people: { name: string; initials: string }[];
  at: number;
}

/**
 * What a row is about, as lenses record it: a message (a comment, a mention)
 * is about where it was said ("Issue: Create my feed fails", "#launch"), a DM
 * about who sent it; anything else about its own subject (`what`, a poll's
 * `question`, …). Not the message's text: two comments on one issue are about
 * the same issue.
 */
export function subjectOf(item: FeedItem): string {
  const f = fieldsOf(item);
  if (f.is_dm === true) return `DM from ${text(f.from) || item.from}`;
  if (text(f.text)) return text(f.where) || item.title;
  return text(f.what) || text(f.question) || text(f.game) || text(f.asks_for) || text(f.title) || text(f.where) || item.title;
}

/** One subject, however a lens labels it: "Issue: Create my feed fails" is "Create my feed fails". */
function subjectKey(subject: string): string {
  return subject.replace(/^[\p{L} ]{1,20}:\s+/u, "").trim().toLowerCase();
}

/**
 * Your team's activity that does not need you, grouped by what it is about:
 * three comments on one issue are one card with three faces. A row with no
 * subject of its own is a group of one.
 */
export function teamGroups(items: FeedItem[], appName: (key: string) => string): TeamGroup[] {
  const groups = new Map<string, TeamGroup>();
  for (const item of items) {
    if (item.kind !== "notification" || item.needs_you || isNoise(item)) continue;
    const h = headlineOf(item, appName);
    const subject = subjectOf(item);
    const key = `${item.app}\u0000${item.source_context}\u0000${subjectKey(subject)}`;
    const g = groups.get(key) ?? { key, subject, app: item.app, items: [], people: [], at: 0 };
    g.items.push(item);
    g.at = Math.max(g.at, item.chain_at || item.at);
    if (h.person && !g.people.some((p) => p.name === h.who)) g.people.push({ name: h.who, initials: h.initials });
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => (b.chain_at || b.at) - (a.chain_at || a.at));
    // Whoever acted last leads the faces and the sentence.
    const last = headlineOf(g.items[0]!, appName).who;
    g.people.sort((a, b) => Number(b.name === last) - Number(a.name === last));
  }
  return [...groups.values()].sort((a, b) => b.at - a.at);
}

/**
 * A group as one sentence: everyone who acted, and the latest thing done.
 * "Maya and 2 others" "commented on your issue" "Issue: Create my feed fails".
 */
export function groupSentence(g: TeamGroup, appName: (key: string) => string): Headline {
  const lead = headlineOf(g.items[0]!, appName);
  const names = g.people.map((p) => p.name);
  const who =
    names.length === 0 ? lead.who : names.length === 1 ? names[0]! : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} others`;
  const object = g.subject && lead.verb.toLowerCase().includes(g.subject.toLowerCase()) ? "" : g.subject;
  return { who, initials: lead.initials, verb: lead.verb, object, person: names.length > 0 };
}

/** Your agent's work since the start of today, as one card. */
export interface AgentDigest {
  done: number;
  working: number;
  failed: number;
  answered: number;
  /** Newest first: the chains it covers, for the expanded card. */
  items: FeedItem[];
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Everything your agent did or said today that does not need you. What needs
 * you is in the strip on top, not counted twice; reads are not counted at all.
 */
export function agentDigest(items: FeedItem[], now = Date.now()): AgentDigest {
  const since = startOfDay(now);
  const d: AgentDigest = { done: 0, working: 0, failed: 0, answered: 0, items: [] };
  for (const item of items) {
    if (item.kind === "notification" || item.needs_you || isNoise(item)) continue;
    if ((item.chain_at || item.at) < since) continue;
    d.items.push(item);
    if (item.kind === "message") {
      if (item.from === "agent" || item.status === "answered") d.answered++;
      else if (item.status === "waiting" || item.status === "thinking") d.working++;
      else if (item.status === "failed") d.failed++;
      continue;
    }
    if (laneOf(item) === "progress") d.working++;
    else if (item.status === "failed") d.failed++;
    else if (item.status === "done") d.done++;
  }
  d.items.sort((a, b) => (b.chain_at || b.at) - (a.chain_at || a.at));
  return d;
}

/** The digest's one line: "Did 4 things · answered 3 messages · 1 failed". */
export function digestLine(d: AgentDigest): string {
  const parts: string[] = [];
  if (d.done) parts.push(`did ${d.done} thing${d.done === 1 ? "" : "s"}`);
  if (d.answered) parts.push(`answered ${d.answered} message${d.answered === 1 ? "" : "s"}`);
  if (d.working) parts.push(`${d.working} in progress`);
  if (d.failed) parts.push(`${d.failed} failed`);
  if (parts.length === 0) return "Nothing yet today.";
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}
