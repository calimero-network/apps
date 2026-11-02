import { useEffect, useState } from "react";
import { isTeamAdminRole, myTeamRole } from "../api/rpc";

/**
 * Whether the signed-in account is an owner or admin of the team `groupId` (an
 * org): `true`, `false`, or `null` while the answer has not come back (or
 * could not be read).
 *
 * It decides which of Delete and Leave a member is offered: an admin deletes a
 * team, everyone else leaves it. Unknown offers neither, rather than a control
 * the node would refuse.
 */
export function useIsGroupAdmin(groupId: string | null | undefined, account: string): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    setIsAdmin(null);
    if (!groupId || !account) return;
    let cancelled = false;
    myTeamRole(groupId)
      .then((role) => {
        if (!cancelled) setIsAdmin(isTeamAdminRole(role));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [groupId, account]);

  return isAdmin;
}
