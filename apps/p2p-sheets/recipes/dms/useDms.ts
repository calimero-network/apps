/**
 * RECIPE — 1:1 direct messages as a 2-member restricted subgroup. Reference
 * hook; copy into app/src/hooks. Builds on ../private-rooms. Not built into base.
 *
 * A DM reuses the room context/service — it's a restricted subgroup with two
 * members, marked via group metadata so it renders as a DM, not a room.
 */
import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

export interface Dm {
  subgroupId: string;
  contextId: string | null;
  otherIdentity: string;
}

/** Deterministic DM name from the two identities (same on both sides → no dupes). */
function dmKey(a: string, b: string): string {
  return [a, b].sort().join('::');
}

export function useDms(
  namespaceId: string | null,
  applicationId: string | null,
  selfIdentity: string | null,
) {
  const { mero } = useMero();
  const [dms, setDms] = useState<Dm[]>([]);

  const refresh = useCallback(async () => {
    if (!mero || !namespaceId || !selfIdentity) return;
    const subs = await mero.admin.listSubgroups(namespaceId);
    const out: Dm[] = [];
    for (const s of subs) {
      const info = await mero.admin.getGroupInfo(s.groupId);
      const meta = info.metadata?.data;
      if (meta?.dm !== '1') continue; // only DM-marked subgroups
      const other = meta.a === selfIdentity ? meta.b : meta.a;
      if (!other) continue;
      const ctxs = await mero.admin.listGroupContexts(s.groupId).catch(() => []);
      out.push({ subgroupId: s.groupId, contextId: ctxs[0]?.contextId ?? null, otherIdentity: other });
    }
    setDms(out);
  }, [mero, namespaceId, selfIdentity]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Open (or create) the DM with `other`. Idempotent per pair. */
  const openDm = useCallback(async (other: string): Promise<Dm | null> => {
    if (!mero || !namespaceId || !applicationId || !selfIdentity) return null;

    const existing = dms.find((d) => d.otherIdentity === other);
    if (existing) return existing;

    const key = dmKey(selfIdentity, other);
    const { groupId } = await mero.admin.createGroupInNamespace(namespaceId, { name: `dm:${key}` });
    await mero.admin.setSubgroupVisibility(groupId, { subgroupVisibility: 'restricted' });
    // Mark as a DM + record both participants (read back in refresh()).
    await mero.admin.setGroupMetadata(groupId, { name: 'Direct message', data: { dm: '1', a: selfIdentity, b: other } });
    await mero.admin.addGroupMembers(groupId, { members: [other] });

    const init = Array.from(new TextEncoder().encode(JSON.stringify({ name: `dm:${key}` })));
    const { contextId } = await mero.admin.createContext({
      applicationId, groupId, serviceName: 'room', initializationParams: init,
    });

    await refresh();
    return { subgroupId: groupId, contextId, otherIdentity: other };
  }, [mero, namespaceId, applicationId, selfIdentity, dms, refresh]);

  return { dms, refresh, openDm };
}
