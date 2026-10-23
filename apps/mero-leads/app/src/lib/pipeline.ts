import type { LeadView } from "../generated/LeadsClient";

/** The pipeline, in order, as the contract defines it (`STATUSES`). */
export const STATUSES = ["new", "contacted", "qualified", "won", "lost", "spam"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
  spam: "Spam",
};

/** The columns the board shows by default: everything but spam. */
export const BOARD_STATUSES: Status[] = ["new", "contacted", "qualified", "won", "lost"];

export function isStatus(s: string): s is Status {
  return (STATUSES as readonly string[]).includes(s);
}

/** The status after `s` in the pipeline, for the "move on" button; none past won. */
export function nextStatus(s: string): Status | null {
  const order: Status[] = ["new", "contacted", "qualified", "won"];
  const i = order.indexOf(s as Status);
  return i >= 0 && i < order.length - 1 ? order[i + 1]! : null;
}

/** Leads grouped by status, each group newest first (the contract's order). */
export function byStatus(leads: LeadView[]): Record<Status, LeadView[]> {
  const groups = Object.fromEntries(STATUSES.map((s) => [s, [] as LeadView[]])) as Record<
    Status,
    LeadView[]
  >;
  for (const lead of leads) groups[isStatus(lead.status) ? lead.status : "new"].push(lead);
  return groups;
}

/** Whether `lead` matches a free-text search over its contact details and notes. */
export function matches(lead: LeadView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [lead.name, lead.email, lead.company, lead.message, lead.notes, lead.source].some((f) =>
    f.toLowerCase().includes(q),
  );
}

/** A node timestamp (nanoseconds) as a Date. */
export function fromNanos(ns: number): Date {
  return new Date(Math.floor(ns / 1_000_000));
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else a date. */
export function ago(ns: number, now = Date.now()): string {
  const ms = now - fromNanos(ns).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} d ago`;
  return fromNanos(ns).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The leads as CSV, the columns a spreadsheet or CRM import expects. */
export function toCsv(leads: LeadView[]): string {
  const cols = ["created", "status", "name", "email", "company", "source", "message", "notes"];
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = leads.map((l) =>
    [fromNanos(l.created_at).toISOString(), l.status, l.name, l.email, l.company, l.source, l.message, l.notes]
      .map(cell)
      .join(","),
  );
  return [cols.join(","), ...rows].join("\n") + "\n";
}
