/**
 * The board's contract is called through `MeroIssueTrackerClient`, which
 * `mero-app-build codegen` writes from logic/res/abi.json
 * (`src/generated/client.ts`). The ABI names its records without their shapes,
 * so the generated types are `unknown`: each answer passes through the
 * `fromWire*` / `to*` below into the shapes the screens use.
 */

// ── what the views render ────────────────────────────────────────────────────
//
// The shapes the screens were written against (v1's generated client). The
// contract now answers camelCase with 64-bit integers as decimal strings;
// `fromWire*` below is the one place that difference is absorbed.

export interface IssueView {
  id: string;
  title: string;
  summary: string;
  impact: string;
  repro: string;
  resolution_criteria: string;
  status: string;
  priority: string;
  assignee: string | null;
  labels: string[];
  /** The filer's account id. */
  created_by: string;
  /** Unix milliseconds. */
  created_at: number;
}

export interface CommentView {
  id: string;
  issue_id: string;
  /** The writer's account id: only they may edit or delete it. */
  author: string;
  body: string;
  created_at: number;
  edited_at: number | null;
}

export interface IssueDetail {
  issue: IssueView;
  comments: CommentView[];
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface NewIssue {
  title: string;
  summary: string;
  impact: string;
  repro: string;
  resolutionCriteria: string;
  priority: string;
  labels: string[];
}

// ── the wire ─────────────────────────────────────────────────────────────────

interface WireIssue {
  id: string;
  title: string;
  summary: string;
  impact: string;
  repro: string;
  resolutionCriteria: string;
  status: string;
  priority: string;
  assignee: string | null;
  labels: string[];
  createdBy: string;
  createdAt: string;
}

interface WireComment {
  id: string;
  issueId: string;
  author: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

/** A u64 as the wire carries it (a decimal string) as a number: milliseconds and counts fit. */
function int(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

export function fromWireIssue(w: WireIssue): IssueView {
  return {
    id: w.id,
    title: w.title,
    summary: w.summary,
    impact: w.impact,
    repro: w.repro,
    resolution_criteria: w.resolutionCriteria,
    status: w.status,
    priority: w.priority,
    assignee: w.assignee,
    labels: w.labels,
    created_by: w.createdBy,
    created_at: int(w.createdAt),
  };
}

export function fromWireComment(w: WireComment): CommentView {
  return {
    id: w.id,
    issue_id: w.issueId,
    author: w.author,
    body: w.body,
    created_at: int(w.createdAt),
    edited_at: w.editedAt === null ? null : int(w.editedAt),
  };
}

// ── answers, in the screens' shapes ──────────────────────────────────────────

/** `listIssues`'s answer. */
export const toIssues = (v: unknown): IssueView[] => (v as WireIssue[]).map(fromWireIssue);

/** `getIssue`'s answer. */
export function toIssueDetail(v: unknown): IssueDetail {
  const d = v as { issue: WireIssue; comments: WireComment[] };
  return { issue: fromWireIssue(d.issue), comments: d.comments.map(fromWireComment) };
}

/** `getStatusCounts`'s answer. */
export const toStatusCounts = (v: unknown): StatusCount[] =>
  (v as Array<{ status: string; count: string }>).map((c) => ({ status: c.status, count: int(c.count) }));

/** `getRepoInfo`'s answer. */
export const toRepoInfo = (v: unknown): { repoUrl: string } => v as { repoUrl: string };
