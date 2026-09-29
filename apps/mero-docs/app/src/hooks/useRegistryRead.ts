// One list read from the workspace registry, re-read on every registry change.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RegistryClient } from '@/generated/registry/RegistryClient';
import { useContextEvents } from './useContextEvents';
import { useDriveWorkspace } from './useDriveWorkspace';

const REGISTRY_EVENT_DEBOUNCE_MS = 300; // one re-read per burst of registry ops
const RETRY_BASE_MS = 1_000; // doubles after each failed first read

/** Null until a read of this workspace's registry lands; a stale or failed read never replaces the last good one. */
export function useRegistryRead<T>(
  label: string, // names the hook in the failed-read warning
  read: (client: RegistryClient) => Promise<T>,
  firstReadTries = 1, // only the first read retries: until then there is nothing to show
) {
  const { registryClient, registryContextId } = useDriveWorkspace();
  const readRef = useRef(read);
  readRef.current = read;
  const [loaded, setLoaded] = useState<{
    client: RegistryClient;
    data: T;
  } | null>(null);
  const seqRef = useRef(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadedForRef = useRef<unknown>(null);

  const load = useCallback(
    (attempt = 0) => {
      if (!registryClient) return;
      clearTimeout(retryRef.current);
      const seq = ++seqRef.current;
      readRef.current(registryClient).then(
        (data) => {
          if (seq !== seqRef.current) return;
          loadedForRef.current = registryClient;
          setLoaded({ client: registryClient, data });
        },
        (e: unknown) => {
          if (seq !== seqRef.current) return;
          console.warn(`[${label}] read failed`, e);
          const firstRead = loadedForRef.current !== registryClient;
          if (firstRead && attempt + 1 < firstReadTries) {
            retryRef.current = setTimeout(
              () => load(attempt + 1),
              RETRY_BASE_MS * 2 ** attempt,
            );
          }
        },
      );
    },
    [registryClient, label, firstReadTries],
  );

  useEffect(() => {
    load();
    return () => clearTimeout(retryRef.current);
  }, [load]);
  const reload = useCallback(() => load(), [load]);
  useContextEvents(registryContextId, reload, {
    strict: true,
    debounceMs: REGISTRY_EVENT_DEBOUNCE_MS,
  });

  const data = loaded?.client === registryClient ? loaded.data : null;
  const dataRef = useRef(data);
  dataRef.current = data;

  const update = useCallback(
    (change: (data: T) => T) =>
      setLoaded((prev) =>
        prev && prev.client === registryClient
          ? { ...prev, data: change(prev.data) }
          : prev,
      ),
    [registryClient],
  );

  return { data, dataRef, reload, update };
}
