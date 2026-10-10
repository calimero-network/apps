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
  if (item.kind === "message") {
    if (item.from === "agent" && item.status === "asked") return { label: "Asks you", tone: "wait" };
    if (item.from === "agent" && item.status === "answered") return { label: "You answered", tone: "good" };
    if (item.from === "agent") return { label: item.reply_to ? "Answer" : "Note", tone: "plain" };
    if (item.status === "thinking") return { label: "Your agent is on it", tone: "busy" };
    if (item.status === "answered") return { label: "Answered", tone: "good" };
    if (item.status === "failed") return { label: "Your agent couldn't answer", tone: "bad" };
    return { label: "Sent · waiting for your agent", tone: "busy" };
  }
  if (item.kind === "notification" && item.reply_call) {
    // The feed carries a typed row's answer itself: no agent in between.
    if (item.status === "answered") return { label: "Sending…", tone: "busy" };
    if (item.status === "delivered") return { label: "Sent", tone: "good" };
    if (item.status === "failed") return { label: "Not sent · needs you", tone: "bad" };
  }
  if (item.kind === "notification") {
    if (item.status === "answered") return { label: "Answered · agent sending", tone: "busy" };
    if (item.status === "delivered") return { label: "Answered", tone: "good" };
    if (item.status === "failed") return { label: "Not delivered · needs you", tone: "bad" };
    return item.needs_you ? { label: "Needs you", tone: "wait" } : { label: item.seen ? "Seen" : "New", tone: "plain" };
  }
  // It acted where your rules said to ask: yours to keep or undo, whatever its status.
  if (item.breach && !item.reviewed_at && item.status === "done") return { label: "Acted without asking", tone: "wait" };
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

/** Your decisions in Hyperfeed: the contract takes them from you only, never from your agent. */
const OWNER_METHODS = new Set([
  "resolve_action",
  "answer_notification",
  "say",
  "decide_lens",
  "set_policy",
  "set_guard",
  "set_paused",
  "mark_seen",
  "mark_all_seen",
]);

/** The ones that change your rules: no other app has methods by these names. */
const RULE_METHODS = new Set(["set_policy", "set_guard", "set_paused"]);

/**
 * An action your agent can never carry out, approved or not: one of your own
 * decisions in Hyperfeed (a change to your rules, above all). Retrying it can
 * only fail again; you make it yourself, in Controls.
 */
export function onlyYouCan(item: FeedItem): boolean {
  const method = item.method.trim().toLowerCase().replace(/^hyperfeed_/, "");
  return RULE_METHODS.has(method) || (item.app === "hyperfeed" && OWNER_METHODS.has(method));
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
    // No Retry where a retry can only fail the same way.
    approve: pending && !item.ask.kind ? "Approve" : item.status === "failed" && !onlyYouCan(item) ? "Retry" : undefined,
    decline: pending || item.status === "failed",
    undo: item.status === "done" && item.undoable,
    keep: item.breach !== "",
  };
}

/** Whether the row should show its in-place resolver right now. */
export function resolvable(item: FeedItem): boolean {
  if (!item.ask.kind) return false;
  if (item.kind === "action") return item.status === "pending";
  // Your agent's question: open until you say something in its chain.
  if (item.kind === "message") return item.status === "asked";
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
    if (item.kind === "message") {
      const mine = item.from === "you";
      if (i === 0) add(i, mine ? "you" : "agent", mine ? "You" : "Your agent", item.body, "", step.at, mine ? "plain" : "good");
      // Picking it up only matters while nothing else has happened; the
      // answer is a message of its own.
      else if (step.status === "thinking" && i === item.history.length - 1)
        add(i, "agent", "Your agent", "Is on it…", "", step.at, "busy");
      else if (step.status === "failed") add(i, "agent", "Your agent", "Couldn't answer", note, step.at, "bad");
      return;
    }
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

/**
 * Your agent's latest step on a message it is working on, with how long ago
 * it started: "Running the tests · 12 s ago". Empty when there is none.
 */
export function progressLine(item: FeedItem, now = Date.now()): string {
  if (item.kind !== "message" || item.status !== "thinking" || !item.doing) return "";
  const secs = Math.max(0, Math.round((now - item.doing_at) / 1000));
  const ago = secs < 5 ? "just now" : secs < 60 ? `${secs} s ago` : `${Math.floor(secs / 60)} min ago`;
  return `${item.doing} · ${ago}`;
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

/** What a typed row is, as a word on its card. */
export const TYPE_LABELS: Record<string, string> = {
  message: "Message",
  assignment: "Assignment",
  poll: "Poll",
  invite: "Invite",
  turn: "Your turn",
  request: "Request",
  change: "Change",
  status: "Status",
  other: "Update",
};

/** A typed row's fields, or {} when it has none or they do not parse. */
export function fieldsOf(item: FeedItem): Record<string, unknown> {
  if (!item.fields) return {};
  try {
    const f = JSON.parse(item.fields) as unknown;
    return f && typeof f === "object" && !Array.isArray(f) ? (f as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The facts a typed card shows under its title, by type: label and value. */
export function typedFacts(item: FeedItem): [string, string][] {
  const f = fieldsOf(item);
  const text = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : typeof f[k] === "number" ? String(f[k]) : "");
  const pick = (...pairs: [string, string][]) => pairs.filter(([, v]) => v);
  switch (item.item_type) {
    case "assignment":
      return pick(["What", text("what")], ["Due", text("due")]);
    case "poll":
      return pick(["Closes", text("closes_at")]);
    case "invite":
      return pick(["What", text("what")], ["When", text("when")], ["Where", text("where")]);
    case "turn":
      return pick(["Game", text("game")], ["Last move", text("last_move")]);
    case "request":
      return pick(["Asks for", text("asks_for")]);
    case "change":
      return pick(["What", text("what")]);
    default:
      return [];
  }
}

/** Where a row stands for you: something to do, something underway, or done. */
export type Lane = "todo" | "progress" | "done";

/**
 * A chain's lane, from its lead row: it needs you (to do); your agent or the
 * feed is still carrying it (in progress: a message being answered, an
 * approved action being done, your answer being sent); or it is settled.
 */
export function laneOf(item: FeedItem): Lane {
  if (item.needs_you) return "todo";
  if (item.kind === "message") {
    return item.from === "you" && (item.status === "waiting" || item.status === "thinking") ? "progress" : "done";
  }
  if (item.kind === "action") return ["approved", "retrying", "undo_requested"].includes(item.status) ? "progress" : "done";
  if (item.kind === "notification") return item.status === "answered" ? "progress" : "done";
  return "done";
}
