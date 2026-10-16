import type { ActionSetView, AutorunView, FeedItem, SettingsView, SituationView } from "./generated/HyperfeedClient";
import { fieldsOf, GUARD_LABELS, laneOf, previewOf } from "./format";
import { groupSets, modeOf } from "./actions/actions";
import { digestSince, isNoise } from "./team";

/**
 * The brief: the feed as an agent that manages it for you would hand it over.
 * A line saying how things stand since you were last here, the few decisions
 * only you can make (ranked, most pressing first, each saying why it reached
 * you), what is moving, what your agent did for you (with its undo), and what
 * was filtered out because it did not need you, which you can look into and
 * tune.
 *
 * Everything here is a reading of the rows the feed already returns.
 */

/** How many decisions the brief puts in front of you before it holds the rest back. */
export const BRIEF_BUDGET = 3;

/** One source of notifications that did not need you: "18 updates in #general". */
export interface FilteredGroup {
  key: string;
  app: string;
  /** Where they came from, as a person reads it: "#general", "Pricing v4". */
  where: string;
  /** Newest first. */
  items: FeedItem[];
}

export interface Brief {
  /** Where "since" starts: your last visit, or the start of today. */
  since: number;
  /** Everything that needs you, most pressing first. */
  decisions: FeedItem[];
  /** The first `BRIEF_BUDGET` of them: what the brief shows. */
  shown: FeedItem[];
  /** The rest, behind "N more". */
  held: FeedItem[];
  /** Being carried right now: your agent answering, an approved action running, your answer being sent. */
  moving: FeedItem[];
  /** What your agent did or answered since `since`, newest first. Reads it made are not counted. */
  done: FeedItem[];
  /** Of `done`, the ones you could still undo. */
  undoable: number;
  /** Notifications since `since` that did not need you, by where they came from, the biggest first. */
  filtered: FilteredGroup[];
  /** How many notifications `filtered` holds. */
  filteredCount: number;
}

const HOUR = 60 * 60 * 1000;

/**
 * When something is due, in ms, or 0 when it says no time a clock can read:
 * a typed row's `due`, `closes_at` or `when`, given as a number (seconds or
 * milliseconds). "This sprint" is shown as it is, but cannot rank.
 */
export function dueAt(item: FeedItem, sit?: SituationView): number {
  if (sit?.due_at) return sit.due_at;
  const f = fieldsOf(item);
  for (const k of ["due", "closes_at", "when"]) {
    const v = f[k];
    if (typeof v === "number" && v > 0) return v < 1e12 ? v * 1000 : v;
  }
  return 0;
}

