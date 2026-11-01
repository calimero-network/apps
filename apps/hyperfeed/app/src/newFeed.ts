import { useCallback, useState, useSyncExternalStore } from "react";
import { appSource, targetKey, type AppSource, type Target } from "@calimero-apps/connect";
import { createFeed, listFeeds, readFeedNames, suggestName } from "./feeds";
import { PACKAGE, useSessionApi, type Session } from "./session";

/** Where feeds come from: the dev bundle `dev:local` uploaded, or the package in production. */
export function feedSource(env: Parameters<typeof appSource>[0] = import.meta.env): AppSource {
  return appSource(env, PACKAGE);
}

/** The signed-in session, or null. */
export function signedIn(session: Session): Extract<Session, { status: "signed-in" }> | null {
  return session.status === "signed-in" ? session : null;
}

/** Where the feed you last opened is remembered: per cluster and per account. */
export function selectionKey(target: Target, accountId: string): string {
  return `hyperfeed:feed:${targetKey(target)}:${accountId}`;
}

function remembered(key: string | null): string | null {
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The feed you opened in this tab, once you switch; until then, the remembered one. */
let opened: { key: string; id: string } | null = null;
const listeners = new Set<() => void>();
let currentKey: string | null = null;

/**
 * Open a feed, in place: remembered for your next visit, and shown now without
 * a reload, so you stay signed in and switch in one click.
 */
export function openFeed(id: string) {
  if (!currentKey) return;
  try {
    localStorage.setItem(currentKey, id);
  } catch {
    // Private mode: it holds for this visit.
  }
  opened = { key: currentKey, id };
  listeners.forEach((l) => l());
}

/** The feed to show for this session: the one you last opened, or null to pick one. */
export function useOpenFeed(session: Session): string | null {
  const live = signedIn(session);
  const key = live ? selectionKey(live.target, live.accountId) : null;
  currentKey = key;
  const picked = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => opened,
  );
  if (!key) return null;
  return picked && picked.key === key ? picked.id : remembered(key);
}

/**
 * Make a feed and open it: an app instance of Hyperfeed in an organization of
 * its own. Also how a feed made by an earlier Hyperfeed is replaced.
 *
 * Without a name, it gets the first free of "My feed", "My feed 2"…
 */
export function useNewFeed() {
  const { session } = useSessionApi();
  const live = signedIn(session);
  const client = live?.client ?? null;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /** True once the feed is made and open. */
  const create = useCallback(
    async (name?: string): Promise<boolean> => {
      if (!client) return false;
      setBusy(true);
      setFailed(null);
      try {
        const source = feedSource();
        let given = name?.trim() ?? "";
        if (!given) {
          const feeds = await listFeeds(client, source).catch(() => []);
          const names = await readFeedNames(client, feeds).catch(() => ({}));
          given = suggestName(Object.values(names));
        }
        openFeed(await createFeed(client, source, given));
        return true;
      } catch (e) {
        setFailed(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  return { create, busy, failed, ready: Boolean(client) };
}
