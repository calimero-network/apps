import { useEffect, useState } from "react";
import { listGroupMembers } from "../api/rpc";

/**
 * Whether `account` is an Admin of `groupId`: `true`, `false`, or `null` while
 * the member list has not come back (or could not be read).
 *
 * It decides which of Delete and Leave a member is offered: an admin deletes a
 * team or a board, everyone else leaves it. Unknown offers neither, rather than
 * a control the node would refuse.
 */
export function useIsGroupAdmin(groupId: string | null | undefined, account: string): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    setIsAdmin(null);
    if (!groupId || !account) return;
    let cancelled = false;
    listGroupMembers(groupId)
      .then(({ members }) => {
        if (!cancelled) setIsAdmin(members.some((m) => m.identity === account && m.role === "Admin"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [groupId, account]);

  return isAdmin;
}
