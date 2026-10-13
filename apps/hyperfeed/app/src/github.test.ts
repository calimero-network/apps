import { beforeEach, describe, expect, it } from "vitest";
import { clearGithubCache, findRefs, fromSeen, FRESH_MS, mergeOffer, pickPr, prKey, readPr, readRun, Unavailable, type PullRequest, type SeenPr } from "./github";
import {
  fakeGitHub,
  greenRuns,
  jobs,
  openBase,
  openPr,
  openStacked,
  pendingRuns,
  prRoutes,
  PR_URL,
  rateLimited,
  redRuns,
  run,
  RUN_URL,
  STACKED_URL,
} from "./test/github";
import merged435 from "./fixtures/github/pull-435-merged.json";
import headsSessionGrant from "./fixtures/github/pulls-head-session-grant.json";

const pr435 = { kind: "pr", url: PR_URL, owner: "calimero-network", repo: "apps", number: 435 } as const;
const pr433 = { kind: "pr", url: STACKED_URL, owner: "calimero-network", repo: "apps", number: 433 } as const;

beforeEach(clearGithubCache);

describe("finding links in a message", () => {
  it("finds PRs and Actions runs, each once, in order, and nothing else", () => {
    const text = `Opened ${PR_URL}. CI: ${RUN_URL}/job/123 (and ${PR_URL} again).
      Not https://github.com/calimero-network/apps/pull/435/files nor https://gitlab.com/a/b/pull/1 nor issue-1791695562720-dcf0be3f`;
    expect(findRefs(text)).toEqual([
      pr435,
      { kind: "run", url: RUN_URL, owner: "calimero-network", repo: "apps", id: 38114772344 },
    ]);
  });
});

describe("reading a PR", () => {
  it("reads title, repo, base, state and green checks from the recorded payloads", async () => {
    const fetcher = fakeGitHub(prRoutes(merged435, greenRuns()));
    const pr = await readPr(pr435, fetcher);
    expect(pr).toMatchObject({
      title: "fix(hyperfeed): a failure no retry can fix offers Archive, not a Retry that fails again",
      repo: "calimero-network/apps",
      base: "main",
      defaultBranch: "main",
      state: "merged",
      stackedOn: null,
    });
    // 11 check runs and 23 Vercel statuses, all passed or skipped.
    expect(pr.checks).toEqual({ state: "green", total: 34, passed: 34, pending: 0, failing: [] });
    // Sent without credentials or a token.
    const [, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(init.credentials).toBe("omit");
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
  });

  it("names the failing jobs", async () => {
    const pr = await readPr(pr435, fakeGitHub(prRoutes(openPr(), redRuns())));
    expect(pr.state).toBe("open");
    expect(pr.checks.state).toBe("red");
    expect(pr.checks.failing).toEqual(["App metadata", "E2E (hyperfeed / feed)"]);
  });

  it("counts running checks as pending", async () => {
    const pr = await readPr(pr435, fakeGitHub(prRoutes(openPr(), pendingRuns())));
    expect(pr.checks).toMatchObject({ state: "pending", pending: 2, failing: [] });
  });

  it("finds the PR a stacked PR sits on", async () => {
    const pr = await readPr(pr433, fakeGitHub(prRoutes(openStacked(), greenRuns(), undefined, headsSessionGrant)));
    expect(pr.base).toBe("fix/hyperfeed-session-grant");
    expect(pr.stackedOn).toEqual({ number: 431, url: "https://github.com/calimero-network/apps/pull/431", merged: true });
  });

  it("serves a fresh answer from its cache, and reads again once it is stale", async () => {
    const fetcher = fakeGitHub(prRoutes(openPr(), pendingRuns()));
    const now = Date.now();
    await readPr(pr435, fetcher, now);
    const calls = fetcher.mock.calls.length;
    await readPr(pr435, fetcher, now + 1_000);
    expect(fetcher.mock.calls.length).toBe(calls);
    await readPr(pr435, fetcher, now + FRESH_MS + 1);
    expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
  });

  it("doesn't read finished checks on the same commit again", async () => {
    const fetcher = fakeGitHub(prRoutes(openPr(), greenRuns()));
    await readPr(pr435, fetcher, 0, true);
    await readPr(pr435, fetcher, 1, true);
    expect(fetcher.mock.calls.filter(([u]) => /check-runs/.test(u as string))).toHaveLength(1);
  });

  it("says a private or missing repo is unavailable", async () => {
    await expect(readPr(pr435, fakeGitHub([]))).rejects.toMatchObject({ reason: "missing" });
  });

  it("stops asking GitHub until a rate limit resets", async () => {
    const now = Date.now();
    const reset = Math.floor(now / 1000) + 600;
    const limited = fakeGitHub([[/./, rateLimited(reset)]]);
    const error = await readPr(pr435, limited, now).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Unavailable);
    expect(error).toMatchObject({ reason: "limited", until: reset * 1000 });

    // Another link, before the reset: not even asked.
    const other = fakeGitHub(prRoutes(openPr(), greenRuns()));
    await expect(readPr(pr433, other, now + 60_000)).rejects.toMatchObject({ reason: "limited" });
    expect(other).not.toHaveBeenCalled();
  });
});

describe("reading an Actions run", () => {
  it("reads the result and names the failed jobs", async () => {
    const r = await readRun({ kind: "run", url: RUN_URL, owner: "calimero-network", repo: "apps", id: 38114772344 }, fakeGitHub([
      [/\/jobs/, jobs()],
      [/\/actions\/runs\/38114772344$/, run()],
    ]));
    expect(r).toMatchObject({ name: "CI", branch: "feat/hyperfeed-live-work", state: "red", failing: ["App metadata", "E2E (hyperfeed / feed)"] });
  });
});

