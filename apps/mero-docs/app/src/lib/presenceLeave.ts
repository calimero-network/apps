// A leave sent while a presence update is still in flight can reach the node
// first, and the node would then replay the update; so a leave is sent twice.

import { PRESENCE_LEAVE_REPEAT_MS } from './presenceTiming';

type Ephemeral = {
  set: (contextId: string, value: object) => Promise<unknown>;
};

const pendingRepeats = new Map<string, ReturnType<typeof setTimeout>>();

/** Leave `contextId` now, and once more shortly after unless something announces there first. */
export function leaveContext(
  ephemeral: Ephemeral,
  contextId: string,
  slice: object,
): void {
  const send = () => void ephemeral.set(contextId, slice).catch(() => {});
  cancelLeave(contextId);
  send();
  pendingRepeats.set(
    contextId,
    setTimeout(() => {
      pendingRepeats.delete(contextId);
      send();
    }, PRESENCE_LEAVE_REPEAT_MS),
  );
}

/** Call before announcing on `contextId`, so an earlier leave's repeat cannot follow the announce. */
export function cancelLeave(contextId: string): void {
  clearTimeout(pendingRepeats.get(contextId));
  pendingRepeats.delete(contextId);
}
