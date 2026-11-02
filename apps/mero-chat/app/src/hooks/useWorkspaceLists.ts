import { useCallback, useMemo } from "react";

import { selfAccount } from "../calimero/connection";
import { useWorkspace } from "../calimero/WorkspaceProvider";
import type { DMContextInfo, GroupContextChannel, SubgroupEntry } from "../types/Common";
import { shortAccount } from "../utils/accountIdentity";

/**
 * The workspace's channels, DMs and members in the shapes the sidebar and
 * `Home` were written for (v1's `useGroupContexts`, `useDMs`,
 * `useGroupMembers`), from `WorkspaceProvider`. Every conversation listed is
 * one the account reaches, so each is "joined" and its identity is the
 * account; there are no subgroups.
 */
export function useWorkspaceLists() {
  const ws = useWorkspace();
  const me = selfAccount();
  const nameOf = useCallback(
    (account: string) => ws.members.find((m) => m.account === account)?.name || "",
    [ws.members],
  );

  const channels: GroupContextChannel[] = useMemo(
    () =>
      ws.conversations
        .filter((c) => c.kind !== "dm")
        .map((c) => ({
          contextId: c.appId,
          alias: c.name,
          info: { name: c.name, context_type: "Channel" as const, creator: c.owner },
          visibility: c.kind === "private" ? ("restricted" as const) : ("open" as const),
          contextIdentity: me,
          isJoined: true,
        })),
    [ws.conversations, me],
  );

  const dms: DMContextInfo[] = useMemo(
    () =>
      ws.conversations
        .filter((c) => c.kind === "dm")
        .map((c) => {
          const other = c.name;
          const otherName = nameOf(other);
          return {
            contextId: c.appId,
            alias: otherName || shortAccount(other),
            info: { name: otherName, context_type: "Dm" as const, creator: c.owner },
            visibility: "restricted" as const,
            contextIdentity: me,
            isJoined: true,
            otherUsername: otherName,
            otherAlias: otherName,
            otherIdentity: other,
            myIdentity: me,
            namespaceMemberIdentity: other,
          };
        }),
    [ws.conversations, me, nameOf],
  );

  const refresh = ws.refresh;

  const groupContextsHook = useMemo(
    () => ({
      channels,
      subgroups: [] as SubgroupEntry[],
      channelsBySubgroup: new Map<string, GroupContextChannel[]>(),
      getSubgroupForContext: (_contextId: string): string | undefined => undefined,
      getIdentity: (_contextId: string): string => me,
      fetchGroupContexts: (_org?: string) => refresh(),
      removeChannel: (_contextId: string) => void refresh(),
      unblockChannel: (_contextId: string) => void refresh(),
    }),
    [channels, me, refresh],
  );

  const dmsHook = useMemo(
    () => ({
      dms,
      fetchDms: async (_org?: string): Promise<DMContextInfo[]> => {
        await refresh();
        return dms;
      },
    }),
    [dms, refresh],
  );

  const groupMembersHook = useMemo(
    () => ({
      members: ws.members.map((m) => ({ identity: m.account, alias: m.name })),
      fetchGroupMembers: (_org?: string) => refresh(),
    }),
    [ws.members, refresh],
  );

  /** The members a DM can be started with: everyone but the caller, by name. */
  const dmMembers = useMemo(
    () =>
      new Map(
        ws.members
          .filter((m) => m.account !== me)
          .map((m) => [m.account, m.name || shortAccount(m.account)] as [string, string]),
      ),
    [ws.members, me],
  );

  return { ws, groupContextsHook, dmsHook, groupMembersHook, dmMembers };
}

/** A DM's display name: the other person's name, else a short account. */
export function getDmDisplayName(params: {
  otherUsername?: string;
  otherAlias?: string;
  otherIdentity?: string;
  contextId: string;
}): string {
  return params.otherUsername || params.otherAlias || shortAccount(params.otherIdentity);
}
