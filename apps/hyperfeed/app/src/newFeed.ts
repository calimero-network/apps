import { useState } from "react";
import { setContextId, useCreateContext, useCreateNamespace } from "@calimero-network/mero-react";

/** rc.25 renamed `groupId` → `namespaceId`; read both. */
function namespaceIdOf(ns: unknown): string | undefined {
  const n = ns as { namespaceId?: string; groupId?: string; id?: string } | null;
  return n?.namespaceId ?? n?.groupId ?? n?.id;
}

/** Open a feed: the app opens the stored one on its next load. */
export function openFeed(id: string) {
  setContextId(id);
  // The provider reads the stored context on mount.
  window.location.reload();
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
