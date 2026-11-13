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
import { resolveDmCounterpart } from "../utils/dmDiscovery";
import { resolveSharedDmDiscovery } from "../utils/dmContext";

export interface DMContextInfo extends GroupContextChannel {
  /** The other person's name in the workspace (member metadata), "" when they chose none. */
  otherAlias: string;
  otherIdentity: string;
  myIdentity: string;
  // The other person's account as the workspace lists it. Used for
  // deduplication checks in the New DM dropdown.
  namespaceMemberIdentity: string;
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
      const contextEntries: {
        contextId: string;
        alias?: string;
        subgroupMembers?: string[];
      }[] = [];

      const subgroupsResp = await groupApi.listSubgroups(groupId);
      if (subgroupsResp.error) {
        log.warn("useDMs", "listSubgroups failed", subgroupsResp.error);
      }
      const subgroups = subgroupsResp.data ?? [];

      await Promise.all(
        subgroups.map(async (sg) => {
          // Who is in this subgroup — the discovery that does not depend on
          // anything being named.
          //
          // The alias-based paths below cannot be relied on: a DM subgroup was
          // named `DM_CONTEXT_<accountA>_<accountB>`, 140 bytes into a field
          // capped at 64, so the name was dropped on write and neither side had
          // one to parse. Observed against two live nodes, where the invitee's
          // context entry arrives as `{ contextId }` and nothing else.
          //
          // Membership is already access-controlled — listing a restricted
          // subgroup's members returns 403 to non-members — so an error here is
          // not a failure to handle, it is the answer "this one is not mine".
          const membersResp = await groupApi.listMembers(sg.groupId);
          const subgroupMembers = (membersResp.data?.members ?? [])
            .map((member) => member.identity)
            .filter(Boolean);

          const ctxResp = await groupApi.listGroupContexts(sg.groupId);
          if (ctxResp.data) {
            // Carry the subgroup alias as a fallback: the server may not echo
            // the alias back on individual context entries, so parseDmAlias
            // would get undefined and namespaceMemberIdentity would be "".
            contextEntries.push(
              ...ctxResp.data.map((entry) => ({
                ...entry,
                alias: entry.alias ?? sg.alias,
                subgroupMembers,
              })),
            );
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

          // Membership is the authority; the alias and metadata paths above are
          // kept only because they answer without a second round trip when the
          // data happens to be there.
          const counterpartFromMembers = currentMemberIdentity
            ? resolveDmCounterpart(entry.subgroupMembers ?? [], currentMemberIdentity)
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
            info?.context_type === "Dm" ||
            (!info && Boolean(discovery || counterpartFromMembers));
          if (!shouldInclude) {
            return null;
          }

          // The other person, by account; their name is the workspace's
          // member metadata for that account, nothing the DM itself carries.
          const namespaceMemberIdentity =
            discovery?.otherIdentity || counterpartFromMembers || "";
          const otherIdentity = namespaceMemberIdentity;
          const otherAlias = otherIdentity
            ? memberAliasByIdentity.get(otherIdentity) || ""
            : "";

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
            otherAlias,
            otherIdentity,
            namespaceMemberIdentity,
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
