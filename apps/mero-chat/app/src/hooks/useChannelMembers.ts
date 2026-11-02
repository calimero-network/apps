import { useState, useCallback } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
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
  // Display-name chain (authoritative first):
  //   1. namespace member alias    — the live, renameable, governance-replicated
  //                                  name; the single source of truth
  //   2. subgroup member alias     — snapshot, scoped to one subgroup
  //   3. context profile username  — snapshot, scoped to one context
  //                                  (`get_profiles`)
  //   4. raw identity              — last resort
  //
  // 2 and 3 are kept only because they can be present before governance sync
  // delivers the member list. They must never outrank 1, or a rename lands in
  // some views and not others.
  //
  // Legacy fallback: when `subgroupId` is unavailable (DMs routed through
  // this path), use `get_profiles` alone.
  const fetchChannelMembers = useCallback(
    async (channelId: string, _subgroupId?: string) => {
      setLoading(true);
      setError(null);

      try {
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
