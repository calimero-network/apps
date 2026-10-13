import type { WatchInput, WatchView } from "./generated/HyperfeedClient";
import type { Tone } from "./format";

/**
 * Watches: "when X, do Y", kept in the feed so they outlive the agent session
 * that set them ("merge #434 when it's green", "watch main and fix it if
 * red"). Your agent's runtime polls each one and fires it once; here you see
 * them on their task, with where each stands, and cancel one still waiting.
 */

/** "Merge calimero-network/apps#434 when its checks are green". */
export function describeWatch(w: Pick<WatchView, "condition" | "repo" | "pr" | "branch" | "action" | "text">): string {
  const pr = `${w.repo}#${w.pr}`;
  const branch = w.branch || "the default branch";
  const when: Record<string, string> = {
    pr_green: `when ${pr}'s checks are green`,
    pr_red: `when a check fails on ${pr}`,
    pr_merged: `when ${pr} is merged`,
    branch_green: `when CI on ${branch} of ${w.repo} is green`,
    branch_red: `when CI on ${branch} of ${w.repo} goes red`,
  };
  const what = w.text.replace(/\s+/g, " ").trim();
  const then: Record<string, string> = {
    merge: `Merge ${pr}`,
    turn: what ? `Your agent: ${clip(what, 80)}` : "Start your agent",
    notify: what ? `Tell you: ${clip(what, 80)}` : "Tell you",
  };
  return `${then[w.action] ?? w.action} ${when[w.condition] ?? w.condition}`;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Where a watch stands, as a pill. */
export function watchState(w: Pick<WatchView, "status">): { label: string; tone: Tone } {
  switch (w.status) {
    case "watching":
      return { label: "Watching", tone: "busy" };
    case "firing":
      return { label: "Firing", tone: "busy" };
    case "done":
      return { label: "Fired", tone: "good" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    default:
      return { label: "Cancelled", tone: "plain" };
  }
}

/** A watch still waiting: shown on its task, and the only kind you can cancel. */
export const isActive = (w: Pick<WatchView, "status">) => w.status === "watching" || w.status === "firing";

const CONDITIONS = ["pr_green", "pr_red", "pr_merged", "branch_green", "branch_red"];
const ACTIONS = ["merge", "turn", "notify"];

/**
 * A new watch by the contract's rules (`add_watch`), for the demo feed: the
 * same checks, so the demo refuses what a real feed refuses.
 */
export function newWatch(input: WatchInput, id: string, now: number): WatchView {
  if (!CONDITIONS.includes(input.condition)) throw new Error(`condition must be one of ${CONDITIONS.join(", ")}`);
  if (!ACTIONS.includes(input.action)) throw new Error(`action must be one of ${ACTIONS.join(", ")}`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repo.trim())) throw new Error(`repo must be owner/name, got "${input.repo}"`);
  const onPr = input.condition.startsWith("pr_");
  if (onPr && !input.pr) throw new Error(`${input.condition} needs the pull request's number in pr`);
  if (!onPr && input.pr) throw new Error(`${input.condition} watches a branch: pr must be 0`);
  if (input.action === "merge" && input.condition !== "pr_green") throw new Error("merge goes with pr_green only: a PR merges when every check passed");
  if (input.action !== "merge" && !input.text.trim()) throw new Error("text must not be empty");
  return {
    ...input,
    repo: input.repo.trim(),
    branch: onPr ? "" : input.branch.trim(),
    text: input.text.trim(),
    id,
    status: "watching",
    note: "",
    seen: "",
    seen_at: 0,
    fired_by: "",
    fired_at: 0,
    created_at: now,
    updated_at: now,
  };
}

/** The contract's state machine, for the demo: watching → firing → done | failed, or watching → cancelled. */
export function moveWatch(w: WatchView, to: "cancelled" | "firing" | "done" | "failed", now: number, note = ""): WatchView {
  const from = to === "cancelled" || to === "firing" ? "watching" : "firing";
  if (w.status !== from) throw new Error(`watch ${w.id} is ${w.status}${to === "firing" ? ", not watching: it fires once" : ""}`);
  return { ...w, status: to, note, ...(to === "firing" ? { fired_by: note, fired_at: now, note: "" } : {}), updated_at: Math.max(now, w.updated_at + 1) };
}

/**
 * The merge button's watch: "merge this PR when every check passed", on the
 * task's chain. Your agent's runtime fires it (right away when the checks are
 * already green) and merges by the safe-merge rules as GitHub stands then.
 */
export function mergeWatchInput(chain: string, repo: string, pr: number): WatchInput {
  return { chain, condition: "pr_green", repo, pr, branch: "", action: "merge", text: "", agent: "" };
}

/** The latest merge watch on a PR that was not cancelled: what its card says about the merge. */
export function mergeWatchFor(watches: WatchView[], repo: string, pr: number): WatchView | undefined {
  const name = repo.toLowerCase();
  return watches
    .filter((w) => w.action === "merge" && w.pr === pr && w.repo.toLowerCase() === name && w.status !== "cancelled")
    .sort((a, b) => b.created_at - a.created_at || b.updated_at - a.updated_at)[0];
}
