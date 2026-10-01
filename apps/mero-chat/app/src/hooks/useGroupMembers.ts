import { useState, useCallback } from "react";
import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import type { GroupMember } from "../api/groupApi";
import { log } from "../utils/logger";

export function useGroupMembers() {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGroupMembers = useCallback(async (groupId: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await new GroupApiDataSource().listMembers(groupId);

      if (response.data) {
        setMembers(response.data.members);
      } else if (response.error) {
        setError(
          response.error.message || "Failed to fetch group members",
        );
      }
    } catch (err) {
      log.error("GroupMembers", "Error fetching group members", err);
      setError("Failed to fetch group members");
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    members,
    loading,
    error,
    fetchGroupMembers,
  };
}
