import { useOutletContext } from 'react-router-dom';
import type { UseCrmReturn } from '../../hooks/useCrm';
import type { UseWorkspaceReturn } from '../../hooks/useWorkspace';
import type { UseAliasesReturn } from '../../hooks/useAliases';

export interface NewDealDefaults {
  stageId?: string;
  contactId?: string;
}

/** Everything the routed CRM views read, passed down via <Outlet context>. */
export interface AppCtx {
  data: UseCrmReturn;
  /** Account id: what `created_by` / `author` hold. Authorship gates use this. */
  currentUser: string;
  /** The signed-in member's display name. */
  myName: string;
  /** The signed-in member's account — what a new `owner` holds. */
  myOwner: string;
  /** Owner values for pickers (member accounts, plus legacy stored names);
   *  label each with `aliases.ownerName`. */
  ownerOptions: string[];
  members: string[];
  aliases: UseAliasesReturn;
  /** '' = everyone; otherwise a display name (compare `aliases.ownerName(owner)`). Applies to board, deals, activities. */
  ownerFilter: string;
  setOwnerFilter: (owner: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  openNewDeal: (defaults?: NewDealDefaults) => void;
  openInvite: () => void;
  ws: UseWorkspaceReturn;
}

export function useAppCtx(): AppCtx {
  return useOutletContext<AppCtx>();
}
