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

/** Which buttons a row offers, straight from the contract's transitions. */
export function choicesFor(item: FeedItem): { approve?: string; decline: boolean; undo: boolean; keep: boolean } {
  if (item.kind !== "action") return { decline: false, undo: false, keep: false };
  return {
    approve: item.status === "pending" ? "Approve" : item.status === "failed" ? "Retry" : undefined,
    decline: item.status === "pending" || item.status === "failed",
    undo: item.status === "done" && item.undoable,
    keep: item.breach !== "",
  };
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
