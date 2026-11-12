/**
 * The board's contract is called through `MeroIssueTrackerClient`, which
 * `mero-app-build codegen` writes from logic/res/abi.json
 * (`src/generated/client.ts`), which types its records from the ABI; each
 * answer passes through the `fromWire*` / `to*` below into the shapes the
 * screens use.
 */

import type {
  Comment as WireComment,
  IssueDetail as WireIssueDetail,
  IssueView as WireIssue,
  RepoInfo,
  StatusCount as WireStatusCount,
} from './generated/client';

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

// ── the wire: the generated client's types (camelCase, u64 as a decimal string) ──

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
export const toIssues = (v: WireIssue[]): IssueView[] => v.map(fromWireIssue);

/** `getIssue`'s answer. */
export function toIssueDetail(d: WireIssueDetail): IssueDetail {
  return { issue: fromWireIssue(d.issue), comments: d.comments.map(fromWireComment) };
}

/** `getStatusCounts`'s answer. */
export const toStatusCounts = (v: WireStatusCount[]): StatusCount[] =>
  v.map((c) => ({ status: c.status, count: int(c.count) }));

/** `getRepoInfo`'s answer. */
export const toRepoInfo = (v: RepoInfo): { repoUrl: string } => v;
