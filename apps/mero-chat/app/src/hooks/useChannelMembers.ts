import { useState, useCallback } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import type { ResponseData } from "../api/types";
import { log } from "../utils/logger";

/**
 * Custom hook for managing channel-specific members and non-invited users
 */
export function useChannelMembers() {
  const [channelUsers, setChannelUsers] = useState<Map<string, string>>(
    new Map(),
  );
  const [nonInvitedUsers, setNonInvitedUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When `subgroupId` is provided, the SUBGROUP's `listMembers` is the
  // canonical source — it includes every direct member, including those
  // who joined but haven't yet called `set_profile`. Trade-offs:
  //
  // * For **joiners** (anyone added by an admin / who explicitly joined),
  //   `join_context.rs:124` keys their `ContextIdentity` row by their
  //   namespace identity (`resolve_namespace_identity`). So
  //   `listMembers.identity === executor_id` and Ban / set_member_role
  //   work as expected when targeting that key.
  // * For the **creator** (admin), `createContext` generates a fresh
  //   per-context identity, so their listMembers identity ≠ context
  //   identity. The UI already gates Ban / role actions behind
  //   `!isSelf && !isOwnerRow`, so this mismatch never reaches a real
  //   WASM call.
  //
  // Display-name chain (richest first):
  //   1. context profile username  (from `get_profiles`)
  //   2. subgroup member alias
  //   3. namespace member alias    (e.g. "NodeUser" — workspace handle)
  //   4. raw identity              (last resort)
  //
  // Legacy fallback: when `subgroupId` is unavailable (DMs routed through
  // this path), use `get_profiles` alone.
  const fetchChannelMembers = useCallback(
    async (
      channelId: string,
      subgroupId?: string,
      namespaceId?: string,
    ) => {
      setLoading(true);
      setError(null);

      try {
        if (subgroupId) {
          const groupApi = new GroupApiDataSource();
          const clientApi = new ClientApiDataSource();
          const [membersResp, profilesResp, namespaceMembersResp] =
            await Promise.all([
              groupApi.listMembers(subgroupId),
              clientApi.getChannelMembers({ channel: { name: channelId } }),
              namespaceId ? groupApi.listMembers(namespaceId) : Promise.resolve(null),
            ]);

          if (membersResp.error || !membersResp.data) {
            setError(
              membersResp.error?.message || "Failed to fetch subgroup members",
            );
            return;
          }

          const profileUsernameByIdentity =
            profilesResp.data ?? new Map<string, string>();
          const namespaceAliasByIdentity = new Map<string, string>();
          if (namespaceMembersResp?.data?.members) {
            namespaceMembersResp.data.members.forEach((m) => {
              const alias = m.alias?.trim();
              if (alias) namespaceAliasByIdentity.set(m.identity, alias);
            });
          }

          const memberMap = new Map<string, string>();
          membersResp.data.members.forEach((m) => {
            const display =
              profileUsernameByIdentity.get(m.identity) ||
              m.alias?.trim() ||
              namespaceAliasByIdentity.get(m.identity) ||
              "Unnamed member";
            memberMap.set(m.identity, display);
          });
          setChannelUsers(memberMap);
          return;
        }

        const response: ResponseData<Map<string, string>> =
          await new ClientApiDataSource().getChannelMembers({
            channel: { name: channelId },
          });

        if (response.data) {
          setChannelUsers(response.data);
        } else if (response.error) {
          setError(response.error.message || "Failed to fetch channel members");
        }
      } catch (err) {
        log.error("ChannelMembers", "Error fetching channel members", err);
        setError("Failed to fetch channel members");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchNonInvitedUsers = useCallback(async (channelId: string) => {
    setLoading(true);
    setError(null);

    try {
      const response: ResponseData<string[]> =
        await new ClientApiDataSource().getNonMemberUsers({
          channel: { name: channelId },
        });

      if (response.data) {
        setNonInvitedUsers(response.data);
      } else if (response.error) {
        setError(response.error.message || "Failed to fetch non-invited users");
      }
    } catch (err) {
      log.error("ChannelMembers", "Error fetching non-invited users", err);
      setError("Failed to fetch non-invited users");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBoth = useCallback(
    async (channelId: string, subgroupId?: string, namespaceId?: string) => {
      await Promise.all([
        fetchChannelMembers(channelId, subgroupId, namespaceId),
        fetchNonInvitedUsers(channelId),
      ]);
    },
    [fetchChannelMembers, fetchNonInvitedUsers],
  );

  return {
    channelUsers,
    nonInvitedUsers,
    loading,
    error,
    fetchChannelMembers,
    fetchNonInvitedUsers,
    fetchBoth,
  };
}
