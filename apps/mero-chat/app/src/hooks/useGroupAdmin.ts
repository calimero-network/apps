import { useState, useCallback } from "react";
import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type {
  GroupInfo,
  GroupMember,
  GroupUpgradeStatus,
  MemberCapabilities,
  ContextVisibility,
  VisibilityMode,
} from "../api/groupApi";
import { log } from "../utils/logger";
import { getGroupMemberIdentity } from "../constants/config";

export interface GroupAdminState {
  group: GroupInfo | null;
  members: GroupMember[];
  upgradeStatus: GroupUpgradeStatus | null;
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
}

export function useGroupAdmin() {
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [subgroupCount, setSubgroupCount] = useState<number | null>(null);
  const [upgradeStatus, setUpgradeStatus] =
    useState<GroupUpgradeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = new GroupApiDataSource();

  const fetchAll = useCallback(async (groupId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [groupResp, membersResp, subgroupsResp, upgradeResp] = await Promise.all([
        api.getGroup(groupId),
        api.listMembers(groupId),
        api.listSubgroups(groupId),
        api.getUpgradeStatus(groupId),
      ]);

      if (groupResp.data) setGroup(groupResp.data);
      if (membersResp.data) setMembers(membersResp.data.members);
      if (subgroupsResp.data) setSubgroupCount(subgroupsResp.data.length);
      if (upgradeResp.data !== undefined) setUpgradeStatus(upgradeResp.data);

      const firstError =
        groupResp.error?.message ||
        membersResp.error?.message;
      if (firstError) setError(firstError);
    } catch (err) {
      log.error("useGroupAdmin", "Failed to fetch admin data", err);
      setError("Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, []);

  const removeMember = useCallback(
    async (groupId: string, memberIdentity: string) => {
      setActionLoading(true);
      setError(null);
      try {
        const resp = await api.removeMember(groupId, memberIdentity);
        if (resp.error) {
          setError(resp.error.message);
          return false;
        }
        setMembers((prev) =>
          prev.filter((m) => m.identity !== memberIdentity),
        );

        // Ban the kicked member in all group contexts so WASM rejects their writes.
        void (async () => {
          try {
            const contextsResp = await api.listGroupContexts(groupId);
            if (!contextsResp.data || contextsResp.data.length === 0) return;
            const myExecutorKey = getGroupMemberIdentity(groupId);
            if (!myExecutorKey) return;
            const clientApi = new ClientApiDataSource();
            await Promise.allSettled(
              contextsResp.data.map((ctx) =>
                clientApi.setMemberRole({
                  contextId: ctx.contextId,
                  executorPublicKey: myExecutorKey,
                  target: memberIdentity,
                  role: "Banned",
                }),
              ),
            );
          } catch (banErr) {
            log.warn("useGroupAdmin", "Cross-context ban after removeMember failed (non-fatal)", banErr);
          }
        })();

        return true;
      } catch (err) {
        log.error("useGroupAdmin", "Failed to remove member", err);
        setError("Failed to remove member");
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [],
  );

  const setMemberCapabilities = useCallback(
    async (
      groupId: string,
      identity: string,
      capabilities: number,
    ): Promise<boolean> => {
      setActionLoading(true);
      setError(null);
      try {
        const resp = await api.setMemberCapabilities(groupId, identity, {
          capabilities,
        });
        if (resp.error) {
          setError(resp.error.message);
          return false;
        }
        return true;
      } catch (err) {
        log.error("useGroupAdmin", "Failed to set capabilities", err);
        setError("Failed to set capabilities");
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [],
  );

  const setMemberMetadata = useCallback(
    async (
      groupId: string,
      identity: string,
      alias: string,
    ): Promise<boolean> => {
      setActionLoading(true);
      setError(null);
      try {
        const resp = await api.setMemberMetadata(groupId, identity, { name: alias });
        if (resp.error) {
          setError(resp.error.message);
          return false;
        }
        setMembers((prev) =>
          prev.map((member) =>
            member.identity === identity ? { ...member, alias } : member,
          ),
        );
        return true;
      } catch (err) {
        log.error("useGroupAdmin", "Failed to set member alias", err);
        setError("Failed to set member alias");
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [],
  );

  const getMemberCapabilities = useCallback(
    async (
      groupId: string,
      identity: string,
    ): Promise<MemberCapabilities | null> => {
      try {
        const resp = await api.getMemberCapabilities(groupId, identity);
        return resp.data ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  const getContextVisibility = useCallback(
    async (
      groupId: string,
      contextId: string,
    ): Promise<ContextVisibility | null> => {
      try {
        const resp = await api.getContextVisibility(groupId, contextId);
        return resp.data ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  const setContextVisibility = useCallback(
    async (
      groupId: string,
      contextId: string,
      mode: VisibilityMode,
    ): Promise<boolean> => {
      setActionLoading(true);
      setError(null);
      try {
        const resp = await api.setContextVisibility(groupId, contextId, {
          mode,
        });
        if (resp.error) {
          setError(resp.error.message);
          return false;
        }
        return true;
      } catch (err) {
        log.error("useGroupAdmin", "Failed to set visibility", err);
        setError("Failed to set visibility");
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [],
  );

  const getContextAllowlist = useCallback(
    async (groupId: string, contextId: string): Promise<string[]> => {
      try {
        const resp = await api.getContextAllowlist(groupId, contextId);
        return resp.data ?? [];
      } catch {
        return [];
      }
    },
    [],
  );

  const manageAllowlist = useCallback(
    async (
      groupId: string,
      contextId: string,
      add?: string[],
      remove?: string[],
    ): Promise<boolean> => {
      setActionLoading(true);
      setError(null);
      try {
        const resp = await api.manageContextAllowlist(groupId, contextId, {
          add,
          remove,
        });
        if (resp.error) {
          setError(resp.error.message);
          return false;
        }
        return true;
      } catch (err) {
        log.error("useGroupAdmin", "Failed to manage allowlist", err);
        setError("Failed to manage allowlist");
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [],
  );

  const setDefaultCapabilities = useCallback(
    async (groupId: string, capabilities: number): Promise<boolean> => {
      setActionLoading(true);
      setError(null);
      try {
        const resp = await api.setDefaultCapabilities(groupId, {
          defaultCapabilities: capabilities,
        });
        if (resp.error) {
          setError(resp.error.message);
          return false;
        }
        if (group) {
          setGroup({ ...group, defaultCapabilities: capabilities });
        }
        return true;
      } catch (err) {
        log.error("useGroupAdmin", "Failed to set default capabilities", err);
        setError("Failed to set default capabilities");
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [group],
  );

  const setSubgroupVisibility = useCallback(
    async (groupId: string, mode: VisibilityMode): Promise<boolean> => {
      setActionLoading(true);
      setError(null);
      try {
        const resp = await api.setSubgroupVisibility(groupId, {
          subgroupVisibility: mode,
        });
        if (resp.error) {
          setError(resp.error.message);
          return false;
        }
        if (group) {
          setGroup({ ...group, subgroupVisibility: mode });
        }
        return true;
      } catch (err) {
        log.error("useGroupAdmin", "Failed to set subgroup visibility", err);
        setError("Failed to set subgroup visibility");
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [group],
  );

  const triggerUpgrade = useCallback(
    async (
      groupId: string,
      targetApplicationId: string,
      migrateMethod?: string,
    ): Promise<boolean> => {
      setActionLoading(true);
      setError(null);
      try {
        const resp = await api.triggerUpgrade(groupId, {
          targetApplicationId,
          migrateMethod,
        });
        if (resp.error) {
          setError(resp.error.message);
          return false;
        }
        // Refresh upgrade status
        const statusResp = await api.getUpgradeStatus(groupId);
        if (statusResp.data !== undefined) setUpgradeStatus(statusResp.data);
        return true;
      } catch (err) {
        log.error("useGroupAdmin", "Failed to trigger upgrade", err);
        setError("Failed to trigger upgrade");
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [],
  );

  const refreshUpgradeStatus = useCallback(async (groupId: string) => {
    try {
      const resp = await api.getUpgradeStatus(groupId);
      if (resp.data !== undefined) setUpgradeStatus(resp.data);
    } catch {
      // silent
    }
  }, []);

  return {
    group,
    members,
    subgroupCount,
    upgradeStatus,
    loading,
    actionLoading,
    error,
    clearError: () => setError(null),
    fetchAll,
    removeMember,
    setMemberCapabilities,
    setMemberMetadata,
    getMemberCapabilities,
    getContextVisibility,
    setContextVisibility,
    getContextAllowlist,
    manageAllowlist,
    setDefaultCapabilities,
    setSubgroupVisibility,
    triggerUpgrade,
    refreshUpgradeStatus,
  };
}
