import type { CalimeroClient } from '@calimero-network/mero-js';

/**
 * The contract's methods by their ABI names (camelCase), split the way the node
 * runs them: a call goes through the app's log, a view is answered by a node
 * without writing. `tracker.test.ts` asserts these lists are exactly the
 * committed `logic/res/abi.json`'s, so a method the contract drops or renames
 * fails a test rather than a request.
 */
export const CALLS = [
  'setRepoUrl',
  'createIssue',
  'setStatus',
  'setSummary',
  'setImpact',
  'setRepro',
  'setResolutionCriteria',
  'setPriority',
  'setAssignee',
  'addLabel',
  'removeLabel',
  'addComment',
  'editComment',
  'deleteComment',
  'deleteIssue',
] as const;
export const VIEWS = ['getRepoInfo', 'listIssues', 'getIssue', 'getStatusCounts'] as const;

export type Call = (typeof CALLS)[number];
export type View = (typeof VIEWS)[number];

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

// ── the client ───────────────────────────────────────────────────────────────

/** The board, typed from the contract (no client is generated from a component ABI yet). */
export interface Tracker {
  setRepoUrl(url: string): Promise<void>;
  getRepoInfo(): Promise<{ repoUrl: string }>;
  /** The new issue's id. */
  createIssue(issue: NewIssue): Promise<string>;
  setStatus(issueId: string, status: string): Promise<void>;
  setSummary(issueId: string, summary: string): Promise<void>;
  setImpact(issueId: string, impact: string): Promise<void>;
  setRepro(issueId: string, repro: string): Promise<void>;
  setResolutionCriteria(issueId: string, resolutionCriteria: string): Promise<void>;
  setPriority(issueId: string, priority: string): Promise<void>;
  setAssignee(issueId: string, assignee: string | null): Promise<void>;
  addLabel(issueId: string, label: string): Promise<void>;
  removeLabel(issueId: string, label: string): Promise<void>;
  /** Oldest first, at most the first 1,000 matches; `null` is no filter. */
  listIssues(filter: { status: string | null; assignee: string | null; label: string | null }): Promise<IssueView[]>;
  /** `AppError` `NotFound` for an unknown issue. */
  getIssue(issueId: string): Promise<IssueDetail>;
  /** Column order: Open, In progress, Blocked, Done. */
  getStatusCounts(): Promise<StatusCount[]>;
  /** The new comment's id. */
  addComment(issueId: string, body: string): Promise<string>;
  /** `AppError` `Forbidden` for anyone but the author. */
  editComment(commentId: string, newBody: string): Promise<void>;
  deleteComment(commentId: string): Promise<void>;
  /** `AppError` `Forbidden` for anyone but the creator. */
  deleteIssue(issueId: string): Promise<void>;
}

export type Transport = Pick<CalimeroClient, 'call' | 'view'>;

/**
 * The board at app instance `app` through `client`. `after` runs after every
 * request (the session store keeps a refreshed session there).
 */
export function tracker(client: Transport, app: string, after: () => void = () => {}): Tracker {
  const call = async <T>(method: Call, args: Record<string, unknown> = {}): Promise<T> => {
    try {
      return (await client.call(app, method, args)).result as T;
    } finally {
      after();
    }
  };
  const view = async <T>(method: View, args: Record<string, unknown> = {}): Promise<T> => {
    try {
      return (await client.view(app, method, args)).result as T;
    } finally {
      after();
    }
  };
  const done = async (p: Promise<unknown>): Promise<void> => {
    await p;
  };
  return {
    setRepoUrl: (url) => done(call('setRepoUrl', { url })),
    getRepoInfo: () => view('getRepoInfo'),
    createIssue: (i) =>
      call('createIssue', {
        title: i.title,
        summary: i.summary,
        impact: i.impact,
        repro: i.repro,
        resolutionCriteria: i.resolutionCriteria,
        priority: i.priority,
        labels: i.labels,
      }),
    setStatus: (issueId, status) => done(call('setStatus', { issueId, status })),
    setSummary: (issueId, summary) => done(call('setSummary', { issueId, summary })),
    setImpact: (issueId, impact) => done(call('setImpact', { issueId, impact })),
    setRepro: (issueId, repro) => done(call('setRepro', { issueId, repro })),
    setResolutionCriteria: (issueId, resolutionCriteria) =>
      done(call('setResolutionCriteria', { issueId, resolutionCriteria })),
    setPriority: (issueId, priority) => done(call('setPriority', { issueId, priority })),
    setAssignee: (issueId, assignee) => done(call('setAssignee', { issueId, assignee })),
    addLabel: (issueId, label) => done(call('addLabel', { issueId, label })),
    removeLabel: (issueId, label) => done(call('removeLabel', { issueId, label })),
    listIssues: async (filter) =>
      (await view<WireIssue[]>('listIssues', { ...filter })).map(fromWireIssue),
    getIssue: async (issueId) => {
      const d = await view<{ issue: WireIssue; comments: WireComment[] }>('getIssue', { issueId });
      return { issue: fromWireIssue(d.issue), comments: d.comments.map(fromWireComment) };
    },
    getStatusCounts: async () =>
      (await view<Array<{ status: string; count: string }>>('getStatusCounts')).map((c) => ({
        status: c.status,
        count: int(c.count),
      })),
    addComment: (issueId, body) => call('addComment', { issueId, body }),
    editComment: (commentId, newBody) => done(call('editComment', { commentId, newBody })),
    deleteComment: (commentId) => done(call('deleteComment', { commentId })),
    deleteIssue: (issueId) => done(call('deleteIssue', { issueId })),
  };
}
