/**
 * A pretend api.github.com built from payloads recorded off the real one
 * (src/fixtures/github, recorded 2026-10-10 from calimero-network/apps and
 * trimmed to the fields the cards read), plus the variants a test needs.
 */
import { vi } from "vitest";
import merged435 from "../fixtures/github/pull-435-merged.json";
import stacked433 from "../fixtures/github/pull-433-stacked.json";
import headsSessionGrant from "../fixtures/github/pulls-head-session-grant.json";
import checkRuns435 from "../fixtures/github/check-runs-435.json";
import status435 from "../fixtures/github/status-435.json";
import failedRun from "../fixtures/github/run-38114772344-failed.json";
import failedJobs from "../fixtures/github/jobs-38114772344.json";

export const PR_URL = "https://github.com/calimero-network/apps/pull/435";
export const STACKED_URL = "https://github.com/calimero-network/apps/pull/433";
export const RUN_URL = "https://github.com/calimero-network/apps/actions/runs/38114772344";

const clone = <T>(v: T): T => structuredClone(v);

/** #435 as it stood before it merged: open, into main. */
export function openPr() {
  return { ...clone(merged435), state: "open", merged: false, merged_at: null, mergeable_state: "clean" };
}
/** #433 as it stood before it merged: open, on #431's branch. */
export function openStacked() {
  return { ...clone(stacked433), state: "open", merged: false, merged_at: null, mergeable_state: "clean" };
}
/** #431, whose branch #433 sits on, still open. */
export function openBase() {
  return clone(headsSessionGrant).map((p) => ({ ...p, state: "open", merged_at: null }));
}

export const greenRuns = () => clone(checkRuns435);
export const greenStatus = () => clone(status435);
/** The checks of a commit still being built: two Actions jobs running. */
export function pendingRuns() {
  const runs = clone(checkRuns435);
  for (const r of runs.check_runs.filter((r) => r.name.startsWith("Browser E2E (") || r.name.startsWith("Frontend"))) {
    r.status = "in_progress";
    r.conclusion = null as unknown as string;
  }
  return runs;
}
/** The recorded failed run's jobs, as a commit's check runs: App metadata and E2E (hyperfeed / feed) failed. */
export function redRuns() {
  return { total_count: failedJobs.total_count, check_runs: clone(failedJobs.jobs) };
}
export const run = () => clone(failedRun);
export const jobs = () => clone(failedJobs);

type Answer = unknown | (() => Response);

/**
 * `fetch` answering by path: the first route whose pattern matches the
 * request after https://api.github.com gives the JSON body, or a Response.
 * Anything else is a 404, as GitHub answers for a private repo.
 */
export function fakeGitHub(routes: [RegExp, Answer][]) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const path = url.replace("https://api.github.com", "");
    const hit = routes.find(([re]) => re.test(path));
    if (!hit) return json({ message: "Not Found" }, 404);
    const answer = hit[1];
    return typeof answer === "function" ? (answer as () => Response)() : json(answer);
  });
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** GitHub's answer once this browser's 60 requests an hour are used up. */
export function rateLimited(resetSeconds: number) {
  return () =>
    json({ message: "API rate limit exceeded for 203.0.113.7." }, 403, {
      "x-ratelimit-limit": "60",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(resetSeconds),
    });
}

/** Routes for one PR: its payload, its checks, and the PRs whose head is its base. */
export function prRoutes(pr: { number: number }, runs: unknown, status: unknown = greenStatus(), heads: unknown = []): [RegExp, Answer][] {
  return [
    [new RegExp(`/pulls/${pr.number}$`), pr],
    [/\/commits\/\w+\/check-runs/, runs],
    [/\/commits\/\w+\/status$/, status],
    [/\/pulls\?head=/, heads],
  ];
}
