import type { IssueView } from '../hooks/useItems';

/** Case-insensitive substring match over title, the four text sections, id, and
 *  labels. Purely client-side (there is no server text-search param). An empty
 *  (or whitespace-only) query matches everything. */
export function matchesQuery(issue: IssueView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    issue.id.toLowerCase().includes(q) ||
    issue.title.toLowerCase().includes(q) ||
    issue.summary.toLowerCase().includes(q) ||
    issue.impact.toLowerCase().includes(q) ||
    issue.repro.toLowerCase().includes(q) ||
    issue.resolution_criteria.toLowerCase().includes(q) ||
    issue.labels.some((l) => l.toLowerCase().includes(q))
  );
}
