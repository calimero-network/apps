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

  const load = useCallback(() => {
    if (!registryClient) return;
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
        setLoaded({ client: registryClient, tags });
      },
      (e: unknown) => {
        if (seq === seqRef.current) console.warn('[useTags] read failed', e);
      },
    );
  }, [registryClient]);

  useEffect(load, [load]);
  useContextEvents(registryContextId, load, {
    strict: true,
    debounceMs: REGISTRY_EVENT_DEBOUNCE_MS,
  });

  return useMemo(() => {
    const tags = loaded?.client === registryClient ? loaded.tags : [];
    return { tags, byKey: new Map(tags.map((t) => [t.key, t])) };
  }, [loaded, registryClient]);
}
