import { useState, useCallback } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { ResponseData } from "@calimero-network/calimero-client";
import { log } from "../utils/logger";

/**
 * Custom hook for managing chat members
 * Fetches and manages the list of all chat members
 */
export function useChatMembers() {
  const [members, setMembers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response: ResponseData<Map<string, string>> =
        await new ClientApiDataSource().getChatMembers({
          isDM: false,
        });

      if (response.data) {
        setMembers(response.data);
      } else if (response.error) {
        setError(response.error.message || "Failed to fetch chat members");
      }
    } catch (err) {
      log.error("ChatMembers", "Error fetching chat members", err);
      setError("Failed to fetch chat members");
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    members,
    loading,
    error,
    fetchMembers,
  };
}
