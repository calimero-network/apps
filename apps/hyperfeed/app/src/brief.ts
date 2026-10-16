import type { FeedItem } from "./generated/HyperfeedClient";
import { GUARD_LABELS, laneOf, previewOf } from "./format";
import { digestSince, isNoise } from "./team";

/**
 * The brief: the feed as an agent that manages it for you would hand it over.
 * A line saying how things stand, the few decisions only you can make
 * (ranked, most pressing first, each saying why it reached you), what is
 * moving, and everything your agent or your apps settled without you, folded
 * away but one tap from its undo.
 *
 * Everything here is a reading of the rows the feed already returns; nothing
 * new is stored.
 */

/** How many decisions the brief puts in front of you before it holds the rest back. */
export const BRIEF_BUDGET = 3;

export interface Brief {
  /** Everything that needs you, most pressing first. */
  decisions: FeedItem[];
  /** The first `BRIEF_BUDGET` of them: what the brief shows. */
  shown: FeedItem[];
  /** The rest, behind "N more". */
  held: FeedItem[];
  /** Being carried right now: your agent answering, an approved action running, your answer being sent. */
  moving: FeedItem[];
  /** Settled today without you, newest first. Reads your agent made are not counted. */
  handled: FeedItem[];
  /** Of `handled`, the ones you could still undo. */
  undoable: number;
}

/** How pressing a decision is: higher first. */
export function urgency(item: FeedItem): number {
  // It acted where your rules say it should have asked: the one row you most need to see.
  if (item.breach && !item.reviewed_at) return 100;
  if (item.category && GUARD_LABELS[item.category]) return 80;
  if (item.status === "failed") return 70;
  if (item.kind === "action") return 60;
  if (item.kind === "message") return 50;
  if (item.item_type === "assignment" || item.item_type === "request") return 45;
  return 40;
}

export function briefOf(items: FeedItem[], now = Date.now()): Brief {
  const since = digestSince(now);
  const at = (i: FeedItem) => i.chain_at || i.at;
  const decisions = items
    .filter((i) => i.needs_you)
    .sort((a, b) => urgency(b) - urgency(a) || at(b) - at(a));
  const moving = items.filter((i) => !i.needs_you && laneOf(i) === "progress").sort((a, b) => at(b) - at(a));
  const handled = items
    .filter((i) => !i.needs_you && laneOf(i) === "done" && !isNoise(i) && at(i) >= since)
    .sort((a, b) => at(b) - at(a));
  return {
    decisions,
    shown: decisions.slice(0, BRIEF_BUDGET),
    held: decisions.slice(BRIEF_BUDGET),
    moving,
    handled,
    undoable: handled.filter((i) => i.kind === "action" && i.status === "done" && i.undoable).length,
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one line on top: "2 decisions for you · 1 moving · 14 handled today". "All quiet" when nothing waits or moves. */
export function statusLine(b: Brief): string {
  if (b.decisions.length === 0 && b.moving.length === 0) {
    return b.handled.length ? `All quiet · ${b.handled.length} handled today` : "All quiet";
  }
  const parts: string[] = [];
  if (b.decisions.length) parts.push(`${count(b.decisions.length, "decision")} for you`);
  if (b.moving.length) parts.push(`${b.moving.length} moving`);
  if (b.handled.length) parts.push(`${b.handled.length} handled today`);
  return parts.join(" · ");
}

/** "Good morning", by the hour where you are. */
export function greeting(now = Date.now()): string {
  const h = new Date(now).getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The sentence under the greeting: how much is yours, and how much was taken care of. */
export function summaryLine(b: Brief): string {
  const handled = b.handled.length ? `Taken care of today: ${count(b.handled.length, "thing")}` : "";
  const undo = b.undoable ? ` (${b.undoable} you can still undo)` : "";
  if (b.decisions.length === 0) {
    return handled ? `Nothing needs you. ${handled}${undo}.` : "Nothing needs you, and nothing has happened yet today.";
  }
  const yours = b.decisions.length === 1 ? "One thing needs you." : `${count(b.decisions.length, "thing")} need you.`;
  return handled ? `${yours} ${handled}${undo}.` : yours;
}

/** Why this reached you rather than being handled: the rule or the fact that put it here. */
export function whyShown(item: FeedItem, appName: (key: string) => string): string {
  const app = appName(item.app || "hyperfeed");
  if (item.breach && !item.reviewed_at) return `Your agent did this without asking, where your rules say it should have. Keep it or undo it.`;
  if (item.category && GUARD_LABELS[item.category]) return `${GUARD_LABELS[item.category]} always needs you.`;
  if (item.status === "failed") return item.kind === "notification" ? "Your answer didn't reach the app." : "It failed. Only you can retry it or drop it.";
  if (item.kind === "action") return `Your rules for ${app} say ask first.`;
  if (item.kind === "message") return "Your agent can't go on without your answer.";
  const who = item.from && !/^[0-9a-zA-Z]{32,}$/.test(item.from) ? item.from : "Someone";
  if (item.item_type === "assignment") return `${who} assigned it to you.`;
  if (item.item_type === "request" || item.item_type === "poll") return `${who} is waiting on your answer.`;
  if (item.item_type === "invite") return `${who} invited you.`;
  return `${app} marks it as needing you.`;
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
