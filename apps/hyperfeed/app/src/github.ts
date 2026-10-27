import { isServedByNode } from "@calimero-apps/node-served";

/**
 * What a chat card shows about a GitHub pull request or Actions run, read
 * from GitHub's public REST API without a token: the browser never holds one.
 *
 * Unauthenticated, GitHub allows 60 requests an hour per address, so every
 * answer is cached, a PR's checks are read again only when its head commit
 * moved or they had not finished, and a rate limit stops all reading until it
 * resets. A private or missing repo answers 404 and the card falls back to
 * the plain link.
 */

export const API = "https://api.github.com";

/** A link a card can show, found in a message. */
export type Ref =
  | { kind: "pr"; url: string; owner: string; repo: string; number: number }
  | { kind: "run"; url: string; owner: string; repo: string; id: number };

const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?![\w/])/g;
const RUN_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/actions\/runs\/(\d+)(?:\/job\/\d+)?(?![\w])/g;

/** The most cards one message shows. */
export const MAX_CARDS = 4;

/** The PR and run links in a message, each once, in the order they appear. */
export function findRefs(text: string): Ref[] {
  const found: { at: number; ref: Ref }[] = [];
  for (const m of text.matchAll(PR_URL)) {
    const [, owner, repo, n] = m;
    found.push({ at: m.index, ref: { kind: "pr", url: `https://github.com/${owner}/${repo}/pull/${n}`, owner: owner!, repo: repo!, number: Number(n) } });
  }
  for (const m of text.matchAll(RUN_URL)) {
    const [, owner, repo, id] = m;
    found.push({ at: m.index, ref: { kind: "run", url: `https://github.com/${owner}/${repo}/actions/runs/${id}`, owner: owner!, repo: repo!, id: Number(id) } });
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.ref)
    .filter((r) => !seen.has(r.url) && seen.add(r.url))
    .slice(0, MAX_CARDS);
}

/** Where a set of checks stands, and which ones failed. */
export interface Checks {
  state: "green" | "red" | "pending";
  /** How many checks there are, skipped ones included. */
  total: number;
  passed: number;
  pending: number;
  failing: string[];
}

export interface PullRequest {
  title: string;
  /** owner/repo */
  repo: string;
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  base: string;
  defaultBranch: string;
  /** GitHub found conflicts with the base. */
  conflicts: boolean;
  headSha: string;
  checks: Checks;
  /**
   * When the base is not the default branch, the PR whose branch it is, if
   * any: a stacked PR. Merged means its branch is dead and this one must be
   * retargeted before it merges.
   */
  stackedOn: { number: number; url: string; merged: boolean } | null;
}

export interface Run {
  name: string;
  title: string;
  repo: string;
  url: string;
  branch: string;
  state: "green" | "red" | "pending";
  /** The run's conclusion as GitHub words it (failure, cancelled, …), or its status while it runs. */
  result: string;
  failing: string[];
}

/** Why a card could not be read: the plain link shows instead. */
export class Unavailable extends Error {
  constructor(
    readonly reason: "limited" | "missing" | "failed",
    /** For a rate limit, when it resets (ms since the epoch). */
    readonly until = 0,
  ) {
    super(reason === "limited" ? "GitHub's rate limit for this browser is used up" : reason === "missing" ? "Not found, or a private repo" : "GitHub didn't answer");
  }
}

const GREEN = new Set(["success", "neutral", "skipped"]);

interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}
interface Status {
  context: string;
  state: string;
}

/** Check runs (Actions) and commit statuses (Vercel and the like) together. */
export function summarize(runs: CheckRun[], statuses: Status[]): Checks {
  let passed = 0;
  let pending = 0;
  const failing: string[] = [];
  for (const r of runs) {
    if (r.status !== "completed") pending++;
    else if (GREEN.has(r.conclusion ?? "")) passed++;
    else failing.push(r.name);
  }
  for (const s of statuses) {
    if (s.state === "pending") pending++;
    else if (s.state === "success") passed++;
    else failing.push(s.context);
  }
  const total = runs.length + statuses.length;
  // No checks at all yet reads as waiting for them, not as passed.
  const state = failing.length > 0 ? "red" : pending > 0 || total === 0 ? "pending" : "green";
  return { state, total, passed, pending, failing };
}

