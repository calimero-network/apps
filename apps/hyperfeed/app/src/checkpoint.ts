import type { CheckpointView } from "./generated/HyperfeedClient";
import { timeLabel } from "./format";

export type { CheckpointView };

/**
 * Where a task stands, as your agent last wrote it with `set_checkpoint`: done,
 * next, its branches, worktrees and PRs, and what is still open. A new agent
 * session picks the task up from it; the app shows it behind "Where it stands"
 * on the task. One per chain, the latest replacing the last.
 */

/** A section of a checkpoint as the app lists it: a label and its lines. Empty sections are left out. */
export interface CheckpointSection {
  label: string;
  lines: string[];
}

export function checkpointSections(c: CheckpointView): CheckpointSection[] {
  const sections: CheckpointSection[] = [
    { label: "Done", lines: c.done ? [c.done] : [] },
    { label: "Next", lines: c.next ? [c.next] : [] },
    { label: "Open questions", lines: c.questions ?? [] },
    { label: "PRs", lines: c.prs ?? [] },
    { label: "Branches", lines: c.branches ?? [] },
    { label: "Worktrees", lines: c.worktrees ?? [] },
  ];
  return sections.filter((s) => s.lines.some((l) => l.trim()));
}

/** Who wrote it and when: "mero-bot on studio · 4 min". */
export function checkpointByline(c: Pick<CheckpointView, "author" | "updated_at">, now = Date.now()): string {
  const who = c.author.trim();
  const at = who.lastIndexOf("@");
  const name = !who ? "Your agent" : at > 0 ? `${who.slice(0, at)} on ${who.slice(at + 1)}` : who;
  return c.updated_at ? `${name} · ${timeLabel(c.updated_at, now)}` : name;
}

/** A PR entry as a link: a URL as is, `owner/repo#12` on GitHub; null when it is neither. */
export function prHref(entry: string): string | null {
  const s = entry.trim();
  if (/^https?:\/\//i.test(s)) return s;
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(s);
  return m ? `https://github.com/${m[1]}/pull/${m[2]}` : null;
}

/** Whether a read came back with a checkpoint: an older feed, or a chain with none, gives null. */
export function isCheckpoint(c: unknown): c is CheckpointView {
  return !!c && typeof c === "object" && typeof (c as CheckpointView).chain === "string" && !!(c as CheckpointView).chain;
}
