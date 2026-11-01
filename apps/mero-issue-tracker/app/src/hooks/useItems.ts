/**
 * useIssues: the active repository's board.
 *
 * Reads go through the typed `tracker` client (`listIssues` filtered on the
 * node, `getStatusCounts` from the contract's maintained counts); every write
 * refetches. Changes by teammates arrive on the app's event stream
 * (`client.events`), coalesced into one refetch. v1 waited for a joined
 * context's state to sync before its first read ("warming up"); an app on
 * Calimero 1.0 is read from its log, so the first read answers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalimeroClient } from '@calimero-network/mero-js';

import { tracker, type CommentView, type IssueDetail, type IssueView, type Tracker } from '../tracker';

export type { IssueView, CommentView, IssueDetail };

/** How long a burst of events is gathered into one refetch. */
export const EVENT_COALESCE_MS = 200;

export interface IssueFilters {
  status: string;
  assignee: string;
  label: string;
}

export interface UseIssuesArgs {
  client: CalimeroClient;
  /** The repository: an app instance id, or null when none is open. */
  appId: string | null;
  filters: IssueFilters;
  after?: () => void;
}

export interface UseIssuesReturn {
  issues: IssueView[];
  counts: Record<string, number>;
  loading: boolean;
  error: Error | null;
  ready: boolean;
  refresh: () => Promise<void>;
  createIssue: (
    title: string,
    summary: string,
    impact: string,
    repro: string,
    resolutionCriteria: string,
    priority: string,
    labels: string[],
  ) => Promise<void>;
  setStatus: (issueId: string, status: string) => Promise<void>;
  setSummary: (issueId: string, summary: string) => Promise<void>;
  setImpact: (issueId: string, impact: string) => Promise<void>;
  setRepro: (issueId: string, repro: string) => Promise<void>;
  setResolutionCriteria: (issueId: string, resolutionCriteria: string) => Promise<void>;
  setPriority: (issueId: string, priority: string) => Promise<void>;
  setAssignee: (issueId: string, assignee: string | null) => Promise<void>;
  addLabel: (issueId: string, label: string) => Promise<void>;
  removeLabel: (issueId: string, label: string) => Promise<void>;
  getIssue: (issueId: string) => Promise<IssueDetail>;
  deleteIssue: (issueId: string) => Promise<void>;
  addComment: (issueId: string, body: string) => Promise<void>;
  editComment: (commentId: string, newBody: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
}

/** Calls `onChange` (coalesced) for each event of `app` until the returned stop. */
export function watchEvents(client: Pick<CalimeroClient, 'events'>, app: string, onChange: () => void): () => void {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  void (async () => {
    try {
      // From the next event on: the first read already covers what came before.
      for await (const _event of client.events(app, undefined, abort.signal)) {
        clearTimeout(timer);
        timer = setTimeout(onChange, EVENT_COALESCE_MS);
      }
    } catch {
      // Stream closed (sign-out, repo left, network): the next write refetches.
    }
  })();
  return () => {
    clearTimeout(timer);
    abort.abort();
  };
}

export function useIssues({ client, appId, filters, after }: UseIssuesArgs): UseIssuesReturn {
  const [issues, setIssues] = useState<IssueView[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);

  const board: Tracker | null = useMemo(
    () => (appId ? tracker(client, appId, after) : null),
    [client, appId, after],
  );

  const { status, assignee, label } = filters;

  const refresh = useCallback(async () => {
    if (!board) return;
    // One read at a time; a request that arrives meanwhile runs once after it.
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    setLoading(true);
    try {
      const [list, statusCounts] = await Promise.all([
        board.listIssues({ status: status || null, assignee: assignee || null, label: label || null }),
        board.getStatusCounts(),
      ]);
      setIssues(list);
      setCounts(Object.fromEntries(statusCounts.map((c) => [c.status, c.count])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        void refreshRef.current();
      }
    }
  }, [board, status, assignee, label]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    setIssues([]);
    setCounts({});
  }, [board]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!appId) return;
    return watchEvents(client, appId, () => void refreshRef.current());
  }, [client, appId]);

  const write = useCallback(
    async (op: (t: Tracker) => Promise<unknown>) => {
      if (!board) return;
      await op(board);
      await refresh();
    },
    [board, refresh],
  );

  const getIssue = useCallback(
    async (issueId: string) => {
      if (!board) throw new Error('No repository is open');
      return board.getIssue(issueId);
    },
    [board],
  );

  return {
    issues,
    counts,
    loading,
    error,
    ready: board !== null,
    refresh,
    createIssue: (title, summary, impact, repro, resolutionCriteria, priority, labels) =>
      write((t) => t.createIssue({ title, summary, impact, repro, resolutionCriteria, priority, labels })),
    setStatus: (id, next) => write((t) => t.setStatus(id, next)),
    setSummary: (id, next) => write((t) => t.setSummary(id, next)),
    setImpact: (id, next) => write((t) => t.setImpact(id, next)),
    setRepro: (id, next) => write((t) => t.setRepro(id, next)),
    setResolutionCriteria: (id, next) => write((t) => t.setResolutionCriteria(id, next)),
    setPriority: (id, next) => write((t) => t.setPriority(id, next)),
    setAssignee: (id, next) => write((t) => t.setAssignee(id, next)),
    addLabel: (id, l) => write((t) => t.addLabel(id, l)),
    removeLabel: (id, l) => write((t) => t.removeLabel(id, l)),
    getIssue,
    deleteIssue: (id) => write((t) => t.deleteIssue(id)),
    addComment: (id, body) => write((t) => t.addComment(id, body)),
    editComment: (id, body) => write((t) => t.editComment(id, body)),
    deleteComment: (id) => write((t) => t.deleteComment(id)),
  };
}