/** A due time as a typed row wrote it, when it is words ("This sprint", "Tomorrow 18:00"); "" otherwise. */
export function dueText(item: FeedItem): string {
  const f = fieldsOf(item);
  for (const k of ["due", "closes_at", "when"]) {
    const v = f[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** How pressing a decision is by its kind alone, or as your agent scored it when it wrote a situation: higher first. */
function tier(item: FeedItem, sit?: SituationView): number {
  return Math.max(kindTier(item), sit?.score ?? 0);
}

function kindTier(item: FeedItem): number {
  // It acted where your rules say it should have asked: the one row you most need to see.
  if (item.breach && !item.reviewed_at) return 100;
  if (item.category && GUARD_LABELS[item.category]) return 80;
  if (item.status === "failed") return 70;
  if (item.kind === "action") return 60;
  if (item.kind === "message") return 50;
  if (item.item_type === "assignment" || item.item_type === "request") return 45;
  return 40;
}

/** When it started waiting on you. */
function waitingSince(item: FeedItem): number {
  return item.status_at || item.chain_at || item.at;
}

/**
 * How pressing a decision is: its kind, then how soon it is due (within the
 * hour beats anything but an action taken without asking; within the day
 * moves it up), then how long it has waited (up to 10 points, one an hour).
 */
export function urgency(item: FeedItem, now = Date.now(), sit?: SituationView): number {
  let score = tier(item, sit);
  const due = dueAt(item, sit);
  if (due) {
    const left = due - now;
    if (left < HOUR) score += 45;
    else if (left < 24 * HOUR) score += 15;
  }
  score += Math.min(10, Math.max(0, Math.floor((now - waitingSince(item)) / HOUR)));
  return score;
}

/** "18:00" today, "Fri 18:00" this week, else the date. */
function clock(at: number, now: number): string {
  const d = new Date(at);
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = (new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / (24 * HOUR);
  if (days === 0) return hm;
  if (days > 0 && days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${hm}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** "in 20 min", "in 3 h", "2 h ago". */
function relative(ms: number): string {
  const mins = Math.round(Math.abs(ms) / 60_000);
  const span = mins < 60 ? `${Math.max(1, mins)} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
  return ms >= 0 ? `in ${span}` : `${span} ago`;
}

/**
 * The pill that says why it is pressing now: "Due 16:00 · in 20 min",
 * "Overdue · 2 h ago", "Due: This sprint", or "Waiting 2 h" once it has
 * waited half an hour. "" when none of it applies.
 */
export function pressLine(item: FeedItem, now = Date.now(), sit?: SituationView): { text: string; hot: boolean } | null {
  const due = dueAt(item, sit);
  if (due) {
    const left = due - now;
    if (left < 0) return { text: `Overdue · ${relative(left)}`, hot: true };
    return { text: `Due ${clock(due, now)} · ${relative(left)}`, hot: left < HOUR };
  }
  const words = dueText(item);
  if (words) return { text: `Due: ${words}`, hot: false };
  const waited = now - waitingSince(item);
  if (waited >= HOUR / 2) {
    const mins = Math.round(waited / 60_000);
    return { text: `Waiting ${mins < 60 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`}`, hot: false };
  }
  return null;
}

/** Your agent led it: something it did, or a conversation with it. */
function agentLed(item: FeedItem): boolean {
  return item.kind === "action" || item.kind === "message";
}

/** Where a notification came from, as one source. */
function sourceOf(item: FeedItem, appName: (key: string) => string): { key: string; where: string } {
  const where = item.source_label || appName(item.app || "hyperfeed");
  return { key: `${item.app}\u0000${item.source_context}`, where };
}

export function briefOf(
  items: FeedItem[],
  now = Date.now(),
  since = digestSince(now),
  appName: (key: string) => string = (k) => k,
  situations: Map<string, SituationView> = new Map(),
): Brief {
  const at = (i: FeedItem) => i.chain_at || i.at;
  const rank = (i: FeedItem) => urgency(i, now, situations.get(i.chain));
  const decisions = items.filter((i) => i.needs_you).sort((a, b) => rank(b) - rank(a) || at(b) - at(a));
  const moving = items.filter((i) => !i.needs_you && laneOf(i) === "progress").sort((a, b) => at(b) - at(a));
  const settled = items.filter((i) => !i.needs_you && laneOf(i) === "done" && !isNoise(i) && at(i) >= since);
  const done = settled.filter(agentLed).sort((a, b) => at(b) - at(a));
  const groups = new Map<string, FilteredGroup>();
  for (const item of settled) {
    if (item.kind !== "notification") continue;
    const s = sourceOf(item, appName);
    const g = groups.get(s.key) ?? { key: s.key, app: item.app, where: s.where, items: [] };
    g.items.push(item);
    groups.set(s.key, g);
  }
  const filtered = [...groups.values()];
  for (const g of filtered) g.items.sort((a, b) => at(b) - at(a));
  filtered.sort((a, b) => b.items.length - a.items.length || at(b.items[0]!) - at(a.items[0]!));
  return {
    since,
    decisions,
    shown: decisions.slice(0, BRIEF_BUDGET),
    held: decisions.slice(BRIEF_BUDGET),
    moving,
    done,
    undoable: done.filter((i) => i.kind === "action" && i.status === "done" && i.undoable).length,
    filtered,
    filteredCount: filtered.reduce((n, g) => n + g.items.length, 0),
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How many rows "handled" covers: what your agent did, and what was filtered out. */
export function handledCount(b: Brief): number {
  return b.done.length + b.filteredCount;
}

/** The one line on top: "2 decisions for you · 1 moving · 14 handled". "All quiet" when nothing waits or moves. */
export function statusLine(b: Brief): string {
  const handled = handledCount(b);
  if (b.decisions.length === 0 && b.moving.length === 0) return handled ? `All quiet · ${handled} handled` : "All quiet";
  const parts: string[] = [];
  if (b.decisions.length) parts.push(`${count(b.decisions.length, "decision")} for you`);
  if (b.moving.length) parts.push(`${b.moving.length} moving`);
  if (handled) parts.push(`${handled} handled`);
  return parts.join(" · ");
}

/** Where "since" starts, as the line beside the status says it: "since you were here at 09:12". */
export function sinceLine(since: number, visited: boolean, now = Date.now()): string {
  return visited ? `since you were here at ${clock(since, now)}` : "since the start of today";
}

/** "Good morning", by the hour where you are. */
export function greeting(now = Date.now()): string {
  const h = new Date(now).getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * The paragraph under the greeting: what was taken care of, what was
 * filtered out, what needs you (and how many of those are due within the
 * hour), and what will go ahead on its own.
 */
export function summaryLine(
  b: Brief,
  visited: boolean,
  now = Date.now(),
  autoruns = 0,
  situations: Map<string, SituationView> = new Map(),
): string {
  const lead = visited ? "While you were away" : "Today";
  const parts: string[] = [];
  if (b.done.length) parts.push(`your agent took care of ${count(b.done.length, "thing")}`);
  if (b.filteredCount) parts.push(`filtered out ${count(b.filteredCount, "notification")}`);
  const head = parts.length ? `${lead} ${parts.join(" and ")}.` : visited ? "Nothing happened while you were away." : "Nothing has happened yet today.";
  const soon = b.decisions.filter((i) => {
    const due = dueAt(i, situations.get(i.chain));
    return due && due - now < HOUR;
  }).length;
  const yours =
    b.decisions.length === 0
      ? " Nothing needs you."
      : ` ${b.decisions.length === 1 ? "One thing needs you" : `${count(b.decisions.length, "thing")} need you`}${soon ? `, ${soon === b.decisions.length && soon === 1 ? "by the hour" : `${soon} within the hour`}` : ""}.`;
  const auto = autoruns ? ` ${autoruns === 1 ? "One thing goes ahead" : `${autoruns} things go ahead`} on its own unless you stop it.` : "";
  return head + yours + auto;
}

/** Why this reached you rather than being handled: the rule or the fact that put it here, and why it ranks where it does. */
export function whyShown(item: FeedItem, appName: (key: string) => string, now = Date.now(), sit?: SituationView): string {
  const reason = sit?.reason ? `${sit.reason.replace(/\.?$/, ".")} ` : "";
  return reason + whyRule(item, appName, now, sit);
}

function whyRule(item: FeedItem, appName: (key: string) => string, now: number, sit?: SituationView): string {
  const app = appName(item.app || "hyperfeed");
  const press = pressLine(item, now, sit);
  const rank = press ? ` ${press.text.startsWith("Waiting") ? `It has been ${press.text.toLowerCase()}.` : `${press.text.split(" · ")[0]}.`}` : "";
  if (item.breach && !item.reviewed_at) return `Your agent did this without asking, where your rules say it should have. Keep it or undo it.${rank}`;
  if (item.category && GUARD_LABELS[item.category]) return `${GUARD_LABELS[item.category]} always needs you: your agent can't do it for you, whatever its rules.${rank}`;
  if (item.status === "failed") return `${item.kind === "notification" ? "Your answer didn't reach the app." : "It failed. Only you can retry it or drop it."}${rank}`;
  if (item.kind === "action") return `Your rules for ${app} say ask first.${rank}`;
  if (item.kind === "message") return `Your agent can't go on without your answer.${rank}`;
  const who = item.from && !/^[0-9a-zA-Z]{32,}$/.test(item.from) ? item.from : "Someone";
  if (item.item_type === "assignment") return `${who} assigned it to you.${rank}`;
  if (item.item_type === "request" || item.item_type === "poll") return `${who} is waiting on your answer.${rank}`;
  if (item.item_type === "invite") return `${who} invited you.${rank}`;
  return `${app} marks it as needing you.${rank}`;
}

/**
 * Your agent's case for the card, labelled by what it is: why it proposes a
 * call, why it already made one, or what it prepared for you. null when it
 * said nothing.
 */
export function recommendationOf(item: FeedItem): { label: string; text: string } | null {
  if (item.kind === "action" && item.why) {
    const label = item.status === "pending" ? "Why your agent proposes it" : "Why your agent did it";
    return { label, text: previewOf(item.why, 2, 240) };
  }
  if (item.ask.kind === "reply" && item.ask.draft) return { label: "Your agent suggests", text: "A reply is drafted below: send it as it is or edit it." };
  if (item.ask.kind === "choose" && item.ask.options.length) return { label: "Your agent asks", text: `Pick one of ${item.ask.options.length} options.` };
  return null;
}

/** For a proposal: whether saying yes can be taken back. "" for anything else. */
export function reversibility(item: FeedItem): "" | "undoable" | "final" {
  if (item.kind !== "action" || item.status !== "pending") return "";
  return item.undoable ? "undoable" : "final";
}

/** How far back "Always allow" counts your decisions. */
export const ALLOW_WINDOW_MS = 7 * 24 * HOUR;
/** How many approvals in a row, and no decline, before the brief offers it. */
export const ALLOW_AFTER = 3;

/** "Let your agent do this without asking": the action it would set to act, and the record behind the offer. */
export interface AllowOffer {
  app: string;
  action: string;
  /** The action as you named it: "Send messages". */
  label: string;
  approved: number;
}

/** You approved it: the row's history has an `approved` step. */
function approvedByYou(item: FeedItem): boolean {
  return item.history.some((s) => s.status === "approved");
}

/**
 * Offer to stop asking for a pending proposal once you approved the same
 * action (an approved action of its app that names its method) at least
 * `ALLOW_AFTER` times in the last week and declined it never. Never for a
 * guard (signing, money, …): those always ask, and so never for an action
 * that names one; never for an action already set to act; and never for an
 * app your agent may only read.
 */
export function allowOffer(
  item: FeedItem,
  items: FeedItem[],
  sets: ActionSetView[],
  settings: SettingsView | null,
  now = Date.now(),
): AllowOffer | null {
  if (item.kind !== "action" || item.status !== "pending" || item.category || item.breach || !item.method) return null;
  const active = groupSets(sets).get(item.app)?.active;
  const action = active?.actions.find((a) => a.methods.includes(item.method));
  if (!action || action.category || !action.writes) return null;
  const policy = settings?.policies.find((p) => p.app === item.app)?.agent;
  if (policy === "off" || policy === "read") return null;
  if (modeOf(settings?.action_modes, item.app, action.id) === "act") return null;
  let approved = 0;
  for (const other of items) {
    if (other.id === item.id || other.kind !== "action" || other.app !== item.app || !action.methods.includes(other.method)) continue;
    if ((other.status_at || other.at) < now - ALLOW_WINDOW_MS) continue;
    if (other.status === "declined") return null;
    if (approvedByYou(other)) approved++;
  }
  return approved >= ALLOW_AFTER ? { app: item.app, action: action.id, label: action.label, approved } : null;
}

/** The rule "Less like this" or "More like this" asks your agent to keep, for one source of notifications. */
export function tuneRule(g: FilteredGroup, more: boolean, appName: (key: string) => string): string {
  const where = g.where === appName(g.app) ? appName(g.app) : `${g.where} in ${appName(g.app)}`;
  return more
    ? `Bring me updates from ${where}: they matter to me even when they don't mention me.`
    : `Record fewer updates from ${where}: propose a narrower lens so they stop reaching my feed.`;
}

/** The defaults waiting to go ahead, by the proposal's id. */
export function waitingAutoruns(autoruns: AutorunView[]): Map<string, AutorunView> {
  return new Map(autoruns.filter((a) => a.status === "waiting").map((a) => [a.id, a]));
}

/**
 * A default's line on its card: "Goes ahead at 17:00 · in 1 h 20 min unless
 * you stop it", and how far through its wait it is (0 to 1), for the bar.
 */
export function autorunLine(a: AutorunView, now = Date.now()): { pill: string; line: string; progress: number } {
  const left = a.at - now;
  const span = Math.max(1, a.at - a.set_at);
  const progress = Math.min(1, Math.max(0, (now - a.set_at) / span));
  if (left <= 0) return { pill: "Going ahead now", line: "Its time came: your agent is carrying it out", progress: 1 };
  const mins = Math.round(left / 60_000);
  const wait = mins < 60 ? `${Math.max(1, mins)} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
  return { pill: `Goes ahead by itself at ${clock(a.at, now)}`, line: `Goes ahead in ${wait} unless you stop it`, progress };
}
