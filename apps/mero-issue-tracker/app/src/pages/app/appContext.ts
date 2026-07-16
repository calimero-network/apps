import { useOutletContext } from 'react-router-dom';
import type { UseIssuesReturn } from '../../hooks/useItems';
import type { UseWorkspaceReturn } from '../../hooks/useWorkspace';
import type { UseAliasesReturn } from '../../hooks/useAliases';

export interface Filters {
  status: string;
  priority: string;
  assignee: string;
  label: string;
}

/** Everything the routed tracker views read, passed down via <Outlet context>. */
export interface AppCtx {
  data: UseIssuesReturn;
  currentUser: string;
  members: string[];
  aliases: UseAliasesReturn;
  filters: Filters;
  /** True when the `?assignee=me` view is active (filters by current user). */
  myIssues: boolean;
  setFilter: (patch: Partial<Filters>) => void;
  clearFilters: () => void;
  openNewIssue: () => void;
  openInvite: () => void;
  ws: UseWorkspaceReturn;
}

export function useAppCtx(): AppCtx {
  return useOutletContext<AppCtx>();
}
