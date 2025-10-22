import { useState, useCallback } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { Channels } from "../api/clientApi";
import type { ChannelMeta } from "../types/Common";
import { log } from "../utils/logger";

/**
 * Simplified Channels hook - no debouncing, just direct fetching
 * Debouncing is handled by the callers
 */
export function useChannels() {
  const [channels, setChannels] = useState<ChannelMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response: ResponseData<Channels> =
        await new ClientApiDataSource().getChannels();

      if (response.data) {
        const channelsArray: ChannelMeta[] = Object.entries(response.data).map(
          ([name, channelInfo]) => ({
            name,
            type: "channel" as const,
            channelType: channelInfo.channel_type,
            description: "",
            owner: channelInfo.created_by,
            createdByUsername: channelInfo.created_by_username,
            members: [],
            createdBy: channelInfo.created_by,
            inviteOnly: false,
            unreadMessages: {
              count: channelInfo.unread_count,
              mentions: channelInfo.unread_mention_count,
            },
            isMember: false,
            readOnly: channelInfo.read_only,
            createdAt: new Date(channelInfo.created_at * 1000).toISOString(),
          }),
        );
        setChannels(channelsArray);
      } else if (response.error) {
        setError(response.error.message || "Failed to fetch channels");
      }
    } catch (err) {
      log.error("Channels", "Error fetching channels", err);
      setError("Failed to fetch channels");
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    channels,
    loading,
    error,
    fetchChannels,
  };
}
