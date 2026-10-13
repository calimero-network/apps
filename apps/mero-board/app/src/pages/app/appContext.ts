import { useOutletContext } from 'react-router-dom';
import type { UseWorkspaceReturn } from '../../hooks/useWorkspace';
import type { UseAliasesReturn } from '../../hooks/useAliases';

/** Everything the routed views read, passed down via <Outlet context>. */
export interface AppCtx {
  currentUser: string;
  members: string[];
  aliases: UseAliasesReturn;
  openInvite: () => void;
  ws: UseWorkspaceReturn;
}

export function useAppCtx(): AppCtx {
  return useOutletContext<AppCtx>();
}
