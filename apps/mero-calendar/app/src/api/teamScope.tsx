import { createContext, useContext } from "react";

/**
 * What the open team (an org) says about its people, for screens deep in the
 * calendar: the name each member set on the team (org member metadata). The
 * calendar page provides it; outside one it is empty.
 */
export interface TeamScope {
  names: Map<string, string>;
}

export const TeamScopeContext = createContext<TeamScope>({ names: new Map() });

export function useTeamScope(): TeamScope {
  return useContext(TeamScopeContext);
}
