import { useState, useCallback } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import type { ResponseData } from "../api/types";
import { log } from "../utils/logger";
import { nameRepository } from "../repositories/names/useNames";

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

  // Who is in the channel comes from the channel's own member list (with
  // `subgroupId`) or its roster; what each is called comes from
  // `nameRepository`, by account: the workspace's member metadata, the one
  // place a name lives. Nothing here reads the contract's profiles.
  const fetchChannelMembers = useCallback(
    async (channelId: string, subgroupId?: string) => {
      setLoading(true);
      setError(null);

      try {
        if (subgroupId) {
          const groupApi = new GroupApiDataSource();
          const membersResp = await groupApi.listMembers(subgroupId);

          if (membersResp.error || !membersResp.data) {
            setError(
              membersResp.error?.message || "Failed to fetch subgroup members",
            );
            return;
          }

          // Names come from the repository, not from a map assembled here.
          //
          // This used to fetch the namespace member list itself and merge it
          // with subgroup aliases and per-context WASM profiles — a second
          // cache with its own precedence, which is how the same person ended
          // up displayed differently in the member list and in the messages
          // beside it. The repository is the one resolver; its batcher turns
          // these per-member calls into a single request.
          const memberMap = new Map<string, string>();
          await Promise.all(
            membersResp.data.members.map(async (m) => {
              memberMap.set(m.identity, await nameRepository.resolve(m.identity));
            }),
          );
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
    // `namespaceId` is gone: the name repository resolves the namespace itself,
    // so callers no longer thread it through just to build a name map.
    async (channelId: string, subgroupId?: string) => {
      await Promise.all([
        fetchChannelMembers(channelId, subgroupId),
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
