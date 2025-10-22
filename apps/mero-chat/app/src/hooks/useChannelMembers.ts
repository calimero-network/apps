import { useState, useCallback } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { ResponseData } from "@calimero-network/calimero-client";
import { log } from "../utils/logger";

/**
 * Custom hook for managing channel-specific members and non-invited users
 */
export function useChannelMembers() {
  const [channelUsers, setChannelUsers] = useState<Map<string, string>>(new Map());
  const [nonInvitedUsers, setNonInvitedUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChannelMembers = useCallback(async (channelId: string) => {
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
  }, []);

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

  const fetchBoth = useCallback(async (channelId: string) => {
    await Promise.all([
      fetchChannelMembers(channelId),
      fetchNonInvitedUsers(channelId),
    ]);
  }, [fetchChannelMembers, fetchNonInvitedUsers]);

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