describe("the merge button's rules", () => {
  const base: PullRequest = {
    title: "t",
    repo: "calimero-network/apps",
    number: 435,
    url: PR_URL,
    state: "open",
    draft: false,
    base: "main",
    defaultBranch: "main",
    conflicts: false,
    headSha: "abc",
    checks: { state: "green", total: 3, passed: 3, pending: 0, failing: [] },
    stackedOn: null,
  };

  it("merges, through your agent, only when every check is green and the base is the default branch", () => {
    expect(mergeOffer(base)).toEqual({ kind: "merge", request: `merge PR ${PR_URL}` });
  });

  it("offers Merge when green while checks run", () => {
    expect(mergeOffer({ ...base, checks: { state: "pending", total: 3, passed: 1, pending: 2, failing: [] } })).toEqual({
      kind: "when-green",
      request: `merge PR ${PR_URL} when green`,
    });
  });

  it("refuses on red checks, naming them", () => {
    expect(mergeOffer({ ...base, checks: { state: "red", total: 3, passed: 2, pending: 0, failing: ["E2E (hyperfeed / feed)"] } })).toMatchObject({
      kind: "blocked",
      why: "Checks failed: E2E (hyperfeed / feed)",
    });
  });

  it("never merges a stacked PR into its base: retarget once the base merged, wait while it hasn't", () => {
    const stacked = { ...base, base: "fix/hyperfeed-session-grant", stackedOn: { number: 431, url: "u", merged: true } };
    expect(mergeOffer(stacked)).toEqual({
      kind: "retarget",
      label: "Base merged: retarget to main",
      request: `retarget PR ${PR_URL} to main`,
    });
    // Its base PR not merged yet: no merge button, only that it is stacked and can't merge into main.
    expect(mergeOffer({ ...stacked, stackedOn: { number: 431, url: "u", merged: false } })).toEqual({
      kind: "stacked",
      why: "Stacked on #431, so it can't merge into main: merge #431 first, then retarget this to main",
    });
    expect(mergeOffer({ ...stacked, stackedOn: null })).toEqual({
      kind: "stacked",
      why: "Its base is fix/hyperfeed-session-grant, not main, so it can't merge into main",
    });
  });

  it("offers nothing on a merged or closed PR, and holds a draft or a conflicted one", () => {
    expect(mergeOffer({ ...base, state: "merged" })).toEqual({ kind: "none" });
    expect(mergeOffer({ ...base, state: "closed" })).toEqual({ kind: "none" });
    expect(mergeOffer({ ...base, draft: true })).toMatchObject({ kind: "blocked" });
    expect(mergeOffer({ ...base, conflicts: true })).toMatchObject({ kind: "blocked" });
  });

  it("reads the open base of the recorded stack as not merged", async () => {
    const pr = await readPr(pr433, fakeGitHub(prRoutes(openStacked(), greenRuns(), undefined, openBase())));
    expect(mergeOffer(pr)).toMatchObject({ kind: "stacked" });
  });
});

describe("what your agent's runtime saw, from the feed", () => {
  const seen: SeenPr = {
    repo: "calimero-network/secret",
    pr: 7,
    title: "",
    state: "open",
    draft: false,
    base: "main",
    default_branch: "main",
    conflicts: false,
    head_sha: "abc",
    checks: "red",
    checks_total: 4,
    checks_passed: 3,
    checks_pending: 0,
    failing: ["E2E"],
    stacked_on: 0,
    stacked_merged: false,
    seen_at: 2_000,
  };

  it("reads a recorded PR as the card's PR, and keys it case-blind", () => {
    const pr = fromSeen(seen);
    expect(pr).toMatchObject({ title: "calimero-network/secret#7", url: "https://github.com/calimero-network/secret/pull/7", defaultBranch: "main", stackedOn: null });
    expect(pr.checks).toEqual({ state: "red", total: 4, passed: 3, pending: 0, failing: ["E2E"] });
    expect(mergeOffer(pr)).toMatchObject({ kind: "blocked", why: "Checks failed: E2E" });
    expect(fromSeen({ ...seen, base: "feat/x", stacked_on: 6, stacked_merged: true }).stackedOn).toEqual({
      number: 6,
      url: "https://github.com/calimero-network/secret/pull/6",
      merged: true,
    });
    expect(prKey("Calimero-Network/Apps", 435)).toBe(prKey("calimero-network/apps", 435));
  });

  it("shows the newer of the browser's read and the runtime's record", () => {
    const read = { ...fromSeen(seen), title: "From GitHub", checks: { state: "green" as const, total: 4, passed: 4, pending: 0, failing: [] } };
    expect(pickPr(undefined, 0, undefined)).toBeUndefined();
    expect(pickPr(read, 1_000, undefined)).toEqual({ pr: read, from: "github" });
    expect(pickPr(undefined, 0, seen)?.from).toBe("feed");
    // The record is newer: its checks, GitHub's title.
    const newer = pickPr(read, 1_000, seen)!;
    expect(newer.from).toBe("feed");
    expect(newer.pr.checks.state).toBe("red");
    expect(newer.pr.title).toBe("From GitHub");
    expect(pickPr(read, 3_000, seen)).toEqual({ pr: read, from: "github" });
  });
});
