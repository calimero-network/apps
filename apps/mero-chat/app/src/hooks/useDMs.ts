import { useState, useCallback, useRef } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { DMChatInfo } from "../api/clientApi";
import { log } from "../utils/logger";

/**
 * Simplified DM hook - no debouncing, just direct fetching
 * Debouncing is handled by the callers
 */
export function useDMs() {
  const [dms, setDms] = useState<DMChatInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Simple, stable fetch function
  const fetchDms = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response: ResponseData<DMChatInfo[]> =
        await new ClientApiDataSource().getDms();
      
      if (response.data) {
        setDms(response.data);
        return response.data;
      } else if (response.error) {
        setError(response.error.message || "Failed to fetch DMs");
        return [];
      }
    } catch (err) {
      log.error("DMs", "Error fetching DMs", err);
      setError("Failed to fetch DMs");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    dms,
    loading,
    error,
    fetchDms,
  };
}
