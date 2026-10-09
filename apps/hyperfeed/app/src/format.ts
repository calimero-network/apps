import type { FeedItem } from "./generated/HyperfeedClient";

const STATUS_LABELS: Record<string, string> = {
  pending: "Waiting for you",
  approved: "Approved · agent working",
  declined: "Declined",
  done: "Done",
  failed: "Failed · needs you",
  retrying: "Retrying",
  undo_requested: "Undo requested",
  undone: "Undone",
};

export type Tone = "wait" | "bad" | "good" | "busy" | "plain";

export function statusOf(item: FeedItem): { label: string; tone: Tone } {
  if (item.kind === "notification") {
    if (item.status === "answered") return { label: "Answered · agent sending", tone: "busy" };
    if (item.status === "delivered") return { label: "Answered", tone: "good" };
    if (item.status === "failed") return { label: "Not delivered · needs you", tone: "bad" };
    return item.needs_you ? { label: "Needs you", tone: "wait" } : { label: item.seen ? "Seen" : "New", tone: "plain" };
  }
  const label = STATUS_LABELS[item.status] ?? item.status;
  const tone: Tone =
    item.status === "pending"
      ? "wait"
      : item.status === "failed"
        ? "bad"
        : item.status === "done"
          ? "good"
          : item.status === "approved" || item.status === "retrying" || item.status === "undo_requested"
            ? "busy"
            : "plain";
  return { label, tone };
}

/**
 * Which plain buttons a row offers, straight from the contract's transitions.
 * A proposal with an ask is approved through its resolver instead (pick an
 * option, edit and send), so it offers no bare Approve.
 */
export function choicesFor(item: FeedItem): { approve?: string; decline: boolean; undo: boolean; keep: boolean } {
  if (item.kind !== "action") return { decline: false, undo: false, keep: false };
  const pending = item.status === "pending";
  return {
    approve: pending && !item.ask.kind ? "Approve" : item.status === "failed" ? "Retry" : undefined,
    decline: pending || item.status === "failed",
    undo: item.status === "done" && item.undoable,
    keep: item.breach !== "",
  };
}

/** Whether the row should show its in-place resolver right now. */
export function resolvable(item: FeedItem): boolean {
  if (!item.ask.kind) return false;
  if (item.kind === "action") return item.status === "pending";
  return item.status === "received" || item.status === "failed";
}

export type Actor = "agent" | "you" | "app";

/** One line of a chain's flow. */
export interface FlowStep {
  key: string;
  item: FeedItem;
  actor: Actor;
  /** Who, as a person reads it: "Your agent", "You", "Maya Ortiz". */
  who: string;
  text: string;
  detail: string;
  at: number;
  tone: Tone;
  /** The row's first step: the one that names what it is about. */
  first: boolean;
}

function quoteOf(text: string): string {
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

/** Every step of one row, as the flow tells it. */
export function stepsOf(item: FeedItem, appName: string): FlowStep[] {
  const out: FlowStep[] = [];
  const add = (i: number, actor: Actor, who: string, text: string, detail: string, at: number, tone: Tone) =>
    out.push({ key: `${item.id}:${i}`, item, actor, who, text, detail, at, tone, first: i === 0 });
  item.history.forEach((step, i) => {
    const note = step.note;
    if (item.kind === "notification") {
      switch (step.status) {
        case "received":
          add(i, "app", item.from || appName, item.title, item.body, step.at, "plain");
          break;
        case "answered": {
          const text =
            item.ask.kind === "reply"
              ? `Replied${item.from ? ` to ${item.from}` : ""}`
              : item.ask.kind === "choose"
                ? `Chose "${note}"`
                : item.ask.prompt || "Confirmed";
          add(i, "you", "You", text, item.ask.kind === "reply" ? quoteOf(note) : "", step.at, "busy");
          break;
        }
        case "delivered":
          add(i, "agent", "Your agent", note || "Delivered it", "", step.at, "good");
          break;
        case "failed":
          add(i, "agent", "Your agent", "Couldn't deliver it", note, step.at, "bad");
          break;
      }
      return;
    }
    if (i === 0) {
      const text = step.status === "pending" ? `Proposed: ${item.title}` : step.status === "failed" ? `Tried: ${item.title}` : item.title;
      add(i, "agent", "Your agent", text, step.status === "failed" ? note : item.body, step.at, step.status === "failed" ? "bad" : step.status === "pending" ? "wait" : "good");
      return;
    }
    switch (step.status) {
      case "approved":
        add(i, "you", "You", note ? (item.ask.kind === "choose" ? `Picked "${note}"` : "Approved, edited") : "Approved", item.ask.kind === "reply" ? quoteOf(note) : "", step.at, "busy");
        break;
      case "declined":
        add(i, "you", "You", "Declined", "", step.at, "plain");
        break;
      case "retrying":
        add(i, "you", "You", "Asked to retry", "", step.at, "busy");
        break;
      case "undo_requested":
        add(i, "you", "You", "Asked to undo it", "", step.at, "busy");
        break;
      case "done":
        add(i, "agent", "Your agent", note || "Done", "", step.at, "good");
        break;
      case "failed":
        add(i, "agent", "Your agent", "Failed", note, step.at, "bad");
        break;
      case "undone":
        add(i, "agent", "Your agent", note || "Undid it", "", step.at, "plain");
        break;
    }
  });
  if (item.reviewed_at > 0) {
    out.push({ key: `${item.id}:kept`, item, actor: "you", who: "You", text: "Kept it", detail: "", at: item.reviewed_at, tone: "plain", first: false });
  }
  return out;
}

/** A whole chain's flow, oldest first. */
export function flowOf(items: FeedItem[], appName: (key: string) => string): FlowStep[] {
  return items
    .flatMap((i) => stepsOf(i, appName(i.app)))
    .sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", or the date. */
export function dayLabel(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

/** "just now", "4 min", "14:02". */
export function timeLabel(at: number, now = Date.now()): string {
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function groupByDay(items: FeedItem[], now = Date.now()): { label: string; items: FeedItem[] }[] {
  const groups: { label: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function short(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export const GUARD_LABELS: Record<string, string> = {
  sign: "Signing anything",
  money: "Spending or moving money",
  new_contact: "Messaging someone new",
  delete: "Deleting anything",
  invite: "Inviting people or changing roles",
  secret: "Reading a secret",
};
