/**
 * useIssues — data binding for the shared issue board (mero-react v4).
 *
 * The canonical Calimero pattern:
 *  - `useWorkspace()` resolves the shared context + executor identity.
 *  - the generated `IssueTrackerClient` wraps `mero.rpc.execute`.
 *  - `useSubscription([contextId])` re-fetches on every sync event, so issues,
 *    counts, and comments from other peers appear live with no polling.
 *
 * The board reads `issues` (server-filtered via list_issues) + `counts`
 * (get_status_counts), and every mutation refetches so the UI never lags.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMero, useSubscription } from '@calimero-network/mero-react';
import {
  IssueTrackerClient,
  IssueView,
  CommentView,
  IssueDetail,
} from '../generated/IssueTrackerClient';

export type { IssueView, CommentView, IssueDetail };

export interface IssueFilters {
  status: string;
  assignee: string;
  label: string;
}

export interface UseIssuesArgs {
  contextId: string | null;
  executorPublicKey: string | null;
  filters: IssueFilters;
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

export function useIssues({
  contextId,
  executorPublicKey,
  filters,
}: UseIssuesArgs): UseIssuesReturn {
  const { mero } = useMero();
  const [issues, setIssues] = useState<IssueView[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Memoized typed client — null until the context + identity resolve.
  const client = useMemo(
    () =>
      mero && contextId && executorPublicKey
        ? new IssueTrackerClient(mero, contextId, executorPublicKey)
        : null,
    [mero, contextId, executorPublicKey],
  );

  const { status, assignee, label } = filters;

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const [list, statusCounts] = await Promise.all([
        client.listIssues({
          status: status || null,
          assignee: assignee || null,
          label: label || null,
        }),
        client.getStatusCounts(),
      ]);
      setIssues(list);
      setCounts(
        Object.fromEntries(statusCounts.map((c) => [c.status, c.count])),
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, status, assignee, label]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates: re-fetch on any sync event for this context (local or remote).
  useSubscription(contextId ? [contextId] : [], () => {
    void refresh();
  });

  const createIssue = useCallback(
    async (
      title: string,
      summary: string,
      impact: string,
      repro: string,
      resolutionCriteria: string,
      priority: string,
      labels: string[],
    ) => {
      if (!client) return;
      await client.createIssue({
        title,
        summary,
        impact,
        repro,
        resolution_criteria: resolutionCriteria,
        priority,
        labels,
      });
      await refresh();
    },
    [client, refresh],
  );

  const setStatus = useCallback(
    async (issueId: string, next: string) => {
      if (!client) return;
      await client.setStatus({ issue_id: issueId, status: next });
      await refresh();
    },
    [client, refresh],
  );

  const setSummary = useCallback(
    async (issueId: string, next: string) => {
      if (!client) return;
      await client.setSummary({ issue_id: issueId, summary: next });
      await refresh();
    },
    [client, refresh],
  );

  const setImpact = useCallback(
    async (issueId: string, next: string) => {
      if (!client) return;
      await client.setImpact({ issue_id: issueId, impact: next });
      await refresh();
    },
    [client, refresh],
  );

  const setRepro = useCallback(
    async (issueId: string, next: string) => {
      if (!client) return;
      await client.setRepro({ issue_id: issueId, repro: next });
      await refresh();
    },
    [client, refresh],
  );

  const setResolutionCriteria = useCallback(
    async (issueId: string, next: string) => {
      if (!client) return;
      await client.setResolutionCriteria({ issue_id: issueId, resolution_criteria: next });
      await refresh();
    },
    [client, refresh],
  );

  const setPriority = useCallback(
    async (issueId: string, next: string) => {
      if (!client) return;
      await client.setPriority({ issue_id: issueId, priority: next });
      await refresh();
    },
    [client, refresh],
  );

  const setAssignee = useCallback(
    async (issueId: string, next: string | null) => {
      if (!client) return;
      await client.setAssignee({ issue_id: issueId, assignee: next });
      await refresh();
    },
    [client, refresh],
  );

  const addLabel = useCallback(
    async (issueId: string, lbl: string) => {
      if (!client) return;
      await client.addLabel({ issue_id: issueId, label: lbl });
      await refresh();
    },
    [client, refresh],
  );

  const removeLabel = useCallback(
    async (issueId: string, lbl: string) => {
      if (!client) return;
      await client.removeLabel({ issue_id: issueId, label: lbl });
      await refresh();
    },
    [client, refresh],
  );

  const getIssue = useCallback(
    async (issueId: string) => {
      if (!client) throw new Error('Workspace not ready');
      return client.getIssue({ issue_id: issueId });
    },
    [client],
  );

  const deleteIssue = useCallback(
    async (issueId: string) => {
      if (!client) return;
      await client.deleteIssue({ issue_id: issueId });
      await refresh();
    },
    [client, refresh],
  );

  const addComment = useCallback(
    async (issueId: string, body: string) => {
      if (!client) return;
      await client.addComment({ issue_id: issueId, body });
      await refresh();
    },
    [client, refresh],
  );

  const editComment = useCallback(
    async (commentId: string, newBody: string) => {
      if (!client) return;
      await client.editComment({ comment_id: commentId, new_body: newBody });
      await refresh();
    },
    [client, refresh],
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!client) return;
      await client.deleteComment({ comment_id: commentId });
      await refresh();
    },
    [client, refresh],
  );

  return {
    issues,
    counts,
    loading,
    error,
    ready: client !== null,
    refresh,
    createIssue,
    setStatus,
    setSummary,
    setImpact,
    setRepro,
    setResolutionCriteria,
    setPriority,
    setAssignee,
    addLabel,
    removeLabel,
    getIssue,
    deleteIssue,
    addComment,
    editComment,
    deleteComment,
  };
}
