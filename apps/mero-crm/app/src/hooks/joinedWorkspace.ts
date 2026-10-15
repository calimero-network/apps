import { useEffect, useRef } from "react";

// ── "A workspace was just joined": the invitation host → the workspace hook ──
//
// The invitation prompt lives at app level (`components/InvitationHost`) so a
// link opened on any route is offered, but the workspace list and the active
// workspace live in `useWorkspace`, under `AppPage`. This carries the one fact
// between them. A join announced while no workspace is mounted (the link was
// opened on `/docs`) is held and handed to the next one that mounts.

type Listener = (namespaceId: string) => void;

const listeners = new Set<Listener>();
let held: string | null = null;

/** Tell the workspace hook to refresh its list and switch into `namespaceId`. */
export function announceJoined(namespaceId: string): void {
  if (listeners.size === 0) {
    held = namespaceId;
    return;
  }
  for (const listener of listeners) listener(namespaceId);
}

/** Run `onJoined` for every announced join, including one held from before mount. */
export function useJoinedWorkspace(onJoined: Listener): void {
  const latest = useRef(onJoined);
  latest.current = onJoined;
  useEffect(() => {
    const listener: Listener = (id) => latest.current(id);
    listeners.add(listener);
    if (held) {
      const id = held;
      held = null;
      listener(id);
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);
}
