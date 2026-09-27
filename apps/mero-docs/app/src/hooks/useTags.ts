// The workspace's tags: each doc carries only keys, and the registry maps a key
// to its name and colour, so one read here names every tag chip in the app.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RegistryClient } from '@/generated/registry/RegistryClient';
import type { Tag } from '@/lib/tags';
import { useContextEvents } from './useContextEvents';
import { useDriveWorkspace } from './useDriveWorkspace';

const REGISTRY_EVENT_DEBOUNCE_MS = 300; // one re-read per burst of registry ops
const FIRST_READ_TRIES = 3; // a just-opened workspace's registry may not answer yet
const RETRY_BASE_MS = 1_000; // doubles after each failed first read

export type TagsState = { tags: Tag[]; byKey: Map<string, Tag> };

export const TagsContext = createContext<TagsState>({
  tags: [],
  byKey: new Map(),
});

/** The shared tag list, from the workspace provider. */
export function useTags(): TagsState {
  return useContext(TagsContext);
}

/** Reads the tags and re-reads on registry changes; a failed re-read keeps the last list. */
export function useTagsSource(): TagsState {
  const { registryClient, registryContextId } = useDriveWorkspace();
  const [loaded, setLoaded] = useState<{
    client: Pick<RegistryClient, 'listTags'>;
    tags: Tag[];
  } | null>(null);
  const seqRef = useRef(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadedForRef = useRef<unknown>(null);

  // Until one read lands, a failure retries with backoff, or every chip shows a raw key.
  const load = useCallback(
    (attempt = 0) => {
      if (!registryClient) return;
      clearTimeout(retryRef.current);
      const seq = ++seqRef.current;
      registryClient.listTags().then(
        (dtos) => {
          if (seq !== seqRef.current) return;
          const tags = dtos.map(({ key, name, color, deleted }) => ({
            key,
            name,
            color,
            deleted,
          }));
          loadedForRef.current = registryClient;
          setLoaded({ client: registryClient, tags });
        },
        (e: unknown) => {
          if (seq !== seqRef.current) return;
          console.warn('[useTags] read failed', e);
          const firstRead = loadedForRef.current !== registryClient;
          if (firstRead && attempt + 1 < FIRST_READ_TRIES) {
            retryRef.current = setTimeout(
              () => load(attempt + 1),
              RETRY_BASE_MS * 2 ** attempt,
            );
          }
        },
      );
    },
    [registryClient],
  );

  useEffect(() => {
    load();
    return () => clearTimeout(retryRef.current);
  }, [load]);
  const onRegistryEvent = useCallback(() => load(), [load]);
  useContextEvents(registryContextId, onRegistryEvent, {
    strict: true,
    debounceMs: REGISTRY_EVENT_DEBOUNCE_MS,
  });

  return useMemo(() => {
    const tags = loaded?.client === registryClient ? loaded.tags : [];
    return { tags, byKey: new Map(tags.map((t) => [t.key, t])) };
  }, [loaded, registryClient]);
}