/** Until when every request is held back: one rate limit stops them all. */
let limitedUntil = 0;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function get<T>(path: string, fetcher: Fetch, now: number): Promise<T> {
  // A node-served app may not connect to GitHub, so its messages keep the plain link.
  if (isServedByNode(new URL(window.location.href))) throw new Unavailable("failed");
  if (now < limitedUntil) throw new Unavailable("limited", limitedUntil);
  let res: Response;
  try {
    // No credentials and no token: only what anyone can read. The browser's
    // HTTP cache honours GitHub's ETag and max-age on its own.
    res = await fetcher(API + path, { headers: { Accept: "application/vnd.github+json" }, credentials: "omit" });
  } catch {
    throw new Unavailable("failed");
  }
  if (res.ok) return (await res.json()) as T;
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (res.status === 429 || (res.status === 403 && remaining === "0")) {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    const retry = Number(res.headers.get("retry-after")) * 1000;
    limitedUntil = reset > now ? reset : now + (retry > 0 ? retry : 60_000);
    throw new Unavailable("limited", limitedUntil);
  }
  if (res.status === 404 || res.status === 403 || res.status === 451) throw new Unavailable("missing");
  throw new Unavailable("failed");
}

interface PullPayload {
  number: number;
  html_url: string;
  state: "open" | "closed";
  draft?: boolean;
  title: string;
  merged?: boolean | null;
  merged_at: string | null;
  mergeable_state?: string | null;
  head: { ref: string; sha: string };
  base: { ref: string; repo: { full_name: string; default_branch: string } };
}

const merged = (p: PullPayload) => Boolean(p.merged || p.merged_at);

interface Cached<T> {
  at: number;
  value?: T;
  error?: Unavailable;
  pending?: Promise<T>;
}

const cache = new Map<string, Cached<unknown>>();
/** Checks by commit: finished checks on a commit do not change. */
const checksBySha = new Map<string, Checks>();

/** Forget everything read: for tests. */
export function clearGithubCache() {
  cache.clear();
  checksBySha.clear();
  limitedUntil = 0;
}

/** How long an answer stands before it is read again. */
export const FRESH_MS = 30_000;
/** How long a missing or private repo is left alone. */
const MISSING_MS = 10 * 60_000;

function cached<T>(key: string, now: number, read: () => Promise<T>, force = false): Promise<T> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit?.pending) return hit.pending;
  if (hit && !force) {
    if (hit.value !== undefined && now - hit.at < FRESH_MS) return Promise.resolve(hit.value);
    if (hit.error?.reason === "missing" && now - hit.at < MISSING_MS) return Promise.reject(hit.error);
  }
  const pending = read().then(
    (value) => {
      cache.set(key, { at: now, value });
      return value;
    },
    (e: unknown) => {
      const error = e instanceof Unavailable ? e : new Unavailable("failed");
      // A failed refresh keeps the last answer to show; the card says it is stale.
      cache.set(key, { at: now, value: hit?.value, error });
      throw error;
    },
  );
  cache.set(key, { ...(hit ?? { at: 0 }), pending });
  return pending;
}

/** The last answer read for a link, if any, even a stale one. */
export function lastRead<T>(url: string): T | undefined {
  return cache.get(url)?.value as T | undefined;
}

