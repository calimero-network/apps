// Saved views: personal ones live on this device; shared ones live in the
// registry. One source per workspace, provided to Home and the sidebar alike.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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

function failed(what: string, message: string, e: unknown): never {
  console.warn(`[useSavedViews] ${what} failed`, e);
  toast.error(message);
  throw e;
}

const notReady = () => Promise.reject(new Error('saved views are not ready'));

export const SavedViewsContext = createContext<SavedViewsState>({
  views: [],
  save: notReady,
  rename: notReady,
  remove: notReady,
});

/** The workspace's saved views and their writes, from the workspace provider. */
export function useSavedViews(): SavedViewsState {
  return useContext(SavedViewsContext);
}

/** Personal views on this device, plus the workspace's shared views, merged and named by scope. */
export function useSavedViewsSource(): SavedViewsState {
  const { namespaceId, registryClient, registryContextId } =
    useDriveWorkspace();
  const ws = namespaceId ?? '';

  // Storage is re-read on every write and on another tab's, so neither undoes the other's.
  const [personal, setPersonal] = useState<Personal[]>(() => readPersonal(ws));
  useEffect(() => {
    setPersonal(readPersonal(ws));
    const onStorage = (e: StorageEvent) => {
      if (e.key === VIEWS_KEY_PREFIX + ws) setPersonal(readPersonal(ws));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [ws]);
  const updatePersonal = useCallback(
    (change: (views: Personal[]) => Personal[]) => {
      const next = change(readPersonal(ws));
      writePersonal(ws, next);
      setPersonal(next);
    },
    [ws],
  );

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
        updatePersonal((views) => [...views, { id, name, query }]);
        return { id, name, query, scope };
      }
      try {
        if (!registryClient) throw new Error('registry is not ready');
        await registryClient.saveView({ id, name, query });
      } catch (e: unknown) {
        failed('save', SAVE_FAILED, e);
      }
      load();
      return { id, name, query, scope };
    },
    [registryClient, load, updatePersonal],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<void> => {
      if (readPersonal(ws).some((p) => p.id === id)) {
        updatePersonal((views) =>
          views.map((p) => (p.id === id ? { ...p, name } : p)),
        );
        return;
      }
      try {
        const view = sharedRef.current.find((v) => v.id === id);
        if (!registryClient || !view) throw new Error('view not found');
        await registryClient.saveView({ id, name, query: view.query });
      } catch (e: unknown) {
        failed('rename', RENAME_FAILED, e);
      }
      load();
    },
    [ws, registryClient, load, updatePersonal],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (readPersonal(ws).some((p) => p.id === id)) {
        updatePersonal((views) => views.filter((p) => p.id !== id));
        return;
      }
      try {
        if (!registryClient) throw new Error('registry is not ready');
        await registryClient.deleteView({ id });
      } catch (e: unknown) {
        failed('delete', DELETE_FAILED, e);
      }
      load();
    },
    [ws, registryClient, load, updatePersonal],
  );

  return useMemo(
    () => ({ views, save, rename, remove }),
    [views, save, rename, remove],
  );
}
