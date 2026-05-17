import { useState, useCallback } from "react";
import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { GroupContextChannel, ContextInfo } from "../types/Common";
import { log } from "../utils/logger";
import type { ResponseData } from "../api/types";
import {
  nodeApi as apiClientNode,
  type LegacyFetchContextIdentitiesResponse as FetchContextIdentitiesResponse,
} from "../api/meroJsClient";
import { getGroupMemberIdentity, setGroupMemberIdentity } from "../constants/config";
import { resolveSharedDmDiscovery } from "../utils/dmContext";

export interface DMContextInfo extends GroupContextChannel {
  otherUsername: string;
  otherAlias: string;
  otherIdentity: string;
  myIdentity: string;
}

/**
 * DM hook backed by group contexts: lists group contexts, filters those with
 * type === "dm", and enriches each with identity and metadata.
 */
export function useDMs() {
  const [dms, setDms] = useState<DMContextInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDms = useCallback(async (groupId?: string) => {
    if (!groupId) {
      return [];
    }
    setLoading(true);
    setError(null);

    try {
      const groupApi = new GroupApiDataSource();
      const clientApi = new ClientApiDataSource();
      const currentIdentityResponse = await groupApi.resolveCurrentMemberIdentity(
        groupId,
        getGroupMemberIdentity(groupId),
      );
      const currentMemberIdentity = currentIdentityResponse.data?.memberIdentity ?? "";
      if (currentMemberIdentity) {
        setGroupMemberIdentity(groupId, currentMemberIdentity);
      }

      const membersResponse = await groupApi.listMembers(groupId);
      const memberAliasByIdentity = new Map<string, string>();
      const namespaceMemberIdentities = new Set<string>();
      if (membersResponse.data) {
        membersResponse.data.members.forEach((member) => {
          namespaceMemberIdentities.add(member.identity);
          const alias = member.alias?.trim();
          if (alias) {
            memberAliasByIdentity.set(member.identity, alias);
          }
        });
      }
      // Only treat the namespace member list as authoritative when we can
      // confirm our OWN identity is in it. Otherwise (older merods that 405
      // on GET /members, transient errors, or an empty response) fall back
      // to the legacy behaviour of showing all DM contexts.
      const membersAuthoritative =
        Boolean(currentMemberIdentity) &&
        namespaceMemberIdentities.has(currentMemberIdentity);

      // 1-group-per-context model: DMs are subgroups under the namespace
      // (restricted visibility, 2 members) with one context inside whose
      // info.context_type === "Dm". Walk subgroups → contexts and filter
      // by type in the enrich pass below.
      const contextEntries: { contextId: string; alias?: string }[] = [];

      const subgroupsResp = await groupApi.listSubgroups(groupId);
      if (subgroupsResp.error) {
        log.warn("useDMs", "listSubgroups failed", subgroupsResp.error);
      }
      const subgroups = subgroupsResp.data ?? [];

      await Promise.all(
        subgroups.map(async (sg) => {
          const ctxResp = await groupApi.listGroupContexts(sg.groupId);
          if (ctxResp.data) {
            contextEntries.push(...ctxResp.data);
          } else if (ctxResp.error) {
            log.debug("useDMs", `listGroupContexts failed for ${sg.groupId}`, ctxResp.error);
          }
        }),
      );

      if (contextEntries.length === 0 && subgroupsResp.error) {
        setError(subgroupsResp.error.message || "Failed to fetch DM contexts");
        setLoading(false);
        return [];
      }

      const enriched: (DMContextInfo | null)[] = await Promise.all(
        contextEntries.map(async (entry) => {
          const { contextId: ctxId, alias } = entry;
          const discovery = currentMemberIdentity
            ? resolveSharedDmDiscovery(entry, currentMemberIdentity)
            : null;

          let joinedIdentity: string | undefined;
          try {
            const resp: ResponseData<FetchContextIdentitiesResponse> =
              await apiClientNode.fetchContextIdentities(ctxId);
            const list = resp.data?.data?.identities;
            if (list && list.length > 0) {
              joinedIdentity = list[0];
            }
          } catch {
            // No identity means we haven't joined this context
          }

          let info: ContextInfo | null = null;
          if (joinedIdentity) {
            try {
              const infoResp = await clientApi.getContextInfo(ctxId, joinedIdentity);
              if (infoResp.data) {
                info = infoResp.data;
              }
            } catch {
              log.debug("useDMs", `get_info failed for ${ctxId}`);
            }
          }

          if (info && info.context_type !== "Dm") {
            return null;
          }

          const shouldInclude =
            info?.context_type === "Dm" || (!info && Boolean(discovery));
          if (!shouldInclude) {
            return null;
          }

          let otherUsername = "";
          let otherIdentity = discovery?.otherIdentity || "";
          let otherAlias = otherIdentity
            ? memberAliasByIdentity.get(otherIdentity) || ""
            : "";

          // Primary: description encodes { c: creatorName, o: otherName } at
          // DM creation time. Compare info.creator to our own joined identity
          // to know which slot is ours. This works as soon as get_info works
          // (context joined + WASM state gossiped) — no set_profile needed.
          if (joinedIdentity && info?.description) {
            try {
              const meta = JSON.parse(info.description) as { c?: string; o?: string };
              if (meta && (meta.c || meta.o)) {
                const isCreator = info.creator === joinedIdentity;
                otherUsername = (isCreator ? meta.o : meta.c)?.trim() || "";
              }
            } catch {
              // not our format — old DM or channel, fall through
            }
          }

          // Fallback: get_profiles (requires both sides to have called set_profile)
          if (!otherUsername && joinedIdentity) {
            try {
              const profilesResp = await clientApi.getProfiles(ctxId, joinedIdentity);
              if (profilesResp.data && Array.isArray(profilesResp.data)) {
                const other = profilesResp.data.find(
                  (p: { identity: string; username: string }) =>
                    p.identity !== joinedIdentity,
                );
                if (other) {
                  otherUsername = other.username;
                  otherIdentity = other.identity;
                  // memberAliasByIdentity is keyed by namespace identity, not context
                  // identity — so the get() here always misses. Preserve the alias
                  // resolved from the namespace member list before get_profiles ran.
                  otherAlias = otherAlias || memberAliasByIdentity.get(other.identity) || "";
                }
              }
            } catch {
              log.debug("useDMs", `get_profiles failed for ${ctxId}`);
            }
          }

          // Hide DMs whose counterpart is no longer in the namespace member
          // list. The server's MemberRemoved cascade strips the kicked user
          // from this DM subgroup, so the namespace member list is the source
          // of truth. Without this, the kicked user's name falls back to a
          // raw identity string and the dead DM lingers in the sidebar.
          if (
            membersAuthoritative &&
            otherIdentity &&
            !namespaceMemberIdentities.has(otherIdentity)
          ) {
            return null;
          }

          return {
            contextId: ctxId,
            alias,
            info,
            otherUsername,
            otherAlias,
            otherIdentity,
            myIdentity: joinedIdentity || "",
            contextIdentity: joinedIdentity,
            isJoined: Boolean(joinedIdentity),
          };
        }),
      );

      const dmList = enriched.filter((d): d is DMContextInfo => d !== null);
      setDms(dmList);
      return dmList;
    } catch (err) {
      log.error("useDMs", "Error fetching DMs", err);
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