export function readPr(ref: Extract<Ref, { kind: "pr" }>, fetcher: Fetch = fetch, now = Date.now(), force = false): Promise<PullRequest> {
  return cached(ref.url, now, async () => {
    const base = `/repos/${ref.owner}/${ref.repo}`;
    const p = await get<PullPayload>(`${base}/pulls/${ref.number}`, fetcher, now);
    let checks = checksBySha.get(p.head.sha);
    if (!checks) {
      const [runs, status] = await Promise.all([
        get<{ check_runs: CheckRun[] }>(`${base}/commits/${p.head.sha}/check-runs?per_page=100`, fetcher, now),
        get<{ statuses: Status[] }>(`${base}/commits/${p.head.sha}/status`, fetcher, now),
      ]);
      checks = summarize(runs.check_runs, status.statuses);
      if (checks.pending === 0 && checks.total > 0) checksBySha.set(p.head.sha, checks);
    }
    let stackedOn: PullRequest["stackedOn"] = null;
    if (p.base.ref !== p.base.repo.default_branch) {
      const owner = p.base.repo.full_name.split("/")[0]!;
      const heads = await get<PullPayload[]>(`${base}/pulls?head=${encodeURIComponent(`${owner}:${p.base.ref}`)}&state=all&per_page=5`, fetcher, now);
      const under = heads.find((h) => h.head.ref === p.base.ref);
      if (under) stackedOn = { number: under.number, url: under.html_url, merged: merged(under) };
    }
    return {
      title: p.title,
      repo: p.base.repo.full_name,
      number: p.number,
      url: p.html_url,
      state: merged(p) ? "merged" : p.state,
      draft: Boolean(p.draft),
      base: p.base.ref,
      defaultBranch: p.base.repo.default_branch,
      conflicts: p.mergeable_state === "dirty",
      headSha: p.head.sha,
      checks,
      stackedOn,
    };
  }, force);
}

