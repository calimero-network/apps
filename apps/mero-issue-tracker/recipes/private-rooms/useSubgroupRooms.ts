/**
 * RECIPE — public/private rooms as subgroups. Reference hook; copy into
 * app/src/hooks and adapt names to studio.config.json. Not built into the base.
 *
 * Each room = a subgroup under the namespace. Visibility gates membership:
 *   'open'       → public  (any workspace member self-joins; needs CAN_JOIN_OPEN_SUBGROUPS)
 *   'restricted' → private (only members the creator adds)
 */
import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

export type RoomVisibility = 'open' | 'restricted';

export interface SubgroupRoom {
  subgroupId: string;
  contextId: string | null;
  name: string;
  visibility: RoomVisibility;
}

export function useSubgroupRooms(namespaceId: string | null, applicationId: string | null) {
  const { mero } = useMero();
  const [rooms, setRooms] = useState<SubgroupRoom[]>([]);

  const refresh = useCallback(async () => {
    if (!mero || !namespaceId) return;
    // listSubgroups only returns restricted subgroups the caller may see, so
    // private rooms are hidden from non-members automatically.
    const subs = await mero.admin.listSubgroups(namespaceId);
    const out = await Promise.all(
      subs.map(async (s) => {
        const info = await mero.admin.getGroupInfo(s.groupId);
        const ctxs = await mero.admin.listGroupContexts(s.groupId).catch(() => []);
        return {
          subgroupId: s.groupId,
          contextId: ctxs[0]?.contextId ?? null,
          name: info.metadata?.name || s.name || s.groupId.slice(0, 8),
          visibility: (info.subgroupVisibility as RoomVisibility) ?? 'open',
        };
      }),
    );
    setRooms(out);
  }, [mero, namespaceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * Create a room. `isPublic` → open (auto-join) vs restricted (invite-only).
   * `invitees` are namespace member identities to add to a private room.
   */
  const createRoom = useCallback(async (
    name: string,
    isPublic: boolean,
    invitees: string[] = [],
  ): Promise<SubgroupRoom | null> => {
    if (!mero || !namespaceId || !applicationId) return null;

    // 1. Subgroup + propagated name.
    const { groupId } = await mero.admin.createGroupInNamespace(namespaceId, { name });
    await mero.admin.setGroupMetadata(groupId, { name });

    // 2. Visibility = the privacy switch.
    await mero.admin.setSubgroupVisibility(groupId, {
      subgroupVisibility: isPublic ? 'open' : 'restricted',
    });

    // 3. The actual app context lives INSIDE the subgroup (not the namespace root).
    const init = Array.from(new TextEncoder().encode(JSON.stringify({ name })));
    const { contextId } = await mero.admin.createContext({
      applicationId,
      groupId,
      serviceName: 'room', // SERVICE_NAME.instance in the base
      initializationParams: init,
    });

    // 4. Private rooms: explicitly add members (open rooms need no add step).
    if (!isPublic && invitees.length > 0) {
      await mero.admin.addGroupMembers(groupId, { members: invitees });
    }

    await refresh();
    return { subgroupId: groupId, contextId, name, visibility: isPublic ? 'open' : 'restricted' };
  }, [mero, namespaceId, applicationId, refresh]);

  /** Join a room's context. Open rooms: anyone may join. Restricted: only after being added. */
  const joinRoom = useCallback(async (room: SubgroupRoom) => {
    if (!mero || !room.contextId) return;
    await mero.admin.joinContext(room.contextId).catch(() => { /* already joined */ });
  }, [mero]);

  return { rooms, refresh, createRoom, joinRoom };
}
