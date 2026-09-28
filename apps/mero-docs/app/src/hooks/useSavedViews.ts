// Saved views: personal ones live on this device; shared ones live in the
// registry. Two instances (Home's header, the sidebar) must see each other's
// personal saves at once, so a write here notifies every other instance for
// this workspace; `storage` events only fire across tabs, not within one.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { nameCollator } from '@/lib/collate';
import { useContextEvents } from './useContextEvents';
import { useDriveWorkspace } from './useDriveWorkspace';

const VIEWS_KEY_PREFIX = 'mero-drive:views:'; // + workspace id
const REGISTRY_EVENT_DEBOUNCE_MS = 300; // one re-read per burst of registry ops
const SAVE_FAILED = "Couldn't save the view. Try again.";
const RENAME_FAILED = "Couldn't rename the view. Try again.";
const DELETE_FAILED = "Couldn't delete the view. Try again.";

export type ViewScope = 'me' | 'everyone';
export type SavedView = {
  id: string;
  name: string;
  query: string;
  scope: ViewScope;
  createdBy?: string;
};

export type SavedViewsState = {
  views: SavedView[];
  save(name: string, query: string, scope: ViewScope): Promise<SavedView>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
};

type Personal = { id: string; name: string; query: string };

function readPersonal(ws: string): Personal[] {
  try {
    const raw = window.localStorage.getItem(VIEWS_KEY_PREFIX + ws);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Personal[]) : [];
  } catch {
    return [];
  }
}

function writePersonal(ws: string, views: Personal[]): void {
  try {
    window.localStorage.setItem(VIEWS_KEY_PREFIX + ws, JSON.stringify(views));
  } catch {
    // storage unavailable or over quota; the write already applied in memory
  }
}

const personalListeners = new Map<string, Set<() => void>>();
function subscribePersonal(ws: string, fn: () => void): () => void {
  let bucket = personalListeners.get(ws);
  if (!bucket) personalListeners.set(ws, (bucket = new Set()));
  bucket.add(fn);
  return () => {
    bucket?.delete(fn);
    if (bucket?.size === 0) personalListeners.delete(ws);
  };
}
function notifyPersonal(ws: string): void {
  personalListeners.get(ws)?.forEach((fn) => fn());
}

/** Personal views on this device, plus the workspace's shared views, merged and named by scope. */
export function useSavedViews(ws: string): SavedViewsState {
  const { registryClient, registryContextId } = useDriveWorkspace();

  const [personal, setPersonal] = useState<Personal[]>(() => readPersonal(ws));
  useEffect(() => {
    setPersonal(readPersonal(ws));
    return subscribePersonal(ws, () => setPersonal(readPersonal(ws)));
  }, [ws]);

  const [shared, setShared] = useState<{
    client: typeof registryClient;
    views: SavedView[];
  }>({ client: null, views: [] });
  const seqRef = useRef(0);
  const load = useCallback(() => {
    if (!registryClient) return;
    const seq = ++seqRef.current;
    registryClient.listViews().then(
      (dtos) => {
        if (seq !== seqRef.current) return;
        setShared({
          client: registryClient,
          views: dtos.map((d) => ({
            id: d.id,
            name: d.name,
            query: d.query,
            scope: 'everyone' as const,
            createdBy: d.created_by,
          })),
        });
      },
      (e: unknown) => {
        if (seq !== seqRef.current) return;
        console.warn('[useSavedViews] read failed', e);
        // A failed re-read keeps the last good shared list rather than blanking it.
      },
    );
  }, [registryClient]);
  useEffect(() => {
    load();
  }, [load]);
  const onRegistryEvent = useCallback(() => load(), [load]);
  useContextEvents(registryContextId, onRegistryEvent, {
    strict: true,
    debounceMs: REGISTRY_EVENT_DEBOUNCE_MS,
  });

  const sharedViews = useMemo(
    () => (shared.client === registryClient ? shared.views : []),
    [shared, registryClient],
  );
  const sharedRef = useRef(sharedViews);
  sharedRef.current = sharedViews;
  const personalRef = useRef(personal);
  personalRef.current = personal;

  const views = useMemo(
    () =>
      [
        ...personal.map((p) => ({ ...p, scope: 'me' as const })),
        ...sharedViews,
      ].sort((a, b) => nameCollator.compare(a.name, b.name)),
    [personal, sharedViews],
  );

  const save = useCallback(
    async (
      name: string,
      query: string,
      scope: ViewScope,
    ): Promise<SavedView> => {
      const id = crypto.randomUUID();
      if (scope === 'me') {
        const next = [...readPersonal(ws), { id, name, query }];
        writePersonal(ws, next);
        setPersonal(next);
        notifyPersonal(ws);
        return { id, name, query, scope };
      }
      if (!registryClient) throw new Error('registry is not ready');
      try {
        await registryClient.saveView({ id, name, query });
      } catch (e: unknown) {
        console.warn('[useSavedViews] save failed', e);
        toast.error(SAVE_FAILED);
        throw e;
      }
      load();
      return { id, name, query, scope };
    },
    [ws, registryClient, load],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<void> => {
      if (personalRef.current.some((p) => p.id === id)) {
        const next = personalRef.current.map((p) =>
          p.id === id ? { ...p, name } : p,
        );
        writePersonal(ws, next);
        setPersonal(next);
        notifyPersonal(ws);
        return;
      }
      const view = sharedRef.current.find((v) => v.id === id);
      if (!registryClient || !view) throw new Error('view not found');
      try {
        await registryClient.saveView({ id, name, query: view.query });
      } catch (e: unknown) {
        console.warn('[useSavedViews] rename failed', e);
        toast.error(RENAME_FAILED);
        throw e;
      }
      load();
    },
    [ws, registryClient, load],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (personalRef.current.some((p) => p.id === id)) {
        const next = personalRef.current.filter((p) => p.id !== id);
        writePersonal(ws, next);
        setPersonal(next);
        notifyPersonal(ws);
        return;
      }
      if (!registryClient) throw new Error('registry is not ready');
      try {
        await registryClient.deleteView({ id });
      } catch (e: unknown) {
        console.warn('[useSavedViews] delete failed', e);
        toast.error(DELETE_FAILED);
        throw e;
      }
      load();
    },
    [ws, registryClient, load],
  );

  return useMemo(
    () => ({ views, save, rename, remove }),
    [views, save, rename, remove],
  );
}