interface RunPayload {
  name: string;
  display_title: string;
  head_branch: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export function readRun(ref: Extract<Ref, { kind: "run" }>, fetcher: Fetch = fetch, now = Date.now(), force = false): Promise<Run> {
  return cached(ref.url, now, async () => {
    const base = `/repos/${ref.owner}/${ref.repo}/actions/runs/${ref.id}`;
    const r = await get<RunPayload>(base, fetcher, now);
    const done = r.status === "completed";
    const state = !done ? "pending" : GREEN.has(r.conclusion ?? "") ? "green" : "red";
    let failing: string[] = [];
    if (state === "red") {
      const jobs = await get<{ jobs: CheckRun[] }>(`${base}/jobs?per_page=100`, fetcher, now).catch(() => ({ jobs: [] }));
      failing = jobs.jobs.filter((j) => j.status === "completed" && !GREEN.has(j.conclusion ?? "")).map((j) => j.name);
    }
    return {
      name: r.name,
      title: r.display_title,
      repo: `${ref.owner}/${ref.repo}`,
      url: r.html_url,
      branch: r.head_branch,
      state,
      result: done ? (r.conclusion ?? "completed") : r.status.replace(/_/g, " "),
      failing,
    };
  }, force);
}

/** What the card's merge control offers, by the safe-merge rules. */
export type MergeOffer =
  | { kind: "merge"; request: string }
  | { kind: "when-green"; request: string }
  | { kind: "retarget"; request: string; label: string }
  | { kind: "blocked"; label: string; why: string }
  /** Its base is not the default branch, and is still live: no merge button at all, only why. */
  | { kind: "stacked"; why: string }
  | { kind: "none" };

/**
 * Merge only when it is safe: every check green and the base is the default
 * branch. Pending checks offer "Merge when green"; red checks, a draft or a
 * conflict hold the button with why. A PR stacked on another PR's branch is
 * never merged into it: once that PR merged, the card offers to retarget this
 * one to the default branch; until then it only says it is stacked.
 */
export function mergeOffer(pr: PullRequest): MergeOffer {
  if (pr.state !== "open") return { kind: "none" };
  if (pr.base !== pr.defaultBranch) {
    if (pr.stackedOn?.merged) {
      return {
        kind: "retarget",
        label: `Base merged: retarget to ${pr.defaultBranch}`,
        request: `retarget PR ${pr.url} to ${pr.defaultBranch}`,
      };
    }
    return {
      kind: "stacked",
      why: pr.stackedOn
        ? `Stacked on #${pr.stackedOn.number}, so it can't merge into ${pr.defaultBranch}: merge #${pr.stackedOn.number} first, then retarget this to ${pr.defaultBranch}`
        : `Its base is ${pr.base}, not ${pr.defaultBranch}, so it can't merge into ${pr.defaultBranch}`,
    };
  }
  if (pr.draft) return { kind: "blocked", label: "Merge", why: "Still a draft" };
  if (pr.conflicts) return { kind: "blocked", label: "Merge", why: `Conflicts with ${pr.base}` };
  if (pr.checks.state === "red") return { kind: "blocked", label: "Merge", why: `Checks failed: ${pr.checks.failing.join(", ")}` };
  if (pr.checks.state === "pending") return { kind: "when-green", request: `merge PR ${pr.url} when green` };
  return { kind: "merge", request: `merge PR ${pr.url}` };
}

// ── what your agent's runtime saw, from the feed ─────────────────────────────

/**
 * A PR as your agent's runtime last recorded it in the feed (`record_pr`):
 * it reads GitHub with your login, so it sees private repos and is not held
 * to the browser's 60 requests an hour.
 */
export interface SeenPr {
  repo: string;
  pr: number;
  title: string;
  state: string;
  draft: boolean;
  base: string;
  default_branch: string;
  conflicts: boolean;
  head_sha: string;
  checks: string;
  checks_total: number;
  checks_passed: number;
  checks_pending: number;
  failing: string[];
  stacked_on: number;
  stacked_merged: boolean;
  seen_at: number;
}

/** How a PR is keyed in the feed and on a card: `owner/name#number`, GitHub's names being case-blind. */
export const prKey = (repo: string, number: number) => `${repo.toLowerCase()}#${number}`;

const STATES = new Set(["open", "merged", "closed"]);
const CHECK_STATES = new Set(["green", "red", "pending"]);

/** The feed's record as the card's PullRequest. */
export function fromSeen(seen: SeenPr): PullRequest {
  return {
    title: seen.title || `${seen.repo}#${seen.pr}`,
    repo: seen.repo,
    number: seen.pr,
    url: `https://github.com/${seen.repo}/pull/${seen.pr}`,
    state: (STATES.has(seen.state) ? seen.state : "open") as PullRequest["state"],
    draft: seen.draft,
    base: seen.base,
    defaultBranch: seen.default_branch,
    conflicts: seen.conflicts,
    headSha: seen.head_sha,
    checks: {
      state: (CHECK_STATES.has(seen.checks) ? seen.checks : "pending") as Checks["state"],
      total: seen.checks_total,
      passed: seen.checks_passed,
      pending: seen.checks_pending,
      failing: [...seen.failing],
    },
    stackedOn: seen.stacked_on ? { number: seen.stacked_on, url: `https://github.com/${seen.repo}/pull/${seen.stacked_on}`, merged: seen.stacked_merged } : null,
  };
}

/**
 * What the card shows: the newer of the browser's own read of GitHub (`read`,
 * read at `readAt`) and the runtime's record in the feed. Either may be
 * missing: a private repo or a used-up rate limit leaves only the record, a
 * feed without mero-bot only the browser's read. The title is GitHub's when
 * the browser has it.
 */
export function pickPr(read: PullRequest | undefined, readAt: number, seen: SeenPr | undefined): { pr: PullRequest; from: "github" | "feed" } | undefined {
  if (!seen) return read ? { pr: read, from: "github" } : undefined;
  const recorded = fromSeen(seen);
  if (!read || seen.seen_at > readAt) return { pr: read && !seen.title ? { ...recorded, title: read.title } : recorded, from: "feed" };
  return { pr: read, from: "github" };
}
