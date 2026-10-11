import type { FeedItem } from "./generated/HyperfeedClient";
import { flowOf, laneOf, progressLine, type Tone } from "./format";
import { headlineOf, isAgent, line } from "./team";

/**
 * A task: something you asked your agent to do, told as one post. The goal
 * is what you said; under it, who is on it, where it stands, and the latest
 * step, live while your agent works.
 *
 * A task is a chain that starts with a message of yours. It is a reading of
 * that chain's rows; nothing new is stored.
 */
export interface TaskPost {
  chain: string;
  /** What you asked for, as one line. */
  goal: string;
  /** Who is on it beside you and your agent: teammates whose updates landed in it. */
  people: { name: string; initials: string }[];
  /** The apps it touched, in the order it first touched them. */
  apps: string[];
  status: { label: string; tone: Tone };
  /** The latest step, as one line: what your agent is doing now, or the last thing that happened. */
  live: string;
  at: number;
}

/** How many tasks the feed shows on top. */
export const TASKS_SHOWN = 3;

/**
 * The chains that may be tasks, newest first: the ones your agent leads that
 * are underway, need you, or moved since the start of today. Whether one is a
 * task is only known once its chain is read (`taskOf`).
 */
export function taskCandidates(items: FeedItem[], now = Date.now()): FeedItem[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return items
    .filter((i) => isAgent(i) && (i.needs_you || laneOf(i) === "progress" || (i.chain_at || i.at) >= today.getTime()))
    .sort((a, b) => (b.chain_at || b.at) - (a.chain_at || a.at));
}

/** Where a task stands, from its lead row. */
export function taskStatus(lead: FeedItem): { label: string; tone: Tone } {
  if (lead.needs_you) {
    return lead.kind === "message" && lead.status === "asked" ? { label: "Asks you", tone: "wait" } : { label: "Needs you", tone: "wait" };
  }
  if (laneOf(lead) === "progress") return { label: "Working", tone: "busy" };
  if (lead.status === "failed") return { label: "Failed", tone: "bad" };
  return { label: "Done", tone: "good" };
}

/**
 * A chain as a task post, or null when it is not one: it does not start with
 * something you asked. `rows` is the whole chain, oldest first; `lead` its row
 * in the feed.
 */
export function taskOf(rows: FeedItem[], lead: FeedItem, appName: (key: string) => string, now = Date.now()): TaskPost | null {
  const root = rows[0];
  if (!root || root.kind !== "message" || root.from !== "you") return null;

  const people: TaskPost["people"] = [];
  const apps: string[] = [];
  for (const r of rows) {
    if (r.app && r.app !== "hyperfeed" && !apps.includes(r.app)) apps.push(r.app);
    if (r.kind !== "notification") continue;
    const h = headlineOf(r, appName);
    if (h.person && !people.some((p) => p.name === h.who)) people.push({ name: h.who, initials: h.initials });
  }

  return {
    chain: lead.chain,
    goal: line(root.body || root.title, 140) || "A task for your agent",
    people,
    apps,
    status: taskStatus(lead),
    live: liveLine(rows, appName, now),
    at: lead.chain_at || lead.at,
  };
}

/** What your agent is doing right now, or else the last step of the flow: "Your agent: Opened PR #420". */
function liveLine(rows: FeedItem[], appName: (key: string) => string, now: number): string {
  for (let i = rows.length - 1; i >= 0; i--) {
    const doing = progressLine(rows[i]!, now);
    if (doing) return doing;
  }
  const steps = flowOf(rows, appName);
  const last = steps[steps.length - 1];
  // Only your question so far: it is the goal, already on the post.
  if (!last || (steps.length === 1 && last.actor === "you")) return "";
  return `${last.who}: ${line(last.text, 120)}`;
}
