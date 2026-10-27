/**
 * RECIPE — propagated per-room (context) metadata: topic / description. Copy
 * into app/src/hooks. No contract change needed. Not built into the base.
 */
import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

export interface RoomMeta {
  name: string;
  topic: string;
  description: string;
}

const EMPTY: RoomMeta = { name: '', topic: '', description: '' };

export function useRoomMetadata(contextId: string | null) {
  const { mero } = useMero();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [meta, setMetaState] = useState<RoomMeta>(EMPTY);

  // Resolve the room's managing group (namespace for flat rooms; subgroup if
  // you use the private-rooms recipe).
  useEffect(() => {
    if (!mero || !contextId) return;
    let cancelled = false;
    // getContextGroup → the managing group id as a string | null.
    mero.admin.getContextGroup(contextId).then(
      (g) => { if (!cancelled) setGroupId(g ?? null); },
      () => { if (!cancelled) setGroupId(null); },
    );
    return () => { cancelled = true; };
  }, [mero, contextId]);

  const refresh = useCallback(async () => {
    if (!mero || !contextId || !groupId) return;
    const rec = await mero.admin.getContextMetadata(groupId, contextId).catch(() => null);
    setMetaState({
      name: rec?.name ?? '',
      topic: rec?.data?.topic ?? '',
      description: rec?.data?.description ?? '',
    });
  }, [mero, contextId, groupId]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Write propagated metadata so all members see the same topic/description. */
  const setMeta = useCallback(async (next: Partial<RoomMeta>) => {
    if (!mero || !contextId || !groupId) return;
    const merged = { ...meta, ...next };
    await mero.admin.setContextMetadata(groupId, contextId, {
      name: merged.name,
      data: { topic: merged.topic, description: merged.description },
    });
    setMetaState(merged);
  }, [mero, contextId, groupId, meta]);

  return { meta, setMeta, refresh };
}
