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
import { useMero } from '@calimero-network/mero-react';
import { toast } from 'sonner';
import { DocsClient } from '@/generated/docs/DocsClient';
import type { RegistryClient } from '@/generated/registry/RegistryClient';
import {
  findTagByName,
  normalizeTagName,
  tagKeyFor,
  type Tag,
} from '@/lib/tags';
import { settleInPool } from '@/lib/pool';
import type { IndexRow } from '@/lib/workspaceIndex/types';
import { useContextEvents } from './useContextEvents';
import { notifyDocsRefetch } from './useDocs';
import { useDriveWorkspace } from './useDriveWorkspace';
import { useNamespacePermissions } from './useNamespacePermissions';

const REGISTRY_EVENT_DEBOUNCE_MS = 300; // one re-read per burst of registry ops
const FIRST_READ_TRIES = 3; // a just-opened workspace's registry may not answer yet
const RETRY_BASE_MS = 1_000; // doubles after each failed first read
export const TAG_NAME_TAKEN = 'A tag with this name already exists';
const SAVE_FAILED = "Couldn't save the tag. Try again.";
const DELETE_FAILED = "Couldn't delete the tag. Try again.";
const TAG_DELETED = 'This tag has been deleted.';
const UNTAG_IN_FLIGHT = 4; // docs untagged at once while a tag is deleted

export class TagNameTakenError extends Error {
  constructor() {
    super(TAG_NAME_TAKEN);
    this.name = 'TagNameTakenError';
  }
}

export type TagsState = {
  tags: Tag[];
  byKey: Map<string, Tag>;
  /** The key of the live tag with this name, created if there is none. */
  createTag(name: string, color: string): Promise<string>;
  renameTag(key: string, name: string): Promise<void>;
  recolorTag(key: string, color: string): Promise<void>;
  /** Strips the tag from the docs in `editable` folders, then marks it deleted everywhere. */
  deleteTag(key: string, editable: ReadonlySet<string>): Promise<void>;
};

type IndexSource = {
  rows: IndexRow[];
  contextOf(folderId: string): string | undefined;
};

const notReady = () => Promise.reject(new Error('tags are not ready'));

export const TagsContext = createContext<TagsState>({
  tags: [],
  byKey: new Map(),
  createTag: notReady,
  renameTag: notReady,
  recolorTag: notReady,
  deleteTag: notReady,
});

/** The shared tag list and its writes, from the workspace provider. */
export function useTags(): TagsState {
  return useContext(TagsContext);
}

/** Editors and above manage tags; a Guest holds no workspace caps, so cannot create folders either. */
export function useCanManageTags(): boolean {
  const { namespaceId, rootGroupId } = useDriveWorkspace();
  return useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '')
    .canCreateFolder;
}

/** Reads the tags and re-reads on registry changes; a failed re-read keeps the last list. */
export function useTagsSource(index: IndexSource): TagsState {
  const { registryClient, registryContextId } = useDriveWorkspace();
  const { mero } = useMero();
  const indexRef = useRef(index);
  indexRef.current = index;
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
        (tags) => {
          if (seq !== seqRef.current) return;
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

  const tags = useMemo(
    () => (loaded?.client === registryClient ? loaded.tags : null),
    [loaded, registryClient],
  );
  const tagsRef = useRef(tags);
  tagsRef.current = tags;

  // A write shows at once; the re-read after it confirms it.
  const apply = useCallback(
    (next: Tag) => {
      setLoaded((prev) => {
        if (!prev || prev.client !== registryClient) return prev;
        const has = prev.tags.some((t) => t.key === next.key);
        return {
          ...prev,
          tags: has
            ? prev.tags.map((t) => (t.key === next.key ? next : t))
            : [...prev.tags, next],
        };
      });
      load();
    },
    [registryClient, load],
  );

  // Until the list is read, a new key could reuse a deleted one, so nothing is written.
  const write = useCallback(
    async (
      op: (client: RegistryClient, tags: Tag[]) => Promise<void>,
      failed: string,
    ) => {
      try {
        const current = tagsRef.current;
        if (!registryClient || !current) throw new Error('tags not read yet');
        await op(registryClient, current);
      } catch (e: unknown) {
        console.warn('[useTags] write failed', e);
        toast.error(failed);
        throw e;
      }
    },
    [registryClient],
  );

  const setTag = useCallback(
    async (next: Tag | undefined) => {
      await write((client) => {
        if (!next) throw new Error('unknown tag');
        return client.setTag({
          key: next.key,
          name: next.name,
          color: next.color,
        });
      }, SAVE_FAILED);
      if (next) apply(next);
    },
    [write, apply],
  );

  // Writing a deleted tag's record would bring it back everywhere.
  const changeTag = useCallback(
    async (key: string, change: (tag: Tag) => Tag) => {
      const tag = tagsRef.current?.find((t) => t.key === key);
      if (tag?.deleted) {
        toast.error(TAG_DELETED);
        throw new Error(`tag ${key} is deleted`);
      }
      await setTag(tag && change(tag));
    },
    [setTag],
  );

  const createTag = useCallback(
    async (raw: string, color: string) => {
      const name = normalizeTagName(raw);
      if (!name) throw new Error('empty tag name');
      const existing = findTagByName(tagsRef.current ?? [], name);
      if (existing) return existing.key;
      const key = tagKeyFor(
        name,
        new Set((tagsRef.current ?? []).map((t) => t.key)),
      );
      await setTag({ key, name, color, deleted: false });
      return key;
    },
    [setTag],
  );

  const renameTag = useCallback(
    async (key: string, raw: string) => {
      const name = normalizeTagName(raw);
      if (!name) throw new Error('empty tag name');
      const taken = findTagByName(tagsRef.current ?? [], name);
      if (taken && taken.key !== key) throw new TagNameTakenError();
      await changeTag(key, (tag) => ({ ...tag, name }));
    },
    [changeTag],
  );

  const recolorTag = useCallback(
    (key: string, color: string) =>
      changeTag(key, (tag) => ({ ...tag, color })),
    [changeTag],
  );

  const deleteTag = useCallback(
    async (key: string, editable: ReadonlySet<string>) => {
      await write(async (registry) => {
        const { rows, contextOf } = indexRef.current;
        const clients = new Map<string, DocsClient>();
        const untag = rows.flatMap((r) => {
          const contextId = contextOf(r.folderId);
          if (!mero || !contextId || !editable.has(r.folderId)) return [];
          if (!r.tags.includes(key)) return [];
          let client = clients.get(contextId);
          if (!client) {
            client = new DocsClient(mero, contextId);
            clients.set(contextId, client);
          }
          return [{ client, id: r.docId }];
        });
        const results = await settleInPool(untag, UNTAG_IN_FLIGHT, (doc) =>
          doc.client.removeTag({ id: doc.id, tag: key }),
        );
        // A doc left with the key shows nothing once the tag is deleted.
        for (const result of results) {
          if (result.status === 'rejected')
            console.warn('[useTags] untagging a doc failed', result.reason);
        }
        clients.forEach((_client, contextId) => notifyDocsRefetch(contextId));
        await registry.deleteTag({ key });
      }, DELETE_FAILED);
      const tag = tagsRef.current?.find((t) => t.key === key);
      if (tag) apply({ ...tag, deleted: true });
    },
    [mero, write, apply],
  );

  return useMemo(() => {
    const list = tags ?? [];
    return {
      tags: list,
      byKey: new Map(list.map((t) => [t.key, t])),
      createTag,
      renameTag,
      recolorTag,
      deleteTag,
    };
  }, [tags, createTag, renameTag, recolorTag, deleteTag]);
}
