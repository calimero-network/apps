import { useState, useCallback } from "react";
import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import type { GroupInfo } from "../api/groupApi";
import { log } from "../utils/logger";

export function useGroup() {
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGroup = useCallback(async (groupId: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await new GroupApiDataSource().getGroup(groupId);

      if (response.data) {
        setGroup(response.data);
      } else if (response.error) {
        setError(response.error.message || "Failed to fetch group");
      }
    } catch (err) {
      log.error("Group", "Error fetching group", err);
      setError("Failed to fetch group");
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    group,
    loading,
    error,
    fetchGroup,
  };
}
