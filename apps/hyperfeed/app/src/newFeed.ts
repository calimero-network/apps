import { useState, useSyncExternalStore } from "react";
import { setContextId, useCreateContext, useCreateNamespace } from "@calimero-network/mero-react";

/** rc.25 renamed `groupId` → `namespaceId`; read both. */
function namespaceIdOf(ns: unknown): string | undefined {
  const n = ns as { namespaceId?: string; groupId?: string; id?: string } | null;
  return n?.namespaceId ?? n?.groupId ?? n?.id;
}

/** The feed you opened in this tab, once you switch; until then, the session's. */
let opened: string | null = null;
const listeners = new Set<() => void>();

/**
 * Open a feed, in place: stored for your next visit, and shown now without a
 * reload, so you stay signed in and switch in one click.
 */
export function openFeed(id: string) {
  setContextId(id);
  opened = id;
  listeners.forEach((l) => l());
}

/** The feed to show: the one you last opened here, else the session's. */
export function useOpenFeed(sessionFeed: string | null): string | null {
  const picked = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => opened,
  );
  return picked ?? sessionFeed;
}

/**
 * Make a feed with the Hyperfeed installed now, in a namespace of its own, and
 * open it. Also how a feed made by an earlier Hyperfeed is replaced: an old
 * feed keeps the code it was created with.
 */
export function useNewFeed(applicationId: string | null) {
  const { createNamespace } = useCreateNamespace();
  const { createContext } = useCreateContext();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function create() {
    if (!applicationId) return;
    setBusy(true);
    setFailed(null);
    try {
      const ns = await createNamespace({ applicationId });
      const namespaceId = namespaceIdOf(ns);
      if (!namespaceId) throw new Error("namespace created but no id came back");
      // `init` takes no arguments.
      const init = Array.from(new TextEncoder().encode("{}"));
      const ctx = await createContext({ applicationId, groupId: namespaceId, initializationParams: init });
      const id = (ctx as { contextId?: string } | null)?.contextId;
      if (!id) throw new Error("context created but no contextId came back");
      openFeed(id);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return { create, busy, failed, ready: Boolean(applicationId) };
}
