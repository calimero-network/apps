import { useState, useSyncExternalStore } from "react";
import { setContextId, useCreateContext, useCreateNamespace, useMero } from "@calimero-apps/cloud";
import { nameProblem, readFeedNames, suggestName, type FeedName, type NamesAdmin } from "./feeds";

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
 *
 * The name goes on the namespace and the context both, so admin tools show
 * it too. Without one, the feed gets the first free of "My feed", "My feed 2"…
 */
export function useNewFeed(applicationId: string | null) {
  const { createNamespace } = useCreateNamespace();
  const { createContext } = useCreateContext();
  const { admin } = useMero();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /** True once the feed is made and open. */
  async function create(name?: string): Promise<boolean> {
    if (!applicationId) return false;
    setBusy(true);
    setFailed(null);
    try {
      const given = name?.trim() || (await defaultName(admin as unknown as NamesAdmin | null, applicationId));
      const problem = nameProblem(given);
      if (problem) throw new Error(problem);
      const ns = await createNamespace({ applicationId, name: given });
      const namespaceId = namespaceIdOf(ns);
      if (!namespaceId) throw new Error("namespace created but no id came back");
      // `init` takes no arguments.
      const init = Array.from(new TextEncoder().encode("{}"));
      const ctx = await createContext({ applicationId, groupId: namespaceId, initializationParams: init, name: given });
      const id = (ctx as { contextId?: string } | null)?.contextId;
      if (!id) throw new Error("context created but no contextId came back");
      openFeed(id);
      return true;
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { create, busy, failed, ready: Boolean(applicationId) };
}

/** The name a feed made without one gets: the first free of "My feed", "My feed 2"… */
async function defaultName(admin: NamesAdmin | null, applicationId: string): Promise<string> {
  const names = admin ? await readFeedNames(admin, applicationId).catch((): Record<string, FeedName> => ({})) : {};
  return suggestName(Object.values(names).map((n) => n.name));
}
