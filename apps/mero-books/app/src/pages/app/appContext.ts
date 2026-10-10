import { useOutletContext } from 'react-router-dom';
import type { UseBooksReturn } from '../../hooks/useBooks';
import type { UseWorkspaceReturn } from '../../hooks/useWorkspace';
import type { UseAliasesReturn } from '../../hooks/useAliases';

/** Everything the routed accounting views read, passed down via <Outlet context>. */
export interface AppCtx {
  data: UseBooksReturn;
  /** Account id: what `approved_by` / `recorded_by` / `author` hold. */
  currentUser: string;
  /** The signed-in member's display name. */
  myName: string;
  members: string[];
  aliases: UseAliasesReturn;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  /** Today, `YYYY-MM-DD`, in the browser's calendar. */
  today: string;
  openInvite: () => void;
  ws: UseWorkspaceReturn;
}

export function useAppCtx(): AppCtx {
  return useOutletContext<AppCtx>();
}
