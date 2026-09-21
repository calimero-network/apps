// ── Which workspace the app is acting in ─────────────────────────────────────
//
// A module store rather than React state, for one reason: `useCalimero()` is
// called from twelve places, and the `app` handle it returns has to know the
// workspace because `createContext` cannot be sent without a group. Threading a
// prop through twelve call sites — two of them on the signing path — to carry a
// value that is really "where am I in the app" would be a large diff through
// code that has no other reason to change.
//
// So the workspace lives here, `useCalimero()` reads it, and the two screens
// that know it (the workspace picker, and the agreements list at
// `/workspaces/:workspaceId`) set it. `useSyncExternalStore` is what makes a
// change re-render every consumer without a provider around the tree.
//
// ⚠️ NOT sessionStorage and NOT memory-only. The desktop opens this app in a
// window that reloads, and a person who picked a workspace and refreshed should
// land back in it rather than at the picker with no explanation.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'mero-sign:workspace';

type Listener = () => void;
const listeners = new Set<Listener>();

/** A read that cannot throw: storage is blocked outright in some browsers. */
function readStored(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

let current: string | null = readStored();

export function getActiveWorkspace(): string | null {
  return current;
}

export function setActiveWorkspace(namespaceId: string | null): void {
  if (current === namespaceId) return;
  current = namespaceId;
  try {
    if (namespaceId) localStorage.setItem(STORAGE_KEY, namespaceId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A private window is not a reason to refuse the selection — it only means
    // it will not survive the reload.
  }
  for (const listener of listeners) listener();
}

export function subscribeActiveWorkspace(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The active workspace, as a hook.
 *
 * The server snapshot is `null` rather than the stored value: this app is
 * client-rendered, but a snapshot that reads `localStorage` is a hydration
 * mismatch waiting to happen and the honest answer before hydration is "not
 * known yet".
 */
export function useActiveWorkspace(): string | null {
  return useSyncExternalStore(
    subscribeActiveWorkspace,
    getActiveWorkspace,
    () => null,
  );
}

/** Test seam. Clears the selection and the stored copy. */
export function resetActiveWorkspaceForTests(): void {
  current = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
  for (const listener of listeners) listener();
}
