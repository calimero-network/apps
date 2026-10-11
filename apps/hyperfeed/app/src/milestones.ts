import type { FeedItem } from "./generated/HyperfeedClient";
import { laneOf, type Tone } from "./format";

/**
 * A task told in milestones: "Filed → PR #12 → CI green → Merged". The few
 * steps a person cares about, read from a chain's rows; the full log is still
 * there behind "More".
 *
 * A reading of the rows the feed already returns; nothing new is stored.
 */
export interface Milestone {
  /** What kind of step it is: one of each in a track, the latest kept. */
  kind: "filed" | "pr" | "ci" | "merged" | "now";
  label: string;
  tone: Tone;
  at: number;
}

/** Everything a row says, in the order it said it: its title and body, then each step's note. */
function said(item: FeedItem): { text: string; at: number }[] {
  const out = [{ text: `${item.title}\n${item.body}`, at: item.at }];
  for (const step of item.history) if (step.note) out.push({ text: step.note, at: step.at });
  if (item.doing) out.push({ text: item.doing, at: item.doing_at });
  return out;
}

/** "PR #432", "pull request #432", ".../pull/432": the pull request a text names, or "". */
export function prOf(text: string): string {
  const m = /\b(?:PR|pull request)\s*#(\d+)|\/pull\/(\d+)\b/i.exec(text);
  return m ? (m[1] ?? m[2])! : "";
}

/** What a text says of CI: green, red, or nothing. */
export function ciOf(text: string): "green" | "red" | "" {
  const t = text.toLowerCase();
  if (!/\b(ci|checks?|tests?)\b/.test(t)) return "";
  if (/\b(fail(ed|ing|s)?|red|broke(n)?)\b/.test(t)) return "red";
  if (/\b(green|pass(ed|es|ing)?|succeeded|all good)\b/.test(t)) return "green";
  return "";
}

/** Whether a text says a pull request was merged; `done` for an action that was carried out, where "Merge PR #12" did it. */
function mergedIn(text: string, done: boolean): boolean {
  if (done && /^\s*(merge\b|\$?\s*gh pr merge\b)/im.test(text)) return true;
  return /\bmerged\b/i.test(text) && !/\b(not|n't|un)\s*merged\b/i.test(text);
}

/**
 * Whether what a row says is a fact: a done action, what your agent said, an
 * app's notification. Not what you asked for ("Fix the failing CI"), and not
 * what is only proposed.
 */
function factual(item: FeedItem): boolean {
  if (item.kind === "action") return item.status === "done";
  return !(item.kind === "message" && item.from === "you");
}

/** Where the chain stands now, from its lead row: the track's last stop, unless it is merged. */
function nowOf(lead: FeedItem): Milestone | null {
  const at = lead.chain_at || lead.status_at || lead.at;
  if (lead.needs_you) return { kind: "now", label: lead.kind === "message" ? "Asks you" : "Needs you", tone: "wait", at };
  if (laneOf(lead) === "progress") return { kind: "now", label: "Working", tone: "busy", at };
  if (lead.status === "failed") return { kind: "now", label: "Failed", tone: "bad", at };
  if (lead.status === "declined") return { kind: "now", label: "Declined", tone: "plain", at };
  return { kind: "now", label: "Done", tone: "good", at };
}

/**
 * A chain's milestones, oldest first. `rows` is the whole chain, oldest
 * first; `lead` is its row in the feed (where it stands now), the newest row
 * when not given.
 *
 * - **Filed**: the chain began with something you asked, or an issue filed.
 * - **PR #N**: the first pull request anything in it names.
 * - **CI green / CI red**: the latest any row says of the checks.
 * - **Merged**: a row that happened says it merged.
 * - Then where it stands, unless merged says it: needs you, working, failed, done.
 *
 * A chain with no PR, CI or merge to tell has no track: [].
 */
export function milestonesOf(rows: FeedItem[], lead: FeedItem | undefined = rows[rows.length - 1]): Milestone[] {
  if (rows.length === 0 || !lead) return [];
  const track: Milestone[] = [];
  const root = rows[0]!;
  if ((root.kind === "message" && root.from === "you") || /(^|_)create_issue$/.test(root.method)) {
    track.push({ kind: "filed", label: "Filed", tone: "plain", at: root.at });
  }

  let pr: Milestone | null = null;
  let ci: Milestone | null = null;
  let merged: Milestone | null = null;
  for (const row of rows) {
    for (const { text, at } of said(row)) {
      const n = prOf(text);
      if (n && !pr) pr = { kind: "pr", label: `PR #${n}`, tone: "plain", at };
      if (!factual(row)) continue;
      const c = ciOf(text);
      if (c && (!ci || at >= ci.at)) ci = { kind: "ci", label: c === "green" ? "CI green" : "CI red", tone: c === "green" ? "good" : "bad", at };
      if (mergedIn(text, row.kind === "action") && !merged) merged = { kind: "merged", label: "Merged", tone: "good", at };
    }
  }
  for (const m of [pr, ci, merged]) if (m) track.push(m);
  track.sort((a, b) => a.at - b.at);

  // Merged is the end of the story, unless something after it waits on you or failed.
  const now = nowOf(lead);
  if (now && !(merged && now.label === "Done")) track.push(now);
  // Filed and where it stands tell nothing the post and its pill do not: a story needs a milestone between.
  return pr || ci || merged ? track : [];
}

/** A track as one line, for a label: "Filed → PR #12 → CI green → Merged". */
export function trackLine(track: Milestone[]): string {
  return track.map((m) => m.label).join(" → ");
}
