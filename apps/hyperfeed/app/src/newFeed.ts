import { useCallback, useSyncExternalStore } from "react";
import { setOrgName } from "@calimero-apps/names";
import { appSource, describeError, targetKey, type AppSource, type Target } from "@calimero-apps/connect";
import { createFeed } from "./feeds";
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
let opened: { key: string; id: string | null } | null = null;
const listeners = new Set<() => void>();
let currentKey: string | null = null;

/**
 * Close the open feed and go back to picking one: it was deleted, or your
 * access to it was taken away. Forgotten too, so the next visit does not open it.
 */
export function closeFeed() {
  if (!currentKey) return;
  try {
    localStorage.removeItem(currentKey);
  } catch {
    // Private mode: nothing was remembered.
  }
  opened = { key: currentKey, id: null };
  listeners.forEach((l) => l());
}

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

const creationListeners = new Set<() => void>();
let creation = { open: false, busy: false, failed: null as string | null };

function setCreation(patch: Partial<typeof creation>) {
  creation = { ...creation, ...patch };
  creationListeners.forEach((l) => l());
}

/** What the shared create dialog and the buttons that open it show. */
export function useNewFeedState() {
  return useSyncExternalStore(
    (l) => {
      creationListeners.add(l);
      return () => creationListeners.delete(l);
    },
    () => creation,
  );
}

export const closeNewFeed = () => setCreation({ open: false });

/** What follows the organization the node approved for a feed: the feed in it, your name there, and open it. */
export async function finishNewFeed(
  session: Extract<Session, { status: "signed-in" }>,
  { orgId, name, selfName }: { orgId: string; name: string; selfName: string },
): Promise<void> {
  setCreation({ open: false, busy: true, failed: null });
  try {
    const { client, accountId } = session;
    openFeed(await createFeed(client, feedSource(), name, orgId));
    // Best effort: the feed exists either way.
    await setOrgName(client, orgId, accountId, selfName).catch(() => {});
  } catch (e) {
    setCreation({ failed: describeError(e) });
  } finally {
    setCreation({ busy: false });
  }
}

/**
 * Make a feed and open it: an app instance of Hyperfeed in an organization of
 * its own, which the shared create dialog (`NewFeedDialog`) gets the node to
 * approve. Also how a feed made by an earlier Hyperfeed is replaced.
 */
export function useNewFeed() {
  const { session } = useSessionApi();
  const { busy, failed } = useNewFeedState();
  const create = useCallback(async () => setCreation({ open: true, failed: null }), []);
  return { create, busy, failed, ready: signedIn(session) !== null };
}
