/**
 * What every shield on the page shares: the session's client (set by
 * `usePasskeySession`), the app instance an app registers for the code check,
 * which shields an app placed, and open requests. One store per page, so a
 * placed `<NodeShield />` needs no props and the built-in floating one knows
 * when to step aside.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import type { AppSource } from "@calimero-apps/connect";

/** The app instance the node should be running, and where its code comes from. */
export interface ShieldApp {
  id: string;
  source: AppSource;
}

/** The client the shield checks, and the cluster the app was configured to use (`describeTarget`). */
export interface ShieldSession {
  client: CalimeroClient;
  cluster: string;
}

export interface ShieldSnapshot {
  /** The sessions bound by `usePasskeySession`, in order; the last is shown. */
  sessions: readonly ShieldSession[];
  app: ShieldApp | null;
  /** Ids of the `<NodeShield />` an app placed, in mount order; the first answers `openNodeShield`. */
  placed: readonly string[];
  /** Grows with every `openNodeShield()`. */
  opens: number;
}

let snapshot: ShieldSnapshot = { sessions: [], app: null, placed: [], opens: 0 };
const listeners = new Set<() => void>();

function update(next: Partial<ShieldSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const readShield = () => snapshot;

export function useShieldStore(): ShieldSnapshot {
  return useSyncExternalStore(subscribe, readShield, readShield);
}

/** Show the shield for `session` until the returned function is called. */
export function bindShieldSession(session: ShieldSession): () => void {
  update({ sessions: [...snapshot.sessions, session] });
  return () => update({ sessions: snapshot.sessions.filter((s) => s !== session) });
}

/** Register a placed shield; the returned function removes it. */
export function placeShield(id: string): () => void {
  update({ placed: [...snapshot.placed, id] });
  return () => update({ placed: snapshot.placed.filter((p) => p !== id) });
}

/** Open the node shield's popover: the placed one, else the floating one. For an account menu's "Connected to" row. */
export function openNodeShield() {
  update({ opens: snapshot.opens + 1 });
}

/**
 * Tell the shield which app instance this page runs and where its code comes
 * from (`appSource`), so the popover can check the node runs that exact code.
 * Without it the popover leaves the app code out.
 */
export function useNodeShieldApp(id: string | null | undefined, source: AppSource) {
  const key = typeof source === "string" ? source : `${source.package}@${source.version ?? ""}`;
  useEffect(() => {
    if (!id) return;
    const app = { id, source };
    update({ app });
    return () => {
      if (snapshot.app === app) update({ app: null });
    };
    // `key` stands for `source`: a fresh object each render is the same source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key]);
}
